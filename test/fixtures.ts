import type { LongTermFitReport } from '../src/schema/report.js';

const ev = (claim: string, source_field: string) => ({ claim, source_field, quality: 'direct' as const });
const est = (p: number, field: string) => ({ estimate: p, ci_low: Math.max(0, p - 0.15), ci_high: Math.min(1, p + 0.15), evidence: [ev('x', field)], counter_evidence: [], missing_signals: [] });

export function sampleReport(): LongTermFitReport {
  return {
    applicant_id: 'app_0001',
    completion_likelihood: est(0.7, 'academic_trajectory.term_scores'),
    alumni_engagement_profile: {
      volunteer: est(0.5, 'activities[0].kind'),
      cheerleader: est(0.4, 'interview_notes'),
      donor: {
        estimate: 0.3, ci_low: 0.15, ci_high: 0.45,
        future_capacity: { estimate: 0.6, ambition_signals: [{ signal: 'founder role', source_field: 'activities[1].kind' }] },
        generosity: { estimate: 0.5, reciprocity_signals: [{ signal: 'mentoring', source_field: 'activities[0].kind' }] },
        horizon_years: 10, evidence: [ev('founder', 'activities[1].kind')], counter_evidence: [], missing_signals: [],
      },
      recruiter: est(0.35, 'institution_interaction.referrals_made'),
    },
    recruiter_multiplier: { expected_referrals_5y: 2, ci_low: 0, ci_high: 4, reasoning: 'institution_interaction.referrals_made = 1 already' },
    critical_analysis: {
      question: 'Will this applicant complete and stay engaged over 10 years?',
      hypotheses: ['High grit → completes', 'Low sociability → limited engagement'],
      inference_type: 'inductive',
      base_rate_used: 'completion 0.62',
      inconsistencies: [],
      circumstance_signals_excluded: [],
      strongest_case_for: 'rising term scores',
      strongest_case_against: 'no interview',
      what_would_change_my_mind: ['a no-show at the volunteer event'],
      proposed_experiment: 'invite to a volunteer event; observe attendance within 30 days',
      analogy_and_where_it_breaks: 'like past founder-alumni; breaks because cohort was smaller',
    },
    risk_flags: [],
    recommended_action: { action: 'invite_to_volunteer_event', rationale: 'cheap falsifying test', requires_human_approval: true },
    confidence_calibration: { overall_confidence: 0.6, why: 'moderate evidence' },
    data_lineage: [{ field: 'statement', source: 'application', consent_flag: true }],
  };
}
