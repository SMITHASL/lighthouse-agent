import { fileURLToPath } from 'node:url';
import { HARNESS_MODE, createHarness, type Harness } from '../harness/index.js';
import { MCP_URL } from '../mcp/server.js';
import { AGENT_NAMES, MCP_SERVER_NAME, SCHEDULE_NAME, actionManifest, analystManifest, fairnessManifest, rescorerManifest } from './manifests.js';

export async function registerAll(client: Harness = createHarness(), domainPack = 'university-admissions'): Promise<void> {
  await client.upsertMcpServer({
    type: 'remote',
    name: MCP_SERVER_NAME,
    url: MCP_URL,
    description: 'Lighthouse applicant records, reference-class base rates, outcomes and approval-gated pipeline actions.',
  });
  await client.upsertAgent(AGENT_NAMES.analyst, 'Critical analyst: produces a Long-Term Fit Report with evidence, counter-evidence and calibrated estimates.', analystManifest(domainPack));
  await client.upsertAgent(AGENT_NAMES.fairness, 'Independent fairness auditor with veto power over reports.', fairnessManifest);
  await client.upsertAgent(AGENT_NAMES.action, 'Proposes a person-affecting action; always pauses for human approval.', actionManifest);
  await client.upsertAgent(AGENT_NAMES.rescorer, 'Nightly: re-scores stored predictions against recorded outcomes and refreshes calibration.', rescorerManifest);
  await client.upsertSchedule(SCHEDULE_NAME, AGENT_NAMES.rescorer, {
    task: 'Run the nightly calibration rescore and summarise the results.',
    cron: '0 2 * * *',
    timezone: 'America/Los_Angeles',
    status: 'active',
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await registerAll(createHarness(), process.argv[2] ?? 'university-admissions');
  console.log(`registered agents (${HARNESS_MODE} harness):`, Object.values(AGENT_NAMES).join(', '));
}
