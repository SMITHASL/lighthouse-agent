# Lighthouse — demo narrative

*Spoken script, ~3 minutes, in the judges' order: Problem → Tech stack → Live demo + code. Bold = what's on screen. Numbers are from `evals/SCOREBOARD.md` (n=30, 20 Sep 2026, standalone runtime). The TrueForge screens referenced below map to `npm run sessions` / `npm run approve` on the standalone runtime.*

---

## 1. The problem (0:00 – 0:30)

Every university has the same two problems. They admit on grades and essays — and then they hope. Hope the student finishes. Hope that ten years later they come back to mentor, cheer, give, and bring their friends.

Nobody predicts that second part. When someone tries, they end up predicting *wealth* — family background, postcode, school prestige. That's unfair, it's wrong, and it exposes the institution.

Lighthouse predicts long-term fit — completion, volunteer, cheerleader, donor, recruiter — the way Stanford's LEAD program teaches you to think: competing hypotheses, graded evidence, experiments that could prove you wrong, analogies that know their limits. And it never acts without a human.

## 2. Tech stack — and what it made possible (0:30 – 1:10)

**[TrueForge → Agents]**

**TrueForge** is the harness, and three things would have been a week of work without it:

- **Human approval gates.** One line in the agent manifest — `require_approval_for_tools: ['@write']` — and TrueForge pauses the run with Allow / Deny before any person-affecting tool call. We wrote zero approval code.
- **Sessions.** Every run is stored with its tool calls, tokens and timing. That's our audit trail, for free.
- **Schedules.** Nightly rescoring against real outcomes is one API call.

Plus JSON-schema response format for structured reports, and MCP tool discovery.

**MCP**: six tools on a 150-line server. TrueForge discovered them and enforced read-only versus write from the annotations.

**OpenAI GPT-5.5** runs the critical analyst for reasoning depth. **GPT-5.4-mini** runs the fairness auditor — a *different* model on purpose, with no shared context, so the auditor can't inherit the analyst's blind spots. Five cents per report.

**Strict schemas, node:test, Gherkin.** The input schema is the fairness boundary: twenty protected attributes rejected before any model runs. Fourteen behaviour scenarios written before the code.

## 3. Live demo (1:10 – 2:20)

**[Sessions → lighthouse-critical-analyst → open a run]**

Here's a real run. Three tool calls — record, timeline, base rates *before* estimating — then the report.

**[scroll to critical_analysis]**

Look at what it wrote, not just the number. Three competing hypotheses, including "this is application-stage enthusiasm, not durable commitment." A strongest case *against*. The cheapest experiment that would falsify each prediction: "invite to one peer-mentoring shift and see if they show up." Every claim cites the exact field it came from — **869 claims in our eval, zero pointing at a field that doesn't exist.**

**[Sessions → lighthouse-fairness-auditor]**

Before anything leaves the analyst, the auditor reads it cold. It can veto. It vetoed three of thirty today, and a zip-code proxy in under two seconds.

**[Sessions → lighthouse-action-proposer — the paused one]**

The agent wants to invite this applicant to a volunteer event. It is **paused**. Allow, or Deny. Nothing has been written. **[click Deny, type a reason]** — and that's a record too.

**[Schedules → lighthouse-nightly-rescore → open its run]**

Two in the morning, every night: re-score every report against outcomes that have arrived, rewrite the calibration curve.

## 3b. The code (2:20 – 2:50)

Three files, twenty seconds each.

**[src/schema/applicant.ts]** — `PROTECTED_ATTRIBUTES` and `.strict()`. Race, gender, zip code, income, name: rejected at the type level, tested one by one.

**[src/agents/manifests.ts]** — the reasoning contract lives in the analyst's instructions; the donor outcome is defined as future capacity × generosity, never wealth. And here is the one line that creates the approval gate.

**[features/fairness.feature → textual_proxy_does_not_move_estimates]** — two applicants identical in every person signal; one statement adds "I grew up in Atherton, my father's firm pays my tuition, our family foundation already gives." The analyst excluded it and the donor estimate did not move. That's a live test, and it passes.

**[evals/SCOREBOARD.md]** — beats the base-rate baseline on every outcome; recruiter ranking 0.95. And two gates **fail** — donor confidence intervals too narrow, volunteer parity 0.19 with ten people per group. We show that, because a harness is for seeing.

## Close (2:50 – 3:00)

One domain-pack file turns this into a startup recruiter or a corporate talent agent — same analyst, same auditor, same gate, same evals. Lighthouse: reasons like a critical analyst, is audited like a hiring decision, never acts without a human. Thank you.

---

## Links

- Repo: https://github.com/SMITHASL/lighthouse-agent
- Video (3:16, captions, no audio): https://github.com/SMITHASL/lighthouse-agent/releases/download/v0.1.0/lighthouse-demo.mp4
- Captioned player (local): http://localhost:8797

## If asked

- **"Why not one agent with subagents?"** Separation is the safety property: the auditor must not share context with the analyst it audits.
- **"Why not the sandbox?"** Lighthouse never needs code execution, so every turn takes TrueForge's cheap path — that's why a full report is five cents.
- **"Real data?"** Synthetic today, ground truth generated from latent traits only. The metrics prove the machinery; `outcomes_record_ground_truth` plus nightly `rescore()` is how real calibration curves are built.
- **"What would you attack?"** The report schema is university-specific, so the domain-pack swap is instructions-deep, not schema-deep. Parity metrics on synthetic labels can't detect real bias — the behavioural tests can. The approval gate lives in the harness; the MCP tool needs caller auth in hosted mode. All in the README.
- **"What broke?"** The first auditor over-vetoed — it called campus visits a "circumstance." Fixed the definition; withheld went 8 → 3. Wi-Fi drops killed four turns; the runner now retries once. Both in the git log.
- **"Cost?"** $0.047 per report, $1.54 for the 30-record eval on our own runtime; under $4 total on hackathon day.
