// Claude-backed specialist agents + advising chat. Active only when credentials resolve
// (ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN).
//
// The SDK is loaded dynamically so the server still starts (in rules mode) when it is not
// installed. ANTHROPIC_SDK_DIR may point at an external node_modules folder.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { AgentSignalSchema } from "./schema.mjs";

const MODEL = "claude-opus-5";
let client = null;
let loadError = null;

async function loadSdk() {
  const dir = process.env.ANTHROPIC_SDK_DIR;
  if (dir) {
    const entry = path.join(dir, "@anthropic-ai", "sdk", "index.mjs");
    return (await import(pathToFileURL(entry).href)).default;
  }
  return (await import("@anthropic-ai/sdk")).default;
}

export async function initLLM() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return false;
  try {
    const Anthropic = await loadSdk();
    client = new Anthropic();
    return true;
  } catch (e) {
    loadError = e;
    console.warn("Claude SDK unavailable, staying in rules mode:", e.message);
    return false;
  }
}
export const llmAvailable = () => client !== null;
export const llmLoadError = () => loadError?.message ?? null;

const AGENT_PROMPTS = {
  transcript:
    "You are the transcript-pattern agent in a graduate-admissions support system. Examine the applicant's academic record for signals that predict whether they will COMPLETE the program — not just whether they are smart. Distinguish exam-based success from open-ended deliverable completion (theses, capstones, projects). Cite concrete evidence.",
  engagement:
    "You are the engagement-telemetry agent. Examine pre-admission behavior (info sessions, advisor correspondence, deadline timing) for follow-through patterns that correlate with attrition. Weight telemetry more lightly than transcript facts. Cite concrete evidence.",
  context:
    "You are the life-context agent. Examine employment, funding runway, visa timeline, stated intent, and program fit for factors that could make enrollment contingent or unsustainable. Never treat layoffs or personal circumstances as character judgments. Cite concrete evidence.",
};

export async function runAgentLLM(name, c) {
  const { narrative, ...structured } = c;
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: `${AGENT_PROMPTS[name]}\n\nReturn agent="${name}". Weights are the marginal reduction in completion probability (0–1). confidence reflects evidence quality.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: `Structured record:\n${JSON.stringify(structured, null, 2)}\n\nNarrative file:\n${narrative}` }],
    output_config: { format: { type: "json_schema", schema: AgentSignalSchema } },
  });
  const text = res.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`${name} agent: no text block (stop_reason=${res.stop_reason})`);
  return JSON.parse(text);
}

// Advising chat: two audiences with different information boundaries.
export async function* chatLLM({ audience, c, aggregate, messages }) {
  const boundary =
    audience === "coordinator"
      ? "You are advising a PROGRAM COORDINATOR. You may discuss the full agent output below, including scores. Lead with strengths, then surface risk plainly with evidence. Report confidence, never overstate. Refuse to auto-deny or to endorse characterizations based on stereotypes; recommend support plans over gatekeeping."
      : "You are advising the STUDENT directly. You must NOT disclose the risk score, completion probability, that they were \"flagged\", or any internal agent output. Be warm, honest about program structure, and practical. Never enter or submit forms on their behalf; never help misrepresent grades, finances, or documents.";
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: `${boundary}\n\nProgram: SJSU MS in Data Science. Verify time-sensitive facts against sjsu.edu.\n\nCase record:\n${JSON.stringify({ ...c, narrative: undefined }, null, 2)}\n\nNarrative:\n${c.narrative}\n\nAgent aggregate (${audience === "coordinator" ? "visible to you" : "INTERNAL — do not reveal"}):\n${JSON.stringify(aggregate, null, 2)}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
  }
}
