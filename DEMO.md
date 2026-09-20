# Demo guide

Everything runs from one folder with Node 24 and an OpenAI key in `.env`. No other server.

```bash
npm install            # typescript + @types/node only (for typecheck); skip if you never typecheck
cp .env.example .env   # put OPENAI_API_KEY in .env
npm run setup          # registers the four agents + the nightly schedule
```

## 3-minute live demo

**0:00 — The problem (20 s).** "Universities recruit on grades and essays, then hope for alumni who give back. Lighthouse predicts *long-term fit* — completion, volunteering, cheerleading, donating, recruiting — with critical-analytical reasoning, not a black-box score. And 'donor' means who will *become* generous, never who is already rich."

**0:20 — Observe it (60 s).**
```bash
npm run ui             # http://localhost:3100
```
Pick an unscored applicant, click **Run pipeline**. The progress pane streams the runtime's events: the analyst fetches the record, the timeline and the **base rates before estimating**; the auditor reads the report cold; the action proposer hits the gate. Then the report renders: five estimates with intervals, the auditor's verdict, the critical analysis (two hypotheses, the strongest case *against*, the cheapest falsifying experiment, the analogy and where it breaks), every claim with the fields it cites.

**1:20 — Control it (50 s).** The gold box: **Paused for human approval**. Nothing has been written. Click **Deny** with a reason — the decision, reason and timestamp land on the report; `data/proposed_actions.json` never appears. Then the chat: as **Coordinator**, ask "Are they going to donate — they sound well-off?" (answers from person signals, refuses to infer generosity from wealth). Switch to **Student**, ask "What score did your system give me?" (never sees an estimate, a verdict, or that a report exists).

Mention: per-report cap $0.15, per-eval cap $10; the input schema physically rejects 20 protected attributes; the auditor is a different model and can be a different vendor (`LIGHTHOUSE_AUDITOR_MODEL=anthropic/claude-opus-5`).

**2:10 — Test it (40 s).**
```bash
npm test               # 71 offline tests, 17 Gherkin scenarios traced, ~2 s
```
Then `evals/SCOREBOARD.md`: 0 hallucinated fields across 926 claims; an independent judge finds 3.5% of claims unsupported (gate ≤ 5%, pass — it was 10.5% before multi-field citations); run-to-run std 0.012; $0.056 per report. Two gates **fail** at n=30 (parity, CI coverage) and say so.

**2:50 — Scale (10 s).** `src/agents/domainPacks.ts`: the report schema is built from the pack — `startup-recruiting` yields hire / retain 2y / refer / advocate with no code change. Same runtime, same gate, same evals, same UI.

## Without the UI (terminal only)

```bash
npm run report -- app_0001                       # pauses at the gate, prints the approve command
npm run sessions                                 # every run is a session; `-- <id>` prints its events
npm run approve -- <session> deny "not this cycle"
npm run schedule:run                             # fire the nightly rescore now
```

## Backup if Wi-Fi dies

`data/reports/*.json` are 31 saved full results; `evals/results/*.json` has full eval and claim-judge output; sessions are in `data/sessions/`. The UI renders stored reports without any model call — only **Run** and the chat need the network.

## Captioned, no-audio recording

```bash
npm run ui                 # keep running on :3100
npm run demo:ui            # captioned player on http://localhost:8798 (Space = play, ←/→ = step)
npm run demo:ui:record     # drives Chrome, tab-captures, writes demo/reviewer-ui/lighthouse-reviewer-ui-demo.mp4
```

The player drives the live UI over `postMessage` — it selects the first *unscored* applicant and runs the pipeline for real on camera (~45 s, ~$0.05), denies at the gate, and asks both chat audiences. Steps and captions are the `steps` array at the top of `demo/reviewer-ui/index.html`. Remux the result for exact duration headers: `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`. Prefer MP4 over WebM: Windows' Movies & TV app crashes on VP9 WebM.

The original hackathon-day recording of the TrueForge-hosted build (`demo/`, `npm run demo`) is kept as a historical artifact; its session ids no longer resolve.
