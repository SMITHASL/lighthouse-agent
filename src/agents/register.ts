import { fileURLToPath } from 'node:url';
import { TrueForgeClient } from '../pipeline/client.js';
import { MCP_URL } from '../mcp/server.js';
import { AGENT_NAMES, MCP_SERVER_NAME, actionManifest, analystManifest, fairnessManifest } from './manifests.js';

export async function registerAll(client = new TrueForgeClient(), domainPack = 'university-admissions'): Promise<void> {
  await client.upsertMcpServer({
    type: 'remote',
    name: MCP_SERVER_NAME,
    url: MCP_URL,
    description: 'Lighthouse applicant records, reference-class base rates, outcomes and approval-gated pipeline actions.',
  });
  await client.upsertAgent(AGENT_NAMES.analyst, 'Critical analyst: produces a Long-Term Fit Report with evidence, counter-evidence and calibrated estimates.', analystManifest(domainPack));
  await client.upsertAgent(AGENT_NAMES.fairness, 'Independent fairness auditor with veto power over reports.', fairnessManifest);
  await client.upsertAgent(AGENT_NAMES.action, 'Proposes a person-affecting action; always pauses for human approval.', actionManifest);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await registerAll(new TrueForgeClient(), process.argv[2] ?? 'university-admissions');
  console.log('registered MCP server and agents:', Object.values(AGENT_NAMES).join(', '));
}
