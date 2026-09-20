import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from '../harness.ts';

/** Every Gherkin scenario must be referenced by name in at least one test file. */
describe('BDD traceability', () => {
  const scenarios = readdirSync('features')
    .filter((f) => f.endsWith('.feature'))
    .flatMap((f) => [...readFileSync(`features/${f}`, 'utf8').matchAll(/Scenario: (\w+)/g)].map((m) => m[1]!));
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]));
  const testSource = walk('test').filter((f) => f.endsWith('.test.ts') && !f.endsWith('traceability.test.ts')).map((f) => readFileSync(f, 'utf8')).join('\n');

  it('has at least one scenario', () => expect(scenarios.length).toBeGreaterThan(0));
  it.each(scenarios)('scenario %s has a test', (name) => {
    expect(testSource.includes(name)).toBe(true);
  });
});
