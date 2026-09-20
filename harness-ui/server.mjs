// Zero-dependency harness server (Node built-ins only). Cases are parsed straight
// from ./cases/*.md so the markdown stays the single source of truth.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcriptAgent, engagementAgent, contextAgent, aggregate } from "./agents/rules.mjs";
import { initLLM, llmAvailable, llmLoadError, runAgentLLM, chatLLM } from "./agents/llm.mjs";
import { chatRules } from "./agents/chatRules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "cases");

function loadCases() {
  const out = {};
  for (const f of fs.readdirSync(root).filter((f) => /^example_case_.*\.md$/.test(f))) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    if (!blocks.length) continue;
    const c = JSON.parse(blocks.at(-1));
    c.narrative = text.split("## 5.")[0];
    c.source_file = f;
    out[c.case_id] = c;
  }
  return out;
}
const cases = loadCases();
const RULE_AGENTS = { transcript: transcriptAgent, engagement: engagementAgent, context: contextAgent };
const lastRun = {}; // case_id -> aggregate, so chat can reference the latest run

const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => ok(b ? JSON.parse(b) : {})); });

async function runCase(c, useLLM, res) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  send({ stage: "start", mode: useLLM ? "claude" : "rules" });
  const signals = [];
  for (const name of Object.keys(RULE_AGENTS)) {
    send({ stage: "agent_start", agent: name });
    let sig;
    try {
      sig = useLLM ? await runAgentLLM(name, c) : RULE_AGENTS[name](c);
    } catch (e) {
      send({ stage: "agent_error", agent: name, error: String(e.message ?? e) });
      sig = RULE_AGENTS[name](c); // fall back so the run completes
    }
    signals.push(sig);
    send({ stage: "agent_done", signal: sig });
  }
  const agg = aggregate(c, signals);
  lastRun[c.case_id] = agg;
  send({ stage: "aggregate", aggregate: agg });
  res.end();
}

async function chat(c, body, res) {
  const { audience = "student", messages = [] } = body;
  const agg = lastRun[c.case_id] ?? aggregate(c, Object.values(RULE_AGENTS).map((f) => f(c)));
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  if (!llmAvailable()) return res.end(chatRules({ audience, c, aggregate: agg, text: messages.at(-1)?.content ?? "" }));
  try {
    for await (const chunk of chatLLM({ audience, c, aggregate: agg, messages })) res.write(chunk);
  } catch (e) {
    res.write(`\n[error: ${e.message}]`);
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(path.join(here, "public", "index.html")).pipe(res);
    }
    if (p === "/api/status") return json(res, 200, { mode: llmAvailable() ? "claude" : "rules", model: "claude-opus-5", sdk_error: llmLoadError(), cases: Object.keys(cases).length });
    if (p === "/api/cases") return json(res, 200, Object.values(cases).map((c) => ({ case_id: c.case_id, name: c.applicant.name, residency: c.applicant.residency, school: c.applicant.degree.school })));
    let m;
    if ((m = p.match(/^\/api\/cases\/([^/]+)$/))) { const c = cases[m[1]]; return c ? json(res, 200, c) : json(res, 404, { error: "unknown case" }); }
    if ((m = p.match(/^\/api\/run\/([^/]+)$/)) && req.method === "POST") { const c = cases[m[1]]; return c ? runCase(c, url.searchParams.get("mode") !== "rules" && llmAvailable(), res) : json(res, 404, { error: "unknown case" }); }
    if ((m = p.match(/^\/api\/chat\/([^/]+)$/)) && req.method === "POST") { const c = cases[m[1]]; return c ? chat(c, await readBody(req), res) : json(res, 404, { error: "unknown case" }); }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

const PORT = process.env.PORT || 3100;
await initLLM();
server.listen(PORT, () => console.log(`Harness on http://localhost:${PORT}  mode=${llmAvailable() ? "claude" : "rules"}  cases=${Object.keys(cases).join(",")}`));
