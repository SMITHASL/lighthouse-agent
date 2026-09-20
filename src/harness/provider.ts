/**
 * Model provider for the local harness: OpenAI Chat Completions over plain fetch (no SDK).
 * Model names keep the TrueForge form ("openai/gpt-5-5"); the prefix is stripped here.
 * OPENAI_BASE_URL lets any OpenAI-compatible endpoint stand in.
 */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ChatTool = { type: 'function'; function: { name: string; description: string; parameters: unknown } };

export type ChatReply = {
  content: string | null;
  tool_calls: ToolCall[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

export async function chatCompletion(req: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  response_format?: { type: 'json_schema'; json_schema: { name: string; schema: unknown; strict?: boolean } };
  reasoning_effort?: string;
}): Promise<ChatReply> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (the local harness calls the model directly)');
  const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = req.model.replace(/^openai\//, '');
  const body: Record<string, unknown> = { model, messages: req.messages };
  if (req.tools?.length) body.tools = req.tools;
  if (req.response_format) body.response_format = req.response_format;
  if (req.reasoning_effort && req.reasoning_effort !== 'none') body.reasoning_effort = req.reasoning_effort;

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`model call failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = (await res.json()) as {
    model: string;
    choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = json.choices[0]?.message;
  return {
    content: msg?.content ?? null,
    tool_calls: msg?.tool_calls ?? [],
    usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 },
    model: json.model,
  };
}
