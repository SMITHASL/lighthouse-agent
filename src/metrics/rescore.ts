import { auroc, brier, ciCoverage, ece } from './index.js';
import type { GroundTruth, LongTermFitReport } from '../schema/index.js';

export type Calibration = {
  computed_at: string;
  n: number;
  outcomes: Record<string, { auroc: number; brier: number; ece: number; ci_coverage: number }>;
};

/** Re-scores stored predictions against ground truth; the nightly schedule calls this. */
export function rescore(reports: LongTermFitReport[], truth: GroundTruth[], now = new Date()): Calibration {
  const byId = new Map(truth.map((t) => [t.applicant_id, t]));
  const pick = {
    completion: (r: LongTermFitReport) => r.completion_likelihood,
    volunteer: (r: LongTermFitReport) => r.alumni_engagement_profile.volunteer,
    cheerleader: (r: LongTermFitReport) => r.alumni_engagement_profile.cheerleader,
    donor: (r: LongTermFitReport) => r.alumni_engagement_profile.donor,
    recruiter: (r: LongTermFitReport) => r.alumni_engagement_profile.recruiter,
  } as const;
  const label = {
    completion: (t: GroundTruth) => t.completed,
    volunteer: (t: GroundTruth) => t.volunteered,
    cheerleader: (t: GroundTruth) => t.cheerled,
    donor: (t: GroundTruth) => t.donated,
    recruiter: (t: GroundTruth) => t.referrals_5y > 0,
  } as const;
  const outcomes: Calibration['outcomes'] = {};
  let n = 0;
  for (const key of Object.keys(pick) as (keyof typeof pick)[]) {
    const rows: { p: number; lo: number; hi: number; y: boolean }[] = [];
    for (const r of reports) {
      const t = byId.get(r.applicant_id);
      const e = pick[key](r);
      if (!t || e.estimate === null || e.ci_low === null || e.ci_high === null) continue;
      rows.push({ p: e.estimate, lo: e.ci_low, hi: e.ci_high, y: label[key](t) });
    }
    n = Math.max(n, rows.length);
    outcomes[key] = { auroc: auroc(rows), brier: brier(rows), ece: ece(rows), ci_coverage: ciCoverage(rows) };
  }
  return { computed_at: now.toISOString(), n, outcomes };
}
