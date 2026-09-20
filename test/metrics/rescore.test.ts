import { describe, expect, it } from '../harness.ts';
import { rescore } from '../../src/metrics/rescore.ts';
import { sampleReport } from '../fixtures.ts';

describe('control.feature', () => {
  it('nightly_rescoring_updates_calibration', () => {
    const r1 = sampleReport();
    const r2 = { ...sampleReport(), applicant_id: 'app_0002' };
    r2.outcomes.completion = { ...r2.outcomes.completion!, estimate: 0.2, ci_low: 0.05, ci_high: 0.35 };
    const truth = [
      { applicant_id: 'app_0001', completed: true, volunteered: true, cheerled: false, donated: false, referrals_5y: 1 },
      { applicant_id: 'app_0002', completed: false, volunteered: false, cheerled: false, donated: false, referrals_5y: 0 },
    ];
    const cal = rescore([r1, r2], truth, new Date('2026-09-19T00:00:00Z'));
    expect(cal.computed_at).toBe('2026-09-19T00:00:00.000Z');
    expect(cal.outcomes.completion!.auroc).toBe(1);
    expect(cal.outcomes.completion!.brier).toBeLessThan(0.1);
  });
});
