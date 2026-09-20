import { describe, expect, it } from '../harness.ts';
import { auroc, brier, ciCoverage, demographicParityDifference, ece, equalOpportunityDifference } from '../../src/metrics/index.ts';

describe('metrics', () => {
  it('brier is 0 for perfect and 1 for inverted predictions', () => {
    expect(brier([{ p: 1, y: true }, { p: 0, y: false }])).toBe(0);
    expect(brier([{ p: 0, y: true }, { p: 1, y: false }])).toBe(1);
  });
  it('ece is 0 when confidence matches accuracy per bin', () => {
    const rows = [...Array(10).fill({ p: 0.8, y: true }), ...Array(2).fill({ p: 0.8, y: false }), { p: 0.85, y: false }];
    expect(ece(rows)).toBeLessThan(0.05);
  });
  it('auroc is 1 for perfect ranking and 0.5 for constant', () => {
    expect(auroc([{ p: 0.9, y: true }, { p: 0.1, y: false }])).toBe(1);
    expect(auroc([{ p: 0.5, y: true }, { p: 0.5, y: false }])).toBe(0.5);
  });
  it('ciCoverage counts intervals that contain the truth side', () => {
    expect(ciCoverage([{ lo: 0.6, hi: 0.9, y: true }, { lo: 0.6, hi: 0.9, y: false }])).toBe(0.5);
  });
  it('parity metrics are 0 when groups are treated alike', () => {
    const rows = [{ p: 0.7, y: true, group: 'a' }, { p: 0.7, y: true, group: 'b' }];
    expect(demographicParityDifference(rows)).toBe(0);
    expect(equalOpportunityDifference(rows)).toBe(0);
  });
});
