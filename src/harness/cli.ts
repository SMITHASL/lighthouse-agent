/**
 * Operator commands for the local harness (what the TrueForge UI used to give you):
 *   npm run sessions            list sessions (newest first)
 *   npm run sessions -- <id>    print one session's events
 *   npm run approve -- <session> allow|deny ["reason"]   resume a paused approval gate
 *   npm run schedule:run        run every active schedule once, now
 *   npm run scheduler           keep running; fire schedules on their cron
 */
import { fileURLToPath } from 'node:url';
import { localHarness } from './index.js';
import { finalState } from './local.js';

function cronMatches(expr: string, timezone: string, now = new Date()): boolean {
  // Five-field cron, numbers / * / lists / step (*/n). Enough for "0 2 * * *"-style schedules.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short', hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const values = [Number(get('minute')), Number(get('hour')) % 24, Number(get('day')), Number(get('month')), dow];
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`unsupported cron expression: ${expr}`);
  return fields.every((f, i) =>
    f.split(',').some((part) => {
      const v = values[i]!;
      if (part === '*') return true;
      const step = part.match(/^\*\/(\d+)$/);
      if (step) return v % Number(step[1]) === 0;
      const range = part.match(/^(\d+)-(\d+)$/);
      if (range) return v >= Number(range[1]) && v <= Number(range[2]);
      return Number(part) === v;
    }),
  );
}

export async function runDueSchedules(force = false) {
  const h = localHarness();
  const ran: string[] = [];
  for (const s of h.listSchedules()) {
    if (s.manifest.status !== 'active') continue;
    const minuteKey = new Date().toISOString().slice(0, 16);
    if (!force && (!cronMatches(s.manifest.cron, s.manifest.timezone) || s.last_run_at?.slice(0, 16) === minuteKey)) continue;
    const out = await h.runScheduleNow(s.id);
    ran.push(`${s.name} → session ${out.data.session_id} (${out.data.status})`);
  }
  return ran;
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const h = localHarness();
  if (cmd === 'sessions') {
    if (rest[0]) {
      const s = h.readSession(rest[0]);
      console.log(`session ${s.id}  agent=${s.agent}  status=${s.status}  created=${s.created_at}`);
      for (const e of s.events) {
        const { type, at, ...body } = e as { type: string; at?: string; [k: string]: unknown };
        delete body.id; delete body.thread_id; delete body.session_id;
        console.log(`\n[${at}] ${type}\n${JSON.stringify(body, null, 2).slice(0, 1500)}`);
      }
      if (s.pending) console.log(`\nPENDING APPROVAL: ${s.pending.name} ${JSON.stringify(s.pending.arguments)}\n→ npm run approve -- ${s.id} allow|deny "reason"`);
      const st = finalState(s.events);
      if (st.output?.content) console.log(`\nFINAL OUTPUT:\n${st.output.content}`);
      return;
    }
    for (const s of h.listSessions()) console.log(`${s.id}  ${s.status.padEnd(7)}  ${s.agent.padEnd(30)}  ${s.created_at}`);
    return;
  }
  if (cmd === 'approve') {
    const [sessionId, decision, ...reasonParts] = rest;
    if (!sessionId || !['allow', 'deny'].includes(decision ?? '')) throw new Error('usage: approve <session> allow|deny ["reason"]');
    const s = h.readSession(sessionId);
    if (!s.pending) throw new Error(`session ${sessionId} has no pending approval`);
    const reason = reasonParts.join(' ') || undefined;
    const events = await h.runTurn(sessionId, [{ type: 'user.tool_approval', thread_id: 'main', tool_call_id: s.pending.tool_call_id, approval: decision === 'allow' ? { status: 'allow' } : { status: 'deny', reason: reason ?? 'denied by reviewer' } }]);
    const st = finalState(events);
    console.log(`${decision === 'allow' ? 'ALLOWED' : 'DENIED'} ${s.pending.name} in ${sessionId} → turn ${st.status}${st.output?.content ? `: ${st.output.content}` : ''}`);
    return;
  }
  if (cmd === 'schedule:run') {
    const ran = await runDueSchedules(true);
    console.log(ran.length ? ran.join('\n') : 'no active schedules');
    return;
  }
  if (cmd === 'scheduler') {
    console.log(`scheduler running; ${h.listSchedules().length} schedule(s). Ctrl+C to stop.`);
    for (;;) {
      try {
        const ran = await runDueSchedules();
        for (const line of ran) console.log(`${new Date().toISOString()} ${line}`);
      } catch (e) {
        console.error('scheduler error:', e instanceof Error ? e.message : e);
      }
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  throw new Error(`unknown command "${cmd}"`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
