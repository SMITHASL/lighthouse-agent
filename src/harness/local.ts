/**
 * LocalHarness — a standalone runtime with the same surface as TrueForgeClient.
 *
 * What TrueForge provided and what this reproduces, in-process, with no external server:
 *   - agents: an in-memory registry of manifests (upsertAgent)
 *   - sessions: each run persisted to data/sessions/<id>.json with every event (observability)
 *   - turns: the model ↔ tool loop, calling the model provider over fetch and tools directly
 *   - approval gate: a call to a tool matched by `require_approval_for_tools` (`@write` = any
 *     non-read-only tool) pauses the turn with `tool.approval_required`; a `user.tool_approval`
 *     input resumes it. Nothing is written until a human decides.
 *   - schedules: stored in data/schedules.json; `runScheduleNow` executes one; src/harness/scheduler.ts ticks cron.
 *
 * Event shapes match what src/pipeline/run.ts already reads (model.message usage, turn.done state,
 * tool.approval_required tool_calls), so the pipeline is unchanged between the two runtimes.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { TOOLS, callTool, loadStore, toolByName, type Store } from '../tools/index.js';
import type { TurnEvent } from '../pipeline/client.js';
import { chatCompletion, type ChatMessage, type ChatTool } from './provider.js';

export type AgentManifest = {
  model: { name: string; params?: { reasoning_effort?: string } };
  instructions: string;
  mcp_servers?: { name: string; enable_tools: string[]; require_approval_for_tools: string[]; preload?: boolean }[];
  response_format?: { type: 'json_schema'; json_schema: { name: string; schema: unknown; strict?: boolean } };
  config?: { iteration_limit?: number };
};

type PendingApproval = { tool_call_id: string; name: string; arguments: Record<string, unknown> };
type SessionFile = {
  id: string;
  agent: string;
  created_at: string;
  status: 'idle' | 'running' | 'paused' | 'done' | 'error';
  messages: ChatMessage[];
  events: TurnEvent[];
  pending?: PendingApproval;
};
type ScheduleFile = { id: string; name: string; agent_name: string; manifest: { task: string; cron: string; timezone: string; status: 'active' | 'paused' }; last_run_at?: string };

export class LocalHarness {
  private agents = new Map<string, { id: string; name: string; description: string; manifest: AgentManifest }>();
  private store: Store;
  constructor(readonly dataDir = process.env.LIGHTHOUSE_DATA_DIR ?? 'data', store?: Store) {
    this.store = store ?? loadStore(this.dataDir);
    mkdirSync(`${this.dataDir}/sessions`, { recursive: true });
    this.loadAgents();
  }

  // ---- agent registry (persisted so `npm run setup` survives restarts) ----
  private agentsPath() { return `${this.dataDir}/agents.json`; }
  private loadAgents() {
    if (!existsSync(this.agentsPath())) return;
    for (const a of JSON.parse(readFileSync(this.agentsPath(), 'utf8')) as { id: string; name: string; description: string; manifest: AgentManifest }[]) this.agents.set(a.name, a);
  }
  private saveAgents() { writeFileSync(this.agentsPath(), JSON.stringify([...this.agents.values()], null, 2)); }

  async upsertMcpServer(_manifest: { type: 'remote'; name: string; url: string; description: string }) {
    return { data: { note: 'local harness calls tools in-process; no MCP server needed' } };
  }
  async listAgents() { return [...this.agents.values()].map(({ id, name }) => ({ id, name })); }
  async upsertAgent(name: string, description: string, manifest: unknown): Promise<string> {
    const existing = this.agents.get(name);
    const id = existing?.id ?? randomUUID();
    this.agents.set(name, { id, name, description, manifest: manifest as AgentManifest });
    this.saveAgents();
    return id;
  }

  // ---- schedules ----
  private schedulesPath() { return `${this.dataDir}/schedules.json`; }
  listSchedules(): ScheduleFile[] { return existsSync(this.schedulesPath()) ? (JSON.parse(readFileSync(this.schedulesPath(), 'utf8')) as ScheduleFile[]) : []; }
  private saveSchedules(list: ScheduleFile[]) { writeFileSync(this.schedulesPath(), JSON.stringify(list, null, 2)); }
  async upsertSchedule(name: string, agentName: string, manifest: ScheduleFile['manifest']): Promise<string> {
    const list = this.listSchedules();
    const existing = list.find((s) => s.name === name);
    if (existing) { existing.manifest = manifest; existing.agent_name = agentName; this.saveSchedules(list); return existing.id; }
    const created: ScheduleFile = { id: randomUUID(), name, agent_name: agentName, manifest };
    list.push(created); this.saveSchedules(list); return created.id;
  }
  async runScheduleNow(scheduleId: string) {
    const list = this.listSchedules();
    const s = list.find((x) => x.id === scheduleId);
    if (!s) throw new Error(`unknown schedule ${scheduleId}`);
    const session = await this.createSession(s.agent_name);
    const events = await this.runTurn(session, [{ type: 'user.message', content: s.manifest.task }]);
    s.last_run_at = new Date().toISOString(); this.saveSchedules(list);
    return { data: { schedule_id: s.id, session_id: session, status: finalState(events).status } };
  }

  // ---- sessions ----
  private sessionPath(id: string) { return `${this.dataDir}/sessions/${id}.json`; }
  readSession(id: string): SessionFile {
    const p = this.sessionPath(id);
    if (!existsSync(p)) throw new Error(`unknown session ${id}`);
    return JSON.parse(readFileSync(p, 'utf8')) as SessionFile;
  }
  listSessions(): { id: string; agent: string; created_at: string; status: string }[] {
    return readdirSync(`${this.dataDir}/sessions`).filter((f) => f.endsWith('.json')).map((f) => {
      const s = JSON.parse(readFileSync(`${this.dataDir}/sessions/${f}`, 'utf8')) as SessionFile;
      return { id: s.id, agent: s.agent, created_at: s.created_at, status: s.status };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  private save(s: SessionFile) { writeFileSync(this.sessionPath(s.id), JSON.stringify(s, null, 2)); }

  async createSession(agentName: string): Promise<string> {
    const agent = this.agents.get(agentName);
    if (!agent) throw new Error(`agent "${agentName}" is not registered — run \`npm run setup\``);
    const id = `ls_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    this.save({ id, agent: agentName, created_at: new Date().toISOString(), status: 'idle', messages: [{ role: 'system', content: agent.manifest.instructions }], events: [] });
    return id;
  }

  /** One turn: consume the inputs, loop model ↔ tools until a final answer or an approval pause. */
  async runTurn(sessionId: string, input: unknown[], onEvent?: (e: TurnEvent) => void): Promise<TurnEvent[]> {
    const s = this.readSession(sessionId);
    const agent = this.agents.get(s.agent)!;
    const m = agent.manifest;
    const turnEvents: TurnEvent[] = [];
    const emit = (type: string, extra: Record<string, unknown> = {}) => {
      const e: TurnEvent = { type, id: randomUUID(), thread_id: 'main', session_id: sessionId, at: new Date().toISOString(), ...extra };
      s.events.push(e); turnEvents.push(e); onEvent?.(e); return e;
    };
    const done = (status: string, content: string | null) => {
      s.status = status === 'done' ? 'done' : status === 'paused' ? 'paused' : 'error';
      emit('turn.done', { state: { status, output: { content } } });
      this.save(s);
      return turnEvents;
    };

    // Which tools this agent may call, and which of those need a human first.
    const enabled = new Set(m.mcp_servers?.flatMap((x) => x.enable_tools) ?? []);
    const gated = new Set(m.mcp_servers?.flatMap((x) => x.require_approval_for_tools) ?? []);
    const needsApproval = (name: string) => gated.has(name) || (gated.has('@write') && !(toolByName(name)?.readOnly ?? true));
    const tools: ChatTool[] = TOOLS.filter((t) => enabled.has(t.name)).map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: zodToJsonSchema(z.object(t.inputSchema), { $refStrategy: 'none' }) },
    }));

    s.status = 'running';
    emit('turn.started', { input });
    for (const raw of input) {
      const inp = raw as { type: string; content?: string; tool_call_id?: string; approval?: { status: 'allow' | 'deny'; reason?: string } };
      if (inp.type === 'user.message') s.messages.push({ role: 'user', content: inp.content ?? '' });
      else if (inp.type === 'user.tool_approval') {
        const p = s.pending;
        if (!p || p.tool_call_id !== inp.tool_call_id) return done('error', `no pending approval for tool_call ${inp.tool_call_id}`);
        s.pending = undefined;
        if (inp.approval?.status === 'allow') {
          const result = await callTool(p.name, p.arguments, { store: this.store, dataDir: this.dataDir });
          emit('tool.approved', { tool_call_id: p.tool_call_id, name: p.name });
          emit('tool.result', { tool_call_id: p.tool_call_id, name: p.name, result });
          s.messages.push({ role: 'tool', tool_call_id: p.tool_call_id, content: JSON.stringify(result) });
        } else {
          const reason = inp.approval?.reason ?? 'denied by reviewer';
          emit('tool.denied', { tool_call_id: p.tool_call_id, name: p.name, reason });
          s.messages.push({ role: 'tool', tool_call_id: p.tool_call_id, content: JSON.stringify({ error: 'denied_by_human', reason }) });
        }
      }
    }

    const limit = m.config?.iteration_limit ?? 10;
    for (let i = 0; i < limit; i++) {
      let reply;
      try {
        reply = await chatCompletion({ model: m.model.name, messages: s.messages, tools, response_format: m.response_format, reasoning_effort: m.model.params?.reasoning_effort });
      } catch (err) {
        emit('model.error', { error: err instanceof Error ? err.message : String(err) });
        return done('error', null);
      }
      emit('model.message', { role: 'assistant', content: reply.content, tool_calls: reply.tool_calls, usage: reply.usage, model: reply.model });
      s.messages.push({ role: 'assistant', content: reply.content ?? '', tool_calls: reply.tool_calls?.length ? reply.tool_calls : undefined });
      if (!reply.tool_calls?.length) return done('done', reply.content);

      for (const tc of reply.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>; } catch { /* leave empty; validation reports it */ }
        if (needsApproval(tc.function.name)) {
          // The gate: persist the pending call and stop. Nothing runs until a human resumes the session.
          s.pending = { tool_call_id: tc.id, name: tc.function.name, arguments: args };
          emit('tool.approval_required', { tool_calls: [{ id: tc.id, name: tc.function.name, arguments: args }] });
          return done('paused', null);
        }
        const result = await callTool(tc.function.name, args, { store: this.store, dataDir: this.dataDir });
        emit('tool.result', { tool_call_id: tc.id, name: tc.function.name, result });
        s.messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    emit('model.error', { error: `iteration limit ${limit} reached` });
    return done('error', null);
  }
}

export function finalState(events: TurnEvent[]) {
  const d = events.find((e) => e.type === 'turn.done');
  return ((d?.state ?? {}) as { status?: string; output?: { content?: string } });
}
