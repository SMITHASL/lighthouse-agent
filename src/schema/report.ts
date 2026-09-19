import { z } from 'zod';

const EvidenceQuality = z.enum(['direct', 'indirect', 'anecdotal', 'absent']);

const Evidence = z
  .object({
    claim: z.string().min(1),
    // Must name a field of ApplicantInput (dot path) so lineage can be verified.
    source_field: z.string().min(1),
    quality: EvidenceQuality,
  })
  .strict();

/** A calibrated estimate; `estimate` is null when the analyst declines to predict. */
const Estimate = z
  .object({
    estimate: z.number().min(0).max(1).nullable(),
    ci_low: z.number().min(0).max(1).nullable(),
    ci_high: z.number().min(0).max(1).nullable(),
    evidence: z.array(Evidence),
    counter_evidence: z.array(Evidence),
    missing_signals: z.array(z.string()),
  })
  .strict()
  .refine(
    (e) => e.estimate === null || (e.ci_low !== null && e.ci_high !== null && e.ci_low <= e.estimate && e.estimate <= e.ci_high),
    { message: 'ci_low <= estimate <= ci_high is required when estimate is present' },
  )
  .refine((e) => e.estimate === null || e.evidence.length > 0, {
    message: 'an estimate requires at least one piece of evidence',
  });

const Signal = z.object({ signal: z.string().min(1), source_field: z.string().min(1) }).strict();

const DonorEstimate = z
  .object({
    estimate: z.number().min(0).max(1).nullable(),
    ci_low: z.number().min(0).max(1).nullable(),
    ci_high: z.number().min(0).max(1).nullable(),
    // Ambition/trajectory: will they build a career capable of giving back?
    future_capacity: z
      .object({
        estimate: z.number().min(0).max(1).nullable(),
        ambition_signals: z.array(Signal),
      })
      .strict(),
    // Reciprocity: have they shown they give back when they can?
    generosity: z
      .object({
        estimate: z.number().min(0).max(1).nullable(),
        reciprocity_signals: z.array(Signal),
      })
      .strict(),
    horizon_years: z.number().int().min(1).max(40),
    evidence: z.array(Evidence),
    counter_evidence: z.array(Evidence),
    missing_signals: z.array(z.string()),
  })
  .strict();

const RiskFlag = z
  .object({
    type: z.enum(['attrition_risk', 'data_gap', 'inconsistency', 'fairness_concern']),
    detail: z.string().min(1),
  })
  .strict();

export const CriticalAnalysis = z
  .object({
    question: z.string().min(1),
    hypotheses: z.array(z.string().min(1)).min(2),
    inference_type: z.enum(['deductive', 'inductive', 'abductive']),
    base_rate_used: z.string().min(1),
    inconsistencies: z.array(z.string()),
    circumstance_signals_excluded: z.array(z.string()),
    strongest_case_for: z.string().min(1),
    strongest_case_against: z.string().min(1),
    what_would_change_my_mind: z.array(z.string().min(1)).min(1),
    // Cheapest falsifying test, per the LEAD "designing experiments" pillar.
    proposed_experiment: z.string().min(1),
    analogy_and_where_it_breaks: z.string().min(1),
  })
  .strict();

export const LongTermFitReport = z
  .object({
    applicant_id: z.string(),
    completion_likelihood: Estimate,
    alumni_engagement_profile: z
      .object({
        volunteer: Estimate,
        cheerleader: Estimate,
        donor: DonorEstimate,
        recruiter: Estimate,
      })
      .strict(),
    recruiter_multiplier: z
      .object({
        expected_referrals_5y: z.number().min(0),
        ci_low: z.number().min(0),
        ci_high: z.number().min(0),
        reasoning: z.string().min(1),
      })
      .strict(),
    critical_analysis: CriticalAnalysis,
    risk_flags: z.array(RiskFlag),
    recommended_action: z
      .object({
        action: z.enum(['invite_to_volunteer_event', 'schedule_interview', 'request_more_information', 'no_action']),
        rationale: z.string().min(1),
        requires_human_approval: z.literal(true),
      })
      .strict(),
    confidence_calibration: z
      .object({
        overall_confidence: z.number().min(0).max(1),
        why: z.string().min(1),
      })
      .strict(),
    data_lineage: z.array(
      z.object({ field: z.string().min(1), source: z.string().min(1), consent_flag: z.boolean() }).strict(),
    ),
  })
  .strict();

export type LongTermFitReport = z.infer<typeof LongTermFitReport>;

export const FairnessAttestation = z
  .object({
    applicant_id: z.string(),
    verdict: z.enum(['pass', 'veto']),
    protected_attribute_leak: z.boolean(),
    circumstance_used_as_person_signal: z.array(z.string()),
    reasoning: z.string().min(1),
  })
  .strict();

export type FairnessAttestation = z.infer<typeof FairnessAttestation>;
