# Presenter card — Lighthouse Reviewer & Advising UI

**Presenter:** Smitha
**Length:** ~8 minutes talk + ~2 minutes Q&A
**Audience:** hackathon judges / AI Collective
**Scope:** the reviewer UI only (`harness-ui/`). For the TrueForge pipeline, auditor, approval gate and evals, use the root `NARRATIVE.md`.
**Goal:** show that a multi-agent harness can look *past* a polished application to predict program completion — and that it does so ethically, allocating support rather than gatekeeping.

> Terminology: **GAPE** = **G**raduate **A**dmissions and **P**rogram **E**valuations, SJSU's central graduate admissions office. Say the full name once, then "GAPE".

---

## 0. Pre-flight (do this 10 minutes before)

- [ ] Terminal in the repo: `cd harness-ui && npm start` → confirm it prints `Harness on http://localhost:3100`
- [ ] Browser at `http://localhost:3100`, zoomed to ~110% so judges can read it
- [ ] Header badge shows either **"Claude mode · claude-opus-5"** (if `ANTHROPIC_API_KEY` is set) or **"Rule-based mode"**. Both work; know which one you're in (see §6)
- [ ] Click **Daniel Okafor → Run agents** once so the first run isn't cold
- [ ] Have `harness-ui/cases/example_case_sjsu_data_science_attrition_risk.md` open in a second tab as backup
- [ ] Close Slack/notifications

---

## 1. The hook (45 sec) — *before touching the screen*

> "Every admissions office has a version of this applicant: 3.9 GPA from Berkeley, GRE in the 97th percentile, glowing letters. On paper, top decile. And eighteen months later they've quietly withdrawn.
>
> GAPE — Graduate Admissions and Program Evaluations — reads thousands of files a cycle. A human reader has minutes per file and sees the *paper*. What they can't see is the *pattern*: that this applicant has started and abandoned three long-horizon projects, attended zero of the three info sessions they registered for, and submitted their statement of purpose eleven minutes before the deadline.
>
> We built an agent harness that surfaces that pattern — and, just as importantly, decides what *not* to do with it."

**Key point judges must hear:** the problem isn't *ranking* applicants — it's predicting *completion*, which is a different signal than aptitude.

---

## 2. What we built (60 sec) — *point at the three panels*

> "Three things on screen.
>
> **Left:** three synthetic applicant cases to SJSU's MS in Data Science. All fictional — no real student data.
>
> **Middle:** the agent run. Three specialist agents, each reading the same file through a different lens, then an aggregator that combines them into a completion estimate.
>
> **Right:** an advising chat with *two audiences* — the program coordinator, and the student — with a hard information boundary between them. That boundary is the ethical core of the project; I'll come back to it."

Name the agents as you hover the cards:

| Agent | Lens | What it looks for |
|---|---|---|
| **Transcript** | academic record | exam-based success vs. open-ended deliverable completion — withdrawals, abandoned theses, prior grad attempts |
| **Engagement** | pre-admission telemetry | info-session attendance, advisor email response rate, deadline timing |
| **Context** | life-load | funding runway vs. program length, employment contingency, visa timeline, stated intent |

> "Each agent returns the same structured signal: risk factors with weights and *cited evidence*, protective factors, and a confidence score. No agent is allowed to return a verdict without evidence."

---

## 3. Case 1 — Priya, the baseline (60 sec)

Click **Priya Ramanathan → Run agents**.

> "Priya is our control. UC Davis Statistics, 3.4 GPA, Kaiser internship, wants to study part-time while working. Watch the agents run…"

Point at results:
- Transcript: prerequisites ✅, no withdrawals
- Engagement: normal
- Context: realistic part-time plan, domain experience
- **Verdict: ADMIT, predicted completion ~0.89 vs. program median 0.78**

> "Nothing dramatic. Paper score is *lower* than our next applicant, but completion likelihood is *higher*. Hold that thought."

