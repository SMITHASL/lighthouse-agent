import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_NAMES, MODELS } from '../agents/manifests.ts';
import { FairnessAttestation, LongTermFitReport } from '../schema/report.ts';
import { finalOutput, indexEvents, type TurnEvent } from './client.ts';
import { HARNESS_MODE, createHarness, type Harness } from '../harness/index.ts';

export type Budget = { max_usd_per_report: number; spent_usd: number };

export type PipelineResult = {
  applicant_id: string;
  status: 'released' | 'withheld' | 'partial';
  report: LongTermFitReport | null;
  attestation: FairnessAttestation | null;
  sessions: { analyst?: string; fairness?: string; action?: string };
  approval: { paused: boolean; tool_call_id?: string; thread_id?: string; decision?: 'allowed' | 'denied'; reason?: string | null; decided_at?: string } | null;
  risk_flags: { type: string; detail: string }[];
  usage: { input_tokens: number; output_tokens: number; estimated_usd: number };
};

// Rough list prices per 1M tokens; enough to keep the demo inside the $50 credit.
const PRICE_USD_PER_M: Record<string, { in: number; out: number }> = {
  'openai/gpt-5-5': { in: 1.25, out: 10 },
  'openai/gpt-5-4-mini': { in: 0.25, out: 2 },
  'anthropic/claude-opus-5': { in: 5, out: 25 },
  'anthropic/claude-sonnet-5': { in: 2, out: 10 },
  'anthropic/claude-haiku-4-5': { in: 1, out: 5 },
};

function usageFromEvents(events: TurnEvent[], model: string) {
  let input = 0;
  let output = 0;
  for (const e of events) {
    const u = e.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (!u) continue;
    input += u.input_tokens ?? 0;
    output += u.output_tokens ?? 0;
  }
  const p = PRICE_USD_PER_M[model] ?? { in: 5, out: 25 }; // unknown model: assume Opus-tier so the cap errs safe
  return { input_tokens: input, output_tokens: output, estimated_usd: (input * p.in + output * p.out) / 1e6 };
}

function parseJson<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, raw: string | null): { ok: true; value: T } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: 'empty model output' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'output was not JSON' };
  }
  const r = schema.safeParse(parsed);
  return r.success && r.data !== undefined ? { ok: true, value: r.data } : { ok: false, reason: `schema violation: ${JSON.stringify(r.error).slice(0, 400)}` };
}

export type RunOptions = {
  client?: Harness;
  budget?: Budget;
  /** When false the action stage is skipped (evals never propose real actions). */
  proposeAction?: boolean;
  log?: (line: string) => void;
  /** Live progress: every runtime event, tagged with the pipeline stage it belongs to. */
  onEvent?: (stage: 'analyst' | 'fairness' | 'action', event: TurnEvent) => void;
};

