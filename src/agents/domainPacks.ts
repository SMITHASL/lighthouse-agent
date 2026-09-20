/**
 * A domain pack is the only thing that changes between university admissions, startup
 * recruiting and corporate talent: the outcomes, the base rates, the vocabulary — and, since the
 * report schema is built from the pack, the shape of the report itself. The reasoning contract,
 * fairness gates, pipeline, runtime and evals stay the same.
 */
import type { GroundTruth } from '../schema/applicant.ts';

export type DomainPack = {
  name: string;
  subject: string;
  /** Every outcome the analyst estimates; each becomes a key of `report.outcomes`. */
  outcomes: readonly string[];
  /** The outcome used for consistency checks, the UI headline and the "did they finish/join" question. */
  primary_outcome: string;
  /** Optional: an outcome modelled as future capacity × generosity (never wealth). */
  trajectory_outcome?: string;
  /** Optional: an outcome with an expected-referrals multiplier, grounded in this record field. */
  referral_outcome?: { name: string; field: string };
  horizon_years: number;
  base_rates: Record<string, number>;
  vocabulary: { institution: string; cohort: string; action_verbs: string };
  /** Ground-truth labels per outcome, when the pack has labelled data (the synthetic set is university-shaped). */
  labels?: (t: GroundTruth) => Record<string, boolean>;
};

export const DOMAIN_PACKS: Record<string, DomainPack> = {
  'university-admissions': {
    name: 'university-admissions',
    subject: 'applicant',
    outcomes: ['completion', 'volunteer', 'cheerleader', 'donor', 'recruiter'],
    primary_outcome: 'completion',
    trajectory_outcome: 'donor',
    referral_outcome: { name: 'recruiter', field: 'institution_interaction.referrals_made' },
    horizon_years: 10,
    base_rates: { completion: 0.62, volunteer: 0.31, cheerleader: 0.28, donor: 0.14, recruiter: 0.22 },
    vocabulary: { institution: 'the University', cohort: 'alumni of the LEAD Certificate program', action_verbs: 'enrol, graduate, volunteer, give' },
    labels: (t) => ({ completion: t.completed, volunteer: t.volunteered, cheerleader: t.cheerled, donor: t.donated, recruiter: t.referrals_5y > 0 }),
  },
  'startup-recruiting': {
    name: 'startup-recruiting',
    subject: 'candidate',
    outcomes: ['hire', 'retain_2y', 'refer', 'advocate'],
    primary_outcome: 'hire',
    referral_outcome: { name: 'refer', field: 'institution_interaction.referrals_made' },
    horizon_years: 5,
    base_rates: { hire: 0.18, retain_2y: 0.55, refer: 0.3, advocate: 0.2 },
    vocabulary: { institution: 'the company', cohort: 'engineers hired in the last three years', action_verbs: 'join, stay, refer, champion' },
  },
  'corporate-talent': {
    name: 'corporate-talent',
    subject: 'candidate',
    outcomes: ['hire', 'retain_3y', 'promote', 'refer', 'advocate'],
    primary_outcome: 'hire',
    referral_outcome: { name: 'refer', field: 'institution_interaction.referrals_made' },
    horizon_years: 7,
    base_rates: { hire: 0.12, retain_3y: 0.6, promote: 0.25, refer: 0.2, advocate: 0.15 },
    vocabulary: { institution: 'the firm', cohort: 'graduate-programme hires', action_verbs: 'join, stay, grow, refer, champion' },
  },
};

export const DEFAULT_PACK = 'university-admissions';

export function loadDomainPack(name: string = DEFAULT_PACK): DomainPack {
  const pack = DOMAIN_PACKS[name];
  if (!pack) throw new Error(`unknown domain pack: ${name}`);
  return pack;
}
