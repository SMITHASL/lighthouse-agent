import { describe, expect, it } from '../harness.ts';
import { ApplicantInput, PROTECTED_ATTRIBUTES } from '../../src/schema/applicant.ts';
import { generateDataset } from '../../src/data/generate.ts';

const valid = generateDataset(1).inputs[0]!;

describe('ApplicantInput', () => {
  it('accepts generated records', () => {
    expect(ApplicantInput.safeParse(valid).success).toBe(true);
  });

  it.each(PROTECTED_ATTRIBUTES)('protected_attribute_rejected: %s', (attr) => {
    const r = ApplicantInput.safeParse({ ...valid, [attr]: 'x' });
    expect(r.success).toBe(false);
  });
});
