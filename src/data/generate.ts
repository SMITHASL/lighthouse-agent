import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApplicantInput, type GroundTruth, type ProtectedLabels } from '../schema/applicant.js';

/** Deterministic PRNG so eval runs are reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Latent = { ambition: number; reciprocity: number; grit: number; sociability: number };

const GOALS = [
  'Build a company that makes clinical trials faster for rare diseases.',
  'Lead product at a climate-tech startup, then teach what I learned.',
  'Move from engineering into general management and run a business unit.',
  'Return to my community and start a mentoring program for first-time founders.',
  'Understand how markets price risk well enough to run my own fund one day.',
  'Get a promotion.',
  'Not sure yet; exploring options.',
];

const STATEMENT_TEMPLATES = {
  high: [
    'When our first pilot failed, I rewrote the onboarding flow over a weekend and we recovered 80% of the churned accounts. I still mentor two of the interns from that team.',
    'I founded a peer tutoring group after failing calculus; it now has 40 tutors. My professor gave me a second chance and I want to be that person for others.',
    'I took the hardest analytics track available and organised our cohort study group. I credit my manager for pushing me into leading the migration.',
  ],
  mid: [
    'I have worked in operations for four years and want to broaden my skills. I have helped colleagues when asked and enjoy team projects.',
    'I enjoy solving problems and learning new tools. This program looks like a good next step for my career.',
  ],
  low: [
    'I want this credential because it will help my resume. I prefer to work alone and get things done efficiently.',
    'My employer is paying for this, so I am applying. I do not have much time for extracurriculars.',
  ],
};

const SETBACKS = [
  'Failed a core course and retook it with a top grade',
  'Lost a co-founder mid-project and shipped anyway',
  'Recovered from a layoff by retraining in six months',
  'Managed a team through a product recall',
];

export function makeApplicant(rng: () => number, i: number): {
  input: ApplicantInput;
  truth: GroundTruth;
  labels: ProtectedLabels;
  latent: Latent;
} {
  const latent: Latent = {
    ambition: rng(),
    reciprocity: rng(),
    grit: rng(),
    sociability: rng(),
  };
  const id = `app_${(i + 1).toString(36).padStart(4, '0')}`;

  const tier = latent.ambition + latent.reciprocity > 1.2 ? 'high' : latent.ambition + latent.reciprocity > 0.7 ? 'mid' : 'low';
  const pool = STATEMENT_TEMPLATES[tier];
  const statement = pool[Math.floor(rng() * pool.length)] ?? pool[0]!;

  const goalIdx = latent.ambition > 0.6 ? Math.floor(rng() * 5) : 5 + Math.floor(rng() * 2);
  const activities: ApplicantInput['activities'] = [];
  if (latent.reciprocity > 0.5) {
    activities.push({ kind: 'volunteering', role: 'Volunteer coordinator', months: Math.round(6 + latent.reciprocity * 30), description: 'Organised weekend food-bank shifts.' });
  }
  if (latent.reciprocity > 0.7) {
    activities.push({ kind: 'mentoring', role: 'Peer mentor', months: Math.round(latent.reciprocity * 24), description: 'Mentored junior analysts through their first year.' });
  }
  if (latent.ambition > 0.65) {
    activities.push({ kind: 'founder', role: 'Co-founder', months: Math.round(latent.ambition * 36), description: 'Started a side business; reached break-even.' });
  }
  if (latent.sociability > 0.6) {
    activities.push({ kind: 'team_sport', role: 'Team captain', months: 24, description: 'Captained a recreational league team.' });
  }
  if (activities.length === 0) {
    activities.push({ kind: 'work', role: 'Analyst', months: 36, description: 'Full-time role.' });
  }

  const start = 0.4 + rng() * 0.3;
  const slope = (latent.grit - 0.5) * 0.3;
  const term_scores = [0, 1, 2, 3].map((t) => Math.min(1, Math.max(0, start + slope * t + (rng() - 0.5) * 0.08)));

  const trackedConsent = rng() > 0.15;
  const interaction = {
    campus_visits: trackedConsent ? Math.round(latent.sociability * 2 + rng()) : 0,
    events_attended: trackedConsent ? Math.round(latent.sociability * 3 + latent.ambition * 2) : 0,
    median_response_hours: trackedConsent ? Math.round(2 + (1 - latent.ambition) * 60) : null,
    questions_asked: trackedConsent ? Math.round(latent.ambition * 4) : 0,
    referrals_made: trackedConsent ? Math.round(latent.sociability * latent.reciprocity * 4) : 0,
  };

  const input = ApplicantInput.parse({
    applicant_id: id,
    program: 'LEAD Certificate',
    statement,
    stated_goals: GOALS[goalIdx] ?? GOALS[0],
    activities,
    academic_trajectory: {
      term_scores,
      hardest_course_load_taken: latent.ambition > 0.7 ? 'heavy' : latent.ambition > 0.4 ? 'standard' : 'light',
      setbacks_overcome: latent.grit > 0.6 ? [SETBACKS[Math.floor(rng() * SETBACKS.length)] ?? SETBACKS[0]] : [],
    },
    institution_interaction: interaction,
    interview_notes: rng() > 0.4 ? `Interviewer: ${tier === 'high' ? 'Energetic, asked about alumni network, credited former colleagues.' : tier === 'mid' ? 'Pleasant, somewhat generic answers.' : 'Focused on credential value; few questions.'}` : null,
    consent: { application_data: true, interaction_tracking: trackedConsent },
  });

  // Ground truth is a noisy function of the latent traits only — never of wealth or group.
  const p = (x: number) => rng() < x;
  const truth: GroundTruth = {
    applicant_id: id,
    completed: p(0.35 + latent.grit * 0.5 + latent.ambition * 0.1),
    volunteered: p(0.1 + latent.reciprocity * 0.7),
    cheerled: p(0.1 + latent.sociability * 0.5 + latent.reciprocity * 0.2),
    donated: p(0.05 + latent.ambition * 0.4 * latent.reciprocity * 1.5),
    referrals_5y: Math.round(latent.sociability * latent.reciprocity * 6 + rng()),
  };

  // Protected labels are independent of truth by construction; they exist to detect leakage.
  const g = rng();
  const w = rng();
  const labels: ProtectedLabels = {
    applicant_id: id,
    synthetic_group: g < 0.33 ? 'group_a' : g < 0.66 ? 'group_b' : 'group_c',
    synthetic_family_wealth: w < 0.33 ? 'low' : w < 0.66 ? 'middle' : 'high',
  };

  return { input, truth, labels, latent };
}

export function generateDataset(n: number, seed = 42) {
  const rng = mulberry32(seed);
  const rows = Array.from({ length: n }, (_, i) => makeApplicant(rng, i));
  return {
    inputs: rows.map((r) => r.input),
    truth: rows.map((r) => r.truth),
    labels: rows.map((r) => r.labels),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const n = Number(process.argv[2] ?? 500);
  const { inputs, truth, labels } = generateDataset(n);
  mkdirSync('data', { recursive: true });
  writeFileSync('data/applicants.json', JSON.stringify(inputs, null, 2));
  writeFileSync('data/ground_truth.json', JSON.stringify(truth, null, 2));
  writeFileSync('data/protected_labels.json', JSON.stringify(labels, null, 2));
  console.log(`wrote ${n} applicants to data/`);
}
