import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '../harness.ts';
import { LocalHarness } from '../../src/harness/local.ts';
import { actionManifest, analystManifest, rescorerManifest, AGENT_NAMES } from '../../src/agents/manifests.ts';
import { generateDataset } from '../../src/data/generate.ts';
import { loadStore } from '../../src/tools/index.ts';
import { finalOutput } from '../../src/pipeline/client.ts';

/**
 * Drives the local runtime against a scripted fake OpenAI endpoint, so the loop, the tool
 * calls and the approval gate are tested without a model or a network.
 */
type Item = { role?: string; content?: string; type?: string; call_id?: string; output?: string };
type Req = { instructions: string; input: Item[]; previous_response_id?: string; tools?: { name: string }[]; text?: unknown };
const seen: Req[] = [];
let script: ((req: Req) => unknown)[] = [];
let server: Server;
let dataDir: string;

let n = 0;
const reply = (content: string | null, tool_calls: { id: string; name: string; args: unknown }[] = []) => ({
  id: `resp_${++n}`,
  model: 'fake',
  output: [
    ...tool_calls.map((t) => ({ type: 'function_call', id: `fc_${t.id}`, call_id: t.id, name: t.name, arguments: JSON.stringify(t.args) })),
    ...(content === null ? [] : [{ type: 'message', content: [{ type: 'output_text', text: content }] }]),
  ],
  usage: { input_tokens: 100, output_tokens: 20 },
});

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const parsed = JSON.parse(body) as Req;
    seen.push(parsed);
    const next = script.shift();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(next ? next(parsed) : reply('unscripted')));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  process.env.OPENAI_API_KEY = 'test';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  dataDir = mkdtempSync(join(tmpdir(), 'lighthouse-local-'));
});
afterAll(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function harness() {
  const store = loadStore('/nonexistent');
  for (const a of generateDataset(3, 7).inputs) store.applicants.set(a.applicant_id, a);
  return { h: new LocalHarness(dataDir, store), store };
}

describe('LocalHarness', () => {
  it('runs the model ↔ tool loop, exposes tools from the manifest, persists the session', async () => {
    const { h } = harness();
    await h.upsertAgent(AGENT_NAMES.analyst, 'analyst', analystManifest());
    const session = await h.createSession(AGENT_NAMES.analyst);
    script = [
      () => reply(null, [{ id: 'c1', name: 'applicants_get', args: { applicant_id: 'app_0001' } }]),
      (req) => {
        // Only the tool output is sent, chained on the previous response id.
        const toolMsg = req.input.find((m) => m.type === 'function_call_output');
        expect(toolMsg?.call_id).toBe('c1');
        expect(toolMsg?.output).toContain('"applicant_id":"app_0001"');
        expect(req.previous_response_id).toBe('resp_1');
        expect(req.input.some((m) => m.role === 'user')).toBe(false);
        return reply('{"done":true}');
      },
    ];
    const events = await h.runTurn(session, [{ type: 'user.message', content: 'go' }]);
    expect(finalOutput(events)).toEqual({ status: 'done', content: '{"done":true}' });
    // Only the analyst's enabled tools are offered; write tools are not.
    const offered = seen.at(-1)!.tools!.map((t) => t.name).sort();
    expect(offered).toEqual(['applicants_get', 'applicants_timeline', 'institution_reference_class_stats']);
    expect(seen.at(-1)!.text).toBeTruthy();
    expect(seen[0]!.instructions).toContain('critical analyst');
    // Usage flows through model.message events (the pipeline's cost accounting reads these).
    expect(events.filter((e) => e.type === 'model.message').length).toBe(2);
    expect(existsSync(join(dataDir, 'sessions', `${session}.json`))).toBe(true);
    expect(h.readSession(session).status).toBe('done');
  });

  it('pauses on an @write tool call and writes nothing until a human allows', async () => {
    const { h, store } = harness();
    await h.upsertAgent(AGENT_NAMES.action, 'action', actionManifest);
    const session = await h.createSession(AGENT_NAMES.action);
    script = [() => reply(null, [{ id: 'c9', name: 'pipeline_propose_action', args: { applicant_id: 'app_0001', action: 'schedule_interview', rationale: 'strong fit' } }])];
    const events = await h.runTurn(session, [{ type: 'user.message', content: 'propose' }]);
    expect(finalOutput(events).status).toBe('paused');
    const pause = events.find((e) => e.type === 'tool.approval_required')!;
    expect((pause.tool_calls as { id: string; name: string }[])[0]).toMatchObject({ id: 'c9', name: 'pipeline_propose_action' });
    expect(store.proposedActions.length).toBe(0);
    expect(existsSync(join(dataDir, 'proposed_actions.json'))).toBe(false);
    expect(h.readSession(session).pending?.tool_call_id).toBe('c9');

    // Deny: the tool never runs; the model is told and the turn completes.
    script = [(req) => {
      expect(req.input.at(-1)?.output).toContain('denied_by_human');
      return reply('acknowledged denial');
    }];
    const denied = await h.runTurn(session, [{ type: 'user.tool_approval', thread_id: 'main', tool_call_id: 'c9', approval: { status: 'deny', reason: 'not this cycle' } }]);
    expect(finalOutput(denied)).toEqual({ status: 'done', content: 'acknowledged denial' });
    expect(denied.some((e) => e.type === 'tool.denied')).toBe(true);
    expect(store.proposedActions.length).toBe(0);
  });

  it('allow runs the gated tool and persists the write', async () => {
    const { h, store } = harness();
    await h.upsertAgent(AGENT_NAMES.action, 'action', actionManifest);
    const session = await h.createSession(AGENT_NAMES.action);
    script = [() => reply(null, [{ id: 'c2', name: 'pipeline_propose_action', args: { applicant_id: 'app_0002', action: 'invite_to_volunteer_event', rationale: 'reciprocity signals' } }])];
    await h.runTurn(session, [{ type: 'user.message', content: 'propose' }]);
    script = [() => reply('proposed')];
    const resumed = await h.runTurn(session, [{ type: 'user.tool_approval', thread_id: 'main', tool_call_id: 'c2', approval: { status: 'allow' } }]);
    expect(finalOutput(resumed).status).toBe('done');
    expect(store.proposedActions).toHaveLength(1);
    expect(store.proposedActions[0]).toMatchObject({ applicant_id: 'app_0002', action: 'invite_to_volunteer_event' });
    const onDisk = JSON.parse(readFileSync(join(dataDir, 'proposed_actions.json'), 'utf8')) as unknown[];
    expect(onDisk).toHaveLength(1);
  });

  it('rejects a second approval for a call that is no longer pending', async () => {
    const { h } = harness();
    await h.upsertAgent(AGENT_NAMES.action, 'action', actionManifest);
    const session = await h.createSession(AGENT_NAMES.action);
    const events = await h.runTurn(session, [{ type: 'user.tool_approval', thread_id: 'main', tool_call_id: 'nope', approval: { status: 'allow' } }]);
    expect(finalOutput(events).status).toBe('error');
  });

  it('schedules: upsert is idempotent and runScheduleNow executes the agent', async () => {
    const { h } = harness();
    await h.upsertAgent(AGENT_NAMES.rescorer, 'rescorer', rescorerManifest);
    const id1 = await h.upsertSchedule('nightly', AGENT_NAMES.rescorer, { task: 'rescore', cron: '0 2 * * *', timezone: 'America/Los_Angeles', status: 'active' });
    const id2 = await h.upsertSchedule('nightly', AGENT_NAMES.rescorer, { task: 'rescore', cron: '0 3 * * *', timezone: 'America/Los_Angeles', status: 'active' });
    expect(id1).toBe(id2);
    expect(h.listSchedules()[0]?.manifest.cron).toBe('0 3 * * *');
    script = [
      () => reply(null, [{ id: 'r1', name: 'calibration_rescore', args: {} }]),
      (req) => {
        expect(req.input.at(-1)?.output).toContain('reports_scored');
        return reply('scored 0 reports');
      },
    ];
    const out = await h.runScheduleNow(id1);
    expect(out.data.status).toBe('done');
    expect(h.listSchedules()[0]?.last_run_at).toBeTruthy();
  });
});