export async function runReport(applicantId: string, opts: RunOptions = {}): Promise<PipelineResult> {
  const client = opts.client ?? createHarness();
  const log = opts.log ?? (() => {});
  const budget = opts.budget ?? { max_usd_per_report: 0.15, spent_usd: 0 };
  const result: PipelineResult = {
    applicant_id: applicantId,
    status: 'partial',
    report: null,
    attestation: null,
    sessions: {},
    approval: null,
    risk_flags: [],
    usage: { input_tokens: 0, output_tokens: 0, estimated_usd: 0 },
  };

  if (budget.spent_usd >= budget.max_usd_per_report) {
    result.risk_flags.push({ type: 'data_gap', detail: `budget exhausted before analysis (${budget.spent_usd.toFixed(3)} USD spent of ${budget.max_usd_per_report})` });
    return result;
  }

  try {
    // 1. Critical analysis
    const analystSession = await client.createSession(AGENT_NAMES.analyst);
    result.sessions.analyst = analystSession;
    log(`analyst session ${analystSession}`);
    // One retry covers both transport failures (flaky Wi-Fi) and schema violations (validation fed back).
    let report: { ok: true; value: LongTermFitReport } | { ok: false; reason: string } = { ok: false, reason: 'not run' };
    let message = `Produce the Long-Term Fit Report for applicant_id ${applicantId}. Return only the JSON.`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const analystEvents = await client.runTurn(analystSession, [{ type: 'user.message', content: message }], (e) => opts.onEvent?.('analyst', e));
      addUsage(result, usageFromEvents(analystEvents, MODELS.analyst));
      const analystOut = finalOutput(analystEvents);
      if (analystOut.status !== 'done') {
        report = { ok: false, reason: `analyst turn ended with status ${analystOut.status}` };
        log(`attempt ${attempt}: ${report.reason}`);
        continue;
      }
      report = parseJson(LongTermFitReport, analystOut.content);
      if (report.ok) break;
      log(`attempt ${attempt}: ${report.reason}`);
      message = `Your previous output failed validation: ${report.reason}. Return the complete corrected JSON report only.`;
    }
    if (!report.ok) {
      result.risk_flags.push({ type: 'data_gap', detail: `analyst output rejected after retry: ${report.reason}` });
      return result;
    }
    result.report = report.value;
    result.risk_flags.push(...report.value.risk_flags);

    // 2. Independent fairness audit (veto power)
    const fairnessSession = await client.createSession(AGENT_NAMES.fairness);
    result.sessions.fairness = fairnessSession;
    const fairnessEvents = await client.runTurn(
      fairnessSession,
      [{ type: 'user.message', content: `Audit this report and return only the JSON attestation:\n${JSON.stringify(report.value)}` }],
      (e) => opts.onEvent?.('fairness', e),
    );
    addUsage(result, usageFromEvents(fairnessEvents, MODELS.auditor));
    const attestation = parseJson(FairnessAttestation, finalOutput(fairnessEvents).content);
    if (!attestation.ok) {
      result.risk_flags.push({ type: 'fairness_concern', detail: `auditor output rejected: ${attestation.reason}; report withheld` });
      result.status = 'withheld';
      return result;
    }
    result.attestation = attestation.value;
    if (attestation.value.verdict === 'veto') {
      result.status = 'withheld';
      result.risk_flags.push({ type: 'fairness_concern', detail: attestation.value.reasoning });
      return result;
    }
    result.status = 'released';

    // 3. Propose the action — the harness pauses at the approval gate; a human resumes it.
    if (opts.proposeAction !== false && report.value.recommended_action.action !== 'no_action') {
      const actionSession = await client.createSession(AGENT_NAMES.action);
      result.sessions.action = actionSession;
      const { action, rationale } = report.value.recommended_action;
      const actionEvents = await client.runTurn(
        actionSession,
        [{ type: 'user.message', content: `applicant_id: ${applicantId}\naction: ${action}\nrationale: ${rationale}` }],
        (e) => opts.onEvent?.('action', e),
      );
      addUsage(result, usageFromEvents(actionEvents, MODELS.action));
      const pending = actionEvents.find((e) => e.type === 'tool.approval_required');
      const calls = (pending?.tool_calls as { id: string }[] | undefined) ?? [];
      result.approval = pending
        ? { paused: true, tool_call_id: calls[0]?.id ?? '', thread_id: (pending.thread_id ?? 'main') as string }
        : { paused: false };
      log(pending ? `approval required in session ${actionSession}` : 'no approval pause observed');
      void indexEvents;
    }
  } catch (err) {
    result.risk_flags.push({ type: 'data_gap', detail: `pipeline error: ${err instanceof Error ? err.message : String(err)}` });
  }
  return result;
}

function addUsage(r: PipelineResult, u: PipelineResult['usage']) {
  r.usage.input_tokens += u.input_tokens;
  r.usage.output_tokens += u.output_tokens;
  r.usage.estimated_usd += u.estimated_usd;
}

/** Resume a paused action session with a human decision. */
export async function decideApproval(sessionId: string, threadId: string, toolCallId: string, allow: boolean, reason?: string, client: Harness = createHarness()) {
  const approval = allow ? { status: 'allow' } : { status: 'deny', reason: reason ?? 'denied by reviewer' };
  return client.runTurn(sessionId, [{ type: 'user.tool_approval', thread_id: threadId, tool_call_id: toolCallId, approval }]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const id = process.argv[2] ?? 'app_0001';
  console.error(`harness: ${HARNESS_MODE}`);
  const res = await runReport(id, { log: (l) => console.error(l) });
  const dataDir = process.env.LIGHTHOUSE_DATA_DIR ?? 'data';
  mkdirSync(`${dataDir}/reports`, { recursive: true });
  writeFileSync(`${dataDir}/reports/${id}.json`, JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ status: res.status, sessions: res.sessions, approval: res.approval, usage: res.usage, risk_flags: res.risk_flags }, null, 2));
  if (res.approval?.paused && HARNESS_MODE === 'local')
    console.error(`paused for approval → npm run approve -- ${res.sessions.action} allow|deny "reason"`);
}
