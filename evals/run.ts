import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadDomainPack } from '../src/agents/domainPacks.js';
import { auroc, brier, ciCoverage, demographicParityDifference, ece, equalOpportunityDifference, mean, stddev } from '../src/metrics/index.js';
import { runReport, type PipelineResult } from '../src/pipeline/run.js';
import { GroundTruth, ProtectedLabels, type LongTermFitReport } from '../src/schema/index.js';

// Caps from PROMPT.md §9a. The projected cost is printed before any model call.
const CAP_USD_PER_RUN = 10;
const EST_USD_PER_REPORT = 0.06;
const THRESHOLDS = { ece_max: 0.15, ci_coverage_min: 0.8, parity_max: 0.1, hallucination_max: 0.01, consistency_max_std: 0.1 };

const args = new Map(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const n = args.has('--full') ? 500 : Number(args.get('--n') ?? 20);
const consistencyRuns = Number(args.get('--consistency') ?? 3);
const concurrency = Number(args.get('--concurrency') ?? 4);

const projected = (n + consistencyRuns) * EST_USD_PER_REPORT;
console.log(`eval: ${n} reports + ${consistencyRuns} consistency runs → projected ≈ $${projected.toFixed(2)} (cap $${CAP_USD_PER_RUN})`);
if (projected > CAP_USD_PER_RUN) {
  console.error('projected cost exceeds cap; lower --n or raise the cap deliberately');
  process.exit(2);
}

const truth = new Map((JSON.parse(readFileSync('data/ground_truth.json', 'utf8')) as unknown[]).map((t) => GroundTruth.parse(t)).map((t) => [t.applicant_id, t]));
const labels = new Map((JSON.parse(readFileSync('data/protected_labels.json', 'utf8')) as unknown[]).map((l) => ProtectedLabels.parse(l)).map((l) => [l.applicant_id, l]));
const applicants = (JSON.parse(readFileSync('data/applicants.json', 'utf8')) as { applicant_id: string }[]).slice(0, n);
const applicantFields = new Map((JSON.parse(readFileSync('data/applicants.json', 'utf8')) as { applicant_id: string }[]).map((a) => [a.applicant_id, a]));

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const item = items[i++]!;
        out.push(await fn(item));
      }
    }),
  );
  return out;
}

let spent = 0;
const results = await pool(applicants, concurrency, async (a) => {
  const r = await runReport(a.applicant_id, { proposeAction: false });
  if (r.report) {
    mkdirSync('data/reports', { recursive: true });
    writeFileSync(`data/reports/${a.applicant_id}.json`, JSON.stringify(r, null, 2));
  }
  spent += r.usage.estimated_usd;
  process.stderr.write(`${a.applicant_id} ${r.status} $${r.usage.estimated_usd.toFixed(3)} (total $${spent.toFixed(2)})\n`);
  if (spent > CAP_USD_PER_RUN) throw new Error('cost cap exceeded mid-run');
  // A report that failed before any model call is an infrastructure fault (agents not registered,
  // no API key, wrong endpoint), not a model result. Abort rather than score an empty run.
  if (r.report === null && r.usage.input_tokens === 0) {
    const why = r.risk_flags.map((f) => f.detail).join('; ') || 'unknown';
    throw new Error(`${a.applicant_id}: no model call was made (${why}). Run \`npm run setup\` and check OPENAI_API_KEY before evaluating.`);
  }
  return r;
});

const released = results.filter((r): r is PipelineResult & { report: LongTermFitReport } => r.report !== null);
if (released.length === 0) {
  console.error('no reports were released; refusing to write a scoreboard with no data');
  process.exit(1);
}

