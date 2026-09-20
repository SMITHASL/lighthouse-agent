# Lighthouse — Reviewer & Advising UI

The screen an admissions office actually sits in front of: a case queue, the agent run with cited evidence, and an advising chat with two audiences (coordinator / student) separated by a hard information boundary.

**Demo video (2:11, captions, no audio):** [lighthouse-reviewer-ui-demo.mp4](https://github.com/SMITHASL/lighthouse-agent/releases/download/v0.1.1/lighthouse-reviewer-ui-demo.mp4)

## What it is, honestly

A self-contained prototype of the reviewer experience, built against the same principles as the TrueForge pipeline in `src/` — evidence-cited specialist agents, a recommendation that is never an automated deny, a human in the loop — but **not yet wired to it**. It runs its own three lightweight agents (transcript, engagement, context) over markdown case files, so it works offline with zero dependencies. The next step is pointing the same screens at TrueForge sessions and `LongTermFitReport` output (see "Reviewer UI" in the root README).

Three synthetic applicants to SJSU's MS in Data Science, written to exercise different signals:

| Case | Applicant | Point |
|---|---|---|
| `sjsu-msds-001` | Priya — UC Davis Statistics, part-time while working | Baseline. ADMIT, 0.89. |
| `sjsu-msds-risk-001` | Daniel — Berkeley Math 3.88, GRE Q169 | **Paper 0.95, predicted completion 0.40.** Four late-term withdrawals in project courses, two abandoned theses, a prior grad withdrawal. Verdict: ADMIT WITH SUPPORT PLAN, never deny. |
| `sjsu-msds-intl-001` | Arjun — Pune B.Tech, F-1 | International rules (GAPE, ISSS, WES, CPT/OPT). ADMIT, 0.86. |

Each case file (`cases/*.md`) is the narrative plus a JSON block plus a table of agent test scenarios and edge cases — a coordinator can add a case by writing a document.

## Run it

```bash
cd harness-ui
npm start                 # http://localhost:3100  (rule-based mode, no key needed)
```

Claude mode — the same three agents on Claude Opus 5 with JSON-schema structured outputs, and a streaming advising chat with adaptive thinking:

```bash
npm install @anthropic-ai/sdk
ANTHROPIC_API_KEY=sk-ant-... npm start
```

(If `node_modules` cannot live next to the code, set `ANTHROPIC_SDK_DIR=/path/to/node_modules` instead.)

## Record the captioned demo

```bash
npm start                 # harness on :3100, keep running
npm run demo              # captioned player on http://localhost:8798 (Space = play, ←/→ = step)
npm run demo:record       # drives Chrome, tab-captures, writes demo/lighthouse-reviewer-ui-demo.mp4
node ../demo/fix-mp4-duration.mjs demo/lighthouse-reviewer-ui-demo.mp4 139
```

The player (`demo/index.html`) drives the live UI over `postMessage` — select a case, run agents, switch audience, send a chat prompt — so the recording shows real interactions, not slides. Steps and captions are the `steps` array at the top of that file.

## Layout

```
harness-ui/
  server.mjs          zero-dependency HTTP server; parses cases/*.md at startup; NDJSON agent stream, text chat stream
  agents/rules.mjs    deterministic transcript / engagement / context agents + aggregator
  agents/llm.mjs      the same agents on Claude (structured outputs) + two-audience chat
  agents/chatRules.mjs offline chat fallback keyed to the scenario prompts in the case files
  agents/schema.mjs   JSON schema every agent's signal must satisfy
  public/index.html   the UI (+ the postMessage tour hook at the bottom)
  cases/*.md          the three applicants
  demo/               captioned player, recorder, server
  PRESENTER.md        live-demo talk track and Q&A for this UI
```

## Design rules the UI enforces

- **Recommended actions are ADMIT · ADMIT WITH SUPPORT PLAN · HUMAN REVIEW.** DENY is not an output; low predictions route to a human.
- **Coordinator sees the score, drivers and confidence.** The student never does — not the number, not the word "flagged". Enforced in the system prompt (Claude mode) and the rule table (offline).
- **Every risk factor carries cited evidence and a weight**; every agent reports confidence. Telemetry-based signals are told to report lower confidence than transcript facts.
- **Refusals**: rounding a GPA, drafting a bank statement, submitting a form on the student's behalf, or laundering a stereotype through the data.
