// Deterministic, rule-based specialist agents. No API key needed.
// Each returns an AgentSignal (see schema.mjs).

const has = (v) => v !== undefined && v !== null;

export function transcriptAgent(c) {
  const a = c.applicant;
  const risks = [];
  const protective = [];
  const w = a.withdrawals ?? [];
  const lateW = w.filter((x) => x.week >= 8);
  if (lateW.length >= 2) {
    risks.push({
      factor: "open_ended_deliverable_non_completion",
      weight: Math.min(0.35, 0.08 * lateW.length + (a.degree?.thesis_attempts ? 0.1 : 0)),
      evidence: [
        `${lateW.length} late-term withdrawals: ${lateW.map((x) => `${x.course} (wk ${x.week})`).join(", ")}`,
        ...(a.degree?.thesis_completed === false ? [`${a.degree.thesis_attempts} thesis attempts, none completed`] : []),
        ...(a.prior_graduate_attempts ?? []).map((p) => `${p.program}: ${p.outcome}, ${p.incompletes} incomplete`),
      ],
    });
  }
  const gpa = a.degree?.gpa_cum ?? a.degree?.gpa_last60;
  if (gpa >= 3.5 || (a.degree?.cgpa_native ?? 0) >= 8) {
    protective.push({ factor: "academic_aptitude", evidence: [gpa ? `GPA ${gpa}` : `CGPA ${a.degree.cgpa_native}/${a.degree.native_scale}`, ...(a.gre ? [`GRE Q${a.gre.q}`] : [])] });
  } else if (gpa && gpa < 3.0) {
    risks.push({ factor: "low_gpa", weight: 0.2, evidence: [`GPA ${gpa} below 3.0`] });
  }
  const prereqOk = Object.values(a.prereqs ?? {}).every(Boolean);
  if (!prereqOk) risks.push({ factor: "missing_prerequisites", weight: 0.25, evidence: [Object.entries(a.prereqs).filter(([, v]) => !v).map(([k]) => k).join(", ")] });
  else protective.push({ factor: "prerequisites_complete", evidence: ["all program prerequisites satisfied"] });
  return sig("transcript", risks, protective, risks.length ? 0.85 : 0.7,
    risks.length ? "Strong exam-based record but a pattern of not finishing long-horizon deliverables." : "Clean transcript; prerequisites met.");
}

export function engagementAgent(c) {
  const e = c.applicant.engagement;
  const risks = [];
  const protective = [];
  if (!e) return sig("engagement", risks, [{ factor: "no_telemetry", evidence: ["no pre-admission engagement data available"] }], 0.3, "No engagement telemetry on file.");
  const ev = [];
  if (e.info_sessions_registered > 0 && e.info_sessions_attended / e.info_sessions_registered < 0.5) ev.push(`${e.info_sessions_attended}/${e.info_sessions_registered} info sessions attended`);
  if (e.advisor_emails_sent > 0 && e.advisor_replies / e.advisor_emails_sent < 0.5) ev.push(`${e.advisor_replies}/${e.advisor_emails_sent} advisor emails answered`);
  if (has(e.sop_submitted_minutes_before_deadline) && e.sop_submitted_minutes_before_deadline < 60) ev.push(`SOP submitted ${e.sop_submitted_minutes_before_deadline} min before deadline`);
  if (ev.length >= 2) risks.push({ factor: "low_follow_through_engagement", weight: 0.08 * ev.length, evidence: ev });
  else protective.push({ factor: "engaged_applicant", evidence: ["normal follow-through on optional touchpoints"] });
  return sig("engagement", risks, protective, 0.65, risks.length ? "Pattern of last-minute execution and low follow-through on non-mandatory touchpoints." : "Engagement looks normal.");
}

export function contextAgent(c) {
  const a = c.applicant;
  const risks = [];
  const protective = [];
  const months = a.financial_runway_months;
  const dur = c.program.expected_duration_months ?? 24;
  if (has(months) && months < dur * 0.5 && !a.employment?.sponsorship) {
    risks.push({ factor: "financial_runway_shortfall", weight: 0.14, evidence: [`~${months}mo savings vs ${dur}mo program`, "no employer sponsorship"] });
  }
  if (a.funding?.loan_sanctioned) protective.push({ factor: "funding_secured", evidence: ["education loan sanctioned"] });
  if (a.employment?.status === "freelance") {
    risks.push({ factor: "contingent_enrollment_intent", weight: 0.19, evidence: ["freelance / may return to full-time work", "generic 'Why SJSU' paragraph"] });
  }
  if (a.residency === "international") {
    risks.push({ factor: "visa_timeline_risk", weight: 0.1, evidence: ["F-1 interview slot scarcity May–July", "arrival window tied to I-20 start date"] });
  }
  if ((a.experience ?? []).length >= 2) protective.push({ factor: "domain_experience", evidence: a.experience.slice(0, 3) });
  if (a.goal?.includes("part-time")) protective.push({ factor: "realistic_load_plan", evidence: ["plans part-time enrollment while working"] });
  return sig("context", risks, protective, 0.6, risks.length ? "Enrollment appears contingent on external factors." : "Life-load and funding look stable.");
}

function sig(agent, risk_factors, protective_factors, confidence, summary) {
  return { agent, summary, risk_factors, protective_factors, confidence };
}

// Combine specialist signals into a completion estimate.
export function aggregate(c, signals) {
  const median = 0.78;
  const a = c.applicant;
  const gpa = a.degree?.gpa_cum ?? a.degree?.gpa_last60 ?? (a.degree?.cgpa_native ? a.degree.cgpa_native / a.degree.native_scale * 4 : 3.2);
  const paper = Math.min(0.98, 0.55 + (gpa - 3.0) * 0.4 + (a.gre ? 0.05 : 0) + ((a.experience?.length ?? 0) >= 2 ? 0.04 : 0));
  const risks = signals.flatMap((s) => s.risk_factors.map((r) => ({ ...r, source: s.agent })));
  const prot = signals.flatMap((s) => s.protective_factors.map((p) => ({ ...p, source: s.agent })));
  const totalRisk = risks.reduce((t, r) => t + r.weight, 0);
  const totalProt = Math.min(0.15, prot.length * 0.03);
  // Risk weights overlap (same underlying trait shows up across agents), so damp the sum.
  const p = Math.max(0.05, Math.min(0.97, median + totalProt - totalRisk * 0.5 + (paper - 0.8) * 0.15));
  const confidence = signals.reduce((t, s) => t + s.confidence, 0) / signals.length;
  let action, rationale;
  if (p >= 0.7) { action = "ADMIT"; rationale = "Completion likelihood at or above program norm."; }
  else if (p >= 0.35) { action = "ADMIT_WITH_SUPPORT_PLAN"; rationale = "Aptitude is strong; risk factors are addressable with structured milestones, advising check-ins, and financial-aid referral. Prediction is not destiny — allocate support, don't gatekeep."; }
  else { action = "HUMAN_REVIEW"; rationale = "Low predicted completion; requires human review — never auto-deny on a behavioral prediction."; }
  return {
    case_id: c.case_id,
    paper_score: round(paper),
    predicted_completion_probability: round(p),
    program_median_completion_probability: median,
    confidence: round(confidence),
    top_risk_factors: risks.sort((x, y) => y.weight - x.weight),
    protective_factors: prot,
    recommended_action: action,
    rationale,
  };
}

const round = (n) => Math.round(n * 100) / 100;
