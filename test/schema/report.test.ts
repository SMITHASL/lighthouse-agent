import { describe, expect, it } from 'vitest';
import { LongTermFitReport } from '../../src/schema/report.js';
import { sampleReport } from '../fixtures.js';

describe('LongTermFitReport', () => {
  it('accepts a complete report', () => {
    expect(LongTermFitReport.safeParse(sampleReport()).success).toBe(true);
  });

  it('no_prediction_without_evidence: estimate with empty evidence is rejected', () => {
    const r = sampleReport();
    r.completion_likelihood.evidence = [];
    expect(LongTermFitReport.safeParse(r).success).toBe(false);
  });

  it('allows a null estimate with missing_signals', () => {
    const r = sampleReport();
    r.completion_likelihood = { estimate: null, ci_low: null, ci_high: null, evidence: [], counter_evidence: [], missing_signals: ['no interview'] };
    expect(LongTermFitReport.safeParse(r).success).toBe(true);
  });

  it('analysis_is_complete: requires question, >=2 hypotheses, inference type, base rate, experiment, analogy', () => {
    const r = sampleReport();
    r.critical_analysis.hypotheses = ['only one'];
    expect(LongTermFitReport.safeParse(r).success).toBe(false);
    const r2 = sampleReport();
    (r2.critical_analysis as Record<string, unknown>).proposed_experiment = '';
    expect(LongTermFitReport.safeParse(r2).success).toBe(false);
  });

  it('recommended actions always require human approval', () => {
    const r = sampleReport();
    (r.recommended_action as Record<string, unknown>).requires_human_approval = false;
    expect(LongTermFitReport.safeParse(r).success).toBe(false);
  });
});
