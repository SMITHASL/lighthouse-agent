import { describe, expect, it } from '../harness.ts';
import { loadDomainPack } from '../../src/agents/domainPacks.ts';
import { reportSchema, reportSchemaFor, SOURCE_REF } from '../../src/schema/report.ts';
import { analystManifest } from '../../src/agents/manifests.ts';
import { sampleReport } from '../fixtures.ts';

describe('domain_pack_drives_report_schema', () => {
  it('the startup pack yields a report with exactly its outcomes and no trajectory structure', () => {
    const schema = reportSchema(loadDomainPack('startup-recruiting'));
    const json = schema.toJsonSchema() as { properties: { outcomes: { properties: Record<string, { properties: Record<string, unknown> }>; required: string[] } }; required: string[] };
    expect(json.properties.outcomes.required.sort()).toEqual(['advocate', 'hire', 'refer', 'retain_2y']);
    expect(json.properties.outcomes.properties.hire!.properties).not.toHaveProperty('future_capacity');
    expect(json.required).toContain('referral_multiplier'); // the pack defines refer as its referral outcome
  });

  it('the university pack keeps donor as a trajectory outcome and rejects a startup-shaped report', () => {
    const uni = reportSchemaFor('university-admissions').toJsonSchema() as { properties: { outcomes: { properties: Record<string, { properties: Record<string, unknown> }> } } };
    expect(uni.properties.outcomes.properties.donor!.properties).toHaveProperty('future_capacity');
    const r = sampleReport();
    const startupShaped = { ...r, outcomes: { hire: r.outcomes.completion, retain_2y: r.outcomes.volunteer, refer: r.outcomes.recruiter, advocate: r.outcomes.cheerleader } };
    expect(reportSchemaFor('university-admissions').safeParse(startupShaped).success).toBe(false);
    expect(reportSchemaFor('startup-recruiting').safeParse(startupShaped).success).toBe(true);
    expect(reportSchemaFor('startup-recruiting').safeParse(r).success).toBe(false);
  });

  it('the analyst manifest for a pack carries that pack\'s response schema and instructions', () => {
    const m = analystManifest('corporate-talent');
    const outcomes = (m.response_format.json_schema.schema as { properties: { outcomes: { required: string[] } } }).properties.outcomes.required;
    expect(outcomes.sort()).toEqual(['advocate', 'hire', 'promote', 'refer', 'retain_3y']);
    expect(m.instructions).toContain('base_rate:hire');
    expect(m.instructions).not.toContain('future_capacity × generosity');
  });

  it('citations accept record paths, base_rate:<outcome> and tool:<name>, and reject anything else', () => {
    for (const ok of ['activities[0].role', 'academic_trajectory.term_scores', 'institution_interaction.referrals_made', 'base_rate:completion', 'tool:applicants_timeline']) expect(SOURCE_REF.test(ok), ok).toBe(true);
    for (const bad of ['', 'program!', 'base rate', 'Activities.Role', 'activities[0]role', 'base_rate:', 'http://x']) expect(SOURCE_REF.test(bad), bad).toBe(false);
  });
});
