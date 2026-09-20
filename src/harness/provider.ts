/**
 * Model provider for the local harness: the OpenAI Responses API over plain fetch (no SDK).
 * Responses (not Chat Completions) because GPT-5.x rejects function tools + reasoning_effort on
 * /v1/chat/completions. Calls chain with previous_response_id, so each request carries only the
 * new input items and the model's reasoning state survives an approval pause.
 * OPENAI_BASE_URL lets any OpenAI-compatible endpoint stand in.
 */
export type InputItem =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export type ToolCall = { id: string; call_id: string; name: string; arguments: string };
export type ResponsesTool = { type: 'function'; name: string; description: string; parameters: unknown; strict?: boolean };

export type ModelReply = {
  response_id: string;
  content: string | null;
  tool_calls: ToolCall[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

/**
 * Manifests use TrueForge-normalised names ("openai/gpt-5-5"); OpenAI's API wants "gpt-5.5".
 * Only the version dash after "gpt-5" becomes a dot; suffixes like "-mini" stay.
 */
export function toOpenAIModelId(name: string): string {
  const bare = name.replace(/^openai\//, '');
  return bare.replace(/^gpt-5-(\d)/, 'gpt-5.$1');
}

export async function createResponse(req: {
  model: string;
  instructions: string;
  input: InputItem[];
  previous_response_id?: string;
  tools?: ResponsesTool[];
  json_schema?: { name: string; schema: unknown; strict?: boolean };
  reasoning_effort?: string;
}): Promise<ModelReply> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (the local harness calls the model directly)');
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
    status?: string;
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
