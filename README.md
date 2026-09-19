# Lighthouse — Long-Term-Fit Admissions & Alumni-Engagement Agent

Built on [TrueForge](https://trueforge.dev) for the Agent Harness Hackathon (Santa Clara, 19 Sep 2026).

Lighthouse reads a LEAD Certificate applicant's record and produces a **Long-Term Fit Report**: a critically reasoned, evidence-traced, calibrated estimate of whether they will **complete the course** and become a **volunteer, cheerleader, donor and recruiter** for the University over a 10-year horizon. Every recommendation goes to a human; the agent never acts alone.

The reasoning standard is the four pillars of Stanford GSB LEAD's *Critical Analytical Thinking* course: logical reasoning, evidence, experiment design, analogies.

## Documents

- [FAQ](FAQ.md) — questions institutions, families and judges ask, with answers
- [Demo narrative](NARRATIVE.md) — 3-minute script in the judges' order: problem, stack, live demo + code
- [Demo guide](DEMO.md) — how to run and record the captioned demo
- [Build prompt](PROMPT.md) — the BDD/TDD spec the agent was built from
- [Eval scoreboard](evals/SCOREBOARD.md) — latest results
- [Demo video](https://github.com/SMITHASL/lighthouse-agent/releases/download/v0.1.0/lighthouse-demo.mp4) — 3:16, captions, no audio

## How it maps to the judging rubric

| Rubric | What Lighthouse does | Where to see it |
|---|---|---|
| **Observe it** | Every stage is a TrueForge session with tool calls, tokens and timing | TrueForge → Sessions |
| **Schedule it** | `lighthouse-nightly-rescore` runs `lighthouse-rescorer` at 02:00 PT: re-scores every stored report against recorded outcomes and refreshes `data/calibration.json`. Trigger it manually from TrueForge → Schedules. | TrueForge → Schedules |
| **Control it** | `pipeline_propose_action` is `@write`-gated → the run pauses with **Allow / Deny** until a human decides. Independent fairness auditor has **veto** power. Per-report and per-eval cost caps. | Sessions → `lighthouse-action-proposer` |
| **Test it** | 13 Gherkin scenarios (BDD) → 50 offline + 5 live tests (TDD). `pnpm eval` computes AUROC, Brier, ECE, CI coverage, fairness parity, hallucination rate, run-to-run consistency and cost, vs. a base-rate baseline. | `features/`, `test/`, `evals/SCOREBOARD.md` |

## Architecture

```
applicant record ─▶ lighthouse-critical-analyst (gpt-5-5)  ──▶ LongTermFitReport (JSON schema)
                       │  MCP: applicants_get, applicants_timeline,
                       │       institution_reference_class_stats
                       ▼
                    lighthouse-fairness-auditor (gpt-5-4-mini) ──▶ pass | VETO (report withheld)
                       ▼
                    lighthouse-action-proposer (gpt-5-4-mini)
                       │  MCP: pipeline_propose_action  [@write → HUMAN APPROVAL]
                       ▼
                    TrueForge pauses → human clicks Allow / Deny
```

- `src/schema/` — Zod contracts. `ApplicantInput` is `strict`: any protected attribute (race, gender, zip code, family income, name, …) is rejected at the boundary. `LongTermFitReport` refuses an estimate with no evidence.
- `src/mcp/` — local Streamable-HTTP MCP server (port 8799) exposing applicant data, base rates, outcome recording and the approval-gated action tool.
- `src/agents/` — agent manifests (instructions encode the reasoning contract) and **domain packs**: swap `university-admissions` for `startup-recruiting` or `corporate-talent` and the outcomes/base rates/vocabulary change with zero core changes.
- `src/pipeline/` — thin TrueForge client (SSE) and the runner: analyst → auditor → action, with one retry on transport failure or schema violation, and budget checks.
- `src/metrics/` — pure eval math (AUROC, Brier, ECE, CI coverage, parity) and nightly `rescore()`.
- `src/data/` — deterministic synthetic dataset (500 records) with ground truth and **separately stored** protected labels used only by the evaluator.

## Donor outcome = future capacity × generosity

Predicting "who will donate" from wealth would be both unfair and lazy. Lighthouse models it as a *trajectory*: ambition signals (goal clarity, initiative, persistence through setbacks, growth rate, hard course loads, founder roles) × reciprocity signals (volunteering, mentoring, crediting others, gratitude, referrals). Wealth is never an input; the BDD scenario `donor_estimate_is_trajectory_not_wealth` proves two wealth-twins score alike.

## Run it

Prereqs: TrueForge running on `http://localhost:8790` with an OpenAI provider configured (Settings → Models).

```bash
npm install
npm run gen:data          # 500 synthetic applicants → data/
npm run mcp               # MCP tools on :8799 (keep running)
npm run setup             # registers MCP server + 4 agents + nightly schedule in TrueForge
npm run report -- app_0001   # one full pipeline run; pauses at the approval gate
npm test                  # 50 offline tests (schemas, metrics, BDD traceability)
LIVE=1 npm test           # + 5 live BDD scenarios against TrueForge (~$0.30)
npm run eval -- --n=30    # scoreboard → evals/SCOREBOARD.md (~$1.50; --full for 500)
```

## Results (n=20 first run, before instruction fixes)

- 0 hallucinated evidence fields across 414 claims; counter-evidence present in 100% of reports; run-to-run std of the completion estimate 0.01.
- Cost $0.040 per report (cap $0.15).
- Fairness parity and CI coverage gates **failed at n=14** — mostly group-size noise, but reported honestly; see `evals/SCOREBOARD.md` for the latest run.
- The first auditor version over-vetoed by treating the applicant's own behaviour (campus visits, response time) as "circumstance"; fixed by defining person vs. circumstance signals explicitly.

## Scaling path

`src/agents/domainPacks.ts` is the contract. A startup recruiter uses `startup-recruiting` (hire → retain 2y → refer → advocate); a corporate talent team uses `corporate-talent`. Same analyst, same auditor, same approval gate, same evals — only outcomes, base rates and vocabulary change. Hosted TrueForge (Postgres + Redis + OIDC) gives multi-tenant deployment without code changes.

## Reviewer UI (next step)

An admissions office will not work in the raw TrueForge chat. The reviewer experience is `@truefoundry/trueforge-ui` themed for the institution: the same Long-Term Fit Report, fairness attestation and Allow / Deny checkpoint, rendered as a review queue against the same TrueForge server — no new backend, no re-implementation of approvals or session history. The agents, MCP tools and evals stay exactly as they are.

## Known limits (from an adversarial self-review)

- **Domain packs swap instructions and base rates, not the report schema.** `LongTermFitReport` hard-codes the five university outcomes; a startup pack needs a per-pack report schema. The analyst/auditor/approval/eval machinery is pack-agnostic; the schema is not yet.
- **Synthetic fairness labels are independent of the data by construction**, so parity metrics can only fail by noise and cannot detect real bias. The meaningful fairness tests are the behavioural ones: the auditor vetoes a zip-code proxy, and a statement that leaks wealth/geography/sponsorship (`textual_proxy_does_not_move_estimates`) does not move the donor estimate.
- **"0 hallucinated source fields" is an existence check** (every cited field resolves on the record), not a claim-support check. A claim-support judge is the next eval to add.
- **`ci_coverage` is a proxy**: for binary outcomes it tests whether the interval spans the observed side of 0.5. ECE at n=30 with 10 bins is mostly noise; treat the calibration numbers as machinery proof, not measurements.
- **The approval gate is enforced by the harness, not the tool.** The local MCP server is unauthenticated; in hosted mode it must verify the caller (TrueForge header auth) or the gate can be bypassed by calling the tool directly.
- **Synthetic statements come from seven templates**, so predictive metrics largely reflect the generator. The reasoning quality in the reports is real; the AUROC numbers are not evidence about real applicants.

- Local sandbox is macOS/Linux only, so TrueForge *skills* are replaced by instructions on Windows.
- Synthetic ground truth: predictive metrics prove the *machinery*, not real-world accuracy. Calibration curves update nightly via `rescore()` as real outcomes are recorded through `outcomes_record_ground_truth`.
