# Lighthouse — Long-Term-Fit Admissions & Alumni-Engagement Agent

Built for the Agent Harness Hackathon (Santa Clara, 19 Sep 2026). **Standalone, zero dependencies**: its own runtime layer (`src/harness/`) runs the agents, the approval gate and the schedules with no external server and no npm packages — Node 24 and an OpenAI key, done. `package.json` has no `dependencies`; the only dev packages are `typescript` + `@types/node` for `npm run typecheck`. The original [TrueForge](https://trueforge.dev) runtime remains an optional mode (`TRUEFORGE_BASE_URL`).

Lighthouse reads a LEAD Certificate applicant's record and produces a **Long-Term Fit Report**: a critically reasoned, evidence-traced, calibrated estimate of whether they will **complete the course** and become a **volunteer, cheerleader, donor and recruiter** for the University over a 10-year horizon. Every recommendation goes to a human; the agent never acts alone.

The reasoning standard is the four pillars of Stanford GSB LEAD's *Critical Analytical Thinking* course: logical reasoning, evidence, experiment design, analogies.

## Documents

- [FAQ](FAQ.md) — questions institutions, families and judges ask, with answers
- [Demo narrative](NARRATIVE.md) — 3-minute script in the judges' order: problem, stack, live demo + code
- [Demo guide](DEMO.md) — how to run and record the captioned demo
- [Build prompt](PROMPT.md) — the BDD/TDD spec the agent was built from
- [Eval scoreboard](evals/SCOREBOARD.md) — latest results
- [Demo video](https://github.com/SMITHASL/lighthouse-agent/releases/download/v0.1.0/lighthouse-demo.mp4) — 3:16, captions, no audio
- [Reviewer & Advising UI](#reviewer--advising-ui) — `npm run ui`: queue, report, approval gate, coordinator/student chat on the real pipeline. [Demo video](https://github.com/SMITHASL/lighthouse-agent/releases/download/v0.1.2/lighthouse-reviewer-ui-demo.mp4) (3:07)

## How it maps to the judging rubric

| Rubric | What Lighthouse does | Where to see it |
|---|---|---|
| **Observe it** | Every stage is a persisted session (`data/sessions/*.json`) with every model message, tool call, token count and timing | `npm run sessions`, `npm run sessions -- <id>` |
| **Schedule it** | `lighthouse-nightly-rescore` runs `lighthouse-rescorer` at 02:00 PT: re-scores every stored report against recorded outcomes and refreshes `data/calibration.json`. | `npm run scheduler` (cron loop) · `npm run schedule:run` (now) |
| **Control it** | `pipeline_propose_action` is `@write`-gated → the run pauses with **Allow / Deny** until a human decides; the gate is our own code, in-process, so the tool cannot be reached around it. Independent fairness auditor has **veto** power. Per-report and per-eval cost caps. | `npm run ui` → Allow / Deny on screen, or `npm run approve -- <session> allow\|deny "reason"` |
| **Test it** | 14 Gherkin scenarios (BDD) → 56 offline on `node:test` (incl. 5 runtime tests against a scripted fake model: loop, gate, deny, allow, schedules) + 6 live tests (TDD). `npm run eval` computes AUROC, Brier, ECE, CI coverage, fairness parity, hallucination rate, run-to-run consistency and cost, vs. a base-rate baseline. | `features/`, `test/`, `evals/SCOREBOARD.md` |

## Architecture

```
applicant record ─▶ lighthouse-critical-analyst (gpt-5-5)  ──▶ LongTermFitReport (JSON schema)
                       │  tools: applicants_get, applicants_timeline,
                       │         institution_reference_class_stats
                       ▼
                    lighthouse-fairness-auditor (gpt-5-4-mini) ──▶ pass | VETO (report withheld)
                       ▼
                    lighthouse-action-proposer (gpt-5-4-mini)
                       │  tool: pipeline_propose_action  [@write → HUMAN APPROVAL]
                       ▼
                    harness pauses the turn → human runs `npm run approve` allow / deny
```

- `src/lib/schema.ts` — a ~200-line schema library (strict objects, enums, refinements, JSON-Schema export) that replaced zod; the contracts read the same.
- `src/schema/` — the contracts. `ApplicantInput` is `strict`: any protected attribute (race, gender, zip code, family income, name, …) is rejected at the boundary. `LongTermFitReport` refuses an estimate with no evidence.
- `src/tools/` — the seven tools as plain functions (applicant data, base rates, outcome recording, calibration rescore, the approval-gated action) with a `readOnly` flag that `@write` gating keys on.
- `src/ui/` — the reviewer & advising UI: one node:http server over the pipeline, the runtime's sessions and the approval gate; coordinator/student chat with an information boundary.
- `src/harness/` — **the runtime layer**: agent registry, persisted sessions, the model ↔ tool loop over plain `fetch`, the approval pause/resume, cron schedules, and the operator CLI. ~300 lines, no dependencies.
- `src/mcp/` — optional: the same tools over MCP Streamable-HTTP (port 8799) for TrueForge mode; JSON-RPC on `node:http`, no SDK.
- `src/agents/` — agent manifests (instructions encode the reasoning contract) and **domain packs**: swap `university-admissions` for `startup-recruiting` or `corporate-talent` and the outcomes/base rates/vocabulary change with zero core changes.
- `src/pipeline/` — the runner: analyst → auditor → action, with one retry on transport failure or schema violation, and budget checks. Runtime-agnostic: `createHarness()` returns the local runtime or a TrueForge client with the same interface.
- `src/metrics/` — pure eval math (AUROC, Brier, ECE, CI coverage, parity) and nightly `rescore()`.
- `src/data/` — deterministic synthetic dataset (500 records) with ground truth and **separately stored** protected labels used only by the evaluator.

## Donor outcome = future capacity × generosity

Predicting "who will donate" from wealth would be both unfair and lazy. Lighthouse models it as a *trajectory*: ambition signals (goal clarity, initiative, persistence through setbacks, growth rate, hard course loads, founder roles) × reciprocity signals (volunteering, mentoring, crediting others, gratitude, referrals). Wealth is never an input; the BDD scenario `donor_estimate_is_trajectory_not_wealth` proves two wealth-twins score alike.

## Run it

Prereqs: **Node 24+** (runs TypeScript natively; no build step) and an OpenAI key in `.env` (any OpenAI-compatible endpoint via `OPENAI_BASE_URL`). Nothing else to run.

```bash
npm install                  # only typescript + @types/node, for typecheck; skip it if you never typecheck
cp .env.example .env         # put OPENAI_API_KEY in .env (git-ignored, loaded automatically)
npm run gen:data             # 500 synthetic applicants → data/
npm run setup                # registers the 4 agents + nightly schedule (data/agents.json, data/schedules.json)
npm run report -- app_0001   # one full pipeline run; pauses at the approval gate and prints the approve command
npm run sessions             # every run is an inspectable session; `-- <id>` prints its events
npm run approve -- <session> deny "not this cycle"   # or allow — nothing is written until you decide
npm run schedule:run         # fire the nightly rescore now; `npm run scheduler` keeps it on cron
npm test                     # 56 offline tests on node:test (schemas, metrics, BDD traceability, runtime)
LIVE=1 npm test              # + 6 live BDD scenarios through the local runtime (~$0.30)
npm run eval -- --n=30       # scoreboard → evals/SCOREBOARD.md (~$1.50; --full for 500)
```

### Optional: run on TrueForge instead

The same pipeline runs unchanged against a [TrueForge](https://trueforge.dev) server — useful for its session UI and hosted multi-tenant mode.

```bash
npm run mcp                        # exposes src/tools over MCP on :8799 (keep running)
TRUEFORGE_BASE_URL=http://localhost:8790 npm run setup
TRUEFORGE_BASE_URL=http://localhost:8790 npm run report -- app_0001
```

## Results (n=30, standalone runtime, 20 Sep 2026)

From [`evals/SCOREBOARD.md`](evals/SCOREBOARD.md), produced by the local runtime in this repo (GPT-5.5 analyst, GPT-5.4-mini auditor), no TrueForge involved. The earlier TrueForge-hosted run of 19 Sep gave the same picture (27/3 released/withheld, 849 claims, 0 hallucinated, $0.054/report).

| outcome | AUROC | Brier | Brier (base rate) | 90% CI coverage |
|---|---|---|---|---|
| completion | 0.665 | 0.201 | 0.208 | 0.93 |
| volunteer | 0.731 | 0.212 | 0.248 | 0.93 |
| cheerleader | 0.685 | 0.196 | 0.225 | 0.87 |
| donor | 0.568 | 0.199 | 0.212 | 0.77 |
| recruiter | 0.948 | 0.442 | 0.590 | 0.70 |

- Beats the base-rate baseline on every outcome. **869 evidence claims, 0 hallucinated source fields**; counter-evidence present in 100% of reports; run-to-run std of the completion estimate **0.009**.
- 27 released / 3 withheld by the fairness auditor / 0 partial. **$1.54 total, $0.047 per report** (cap $0.15); ~11.0k input / 3.8k output tokens per report.
- Two gates **fail**, as before: fairness parity (0.19 on volunteer, ~10 people per synthetic group, mostly noise) and CI coverage (intervals too narrow on donor and recruiter). Shown deliberately — a harness exists to make failure visible.
- The synthetic donor outcome is near-random by construction, so donor AUROC (0.57) says little; recruiter ranks at 0.95 but anchors on a 22% base rate while the eval label is far more common, hence the poor calibration — the drift nightly rescoring is for.
- History: the first auditor version over-vetoed by treating the applicant's own behaviour (campus visits, response time) as "circumstance"; fixed by defining person vs. circumstance signals explicitly (withheld 8 → 3 of 30).

## Scaling path

`src/agents/domainPacks.ts` is the contract. A startup recruiter uses `startup-recruiting` (hire → retain 2y → refer → advocate); a corporate talent team uses `corporate-talent`. Same analyst, same auditor, same approval gate, same evals — only outcomes, base rates and vocabulary change. Multi-tenant hosting: the runtime persists to plain JSON under `data/`; swap that for a database, or run the TrueForge mode (Postgres + Redis + OIDC).

## Reviewer & Advising UI

```bash
npm run ui                # http://localhost:3100
```

The screen an admissions office uses, on top of the real pipeline and runtime — no separate agents, no separate data (`src/ui/`, zero dependencies):

- **Queue** — every applicant, badged with the status of its stored report: released, withheld by the auditor, waiting for approval, or unscored.
- **Report** — the five calibrated estimates with 90% intervals, the fairness attestation, the recommended action, the full critical analysis (hypotheses, strongest case against, falsifying experiment, analogy) and every evidence claim with the record field it cites. **Run** streams the runtime's events live: tool calls, the approval pause, turn state.
- **Approval gate** — when the action proposer pauses, the reviewer sees **Allow / Deny** with a reason box; the decision, reason and timestamp land on the stored report and nothing is written until they decide.
- **Advising chat**, grounded in the report, with a hard information boundary: the *coordinator* sees estimates, drivers and the audit and is pushed back on automated denial and stereotype framing; the *student* gets advice and never learns a report exists.

Captioned walkthrough (3:07, no audio, includes one live pipeline run): [lighthouse-reviewer-ui-demo.mp4](https://github.com/SMITHASL/lighthouse-agent/releases/download/v0.1.2/lighthouse-reviewer-ui-demo.mp4) — `npm run demo:ui` to play it locally, `npm run demo:ui:record` to re-record (drives the live UI over `postMessage`; one real pipeline run, ~$0.05).

## Known limits (from an adversarial self-review)

- **Domain packs swap instructions and base rates, not the report schema.** `LongTermFitReport` hard-codes the five university outcomes; a startup pack needs a per-pack report schema. The analyst/auditor/approval/eval machinery is pack-agnostic; the schema is not yet.
- **Synthetic fairness labels are independent of the data by construction**, so parity metrics can only fail by noise and cannot detect real bias. The meaningful fairness tests are the behavioural ones: the auditor vetoes a zip-code proxy, and a statement that leaks wealth/geography/sponsorship (`textual_proxy_does_not_move_estimates`) does not move the donor estimate.
- **"0 hallucinated source fields" is an existence check** (every cited field resolves on the record), not a claim-support check. A claim-support judge is the next eval to add.
- **`ci_coverage` is a proxy**: for binary outcomes it tests whether the interval spans the observed side of 0.5. ECE at n=30 with 10 bins is mostly noise; treat the calibration numbers as machinery proof, not measurements.
- **The approval gate is enforced by the runtime, not the tool.** In the local runtime tools are in-process functions, so there is no network path around the gate. In TrueForge mode the MCP server is unauthenticated and must verify the caller in hosted deployments, or the gate can be bypassed by calling the tool directly.
- **Synthetic statements come from seven templates**, so predictive metrics largely reflect the generator. The reasoning quality in the reports is real; the AUROC numbers are not evidence about real applicants.

- The local runtime is deliberately minimal: no streaming, no sub-agents, no sandbox — Lighthouse never needed them. Model provider is OpenAI-compatible chat completions only.
- Synthetic ground truth: predictive metrics prove the *machinery*, not real-world accuracy. Calibration curves update nightly via `rescore()` as real outcomes are recorded through `outcomes_record_ground_truth`.
