import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ApplicantInput, GroundTruth } from '../schema/applicant.js';
import { LongTermFitReport } from '../schema/report.js';
import { rescore } from '../metrics/rescore.js';
import { loadDomainPack } from '../agents/domainPacks.js';

export const MCP_PORT = 8799;
export const MCP_URL = `http://localhost:${MCP_PORT}/mcp`;

type Store = {
  applicants: Map<string, ApplicantInput>;
  outcomes: Map<string, GroundTruth>;
  proposedActions: { id: string; applicant_id: string; action: string; rationale: string; at: string }[];
};

export function loadStore(dataDir = 'data'): Store {
  const applicants = new Map<string, ApplicantInput>();
  const path = `${dataDir}/applicants.json`;
  if (existsSync(path)) {
    for (const raw of JSON.parse(readFileSync(path, 'utf8')) as unknown[]) {
      const a = ApplicantInput.parse(raw);
      applicants.set(a.applicant_id, a);
    }
  }
  return { applicants, outcomes: new Map(), proposedActions: [] };
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });

export function buildMcpServer(store: Store, dataDir = 'data'): McpServer {
  const server = new McpServer({ name: 'lighthouse-tools', version: '0.1.0' });

  server.registerTool(
    'applicants_list',
    {
      description: 'List applicant ids and programs. Read-only.',
      inputSchema: { limit: z.number().int().min(1).max(500).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => text([...store.applicants.values()].slice(0, limit ?? 50).map((a) => ({ applicant_id: a.applicant_id, program: a.program }))),
  );

  server.registerTool(
    'applicants_get',
    {
      description: 'Fetch one applicant record (consented application data only). Read-only.',
      inputSchema: { applicant_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ applicant_id }) => {
      const a = store.applicants.get(applicant_id);
      return a ? text(a) : text({ error: 'not_found', applicant_id });
    },
  );

  server.registerTool(
    'applicants_timeline',
    {
      description: 'Institution interaction timeline for an applicant; empty when tracking consent is absent. Read-only.',
      inputSchema: { applicant_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ applicant_id }) => {
      const a = store.applicants.get(applicant_id);
      if (!a) return text({ error: 'not_found' });
      if (!a.consent.interaction_tracking) return text({ consent: false, events: [] });
      return text({ consent: true, events: a.institution_interaction });
    },
  );

  server.registerTool(
    'institution_reference_class_stats',
    {
      description: 'Base rates for each outcome in the active domain pack. Use before forming any estimate. Read-only.',
      inputSchema: { domain_pack: z.string().default('university-admissions') },
      annotations: { readOnlyHint: true },
    },
    async ({ domain_pack }) => {
      const pack = loadDomainPack(domain_pack);
      return text({ domain_pack: pack.name, horizon_years: pack.horizon_years, base_rates: pack.base_rates, cohort: pack.vocabulary.cohort });
    },
  );

  server.registerTool(
    'outcomes_record_ground_truth',
    {
      description: 'Record an observed outcome for an applicant so predictions can be re-scored. Write.',
      inputSchema: {
        applicant_id: z.string(),
        completed: z.boolean(),
        volunteered: z.boolean(),
        cheerled: z.boolean(),
        donated: z.boolean(),
        referrals_5y: z.number().int().min(0),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const gt = GroundTruth.parse(args);
      store.outcomes.set(gt.applicant_id, gt);
      return text({ recorded: true });
    },
  );

  server.registerTool(
    'calibration_rescore',
    {
      description: 'Re-score every stored Long-Term Fit Report against recorded outcomes and persist updated calibration metrics. Write (metrics only; never touches applicants).',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => {
      const reportsDir = `${dataDir}/reports`;
      const reports: LongTermFitReport[] = existsSync(reportsDir)
        ? readdirSync(reportsDir)
            .filter((f) => f.endsWith('.json'))
            .flatMap((f) => {
              const parsed = JSON.parse(readFileSync(`${reportsDir}/${f}`, 'utf8')) as { report?: unknown };
              const r = LongTermFitReport.safeParse(parsed.report);
              return r.success ? [r.data] : [];
            })
        : [];
      // Recorded outcomes win; the synthetic ground truth fills in until real outcomes arrive.
      const truth = new Map<string, GroundTruth>();
      const gtPath = `${dataDir}/ground_truth.json`;
      if (existsSync(gtPath)) for (const raw of JSON.parse(readFileSync(gtPath, 'utf8')) as unknown[]) {
        const t = GroundTruth.parse(raw);
        truth.set(t.applicant_id, t);
      }
      for (const [id, t] of store.outcomes) truth.set(id, t);
      const calibration = rescore(reports, [...truth.values()]);
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${dataDir}/calibration.json`, JSON.stringify(calibration, null, 2));
      return text({ reports_scored: reports.length, outcomes_available: truth.size, recorded_outcomes: store.outcomes.size, calibration });
    },
  );

  server.registerTool(
    'pipeline_propose_action',
    {
      description: 'Propose a person-affecting action (invite, interview, request info). Always requires human approval. Write.',
      inputSchema: {
        applicant_id: z.string(),
        action: z.enum(['invite_to_volunteer_event', 'schedule_interview', 'request_more_information', 'no_action']),
        rationale: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ applicant_id, action, rationale }) => {
      const entry = { id: randomUUID(), applicant_id, action, rationale, at: new Date().toISOString() };
      store.proposedActions.push(entry);
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${dataDir}/proposed_actions.json`, JSON.stringify(store.proposedActions, null, 2));
      return text({ proposed: true, id: entry.id });
    },
  );

  return server;
}

export async function startMcpServer(store: Store, port = MCP_PORT): Promise<() => Promise<void>> {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  // Stateless transport: one server instance per request keeps the demo simple and restart-safe.
  app.post('/mcp', async (req, res) => {
    const server = buildMcpServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'stateless server; use POST' });
  });
  const httpServer = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return () => new Promise((resolve) => httpServer.close(() => resolve()));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store = loadStore();
  await startMcpServer(store);
  console.log(`lighthouse MCP server on ${MCP_URL} (${store.applicants.size} applicants)`);
}
