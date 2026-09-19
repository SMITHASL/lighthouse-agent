/** Minimal TrueForge HTTP client over the documented snake_case wire format. */

export const TRUEFORGE_URL = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';

export type TurnEvent = {
  type: string;
  id: string;
  thread_id: string | null;
  [k: string]: unknown;
};

export class TrueForgeClient {
  constructor(private readonly baseUrl = TRUEFORGE_URL) {}

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  upsertMcpServer(manifest: { type: 'remote'; name: string; url: string; description: string }) {
    return this.json<{ data: unknown }>('PUT', '/api/v1/settings/mcp-servers', { manifest });
  }

  async listAgents(): Promise<{ id: string; name: string }[]> {
    const out = await this.json<{ data: { id: string; name: string }[] }>('GET', '/api/v1/agents');
    return out.data;
  }

  async upsertAgent(name: string, description: string, manifest: unknown): Promise<string> {
    const existing = (await this.listAgents()).find((a) => a.name === name);
    if (existing) {
      await this.json('PUT', `/api/v1/agents/${existing.id}`, { description, manifest });
      return existing.id;
    }
    const created = await this.json<{ data: { id: string } }>('POST', '/api/v1/agents', { name, description, manifest });
    return created.data.id;
  }

  async upsertSchedule(name: string, agentName: string, manifest: { task: string; cron: string; timezone: string; status: 'active' | 'paused' }): Promise<string> {
    const list = await this.json<{ data: { id: string; name: string }[] }>('GET', '/api/v1/schedules');
    const existing = list.data.find((s) => s.name === name);
    if (existing) {
      await this.json('PUT', `/api/v1/schedules/${existing.id}`, { name, manifest });
      return existing.id;
    }
    const created = await this.json<{ data: { id: string } }>('POST', '/api/v1/schedules', { name, agent_name: agentName, manifest });
    return created.data.id;
  }

  runScheduleNow(scheduleId: string) {
    return this.json<{ data: unknown }>('POST', '/api/v1/schedules/runs', { schedule_id: scheduleId });
  }

  async createSession(agentName: string): Promise<string> {
    const out = await this.json<{ data: { id: string } }>('POST', '/api/v1/sessions', { agent: { name: agentName } });
    return out.data.id;
  }

  /** Streams one turn; resolves with every event once `turn.done` arrives. */
  async runTurn(sessionId: string, input: unknown[], onEvent?: (e: TurnEvent) => void): Promise<TurnEvent[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ input }),
    });
    if (!res.ok || !res.body) throw new Error(`turn → ${res.status}: ${await res.text()}`);
    const events: TurnEvent[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data) continue;
        const event = JSON.parse(data) as TurnEvent;
        events.push(event);
        onEvent?.(event);
      }
    }
    return events;
  }
}

/** Merges `model.message.delta` events into their base `model.message` so tool calls can be read. */
export function indexEvents(events: TurnEvent[]): Map<string, TurnEvent> {
  const index = new Map<string, TurnEvent>();
  for (const e of events) {
    if (e.type.endsWith('.delta')) {
      const base = index.get(e.id);
      if (base) mergeDelta(base, e);
      continue;
    }
    index.set(e.id, e);
  }
  return index;
}

function mergeDelta(base: TurnEvent, delta: TurnEvent): void {
  for (const [k, v] of Object.entries(delta)) {
    if (k === 'type' || k === 'id') continue;
    const cur = base[k];
    if (typeof v === 'string' && typeof cur === 'string') base[k] = cur + v;
    else if (Array.isArray(v) && Array.isArray(cur)) base[k] = mergeArrays(cur, v);
    else if (v !== undefined && v !== null) base[k] = v;
  }
}

function mergeArrays(cur: unknown[], add: unknown[]): unknown[] {
  // Tool-call deltas carry partial `function.arguments`; merge by index.
  const out = [...cur];
  add.forEach((item, i) => {
    const prev = out[i];
    if (prev && typeof prev === 'object' && item && typeof item === 'object') {
      mergeDelta(prev as TurnEvent, item as TurnEvent);
    } else if (i >= out.length) {
      out.push(item);
    }
  });
  return out;
}

export function finalOutput(events: TurnEvent[]): { status: string; content: string | null } {
  const done = events.find((e) => e.type === 'turn.done');
  const state = (done?.state ?? {}) as { status?: string; output?: { content?: string } };
  return { status: state.status ?? 'unknown', content: state.output?.content ?? null };
}
