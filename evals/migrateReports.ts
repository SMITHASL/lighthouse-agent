/**
 * One-off migration of stored reports from the university-specific shape to the pack-driven one:
 *   completion_likelihood + alumni_engagement_profile.* → outcomes.*
 *   recruiter_multiplier → referral_multiplier
 *   evidence.source_field → evidence.source_fields[]
 * Idempotent; validates every migrated report against the current schema before writing.
 *   node evals/migrateReports.ts [data/reports]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { LongTermFitReport } from '../src/schema/report.ts';

type Old = Record<string, unknown>;
const migrateEvidence = (list: Old[] | undefined) => (list ?? []).map((e) => (e.source_fields ? e : { claim: e.claim, source_fields: [e.source_field], quality: e.quality }));
const migrateEstimate = (e: Old) => ({ ...e, evidence: migrateEvidence(e.evidence as Old[]), counter_evidence: migrateEvidence(e.counter_evidence as Old[]) });

export function migrateReport(r: Old): Old {
  if (r.outcomes) return r; // already new shape
  const profile = (r.alumni_engagement_profile ?? {}) as Record<string, Old>;
  const { completion_likelihood, alumni_engagement_profile, recruiter_multiplier, ...rest } = r;
  void alumni_engagement_profile;
  const outcomes: Record<string, Old> = { completion: migrateEstimate(completion_likelihood as Old) };
  for (const [k, v] of Object.entries(profile)) outcomes[k] = migrateEstimate(v);
  return { ...rest, outcomes, ...(recruiter_multiplier ? { referral_multiplier: recruiter_multiplier } : {}) };
}

const dir = process.argv[2] ?? 'data/reports';
let migrated = 0, skipped = 0, failed = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const path = `${dir}/${f}`;
  const result = JSON.parse(readFileSync(path, 'utf8')) as { report?: Old | null };
  if (!result.report) { skipped++; continue; }
  const next = migrateReport(result.report);
  const check = LongTermFitReport.safeParse(next);
  if (!check.success) { failed++; console.error(`${f}: ${check.error.message.slice(0, 200)}`); continue; }
  if (next !== result.report) { writeFileSync(path, JSON.stringify({ ...result, report: next }, null, 2)); migrated++; } else skipped++;
}
console.log(`migrated ${migrated}, unchanged ${skipped}, failed ${failed}`);
if (failed) process.exit(1);
