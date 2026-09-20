import { describe, expect, it } from '../harness.ts';
import { generateDataset } from '../../src/data/generate.ts';
import { ApplicantInput } from '../../src/schema/applicant.ts';

describe('synthetic dataset', () => {
  it('is deterministic for a seed and schema-valid', () => {
    const a = generateDataset(20, 7);
    const b = generateDataset(20, 7);
    expect(a).toEqual(b);
    for (const row of a.inputs) expect(ApplicantInput.safeParse(row).success).toBe(true);
  });
  it('keeps protected labels out of model inputs', () => {
    const { inputs } = generateDataset(5);
    for (const row of inputs) {
      expect(row).not.toHaveProperty('synthetic_group');
      expect(row).not.toHaveProperty('synthetic_family_wealth');
    }
  });
});
