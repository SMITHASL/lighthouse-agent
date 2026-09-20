/**
 * Runtime selection. Default is the standalone LocalHarness; set TRUEFORGE_BASE_URL to run the
 * same pipeline against a TrueForge server instead. Both expose the same methods.
 */
import { TrueForgeClient } from '../pipeline/client.js';
import { LocalHarness } from './local.js';

export type Harness = Pick<TrueForgeClient, 'upsertMcpServer' | 'listAgents' | 'upsertAgent' | 'upsertSchedule' | 'runScheduleNow' | 'createSession' | 'runTurn'>;

export const HARNESS_MODE: 'local' | 'trueforge' = process.env.TRUEFORGE_BASE_URL ? 'trueforge' : 'local';

let shared: LocalHarness | undefined;
export function createHarness(): Harness {
  if (HARNESS_MODE === 'trueforge') return new TrueForgeClient(process.env.TRUEFORGE_BASE_URL);
  // One instance per process so the in-memory store (proposed actions, outcomes) is shared.
  shared ??= new LocalHarness();
  return shared;
}
export function localHarness(): LocalHarness {
  shared ??= new LocalHarness();
  return shared;
}
