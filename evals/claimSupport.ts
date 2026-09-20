/**
 * Claim-support judge. "0 hallucinated source fields" only proves every cited field exists on the
 * record; this asks a separate, cheaper model whether the field's ACTUAL VALUE supports the claim.
 *
 *   npm run eval:claims            judge every released report in data/reports (~$0.25 for 30)
 *   npm run eval:claims -- --n=5   first 5 only
 *
 * One call per report (all its claims batched), GPT-5.4-mini, JSON-schema output. Verdicts:
 *   supported      the value substantiates the claim as stated
 *   partially      the value is consistent with the claim but the claim overstates or adds detail
 *   unsupported    the value contradicts the claim or has no bearing on it
 *   field_missing  the cited path does not resolve on the record (also counted by the existence check)
 * Gate: unsupported rate ≤ 5%. Written to evals/results/claim-support-<ts>.json and merged into
 * SCOREBOARD.md by evals/run.ts (or by this CLI when run standalone).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createResponse } from '../src/harness/provider.ts';
import { z } from '../src/lib/schema.ts';
import type { LongTermFitReport } from '../src/schema/report.ts';
import type { PipelineResult } from '../src/pipeline/run.ts';

export const JUDGE_MODEL = 'openai/gpt-5-4-mini';
export const UNSUPPORTED_MAX = 0.05;

export type Claim = { outcome: string; kind: 'evidence' | 'counter_evidence'; claim: string; source_field: string; quality: string };
export type Verdict = 'supported' | 'partially' | 'unsupported' | 'field_missing';
export type Judgement = Claim & { applicant_id: string; field_value: unknown; verdict: Verdict; reason: string };

/** Resolve a dot/bracket path ("activities[0].role") on a record; undefined when it does not exist. */
export function resolveField(record: unknown, path: string): { found: boolean; value: unknown } {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = record;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || !(p in (cur as Record<string, unknown>))) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[p];
  }
  return { found: true, value: cur };
}

/** Every evidence and counter-evidence claim in a report, tagged with its outcome. */
export function collectClaims(report: LongTermFitReport): Claim[] {
  type Est = { evidence: LongTermFitReport['completion_likelihood']['evidence']; counter_evidence: LongTermFitReport['completion_likelihood']['counter_evidence'] };
  const groups: [string, Est][] = [['completion', report.completion_likelihood], ...Object.entries(report.alumni_engagement_profile)];
  return groups.flatMap(([outcome, e]) => [
    ...e.evidence.map((c) => ({ outcome, kind: 'evidence' as const, claim: c.claim, source_field: c.source_field, quality: c.quality })),
    ...e.counter_evidence.map((c) => ({ outcome, kind: 'counter_evidence' as const, claim: c.claim, source_field: c.source_field, quality: c.quality })),
  ]);
}

const JudgeOutput = z.object({
  verdicts: z.array(z.object({ index: z.number().int().min(0), verdict: z.enum(['supported', 'partially', 'unsupported']), reason: z.string().min(1) }).strict()),
}).strict();

const INSTRUCTIONS = `You are a strict evidence auditor. For each numbered claim you receive the claim text and the ACTUAL VALUE of the record field it cites. Judge only whether that value substantiates the claim as written:
- supported: the value clearly substantiates the claim (a reasonable reader would accept the claim from that value alone).
- partially: the value is consistent with the claim but the claim adds interpretation, degree, or detail the value does not carry.
- unsupported: the value contradicts the claim, or has no bearing on it, or the claim asserts something the value cannot show.
Do not reward plausibility from outside knowledge; judge from the value only. Return one verdict per index, every index exactly once.`;

export async function judgeReport(applicantId: string, report: LongTermFitReport, record: unknown): Promise<Judgement[]> {
  const claims = collectClaims(report);
  const resolved = claims.map((c) => ({ ...c, ...resolveField(record, c.source_field) }));
  const askable = resolved.map((c, index) => ({ c, index })).filter(({ c }) => c.found);
  const judged = new Map<number, { verdict: Verdict; reason: string }>();
  if (askable.length) {
    const items = askable.map(({ c, index }) => `#${index} [${c.outcome} / ${c.kind}] claim: ${JSON.stringify(c.claim)}\n    field ${c.source_field} = ${JSON.stringify(c.value)}`).join('\n');
    const reply = await createResponse({
      model: JUDGE_MODEL,
      instructions: INSTRUCTIONS,
      input: [{ role: 'user', content: `Applicant ${applicantId}. Claims:\n${items}` }],
      json_schema: { name: 'claim_verdicts', schema: JudgeOutput.toJsonSchema(), strict: false },
      reasoning_effort: 'low',
    });
    const parsed = JudgeOutput.safeParse(JSON.parse(reply.content ?? '{}'));
    if (!parsed.success) throw new Error(`judge output rejected for ${applicantId}: ${parsed.error.message}`);
    for (const v of parsed.data.verdicts) judged.set(v.index, { verdict: v.verdict as Verdict, reason: v.reason });
  }
  return resolved.map((c, index) => {
    const j = c.found ? judged.get(index) : undefined;
    return {
      applicant_id: applicantId,
      outcome: c.outcome, kind: c.kind, claim: c.claim, source_field: c.source_field, quality: c.quality,
      field_value: c.value,
      verdict: !c.found ? 'field_missing' : (j?.verdict ?? 'unsupported'),
      reason: !c.found ? 'cited field does not exist on the record' : (j?.reason ?? 'judge returned no verdict for this claim'),
    };
  });
}

