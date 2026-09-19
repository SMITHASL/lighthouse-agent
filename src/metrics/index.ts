/** Pure evaluation math. Every function takes parallel arrays; no I/O. */

export type Labeled = { p: number; y: boolean };

export function brier(rows: Labeled[]): number {
  if (rows.length === 0) return NaN;
  return rows.reduce((s, r) => s + (r.p - (r.y ? 1 : 0)) ** 2, 0) / rows.length;
}

/** Expected Calibration Error with equal-width bins. */
export function ece(rows: Labeled[], bins = 10): number {
  if (rows.length === 0) return NaN;
  const buckets: Labeled[][] = Array.from({ length: bins }, () => []);
  for (const r of rows) {
    const b = Math.min(bins - 1, Math.floor(r.p * bins));
    buckets[b]!.push(r);
  }
  let total = 0;
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const conf = bucket.reduce((s, r) => s + r.p, 0) / bucket.length;
    const acc = bucket.filter((r) => r.y).length / bucket.length;
    total += (bucket.length / rows.length) * Math.abs(conf - acc);
  }
  return total;
}

/** AUROC via the rank-sum (Mann–Whitney) identity; ties count half. */
export function auroc(rows: Labeled[]): number {
  const pos = rows.filter((r) => r.y).map((r) => r.p);
  const neg = rows.filter((r) => !r.y).map((r) => r.p);
  if (pos.length === 0 || neg.length === 0) return NaN;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** Share of rows whose interval contains the truth. */
export function ciCoverage(rows: { lo: number; hi: number; y: boolean }[]): number {
  if (rows.length === 0) return NaN;
  const hit = rows.filter((r) => (r.y ? r.hi >= 0.5 : r.lo <= 0.5)).length;
  return hit / rows.length;
}

/** Max pairwise difference in mean prediction across groups. */
export function demographicParityDifference(rows: { p: number; group: string }[]): number {
  const means = groupMeans(rows.map((r) => ({ v: r.p, group: r.group })));
  return spread(means);
}

/** Max pairwise difference in true-positive rate across groups. */
export function equalOpportunityDifference(rows: { p: number; y: boolean; group: string; threshold?: number }[]): number {
  const positives = rows.filter((r) => r.y);
  const means = groupMeans(positives.map((r) => ({ v: r.p >= (r.threshold ?? 0.5) ? 1 : 0, group: r.group })));
  return spread(means);
}

function groupMeans(rows: { v: number; group: string }[]): number[] {
  const acc = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const g = acc.get(r.group) ?? { s: 0, n: 0 };
    g.s += r.v;
    g.n += 1;
    acc.set(r.group, g);
  }
  return [...acc.values()].map((g) => g.s / g.n);
}

function spread(xs: number[]): number {
  if (xs.length < 2) return 0;
  return Math.max(...xs) - Math.min(...xs);
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
