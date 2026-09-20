import { z, type Infer, type Schema } from '../lib/schema.ts';
import { DEFAULT_PACK, loadDomainPack, type DomainPack } from '../agents/domainPacks.ts';

const EvidenceQuality = z.enum(['direct', 'indirect', 'anecdotal', 'absent']);

/**
 * Where a claim comes from. Either a dot-path into the applicant record ("activities[0].role",
 * "institution_interaction.referrals_made"), or one of two non-record sources the analyst is
 * allowed to lean on: "base_rate:<outcome>" (from institution_reference_class_stats) and
 * "tool:<name>". A claim may cite several fields — "two events and two campus visits" cites both.
 */
export const SOURCE_REF = /^(?:[a-z_][a-z0-9_]*(?:\[\d+\])?(?:\.[a-z_][a-z0-9_]*(?:\[\d+\])?)*|base_rate:[a-z0-9_]+|tool:[a-z0-9_]+)$/;
export const isRecordPath = (ref: string) => !ref.startsWith('base_rate:') && !ref.startsWith('tool:');

const Evidence = z
  .object({
    claim: z.string().min(1),
    // Every field the claim draws on, so lineage can be verified field by field.
    source_fields: z.array(z.string().regex(SOURCE_REF)).min(1),
    quality: EvidenceQuality,
  })
  .strict();
export type Evidence = Infer<typeof Evidence>;

/** A calibrated estimate; `estimate` is null when the analyst declines to predict. */
export const Estimate = z
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
export type Estimate = Infer<typeof Estimate>;

const Signal = z.object({ signal: z.string().min(1), source_field: z.string().regex(SOURCE_REF) }).strict();

/** An outcome modelled as a trajectory: who will BECOME able to give back, and does give back. */
export const TrajectoryEstimate = z
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
export type TrajectoryEstimate = Infer<typeof TrajectoryEstimate>;

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

const ReferralMultiplier = z
  .object({
    expected_referrals_5y: z.number().min(0),
    ci_low: z.number().min(0),
    ci_high: z.number().min(0),
    reasoning: z.string().min(1),
  })
  .strict();

const RecommendedAction = z
  .object({
    action: z.enum(['invite_to_volunteer_event', 'schedule_interview', 'request_more_information', 'no_action']),
    rationale: z.string().min(1),
    requires_human_approval: z.literal(true),
  })
  .strict();

const ConfidenceCalibration = z.object({ overall_confidence: z.number().min(0).max(1), why: z.string().min(1) }).strict();
const DataLineage = z.array(z.object({ field: z.string().min(1), source: z.string().min(1), consent_flag: z.boolean() }).strict());

/** The report type: `outcomes` is keyed by the pack's outcome names. */
export type LongTermFitReport = {
  applicant_id: string;
  outcomes: Record<string, Estimate | TrajectoryEstimate>;
  referral_multiplier?: Infer<typeof ReferralMultiplier>;
  critical_analysis: Infer<typeof CriticalAnalysis>;
  risk_flags: Infer<typeof RiskFlag>[];
  recommended_action: Infer<typeof RecommendedAction>;
  confidence_calibration: Infer<typeof ConfidenceCalibration>;
  data_lineage: Infer<typeof DataLineage>;
};

/**
 * Builds the report schema for a domain pack: one Estimate per outcome, a TrajectoryEstimate for
 * the pack's trajectory outcome, and a referral multiplier only when the pack defines one.
 */
export function reportSchema(pack: DomainPack): Schema<LongTermFitReport> {
  const outcomes: Record<string, Schema<unknown>> = {};
  for (const o of pack.outcomes) outcomes[o] = o === pack.trajectory_outcome ? TrajectoryEstimate : Estimate;
  const shape: Record<string, Schema<unknown>> = {
    applicant_id: z.string(),
    outcomes: z.object(outcomes).strict(),
    critical_analysis: CriticalAnalysis,
    risk_flags: z.array(RiskFlag),
    recommended_action: RecommendedAction,
    confidence_calibration: ConfidenceCalibration,
    data_lineage: DataLineage,
  };
  if (pack.referral_outcome) shape.referral_multiplier = ReferralMultiplier;
  return z.object(shape).strict() as unknown as Schema<LongTermFitReport>;
}

const cache = new Map<string, Schema<LongTermFitReport>>();
export function reportSchemaFor(packName: string = DEFAULT_PACK): Schema<LongTermFitReport> {
  let s = cache.get(packName);
  if (!s) { s = reportSchema(loadDomainPack(packName)); cache.set(packName, s); }
  return s;
}

/** The default (university-admissions) report schema — what most callers mean by "the report". */
export const LongTermFitReport: Schema<LongTermFitReport> = reportSchemaFor(DEFAULT_PACK);

export const FairnessAttestation = z
  .object({
    applicant_id: z.string(),
    verdict: z.enum(['pass', 'veto']),
    protected_attribute_leak: z.boolean(),
    circumstance_used_as_person_signal: z.array(z.string()),
    reasoning: z.string().min(1),
  })
  .strict();

export type FairnessAttestation = Infer<typeof FairnessAttestation>;

/** All evidence and counter-evidence across every outcome, tagged by outcome and kind. */
export function allEvidence(report: LongTermFitReport): { outcome: string; kind: 'evidence' | 'counter_evidence'; item: Evidence }[] {
  return Object.entries(report.outcomes).flatMap(([outcome, e]) => [
    ...e.evidence.map((item) => ({ outcome, kind: 'evidence' as const, item })),
    ...e.counter_evidence.map((item) => ({ outcome, kind: 'counter_evidence' as const, item })),
  ]);
}