export function summarize(judgements: Judgement[]) {
  const n = judgements.length;
  const count = (v: Verdict) => judgements.filter((j) => j.verdict === v).length;
  const byQuality: Record<string, { n: number; unsupported: number }> = {};
  for (const j of judgements) {
    byQuality[j.quality] ??= { n: 0, unsupported: 0 };
    byQuality[j.quality]!.n++;
    if (j.verdict === 'unsupported') byQuality[j.quality]!.unsupported++;
  }
  const unsupported = count('unsupported');
  return {
    claims: n,
    supported: count('supported'),
    partially: count('partially'),
    unsupported,
    field_missing: count('field_missing'),
    supported_rate: n ? count('supported') / n : 0,
    unsupported_rate: n ? unsupported / n : 0,
    unsupported_by_quality: Object.fromEntries(Object.entries(byQuality).map(([q, v]) => [q, v.n ? v.unsupported / v.n : 0])),
    gate_pass: n === 0 ? false : unsupported / n <= UNSUPPORTED_MAX,
  };
}

export type ClaimSupportSummary = ReturnType<typeof summarize>;

/** Judge every released report under dataDir/reports; returns the summary and writes the detail file. */
export async function judgeStoredReports(opts: { dataDir?: string; n?: number; log?: (s: string) => void } = {}) {
  const dataDir = opts.dataDir ?? 'data';
  const log = opts.log ?? (() => {});
  const applicants = new Map((JSON.parse(readFileSync(`${dataDir}/applicants.json`, 'utf8')) as { applicant_id: string }[]).map((a) => [a.applicant_id, a]));
  const files = readdirSync(`${dataDir}/reports`).filter((f) => f.endsWith('.json')).sort().slice(0, opts.n ?? Infinity);
  const all: Judgement[] = [];
  for (const f of files) {
    const r = JSON.parse(readFileSync(`${dataDir}/reports/${f}`, 'utf8')) as PipelineResult;
    if (!r.report) continue;
    const before = Date.now();
    const js = await judgeReport(r.applicant_id, r.report, applicants.get(r.applicant_id));
    all.push(...js);
    const s = summarize(js);
    log(`${r.applicant_id}: ${s.claims} claims — ${s.supported} supported, ${s.partially} partial, ${s.unsupported} unsupported (${((Date.now() - before) / 1000).toFixed(1)}s)`);
  }
  const summary = summarize(all);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync('evals/results', { recursive: true });
  const out = `evals/results/claim-support-${ts}.json`;
  writeFileSync(out, JSON.stringify({ run_at: new Date().toISOString(), model: JUDGE_MODEL, summary, judgements: all }, null, 2));
  return { summary, out, judgements: all };
}

export function scoreboardSection(s: ClaimSupportSummary, model = JUDGE_MODEL): string[] {
  return [
    '## Claim support (independent judge reads the cited field value)',
    `- Judge: ${model}. Claims judged: ${s.claims} — supported ${s.supported} (${(s.supported_rate * 100).toFixed(1)}%), partially ${s.partially}, unsupported ${s.unsupported} (${(s.unsupported_rate * 100).toFixed(1)}%), field missing ${s.field_missing}`,
    `- Unsupported rate by evidence grade: ${Object.entries(s.unsupported_by_quality).map(([q, v]) => `${q} ${(v * 100).toFixed(1)}%`).join(', ')}`,
    `- ${s.gate_pass ? 'PASS' : 'FAIL'} claim_support (unsupported ≤ ${UNSUPPORTED_MAX * 100}%)`,
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = new Map(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  const n = args.has('--n') ? Number(args.get('--n')) : undefined;
  const { summary, out } = await judgeStoredReports({ n, log: (s) => console.error(s) });
  console.log(scoreboardSection(summary).join('\n'));
  console.log(`\ndetail: ${out}`);
  // Merge into the scoreboard: replace an existing section or append before "## Gates".
  const sb = 'evals/SCOREBOARD.md';
  if (existsSync(sb)) {
    let md = readFileSync(sb, 'utf8');
    const section = scoreboardSection(summary).join('\n') + '\n\n';
    md = md.includes('## Claim support') ? md.replace(/## Claim support[\s\S]*?(?=\n## )/, section.trimEnd() + '\n') : md.replace('## Gates', section + '## Gates');
    md = md.replace(/- (PASS|FAIL) claim_support_gate\n/, '').replace('## Gates\n', `## Gates\n- ${summary.gate_pass ? 'PASS' : 'FAIL'} claim_support\n`);
    writeFileSync(sb, md);
    console.log(`updated ${sb}`);
  }
  if (!summary.gate_pass) process.exit(1);
}