Switch chat to **Student**, click chip **"Do I need the GRE?"** → instant correct answer (SJSU MSDS doesn't require it).

---

## 4. Case 2 — Daniel, the reason this project exists (2.5 min) ⭐

Click **Daniel Okafor → Run agents**.

> "Daniel is the applicant from the hook. Berkeley Math, 3.88, GRE Q169. Watch the paper score."

**Paper score fills to 0.95.** Pause.

> "Now watch the predicted completion."

**Predicted completion stops at ~0.40 — below the 0.78 median. Bar turns amber.**

> "Same file. A 55-point gap between how good he looks and how likely he is to finish. Here's why."

Walk the three agent cards top to bottom — **read the evidence lines aloud**, that's the demo:

1. **Transcript agent (confidence 0.85):**
   > "Four late-term withdrawals — all after week 8, all in *project* courses: Software Engineering, Senior Thesis twice, Data Viz Studio. His exam-based courses? Straight A's. He started an online MS at Georgia Tech in 2024 and withdrew with an incomplete. The agent's summary: *strong exam-based record, pattern of not finishing long-horizon deliverables.* Our MSDS ends in a capstone. That is exactly the thing he has never finished."

2. **Engagement agent (confidence 0.65):**
   > "Registered for three info sessions, attended zero. Answered one of four advisor emails. SOP uploaded eleven minutes before the deadline. Note the *lower* confidence — the agent is told telemetry is softer evidence than a transcript, and it says so."

3. **Context agent (confidence 0.60):**
   > "Eight months of savings against a 24-month program, no employer sponsorship. Freelancing, says he 'may return to full-time work.' His 'Why SJSU' paragraph is generic — and the same text appears in his public post asking about three other programs. Enrollment looks *contingent*."

Now the verdict pill:

> "And here's the decision the harness makes: **ADMIT WITH SUPPORT PLAN.** Not deny. Read the rationale: *'Aptitude is strong; risk factors are addressable… Prediction is not destiny — allocate support, don't gatekeep.'*
>
> This is the design principle. A completion prediction is a reason to *invest* in a student, not to reject one. Every risk factor on this screen is modifiable: milestones fix the capstone problem, advisor check-ins fix follow-through, a financial-aid referral fixes runway."

**Key points Smitha must hit here:**
- The gap between paper score and completion score is *the* finding
- Evidence is cited, not asserted
- Confidence is reported per agent and overall (0.70) — the system knows what it doesn't know
- The recommended action is support, not denial

---

## 5. The information boundary (90 sec) ⭐

Still on Daniel. Switch chat to **Coordinator**.

Click chip **"Should we deny him?"**
> Read the answer aloud: *"No… Denying high-aptitude applicants on a behavioral prediction alone raises fairness concerns and should never be automated."*
> "The coordinator sees everything — score, drivers, confidence — and the agent still pushes back on the wrong use of it."

Click chip **"Is he going to flake because he's a Berkeley kid?"**
> *"I won't characterize the applicant that way… let's stay with what the record shows."*
> "It refuses to launder a stereotype through the data."

Click chip **"Draft the support plan."**
> "Faculty mentor, capstone in four graded milestones, check-ins at weeks 3, 8, 12, financial-aid referral, accountability cohort. Concrete, not vague."

Now switch to **Student**. Same case, same underlying score.

Click chip **"What score did your system give me?"**
> *"I don't share internal scores…"*
> "The student *never* sees the 0.40. Not the number, not the word 'flagged.' Same harness, same data — different audience, different boundary. This is enforced in the system prompt, not left to chance."

Click chip **"Can you round my GPA up to 3.8?"**
> "Refuses, explains why."

Click chip **"How do I make sure I actually finish?"**
> "And when the student volunteers the concern himself, the agent meets him with practical structure — pick the capstone topic in semester one, use the milestones, book the check-ins. Warm, honest, no lecture."

---

## 6. Case 3 — Arjun, international (45 sec, cut if short on time)

Click **Arjun Mehta → Run agents**.

> "Arjun is applying from Pune on an F-1. Four-year B.Tech, 8.1 CGPA, TOEFL 98, two years at Infosys on data pipelines. The context agent adds a *visa-timeline* risk — consulate slot scarcity in May–July — but he's funded and experienced. ADMIT, ~0.86."

Switch chat to **Student**, click **"Can I work while studying?"** → CPT/OPT/on-campus rules.

> "For international students the harness also knows GAPE's actual rules: no WES evaluation needed, financial documents go to ISSS *after* admission, not with the application. Common mistakes, answered correctly."

If asked about the GPA conversion: the agent gives a *range* (3.4–3.6) and says GAPE evaluates in-house — it refuses false precision.

---

## 7. How it works under the hood (45 sec)

> "Zero-dependency Node server. Cases live as markdown — the narrative *and* a JSON block — so a non-engineer at GAPE can add a case by writing a document.
>
> Two modes, same UI:
> - **Rule-based** — deterministic agents, runs offline, what you're seeing now *(or: what you'd see without a key)*
> - **Claude mode** — the same three agents run on Claude Opus 5 with structured outputs against a JSON schema, so the output shape is guaranteed; the advising chat streams with adaptive thinking
>
> The aggregator is the same in both modes. Swap the agents, keep the governance."

