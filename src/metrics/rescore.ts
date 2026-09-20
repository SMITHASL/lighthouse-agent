import { auroc, brier, ciCoverage, ece } from './index.ts';
import type { GroundTruth, LongTermFitReport } from '../schema/index.ts';
import { loadDomainPack, type DomainPack } from '../agents/domainPacks.ts';

export type Calibration = {
  computed_at: string;
  n: number;
  outcomes: Record<string, { auroc: number; brier: number; ece: number; ci_coverage: number }>;
};

/** Re-scores stored predictions against ground truth; the nightly schedule calls this. */
export function rescore(reports: LongTermFitReport[], truth: GroundTruth[], now = new Date(), pack: DomainPack = loadDomainPack()): Calibration {
  const byId = new Map(truth.map((t) => [t.applicant_id, t]));
  const outcomes: Calibration['outcomes'] = {};
  let n = 0;
  for (const key of pack.outcomes) {
    const rows: { p: number; lo: number; hi: number; y: boolean }[] = [];
    for (const r of reports) {
      const t = byId.get(r.applicant_id);
      const e = r.outcomes[key];
      const y = t && pack.labels ? pack.labels(t)[key] : undefined;
      if (!e || y === undefined || e.estimate === null || e.ci_low === null || e.ci_high === null) continue;
      rows.push({ p: e.estimate, lo: e.ci_low, hi: e.ci_high, y });
    }
    n = Math.max(n, rows.length);
    outcomes[key] = { auroc: auroc(rows), brier: brier(rows), ece: ece(rows), ci_coverage: ciCoverage(rows) };
  }
  return { computed_at: now.toISOString(), n, outcomes };
}
