/**
 * A domain pack is the only thing that changes between university admissions, startup
 * recruiting and corporate talent: the outcomes, the base rates, and the vocabulary.
 * The reasoning contract, schemas, fairness gates and pipeline stay the same.
 */
export type DomainPack = {
  name: string;
  subject: string;
  outcomes: readonly string[];
  horizon_years: number;
  base_rates: Record<string, number>;
  vocabulary: { institution: string; cohort: string; action_verbs: string };
};

export const DOMAIN_PACKS: Record<string, DomainPack> = {
  'university-admissions': {
    name: 'university-admissions',
    subject: 'applicant',
    outcomes: ['completion', 'volunteer', 'cheerleader', 'donor', 'recruiter'],
    horizon_years: 10,
    base_rates: { completion: 0.62, volunteer: 0.31, cheerleader: 0.28, donor: 0.14, recruiter: 0.22 },
    vocabulary: { institution: 'the University', cohort: 'alumni of the LEAD Certificate program', action_verbs: 'enrol, graduate, volunteer, give' },
  },
  'startup-recruiting': {
    name: 'startup-recruiting',
    subject: 'candidate',
    outcomes: ['hire', 'retain_2y', 'refer', 'advocate'],
    horizon_years: 5,
    base_rates: { hire: 0.18, retain_2y: 0.55, refer: 0.3, advocate: 0.2 },
    vocabulary: { institution: 'the company', cohort: 'engineers hired in the last three years', action_verbs: 'join, stay, refer, champion' },
  },
  'corporate-talent': {
    name: 'corporate-talent',
    subject: 'candidate',
    outcomes: ['hire', 'retain_3y', 'promote', 'refer', 'advocate'],
    horizon_years: 7,
    base_rates: { hire: 0.12, retain_3y: 0.6, promote: 0.25, refer: 0.2, advocate: 0.15 },
    vocabulary: { institution: 'the firm', cohort: 'graduate-programme hires', action_verbs: 'join, stay, grow, refer, champion' },
  },
};

export function loadDomainPack(name: string): DomainPack {
  const pack = DOMAIN_PACKS[name];
  if (!pack) throw new Error(`unknown domain pack: ${name}`);
  return pack;
}
