import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '../harness.ts';
import { LocalHarness } from '../../src/harness/local.ts';
import { toAnthropicMessages, vendorOf, type InputItem } from '../../src/harness/provider.ts';
import { AGENT_NAMES, fairnessManifest, actionManifest } from '../../src/agents/manifests.ts';
import { generateDataset } from '../../src/data/generate.ts';
import { loadStore } from '../../src/tools/index.ts';
import { finalOutput } from '../../src/pipeline/client.ts';

/** The runtime against a scripted fake Anthropic Messages endpoint: the auditor on a second vendor. */
type Req = { model: string; system: string; messages: { role: string; content: { type: string; text?: string; tool_use_id?: string; content?: string; name?: string }[] }[]; tools?: { name: string; input_schema: unknown }[]; output_config?: Record<string, unknown> };
const seen: Req[] = [];
const headers: Record<string, string | undefined>[] = [];
let script: ((req: Req) => unknown)[] = [];
let server: Server;
let dataDir: string;

const reply = (blocks: unknown[], stop_reason = 'end_turn') => ({ id: 'msg_1', model: 'claude-opus-5', stop_reason, content: blocks, usage: { input_tokens: 50, output_tokens: 10 } });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push(JSON.parse(body) as Req);
    headers.push({ key: req.headers['x-api-key'] as string, version: req.headers['anthropic-version'] as string, beta: req.headers['anthropic-beta'] as string });
    const next = script.shift();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(next ? next(seen.at(-1)!) : reply([{ type: 'text', text: 'unscripted' }])));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}/v1`;
  dataDir = mkdtempSync(join(tmpdir(), 'lighthouse-anthropic-'));
});
afterAll(() => { server.close(); rmSync(dataDir, { recursive: true, force: true }); });

const onAnthropic = <M extends { model: { name: string } }>(m: M): M => ({ ...m, model: { ...m.model, name: 'anthropic/claude-opus-5' } });

describe('second vendor: Anthropic Messages API (independent_auditor_on_a_different_vendor)', () => {
  it('routes by model prefix', () => {
    expect(vendorOf('anthropic/claude-opus-5')).toBe('anthropic');
    expect(vendorOf('openai/gpt-5-5')).toBe('openai');
  });

  it('maps the transcript to Messages turns, merging consecutive same-role items and dropping system', () => {
    const history: InputItem[] = [
      { role: 'system', content: 'ignored here' },
      { role: 'user', content: 'go' },
      { type: 'function_call', call_id: 'c1', name: 'applicants_get', arguments: '{"applicant_id":"app_0001"}' },
      { type: 'function_call', call_id: 'c2', name: 'applicants_timeline', arguments: '{"applicant_id":"app_0001"}' },
      { type: 'function_call_output', call_id: 'c1', output: '{"a":1}' },
      { type: 'function_call_output', call_id: 'c2', output: '{"b":2}' },
      { role: 'assistant', content: 'done' },
    ];
    const msgs = toAnthropicMessages(history);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(msgs[1]!.content.map((b) => b.type)).toEqual(['tool_use', 'tool_use']);
    expect(msgs[2]!.content.map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect((msgs[1]!.content[0] as { input: unknown }).input).toEqual({ applicant_id: 'app_0001' });
  });

  it('the auditor runs on Anthropic: system prompt, json schema, headers, usage', async () => {
    const store = loadStore('/nonexistent');
    const h = new LocalHarness(dataDir, store);
    await h.upsertAgent(AGENT_NAMES.fairness, 'auditor', onAnthropic(fairnessManifest));
    const session = await h.createSession(AGENT_NAMES.fairness);
    script = [() => reply([{ type: 'text', text: '{"verdict":"pass"}' }])];
    const events = await h.runTurn(session, [{ type: 'user.message', content: 'Audit this' }]);
    expect(finalOutput(events)).toEqual({ status: 'done', content: '{"verdict":"pass"}' });
    const req = seen.at(-1)!;
    expect(req.model).toBe('claude-opus-5');
    expect(req.system).toContain('fairness auditor');
    expect(req.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Audit this' }] }]);
    expect((req.output_config!.format as { type: string }).type).toBe('json_schema');
    expect(req.output_config!.effort).toBe('low');
    expect(headers.at(-1)).toMatchObject({ key: 'test-anthropic', version: '2023-06-01', beta: 'server-side-fallback-2026-07-01' });
    expect(events.find((e) => e.type === 'model.message')!.usage).toEqual({ input_tokens: 50, output_tokens: 10 });
  });

  it('tool loop and approval gate work identically on the stateless vendor (full transcript resent)', async () => {
    const store = loadStore('/nonexistent');
    for (const a of generateDataset(2, 3).inputs) store.applicants.set(a.applicant_id, a);
    const h = new LocalHarness(dataDir, store);
    await h.upsertAgent(AGENT_NAMES.action, 'action', onAnthropic(actionManifest));
    const session = await h.createSession(AGENT_NAMES.action);
    script = [() => reply([{ type: 'tool_use', id: 'toolu_1', name: 'pipeline_propose_action', input: { applicant_id: 'app_0001', action: 'schedule_interview', rationale: 'fit' } }], 'tool_use')];
    const paused = await h.runTurn(session, [{ type: 'user.message', content: 'propose' }]);
    expect(finalOutput(paused).status).toBe('paused');
    expect(store.proposedActions.length).toBe(0);
    expect(seen.at(-1)!.tools!.map((t) => t.name)).toEqual(['pipeline_propose_action']);

    script = [(req) => {
      // Stateless vendor: the resumed call carries the whole transcript (user, tool_use, tool_result).
      expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(req.messages[2]!.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
      expect(req.messages[2]!.content[0]!.content).toContain('"proposed":true');
      return reply([{ type: 'text', text: 'proposed' }]);
    }];
    const resumed = await h.runTurn(session, [{ type: 'user.tool_approval', thread_id: 'main', tool_call_id: 'toolu_1', approval: { status: 'allow' } }]);
    expect(finalOutput(resumed)).toEqual({ status: 'done', content: 'proposed' });
    expect(store.proposedActions).toHaveLength(1);
  });

  it('a refusal stop_reason surfaces as a model error, not a silent empty answer', async () => {
    const h = new LocalHarness(dataDir, loadStore('/nonexistent'));
    await h.upsertAgent(AGENT_NAMES.fairness, 'auditor', onAnthropic(fairnessManifest));
    const session = await h.createSession(AGENT_NAMES.fairness);
    script = [() => ({ ...reply([], 'refusal'), stop_details: { category: 'test', explanation: 'declined' } })];
    const events = await h.runTurn(session, [{ type: 'user.message', content: 'x' }]);
    expect(finalOutput(events).status).toBe('error');
    expect(String(events.find((e) => e.type === 'model.error')!.error)).toContain('refused');
  });
});
