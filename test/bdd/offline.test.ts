import { describe, expect, it } from '../harness.ts';
import { loadDomainPack } from '../../src/agents/domainPacks.ts';
import { analystInstructions } from '../../src/agents/manifests.ts';
import { runReport } from '../../src/pipeline/run.ts';
import { sampleReport } from '../fixtures.ts';
import { LongTermFitReport } from '../../src/schema/report.ts';

describe('control.feature', () => {
  it('budget_exhausted_degrades_gracefully', async () => {
    const res = await runReport('app_0001', { budget: { max_usd_per_report: 0.1, spent_usd: 0.1 } });
    expect(res.status).toBe('partial');
    expect(res.report).toBeNull();
    expect(res.risk_flags.some((f) => f.type === 'data_gap')).toBe(true);
  });
});

describe('scaling.feature', () => {
  it('domain_pack_swap', () => {
    const pack = loadDomainPack('startup-recruiting');
    expect(pack.outcomes).toEqual(['hire', 'retain_2y', 'refer', 'advocate']);
    const instructions = analystInstructions('startup-recruiting');
    expect(instructions).toContain('hire, retain_2y, refer, advocate');
    expect(instructions).toContain('candidate');
  });
});

describe('fairness.feature (offline)', () => {
  it('proxy_flagged_not_used: excluded circumstance signals never appear as evidence', () => {
    const r = sampleReport();
    r.critical_analysis.circumstance_signals_excluded = ['school prestige'];
    const allEvidence = [
      ...r.completion_likelihood.evidence,
      ...Object.values(r.alumni_engagement_profile).flatMap((e) => e.evidence),
    ].map((e) => e.claim.toLowerCase());
    for (const excluded of r.critical_analysis.circumstance_signals_excluded) {
      expect(allEvidence.some((c) => c.includes(excluded.toLowerCase()))).toBe(false);
    }
    expect(LongTermFitReport.safeParse(r).success).toBe(true);
  });
});