// --- A. Predictive quality vs. base-rate baseline
const pack = loadDomainPack('university-admissions');
const outcomes = {
  completion: { get: (r: LongTermFitReport) => r.completion_likelihood, y: (t: GroundTruth) => t.completed, base: pack.base_rates.completion! },
  volunteer: { get: (r: LongTermFitReport) => r.alumni_engagement_profile.volunteer, y: (t: GroundTruth) => t.volunteered, base: pack.base_rates.volunteer! },
  cheerleader: { get: (r: LongTermFitReport) => r.alumni_engagement_profile.cheerleader, y: (t: GroundTruth) => t.cheerled, base: pack.base_rates.cheerleader! },
  donor: { get: (r: LongTermFitReport) => r.alumni_engagement_profile.donor, y: (t: GroundTruth) => t.donated, base: pack.base_rates.donor! },
  recruiter: { get: (r: LongTermFitReport) => r.alumni_engagement_profile.recruiter, y: (t: GroundTruth) => t.referrals_5y > 0, base: pack.base_rates.recruiter! },
};
const predictive: Record<string, Record<string, number>> = {};
const fairness: Record<string, Record<string, number>> = {};
for (const [name, o] of Object.entries(outcomes)) {
  const rows = released.flatMap((r) => {
    const e = o.get(r.report);
    const t = truth.get(r.applicant_id);
    const l = labels.get(r.applicant_id);
    if (!t || !l || e.estimate === null || e.ci_low === null || e.ci_high === null) return [];
    return [{ p: e.estimate, lo: e.ci_low, hi: e.ci_high, y: o.y(t), group: l.synthetic_group, wealth: l.synthetic_family_wealth }];
  });
  const baseline = rows.map((r) => ({ p: o.base, y: r.y }));
  predictive[name] = {
    n: rows.length,
    auroc: auroc(rows),
    brier: brier(rows),
    brier_baseline: brier(baseline),
    ece: ece(rows),
    ece_baseline: ece(baseline),
    ci_coverage: ciCoverage(rows),
  };
  fairness[name] = {
    parity_group: demographicParityDifference(rows),
    equal_opportunity_group: equalOpportunityDifference(rows),
    parity_wealth: demographicParityDifference(rows.map((r) => ({ p: r.p, group: r.wealth }))),
  };
}