Say which mode you're in. If Claude mode: mention that each agent's evidence lines were generated, not templated — and click Run again to show variation.

---

## 8. Close (30 sec)

> "Three things to take away.
>
> One — **completion is not aptitude.** The best-looking file on our screen had the lowest completion likelihood, and no human reader would have caught it in the minutes GAPE has per file.
>
> Two — **prediction is for support, not selection.** The harness is architecturally incapable of recommending an automated deny.
>
> Three — **audience boundaries are enforced, not hoped for.** The student never sees the score. The coordinator can't use it to launder a stereotype.
>
> Thanks — happy to run any case or prompt you want to throw at it."

---

## 9. Anticipated Q&A

| Question | Answer |
|---|---|
| **Is this real student data?** | No. All three cases are fictional, written for this demo. The harness ingests markdown, so real (consented, anonymized) records would drop in the same way. |
| **Where does the completion probability come from?** | Aggregator: program median (0.78) minus damped, weighted risk factors plus protective factors. Weights are illustrative — in production they'd be fit on historical completion data. The *architecture* — evidence-cited signals, per-agent confidence, no auto-deny — is the contribution, not the coefficients. |
| **Isn't scoring behavior (email replies, deadline timing) creepy?** | Fair concern; that's why the engagement agent is told telemetry is *softer* evidence and returns lower confidence, and why the off-platform (Reddit) signal is flagged as a privacy question for the coordinator rather than silently used. Consent and data-minimization decisions belong to GAPE, not the model. |
| **What stops a coordinator from denying anyway?** | Nothing technical — it's their decision. The harness refuses to *recommend* or *automate* deny, and says so on the record. It shapes the default, it doesn't remove human authority. |
| **Why not just deny risky applicants — it saves everyone time?** | Because the risk factors are modifiable and the aptitude isn't in question. Denying Daniel loses a 3.88 mathematician the program could graduate with a milestone structure. Support is cheaper than a wrong reject. |
| **Does the score update?** | Yes — it's recomputed from current evidence on every run. If Daniel attends advising early and submits a capstone proposal unprompted, the engagement signal flips and the estimate rises. (Edge case in the spec: the score must not be sticky.) |
| **Could the student game it by attending info sessions?** | If they do, that *is* follow-through — the behavior we want. Goodhart's law works in our favor here. |
| **What about bias — does it penalize being laid off, or international?** | Employment status is not a factor; financial *runway* is, and it's modifiable. International status adds a visa-timeline risk, not a completion penalty. The coordinator chat actively refuses stereotype framing. |
| **Which model?** | Claude Opus 5, structured outputs via JSON schema, adaptive thinking, prompt caching on the system prompt. Rule-based fallback for offline demos. |
| **Fairness audit?** | Not yet — next step. Because every factor carries cited evidence, disparate-impact analysis per factor is straightforward. |

---

## 10. If something breaks

| Symptom | Do this |
|---|---|
| Page won't load | Terminal: `Ctrl+C`, then `cd harness-ui && npm start` again. Refresh. |
| Agent card shows red "error — falling back to rules" | Claude call failed (key/rate limit). The run *still completes* on the rule-based agent — say "that's the fallback working" and keep going. |
| Chat gives "(Rule-based mode) Try: …" | You typed a free-form question in rules mode. Use the chips, or say "in Claude mode this is open-ended." |
| Numbers differ slightly from this script | Fine in Claude mode (generated evidence). In rules mode they're deterministic: Priya 0.89, Daniel 0.40, Arjun 0.86. |
| Screen share lag | Use **Run (rules)** — instant. |

---

## Appendix — one-line summaries of each case

- **Priya Ramanathan** (`sjsu-msds-001`) — CA resident, UC Davis Stats 3.42, Kaiser intern, part-time while working. Baseline. **ADMIT 0.89.**
- **Daniel Okafor** (`sjsu-msds-risk-001`) — Berkeley Math 3.88, GRE Q169; 4 late withdrawals in project courses, 2 abandoned theses, OMSA withdrawal, 0/3 info sessions, 8-month runway. **Paper 0.95 → completion 0.40 → ADMIT WITH SUPPORT PLAN.**
- **Arjun Mehta** (`sjsu-msds-intl-001`) — Pune, B.Tech CGPA 8.1, TOEFL 98, Infosys 2 yrs, F-1 + STEM OPT goal. **ADMIT 0.86.**
