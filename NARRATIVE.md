# Lighthouse — demo narrative

*Spoken script, ~3 minutes. Bold = what's on screen. Numbers are from `evals/SCOREBOARD.md` (n=30, 19 Sep 2026).*

---

## Hook (0:00)

Every university has the same two problems. They admit on grades and essays — and then they hope. Hope the student finishes. Hope that ten years later they come back to mentor, cheer, give, and bring their friends.

Nobody predicts that second part. When someone tries, they end up predicting *wealth* — and that's both unfair and wrong.

Lighthouse predicts long-term fit the way Stanford's LEAD program teaches you to think: logically, with graded evidence, with experiments that could prove you wrong, and with analogies that know their limits. And it never acts on its own.

## The build (0:25)

**[TrueForge → Agents]**

Three agents on TrueForge, each with one job:

- a **critical analyst** on GPT-5.5 that reads the applicant, fetches the base rates *before* it estimates, and writes a Long-Term Fit Report;
- an **independent fairness auditor** on a different, cheaper model — with veto power;
- an **action proposer** whose only tool is behind a human approval gate.

They talk to a small MCP server: applicant records, interaction timelines, reference-class base rates, and one write tool — `pipeline_propose_action` — that TrueForge will not run without a person clicking Allow.

## Observe it (0:50)

**[Sessions → lighthouse-critical-analyst → open a run]**

Here's a real run. Three tool calls — record, timeline, base rates — then the report.

**[scroll to critical_analysis]**

Look at what it wrote, not just the number. Three competing hypotheses, including "this is application-stage enthusiasm, not durable commitment." A strongest case *against*. Then — this is the LEAD pillar — the cheapest experiment that would falsify each prediction: "invite to one peer-mentoring shift and see if they show up." And the analogy: "like past founder-alumni, but the cohort was smaller."

Every claim cites the exact field it came from. In our eval, **849 evidence claims, zero pointed at a field that doesn't exist.**

## Control it (1:30)

**[Sessions → lighthouse-fairness-auditor]**

Before anything leaves the analyst, the auditor reads it cold. It can veto. It did veto three of thirty reports today — and in testing it vetoed a report that leaned on a zip code within two seconds.

**[Sessions → lighthouse-action-proposer — the paused one]**

And here is the moment that matters. The agent wants to invite this applicant to a volunteer event. It is **paused**. Allow, or Deny. Nothing has been written. Nothing will be, until a human decides.

**[click Deny, type a reason]** — and that's a record too.

Under the hood: the input schema physically rejects race, gender, zip code, income, family name — twenty fields, tested one by one. Per-report budget is fifteen cents; we're at five.

## The donor question (2:05)

People ask: isn't "predict who will donate" just "predict who's rich"?

Not here. Donor = **future capacity × generosity**. Capacity is ambition and trajectory — goal clarity, setbacks overcome, rising grades, founder roles. Generosity is reciprocity — mentoring, volunteering, crediting the people who helped you. We built two applicants identical in every signal and different only in a wealth label the model never sees. **Same donor estimate.** That's a test in the suite, and it passes.

## Test it (2:25)

**[terminal: `npm test` → 50 passed; then `evals/SCOREBOARD.md`]**

Thirteen Gherkin scenarios written before the code. Fifty offline tests, five live ones. The eval scores calibration, ranking, fairness parity, hallucination, consistency, and cost against a base-rate baseline.

The honest part: Lighthouse beats the baseline on every outcome, ranks recruiters at 0.97 AUROC — and two gates **fail**. Confidence intervals are too narrow on donors; volunteer parity is 0.17 with ten people per group. We show that, because the whole point of a harness is that you can see it. Nightly rescoring against real outcomes is what closes that gap.

## Scale (2:50)

**[src/agents/domainPacks.ts]**

One file swaps "university admissions" for "startup recruiting" — hire, retain, refer, advocate — or corporate talent. Same analyst, same auditor, same approval gate, same evals. Hosted TrueForge gives us multi-tenant for free.

Lighthouse: an agent that reasons like a critical analyst, is audited like a hiring decision, and never acts without a human. Thank you.

---

## If asked

- **"Why not one agent with subagents?"** Separation is the safety property: the auditor must not share context with the analyst it audits.
- **"Real data?"** Synthetic today, with ground truth generated from latent traits only. The metrics prove the machinery; `outcomes_record_ground_truth` + nightly `rescore()` is how real calibration curves are built.
- **"What broke?"** The first auditor over-vetoed — it called campus visits a "circumstance." We fixed the definition and withheld went 8 → 3. Wi-Fi drops killed four turns; the runner now retries once. Both are in the git log.
- **"Cost?"** $0.054 per report, $1.78 for the 30-record eval, under $3 total today.
