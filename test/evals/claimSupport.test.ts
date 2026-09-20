import { describe, expect, it } from '../harness.ts';
import { collectClaims, resolveField, summarize, UNSUPPORTED_MAX, type Judgement } from '../../evals/claimSupport.ts';
import { sampleReport } from '../fixtures.ts';

describe('claim-support judge (evidence_claims_are_supported_by_cited_fields)', () => {
  it('resolveField follows dot and bracket paths and reports missing ones', () => {
    const rec = { activities: [{ role: 'Team captain', months: 32 }], academic_trajectory: { term_scores: [0.5, 0.7] } };
    expect(resolveField(rec, 'activities[0].role')).toEqual({ found: true, value: 'Team captain' });
    expect(resolveField(rec, 'academic_trajectory.term_scores')).toEqual({ found: true, value: [0.5, 0.7] });
    expect(resolveField(rec, 'activities[3].role').found).toBe(false);
    expect(resolveField(rec, 'zip_code').found).toBe(false);
  });

  it('collectClaims gathers evidence and counter-evidence for every outcome, tagged', () => {
    const claims = collectClaims(sampleReport());
    expect(claims.length).toBeGreaterThan(0);
    expect(new Set(claims.map((c) => c.outcome))).toEqual(new Set(['completion', 'volunteer', 'cheerleader', 'donor', 'recruiter']));
    expect(claims.every((c) => c.claim && c.source_field && ['evidence', 'counter_evidence'].includes(c.kind))).toBe(true);
  });

  it('summarize computes rates, the per-grade breakdown and the gate', () => {
    const j = (verdict: Judgement['verdict'], quality: string): Judgement => ({ applicant_id: 'app_x', outcome: 'completion', kind: 'evidence', claim: 'c', source_field: 'f', quality, field_value: 1, verdict, reason: 'r' });
    const ok = summarize([j('supported', 'direct'), j('supported', 'direct'), j('partially', 'indirect'), j('field_missing', 'direct')]);
    expect(ok.claims).toBe(4);
    expect(ok.unsupported_rate).toBe(0);
    expect(ok.field_missing).toBe(1);
    expect(ok.gate_pass).toBe(true);
    const bad = summarize([j('supported', 'direct'), j('unsupported', 'indirect'), j('unsupported', 'indirect'), j('supported', 'indirect')]);
    expect(bad.unsupported_rate).toBe(0.5);
    expect(bad.unsupported_by_quality.indirect).toBeCloseTo(2 / 3, 2);
    expect(bad.unsupported_by_quality.direct).toBe(0);
    expect(bad.gate_pass).toBe(false);
    expect(summarize([]).gate_pass).toBe(false); // no data is not a pass
    expect(UNSUPPORTED_MAX).toBe(0.05);
  });
});
