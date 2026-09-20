import { z, type Infer } from '../lib/schema.ts';

/**
 * Attributes that may never reach a prediction. The input schema is `strict`, so any of
 * these keys is rejected at the boundary rather than silently ignored.
 */
export const PROTECTED_ATTRIBUTES = [
  'race',
  'ethnicity',
  'religion',
  'sex',
  'gender',
  'disability',
  'age',
  'date_of_birth',
  'national_origin',
  'citizenship',
  'family_income',
  'household_income',
  'first_generation',
  'zip_code',
  'postal_code',
  'legacy_status',
  'name',
  'first_name',
  'last_name',
  'high_school_name',
] as const;

const Activity = z
  .object({
    kind: z.enum(['volunteering', 'club', 'mentoring', 'team_sport', 'leadership', 'work', 'founder', 'other']),
    role: z.string().min(1),
    months: z.number().int().min(0),
    description: z.string(),
  })
  .strict();

const InstitutionInteraction = z
  .object({
    campus_visits: z.number().int().min(0),
    events_attended: z.number().int().min(0),
    // Median hours from an institution message to the applicant's reply; null when never contacted.
    median_response_hours: z.number().min(0).nullable(),
    questions_asked: z.number().int().min(0),
    referrals_made: z.number().int().min(0),
  })
  .strict();

const AcademicTrajectory = z
  .object({
    // Normalised 0..1 across the most recent terms, oldest first; trend matters more than level.
    term_scores: z.array(z.number().min(0).max(1)).min(1),
    hardest_course_load_taken: z.enum(['light', 'standard', 'heavy']),
    setbacks_overcome: z.array(z.string()),
  })
  .strict();

export const ApplicantInput = z
  .object({
    applicant_id: z.string().regex(/^app_[a-z0-9]+$/),
    program: z.string().min(1),
    statement: z.string().min(1),
    stated_goals: z.string().min(1),
    activities: z.array(Activity),
    academic_trajectory: AcademicTrajectory,
    institution_interaction: InstitutionInteraction,
    interview_notes: z.string().nullable(),
    // Consent flags travel with the record so `data_lineage` can attest to them.
    consent: z
      .object({
        application_data: z.literal(true),
        interaction_tracking: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ApplicantInput = Infer<typeof ApplicantInput>;

/**
 * Held only by the evaluation harness for fairness audits. Structurally separate from
 * `ApplicantInput`, so it cannot be passed to the model by accident.
 */
export const ProtectedLabels = z
  .object({
    applicant_id: z.string(),
    synthetic_group: z.enum(['group_a', 'group_b', 'group_c']),
    synthetic_family_wealth: z.enum(['low', 'middle', 'high']),
  })
  .strict();

export type ProtectedLabels = Infer<typeof ProtectedLabels>;

export const GroundTruth = z
  .object({
    applicant_id: z.string(),
    completed: z.boolean(),
    volunteered: z.boolean(),
    cheerled: z.boolean(),
    donated: z.boolean(),
    referrals_5y: z.number().int().min(0),
  })
  .strict();

export type GroundTruth = Infer<typeof GroundTruth>;
