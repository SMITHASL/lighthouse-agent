/**
 * Reviewer & Advising UI server — the screen an admissions office uses, on top of the real
 * pipeline and runtime (no separate agents, no separate data):
 *   GET  /api/applicants          queue: every applicant + status of its stored report
 *   GET  /api/applicants/:id      record + stored PipelineResult (report, attestation, approval)
 *   POST /api/run/:id             runReport(); streams NDJSON progress (stage + runtime events)
 *   POST /api/approve/:session    { allow, reason } → decideApproval() on the paused action session
 *   GET  /api/sessions[/:id]      the runtime's persisted sessions (observability)
 *   POST /api/chat/:id            advising chat, coordinator or student audience, grounded in the report
 * Zero dependencies: node:http + the modules in src/.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS_MODE, localHarness } from '../harness/index.ts';
import { decideApproval, runReport, type PipelineResult } from '../pipeline/run.ts';
import { loadStore } from '../tools/index.ts';
import { chat, type Audience } from './chat.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.LIGHTHOUSE_DATA_DIR ?? 'data';
const PORT = Number(process.env.PORT ?? 3100);

const store = loadStore(DATA);
const reportPath = (id: string) => path.join(DATA, 'reports', `${id}.json`);
const readResult = (id: string): PipelineResult | null => (existsSync(reportPath(id)) ? (JSON.parse(readFileSync(reportPath(id), 'utf8')) as PipelineResult) : null);
const writeResult = (r: PipelineResult) => { mkdirSync(path.join(DATA, 'reports'), { recursive: true }); writeFileSync(reportPath(r.applicant_id), JSON.stringify(r, null, 2)); };

const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = async (req: import('node:http').IncomingMessage) => { let b = ''; for await (const c of req) b += c; return b ? (JSON.parse(b) as Record<string, unknown>) : {}; };

function summary(id: string) {
  const a = store.applicants.get(id)!;
  const r = readResult(id);
  return {
    applicant_id: id,
    program: a.program,
    goals: a.stated_goals.slice(0, 80),
    status: r?.status ?? 'unscored',
    paused: r?.approval?.paused ?? false,
    action: r?.report?.recommended_action.action ?? null,
    completion: r?.report?.completion_likelihood.estimate ?? null,
    verdict: r?.attestation?.verdict ?? null,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  let m: RegExpMatchArray | null;
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(path.join(here, 'index.html')));
    }
    if (p === '/api/status') return json(res, 200, { harness: HARNESS_MODE, model_key: Boolean(process.env.OPENAI_API_KEY), applicants: store.applicants.size, data_dir: DATA });
    if (p === '/api/applicants') {
      const limit = Number(url.searchParams.get('limit') ?? 40);
      return json(res, 200, [...store.applicants.keys()].slice(0, limit).map(summary));
    }
    if ((m = p.match(/^\/api\/applicants\/([^/]+)$/))) {
      const a = store.applicants.get(m[1]!);
      return a ? json(res, 200, { applicant: a, result: readResult(m[1]!) }) : json(res, 404, { error: 'unknown applicant' });
    }
    if ((m = p.match(/^\/api\/run\/([^/]+)$/)) && req.method === 'POST') {
      const id = m[1]!;
      if (!store.applicants.has(id)) return json(res, 404, { error: 'unknown applicant' });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const send = (o: unknown) => res.write(JSON.stringify(o) + '\n');
      send({ stage: 'start', applicant_id: id, harness: HARNESS_MODE });
      const result = await runReport(id, {
        proposeAction: true,
        log: (line) => send({ stage: 'log', line }),
        onEvent: (stage, e) => {
          // Forward the events a reviewer can act on; skip the noise.
          if (e.type === 'tool.response' || e.type === 'tool.approval_required' || e.type === 'model.error' || e.type === 'turn.done')
            send({ stage, event: { type: e.type, name: e.name, session_id: e.session_id, tool_calls: e.tool_calls, state: e.state, error: e.error } });
          else if (e.type === 'model.message') send({ stage, event: { type: e.type, usage: e.usage, tool_calls: (e.tool_calls as { name: string }[] | undefined)?.map((t) => t.name) } });
        },
      });
      writeResult(result);
      send({ stage: 'result', result });
      return res.end();
    }
    if ((m = p.match(/^\/api\/approve\/([^/]+)$/)) && req.method === 'POST') {
      const sessionId = m[1]!;
      const { allow, reason } = (await readBody(req)) as { allow?: boolean; reason?: string };
      const s = localHarness().readSession(sessionId);
      if (!s.pending) return json(res, 409, { error: 'no pending approval on this session' });
      const events = await decideApproval(sessionId, 'main', s.pending.tool_call_id, Boolean(allow), reason);
      const done = events.find((e) => e.type === 'turn.done');
      // Reflect the decision on the stored result so the queue shows it.
      const applicantId = String(s.pending.arguments.applicant_id ?? '');
      const r = readResult(applicantId);
      if (r?.approval) { r.approval = { ...r.approval, paused: false, decision: allow ? 'allowed' : 'denied', reason: reason ?? null, decided_at: new Date().toISOString() }; writeResult(r); }
      return json(res, 200, { decision: allow ? 'allowed' : 'denied', state: done?.state ?? null });
    }
    if (p === '/api/sessions') return json(res, 200, localHarness().listSessions().slice(0, 100));
    if ((m = p.match(/^\/api\/sessions\/([^/]+)$/))) return json(res, 200, localHarness().readSession(m[1]!));
    if ((m = p.match(/^\/api\/chat\/([^/]+)$/)) && req.method === 'POST') {
      const id = m[1]!;
      const a = store.applicants.get(id);
      if (!a) return json(res, 404, { error: 'unknown applicant' });
      const { audience = 'student', messages = [] } = (await readBody(req)) as { audience?: Audience; messages?: { role: 'user' | 'assistant'; content: string }[] };
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      try {
        for await (const chunk of chat({ audience, applicant: a, result: readResult(id), messages })) res.write(chunk);
      } catch (e) {
        res.write(`\n[error: ${e instanceof Error ? e.message : String(e)}]`);
      }
      return res.end();
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    else res.end();
  }
});

server.listen(PORT, () => console.log(`Lighthouse reviewer UI on http://localhost:${PORT}  harness=${HARNESS_MODE}  applicants=${store.applicants.size}  data=${DATA}`));