// --- B. Reasoning quality: evidence grounding (every source_field must resolve on the record)
function resolves(obj: unknown, path: string): boolean {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || !(p in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return true;
}
let claims = 0;
let ungrounded = 0;
for (const r of released) {
  const record = applicantFields.get(r.applicant_id);
  const all = [r.report.completion_likelihood, ...Object.values(r.report.alumni_engagement_profile)].flatMap((e) => [...e.evidence, ...e.counter_evidence]);
  for (const ev of all) {
    claims++;
    if (!resolves(record, ev.source_field)) ungrounded++;
  }
}
const counterEvidencePresent = released.filter((r) => r.report.critical_analysis.strongest_case_against.length > 20 && r.report.completion_likelihood.counter_evidence.length > 0).length;

// --- Consistency: same applicant, repeated runs
const consistencyId = applicants[0]?.applicant_id;
const repeats = consistencyId ? await pool(Array.from({ length: consistencyRuns }), 2, () => runReport(consistencyId, { proposeAction: false })) : [];
const repeatEstimates = repeats.flatMap((r) => (r.report?.completion_likelihood.estimate === null || r.report === null ? [] : [r.report.completion_likelihood.estimate]));
spent += repeats.reduce((s, r) => s + r.usage.estimated_usd, 0);

// --- E. Ops
const ops = {
  reports_requested: results.length,
  released: results.filter((r) => r.status === 'released').length,
  withheld: results.filter((r) => r.status === 'withheld').length,
  partial: results.filter((r) => r.status === 'partial').length,
  cost_total_usd: spent,
  cost_per_report_usd: spent / Math.max(1, results.length + repeats.length),
  mean_input_tokens: mean(results.map((r) => r.usage.input_tokens)),
  mean_output_tokens: mean(results.map((r) => r.usage.output_tokens)),
};

const summary = {
  run_at: new Date().toISOString(),
  n,
  predictive,
  reasoning: {
    evidence_claims: claims,
    hallucinated_source_fields: ungrounded,
    hallucination_rate: claims ? ungrounded / claims : 0,
    counter_evidence_present_rate: released.length ? counterEvidencePresent / released.length : 0,
    consistency_std_completion: stddev(repeatEstimates),
    consistency_runs: repeatEstimates.length,
  },
  fairness,
  ops,
  gates: {
    hallucination: (claims ? ungrounded / claims : 0) <= THRESHOLDS.hallucination_max,
    consistency: repeatEstimates.length < 2 || stddev(repeatEstimates) <= THRESHOLDS.consistency_max_std,
    parity: Object.values(fairness).every((f) => Number.isNaN(f.parity_group!) || f.parity_group! <= THRESHOLDS.parity_max),
    ci_coverage: Object.values(predictive).every((p) => Number.isNaN(p.ci_coverage!) || p.ci_coverage! >= THRESHOLDS.ci_coverage_min),
  },
  thresholds: THRESHOLDS,
};

mkdirSync('evals/results', { recursive: true });
const stamp = summary.run_at.replace(/[:.]/g, '-');
writeFileSync(`evals/results/${stamp}.json`, JSON.stringify({ summary, results }, null, 2));

const f = (x: number) => (Number.isNaN(x) ? 'n/a' : x.toFixed(3));
const lines = [
  `# Lighthouse eval scoreboard — ${summary.run_at} (n=${n})`,
  '',
  '## Predictive quality (Lighthouse vs. base-rate baseline)',
  '| outcome | n | AUROC | Brier | Brier (base) | ECE | ECE (base) | 90% CI coverage |',
  '|---|---|---|---|---|---|---|---|',
  ...Object.entries(predictive).map(([k, p]) => `| ${k} | ${p.n} | ${f(p.auroc!)} | ${f(p.brier!)} | ${f(p.brier_baseline!)} | ${f(p.ece!)} | ${f(p.ece_baseline!)} | ${f(p.ci_coverage!)} |`),
  '',
  '## Reasoning quality',
  `- Evidence claims: ${claims}; hallucinated source fields: ${ungrounded} (rate ${f(summary.reasoning.hallucination_rate)}, gate ≤ ${THRESHOLDS.hallucination_max})`,
  `- Counter-evidence present: ${f(summary.reasoning.counter_evidence_present_rate)}`,
  `- Consistency (std of completion estimate over ${repeatEstimates.length} runs): ${f(summary.reasoning.consistency_std_completion)} (gate ≤ ${THRESHOLDS.consistency_max_std})`,
  '',
  '## Fairness (synthetic groups the model never sees)',
  '| outcome | parity diff (group) | equal-opp diff (group) | parity diff (wealth) |',
  '|---|---|---|---|',
  ...Object.entries(fairness).map(([k, v]) => `| ${k} | ${f(v.parity_group!)} | ${f(v.equal_opportunity_group!)} | ${f(v.parity_wealth!)} |`),
  '',
  '## Ops',
  `- released ${ops.released} / withheld ${ops.withheld} / partial ${ops.partial} of ${ops.reports_requested}`,
  `- cost: $${ops.cost_total_usd.toFixed(2)} total, $${ops.cost_per_report_usd.toFixed(3)} per report; tokens in/out per report ${f(ops.mean_input_tokens)} / ${f(ops.mean_output_tokens)}`,
  '',
  '## Gates',
  ...Object.entries(summary.gates).map(([k, v]) => `- ${v ? 'PASS' : 'FAIL'} ${k}`),
  '',
  `Full results: evals/results/${stamp}.json`,
];
writeFileSync('evals/SCOREBOARD.md', lines.join('\n'));
console.log(lines.join('\n'));
if (!Object.values(summary.gates).every(Boolean)) process.exit(1);
