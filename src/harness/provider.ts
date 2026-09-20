/**
 * Model providers for the local harness, over plain fetch (the repo is dependency-free by design,
 * so the official SDKs are not used; the wire shapes below follow each vendor's documented API).
 *
 *   openai/<model>     OpenAI Responses API. Stateful: chains on previous_response_id, so each call
 *                      sends only the new input items.
 *   anthropic/<model>  Anthropic Messages API. Stateless: each call sends the whole transcript.
 *
 * Both take the same request and return the same reply, so the runtime does not care which vendor
 * an agent runs on — which is the point: the fairness auditor can run on a different vendor from
 * the analyst it audits.
 */
import './env.ts'; // .env → process.env, so every entrypoint that calls a model picks the keys up

export type InputItem =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export type ToolCall = { id: string; call_id: string; name: string; arguments: string };
export type ResponsesTool = { type: 'function'; name: string; description: string; parameters: unknown; strict?: boolean };

export type ModelReply = {
  /** Vendor conversation handle, when the vendor keeps state (OpenAI response id); otherwise null. */
  response_id: string | null;
  content: string | null;
  tool_calls: ToolCall[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

export type ModelRequest = {
  model: string;
  instructions: string;
  /** Items not yet seen by a stateful vendor (OpenAI): sent with previous_response_id. */
  input: InputItem[];
  /** The whole transcript, for stateless vendors (Anthropic). */
  history?: InputItem[];
  previous_response_id?: string | null;
  tools?: ResponsesTool[];
  json_schema?: { name: string; schema: unknown; strict?: boolean };
  reasoning_effort?: string;
};

export type Vendor = 'openai' | 'anthropic';
export function vendorOf(model: string): Vendor {
  return model.startsWith('anthropic/') ? 'anthropic' : 'openai';
}

/**
 * Manifests use TrueForge-normalised names ("openai/gpt-5-5"); OpenAI's API wants "gpt-5.5".
 * Only the version dash after "gpt-5" becomes a dot; suffixes like "-mini" stay.
 */
export function toOpenAIModelId(name: string): string {
  const bare = name.replace(/^openai\//, '');
  return bare.replace(/^gpt-5-(\d)/, 'gpt-5.$1');
}

export async function createResponse(req: ModelRequest): Promise<ModelReply> {
  return vendorOf(req.model) === 'anthropic' ? anthropicMessages(req) : openaiResponses(req);
}

// ---------------------------------------------------------------- OpenAI Responses API
async function openaiResponses(req: ModelRequest): Promise<ModelReply> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (needed for openai/* models)');
  const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const body: Record<string, unknown> = { model: toOpenAIModelId(req.model), instructions: req.instructions, input: req.input, store: true };
  if (req.previous_response_id) body.previous_response_id = req.previous_response_id;
  if (req.tools?.length) body.tools = req.tools;
  if (req.json_schema) body.text = { format: { type: 'json_schema', name: req.json_schema.name, schema: req.json_schema.schema, strict: req.json_schema.strict ?? false } };
  if (req.reasoning_effort && req.reasoning_effort !== 'none') body.reasoning = { effort: req.reasoning_effort };

  const res = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`model call failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = (await res.json()) as {
    id: string;
    model: string;
    error?: { message: string } | null;
    output: { type: string; id?: string; call_id?: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (json.error) throw new Error(`model error: ${json.error.message}`);
  const texts: string[] = [];
  const tool_calls: ToolCall[] = [];
  for (const item of json.output ?? []) {
    if (item.type === 'message') {
      for (const c of item.content ?? []) if (c.type === 'output_text' && c.text) texts.push(c.text);
    } else if (item.type === 'function_call') {
      tool_calls.push({ id: item.id ?? '', call_id: item.call_id ?? '', name: item.name ?? '', arguments: item.arguments ?? '' });
    }
  }
  return {
    response_id: json.id,
    content: texts.length ? texts.join('') : null,
    tool_calls,
    usage: { input_tokens: json.usage?.input_tokens ?? 0, output_tokens: json.usage?.output_tokens ?? 0 },
    model: json.model,
  };
}

// ---------------------------------------------------------------- Anthropic Messages API
type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] };

/** Map the vendor-neutral transcript onto Messages-API turns, merging consecutive same-role items. */
export function toAnthropicMessages(history: InputItem[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  const push = (role: 'user' | 'assistant', block: AnthropicBlock) => {
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const item of history) {
    if ('role' in item) {
      if (item.role === 'system') continue; // instructions travel in `system`
      push(item.role, { type: 'text', text: item.content });
    } else if (item.type === 'function_call') {
      let input: unknown = {};
      try { input = JSON.parse(item.arguments || '{}'); } catch { /* leave empty */ }
      push('assistant', { type: 'tool_use', id: item.call_id, name: item.name, input });
    } else if (item.type === 'function_call_output') {
      push('user', { type: 'tool_result', tool_use_id: item.call_id, content: item.output });
    }
  }
  return out;
}

async function anthropicMessages(req: ModelRequest): Promise<ModelReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (needed for anthropic/* models)');
  const base = (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
  const model = req.model.replace(/^anthropic\//, '');
  const body: Record<string, unknown> = {
    model,
    max_tokens: 16000,
    system: req.instructions,
    messages: toAnthropicMessages(req.history ?? req.input),
    // Opt into server-side refusal fallbacks: a safety-classifier decline is re-run on a fallback model in the same call.
    fallbacks: 'default',
  };
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const output_config: Record<string, unknown> = {};
  if (req.json_schema) output_config.format = { type: 'json_schema', schema: req.json_schema.schema };
  if (req.reasoning_effort && req.reasoning_effort !== 'none') output_config.effort = req.reasoning_effort;
  if (Object.keys(output_config).length) body.output_config = output_config;

  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`model call failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = (await res.json()) as {
    id: string;
    model: string;
    stop_reason: string;
    stop_details?: { category?: string | null; explanation?: string } | null;
    content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (json.stop_reason === 'refusal') throw new Error(`model refused (${json.stop_details?.category ?? 'unspecified'}): ${json.stop_details?.explanation ?? ''}`);
  const texts: string[] = [];
  const tool_calls: ToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type === 'text' && block.text) texts.push(block.text);
    else if (block.type === 'tool_use') tool_calls.push({ id: block.id ?? '', call_id: block.id ?? '', name: block.name ?? '', arguments: JSON.stringify(block.input ?? {}) });
  }
  return {
    response_id: null,
    content: texts.length ? texts.join('') : null,
    tool_calls,
    usage: { input_tokens: json.usage?.input_tokens ?? 0, output_tokens: json.usage?.output_tokens ?? 0 },
    model: json.model,
  };
}
