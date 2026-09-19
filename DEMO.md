# 3-minute demo script

Before you start: TrueForge UI open at http://localhost:3000, MCP server running (`npm run mcp`), terminal in `D:\dev\hackathon\admissions-agent`.

## 0:00 — The problem (20s)
"Universities recruit on grades and essays, then hope for alumni who give back. Lighthouse predicts *long-term fit* — completion, volunteering, cheerleading, donating, recruiting — with critical-analytical reasoning, not a black-box score. And 'donor' means who will *become* generous, never who is already rich."

## 0:20 — Observe it (60s)
```bash
npm run report -- app_0007
```
While it runs (~60s), open TrueForge → **Sessions** → `lighthouse-critical-analyst` (newest).
Point at: the three MCP tool calls (record → timeline → base rates **before** estimating), then the JSON report.
Read aloud from the report: two competing hypotheses, strongest case *against*, the cheapest falsifying experiment, the analogy and where it breaks. Every claim cites an input field.

## 1:20 — Control it (50s)
Open the `lighthouse-fairness-auditor` session: independent model, verdict `pass`, with veto power.
Open the `lighthouse-action-proposer` session: it is **paused** — "Tool Approval Required for `pipeline_propose_action`", Allow / Deny.
Click **Deny** with a reason, or **Allow** and show `data/proposed_actions.json` appear. Nothing was written until a human decided.

Mention: per-report cap $0.15, per-eval cap $10, `ApplicantInput` schema physically rejects zip code, income, name, gender…

## 2:10 — Test it (40s)
```bash
npm test
```
50 tests, 13 Gherkin scenarios traced (`features/`). Then show `evals/SCOREBOARD.md`:
- 0 hallucinated evidence fields across hundreds of claims
- run-to-run consistency std ≈ 0.01
- fairness parity across synthetic groups the model never sees
- cost per report

Be honest about gates that fail at small n — that is what calibration monitoring is for.

## 2:50 — Scale (10s)
`src/agents/domainPacks.ts`: swap to `startup-recruiting` → outcomes become hire / retain / refer / advocate. Same harness, same guardrails.

## Backup if Wi-Fi dies
`data/reports/app_0001.json` is a saved full result; `evals/results/*.json` has full eval output. TrueForge Sessions are persisted locally.
