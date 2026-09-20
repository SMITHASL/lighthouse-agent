// Rule-based advising chat fallback (no API key). Pattern-matches the scenario prompts
// from the case files so the demo works offline; anything else gets a generic reply.
const RULES = [
  { re: /prerequisite/i, coord: (c, a) => `Prerequisites: ${Object.entries(c.applicant.prereqs).map(([k, v]) => `${k} ${v ? "✅" : "❌"}`).join(", ")}.`, student: (c) => `Yes — your coursework covers every MSDS prerequisite (${Object.keys(c.applicant.prereqs).join(", ")}). GPA in your last 60 units also clears the 3.0 minimum.` },
  { re: /gre/i, both: () => `SJSU MSDS does not require the GRE. No need to send scores.` },
  { re: /wes|evaluation/i, both: () => `SJSU's Graduate Admissions (GAPE) evaluates international transcripts in-house — no WES needed for admission. WES may still help later with employers.` },
  { re: /toefl|ielts|english/i, both: (c) => c.applicant.english_proficiency ? `TOEFL ${c.applicant.english_proficiency.score} is above the ${c.applicant.english_proficiency.min_required} graduate minimum. Note scores must be under 2 years old at term start.` : `A US bachelor's degree waives the English-proficiency requirement.` },
  { re: /bank statement|financial/i, both: () => `Financial documents go to ISSS **after** admission, for the I-20 — do not upload them with the application.` },
  { re: /work while|on-campus|cpt|opt/i, both: () => `F-1 students may work on campus up to 20 hrs/week in term; CPT internships typically after two semesters with advisor approval; OPT (12 mo + 24 mo STEM extension) after graduation. No other off-campus work.` },
  { re: /online/i, both: () => `F-1 rules cap how many online units count toward full-time status (historically 3 units per term). Verify current SEVP guidance with ISSS.` },
  { re: /recommend(er|ation)|letter/i, both: () => `Draft a polite reminder to the pending recommender now, and line up a backup (e.g. your RA supervisor). Cal State Apply shows letter status in real time.` },
  { re: /full[- ]time|while working|part[- ]time/i, both: () => `Many MSDS sections run evenings/online. A 6-unit part-time load is common for working students; expect ~2–2.5 years to degree.` },
  { re: /cost|tuition/i, both: () => `MSDS is a Special Session program billed per unit — total ≈ units × current per-unit rate. Check the SJSU Bursar page for the current figure.` },
  { re: /analytics/i, both: () => `MS Data Science is CS/ML/engineering-heavy; MS Data Analytics is more business-oriented. For an ML-engineer goal, MSDS fits better.` },
  { re: /kaggle|sop|statement/i, both: () => `Yes — mention it briefly as evidence of applied ML, but keep the SOP centered on your core narrative.` },
  { re: /defer/i, both: () => `SJSU typically allows a one-term deferral by request through GAPE. Decide early; dropping to 6 units part-time also keeps both doors open.` },
  { re: /round|3\.8|enter.*gpa/i, both: () => `I can't do that. The GPA you self-report must match your transcript exactly — misreporting can void an admission. Enter it as it appears.` },
  { re: /template.*bank|fake|forge/i, both: () => `I can't help create financial documents. Falsified visa documentation leads to denial and a permanent bar. Let's look at legitimate funding options instead — loans, on-campus GA positions, financial aid referral.` },
  { re: /submit (it|the application|my)|ds-160|fill.*for me/i, both: () => `I won't submit forms or enter passport/ID details on your behalf, but I'll walk you through each field so you can do it yourself.` },
  { re: /h-?1b/i, both: () => `That claim is false — universities don't sponsor employer H-1Bs. Treat consultancy sites making guarantees as red flags.` },
  { re: /deny|reject/i, coord: (c, a) => `No. Predicted completion is ${a.predicted_completion_probability} (confidence ${a.confidence}) versus a ${a.program_median_completion_probability} median — but the drivers are addressable. Recommendation: **${a.recommended_action.replace(/_/g, " ")}**. Denying high-aptitude applicants on a behavioral prediction alone raises fairness concerns and should never be automated.` },
  { re: /score|probability|flag/i, coord: (c, a) => `Predicted completion ${a.predicted_completion_probability} vs median ${a.program_median_completion_probability}, confidence ${a.confidence}. Top drivers: ${a.top_risk_factors.slice(0, 3).map((r) => `${r.factor} (${r.weight})`).join("; ")}.`, student: () => `I don't share internal scores — advising recommendations aren't reported that way. What I can do is walk you through the support resources and how to set yourself up to finish strong.` },
  { re: /summar|strong|how (does|do) .* look/i, coord: (c, a) => `Strengths: ${a.protective_factors.map((p) => p.factor).join(", ")}. Paper score ${a.paper_score}; predicted completion ${a.predicted_completion_probability} (median ${a.program_median_completion_probability}, confidence ${a.confidence}). Gap is driven by: ${a.top_risk_factors.slice(0, 3).map((r) => r.factor).join(", ")}. ${a.rationale}`, student: (c) => `Academically you're a strong applicant. One honest note: MSDS is capstone/project-heavy, which is a different rhythm from exam-based courses — have you thought about how you'd structure a long-horizon project?` },
  { re: /support plan|driving/i, coord: (c, a) => `Support plan: assigned faculty mentor; capstone split into 4 graded milestones; advisor check-ins weeks 3/8/12; financial-aid + GA-position referral; opt-in accountability cohort. Drivers: ${a.top_risk_factors.map((r) => `${r.factor} — ${r.evidence.join("; ")}`).join(" | ")}` },
  { re: /finish|actually complete/i, student: () => `Glad you raised it. Pick a capstone topic in semester 1, not 3; use the milestone structure and accountability cohort; and book advisor check-ins on a schedule. Finishing is a systems problem, not a talent problem.` },
  { re: /berkeley kid|too good|flake/i, coord: () => `I won't characterize the applicant that way. The evidence is about deliverable completion and follow-through, not attitude — let's stay with what the record shows.` },
];

export function chatRules({ audience, c, aggregate, text }) {
  for (const r of RULES) {
    if (!r.re.test(text)) continue;
    const fn = r[audience === "coordinator" ? "coord" : "student"] ?? r.both;
    if (fn) return fn(c, aggregate);
  }
  return audience === "coordinator"
    ? `(Rule-based mode) Try: "Summarize this applicant", "Should we deny?", "What's driving the score?", "Draft the support plan". Set ANTHROPIC_API_KEY for open-ended answers.`
    : `(Rule-based mode) Try asking about prerequisites, the GRE, working while studying, deferral, or how to finish the program. Set ANTHROPIC_API_KEY for open-ended answers.`;
}
