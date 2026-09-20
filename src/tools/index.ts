/**
 * Lighthouse tools as plain in-process functions. The local harness calls them directly;
 * the optional MCP server (src/mcp/server.ts) exposes the same registry over HTTP for
 * TrueForge mode. `readOnly` is what "@write" approval gating keys on.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z, type Shape } from '../lib/schema.ts';
import { ApplicantInput, GroundTruth } from '../schema/applicant.ts';
import { LongTermFitReport } from '../schema/report.ts';
import { rescore } from '../metrics/rescore.ts';
import { loadDomainPack } from '../agents/domainPacks.ts';

export type Store = {
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
  const outcomes = new Map<string, GroundTruth>();
  const outcomesPath = `${dataDir}/outcomes.json`;
  if (existsSync(outcomesPath)) {
    for (const raw of JSON.parse(readFileSync(outcomesPath, 'utf8')) as unknown[]) {
      const t = GroundTruth.parse(raw);
      outcomes.set(t.applicant_id, t);
    }
  }
  return { applicants, outcomes, proposedActions: [] };
}

export type ToolDef = {
  name: string;
  description: string;
  /** Object shape (key → schema); z.object(inputSchema) is the validator, .toJsonSchema() the wire form. */
  inputSchema: Shape;
  readOnly: boolean;
  handler: (args: Record<string, unknown>, ctx: { store: Store; dataDir: string }) => Promise<unknown>;
};

export const TOOLS: ToolDef[] = [
  {
    name: 'applicants_list',
    description: 'List applicant ids and programs. Read-only.',
    inputSchema: { limit: z.number().int().min(1).max(500).optional() },
    readOnly: true,
    handler: async ({ limit }, { store }) =>
      [...store.applicants.values()].slice(0, (limit as number | undefined) ?? 50).map((a) => ({ applicant_id: a.applicant_id, program: a.program })),
  },
  {
    name: 'applicants_get',
    description: 'Fetch one applicant record (consented application data only). Read-only.',
    inputSchema: { applicant_id: z.string() },
    readOnly: true,
    handler: async ({ applicant_id }, { store }) => store.applicants.get(applicant_id as string) ?? { error: 'not_found', applicant_id },
  },
  {
    name: 'applicants_timeline',
    description: 'Institution interaction timeline for an applicant; empty when tracking consent is absent. Read-only.',
    inputSchema: { applicant_id: z.string() },
    readOnly: true,
    handler: async ({ applicant_id }, { store }) => {
      const a = store.applicants.get(applicant_id as string);
      if (!a) return { error: 'not_found' };
      if (!a.consent.interaction_tracking) return { consent: false, events: [] };
      return { consent: true, events: a.institution_interaction };
    },
  },
  {
    name: 'institution_reference_class_stats',
    description: 'Base rates for each outcome in the active domain pack. Use before forming any estimate. Read-only.',
    inputSchema: { domain_pack: z.string().default('university-admissions') },
    readOnly: true,
    handler: async ({ domain_pack }) => {
      const pack = loadDomainPack((domain_pack as string | undefined) ?? 'university-admissions');
      return { domain_pack: pack.name, horizon_years: pack.horizon_years, base_rates: pack.base_rates, cohort: pack.vocabulary.cohort };
    },
  },
  {
    name: 'outcomes_record_ground_truth',
    description: 'Record an observed outcome for an applicant so predictions can be re-scored. Write.',
    inputSchema: {
      applicant_id: z.string(),
      completed: z.boolean(),
      volunteered: z.boolean(),
      cheerled: z.boolean(),
      donated: z.boolean(),
      referrals_5y: z.number().int().min(0),
    },
    readOnly: false,
    handler: async (args, { store, dataDir }) => {
      const gt = GroundTruth.parse(args);
      store.outcomes.set(gt.applicant_id, gt);
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${dataDir}/outcomes.json`, JSON.stringify([...store.outcomes.values()], null, 2));
      return { recorded: true, total_recorded: store.outcomes.size };
    },
  },
  {
    name: 'calibration_rescore',
    description: 'Re-score every stored Long-Term Fit Report against recorded outcomes and persist updated calibration metrics. Write (metrics only; never touches applicants).',
    inputSchema: {},
    readOnly: false,
    handler: async (_args, { store, dataDir }) => {
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
      if (existsSync(gtPath))
        for (const raw of JSON.parse(readFileSync(gtPath, 'utf8')) as unknown[]) {
          const t = GroundTruth.parse(raw);
          truth.set(t.applicant_id, t);
        }
      for (const [id, t] of store.outcomes) truth.set(id, t);
      const calibration = rescore(reports, [...truth.values()]);
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${dataDir}/calibration.json`, JSON.stringify(calibration, null, 2));
      return { reports_scored: reports.length, outcomes_available: truth.size, recorded_outcomes: store.outcomes.size, calibration };
    },
  },
  {
    name: 'pipeline_propose_action',
    description: 'Propose a person-affecting action (invite, interview, request info). Always requires human approval. Write.',
    inputSchema: {
      applicant_id: z.string(),
      action: z.enum(['invite_to_volunteer_event', 'schedule_interview', 'request_more_information', 'no_action']),
      rationale: z.string().min(1),
    },
    readOnly: false,
    handler: async ({ applicant_id, action, rationale }, { store, dataDir }) => {
      const entry = { id: randomUUID(), applicant_id: applicant_id as string, action: action as string, rationale: rationale as string, at: new Date().toISOString() };
      store.proposedActions.push(entry);
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${dataDir}/proposed_actions.json`, JSON.stringify(store.proposedActions, null, 2));
      return { proposed: true, id: entry.id };
    },
  },
];

export const toolByName = (name: string): ToolDef | undefined => TOOLS.find((t) => t.name === name);

/** Validate args against the tool's schema and run it. */
export async function callTool(name: string, rawArgs: unknown, ctx: { store: Store; dataDir: string }): Promise<unknown> {
  const tool = toolByName(name);
  if (!tool) return { error: 'unknown_tool', name };
  const parsed = z.object(tool.inputSchema).safeParse(rawArgs ?? {});
  if (!parsed.success) return { error: 'invalid_arguments', issues: parsed.error.issues };
  return tool.handler(parsed.data as Record<string, unknown>, ctx);
}
