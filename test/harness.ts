/**
 * Test harness on node:test + node:assert — the matcher subset the suite uses, with a
 * vitest-shaped surface so test files only change their import line.
 *   node --test "test/**\/*.test.ts"
 */
import assert from 'node:assert/strict';
import { after, before, describe as nodeDescribe, it as nodeIt } from 'node:test';

export const beforeAll = before;
export const afterAll = after;

type Fn = () => void | Promise<void>;
type ItFn = ((name: string, fn: Fn) => void) & { each: <T>(cases: readonly T[]) => (name: string, fn: (c: T) => void | Promise<void>) => void };
type DescribeFn = ((name: string, fn: () => void) => void) & { skipIf: (cond: boolean) => (name: string, fn: () => void) => void };

const format = (name: string, c: unknown) => name.replace(/%s/g, String(c));

export const it: ItFn = Object.assign((name: string, fn: Fn) => { nodeIt(name, fn); }, {
  each: <T>(cases: readonly T[]) => (name: string, fn: (c: T) => void | Promise<void>) => { for (const c of cases) nodeIt(format(name, c), () => fn(c)); },
});
export const test = it;

export const describe: DescribeFn = Object.assign((name: string, fn: () => void) => { nodeDescribe(name, fn); }, {
  skipIf: (cond: boolean) => (name: string, fn: () => void) => { nodeDescribe(name, { skip: cond }, fn); },
});

function matchObject(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== 'object' || expected === null) return Object.is(actual, expected);
  if (typeof actual !== 'object' || actual === null) return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => matchObject(actual[i], e));
  return Object.entries(expected).every(([k, v]) => matchObject((actual as Record<string, unknown>)[k], v));
}

class Expectation {
  private readonly actual: unknown;
  private readonly negate: boolean;
  private readonly msg?: string;
  constructor(actual: unknown, negate = false, msg?: string) { this.actual = actual; this.negate = negate; this.msg = msg; }
  get not() { return new Expectation(this.actual, !this.negate, this.msg); }
  private check(pass: boolean, what: string) {
    if (pass === this.negate) assert.fail(`${this.msg ? this.msg + ': ' : ''}expected ${JSON.stringify(this.actual)}${this.negate ? ' not' : ''} ${what}`);
  }
  toBe(v: unknown) { this.check(Object.is(this.actual, v), `to be ${JSON.stringify(v)}`); }
  toEqual(v: unknown) { let pass = true; try { assert.deepEqual(this.actual, v); } catch { pass = false; } this.check(pass, `to equal ${JSON.stringify(v)}`); }
  toStrictEqual(v: unknown) { this.toEqual(v); }
  toBeNull() { this.check(this.actual === null, 'to be null'); }
  toBeDefined() { this.check(this.actual !== undefined, 'to be defined'); }
  toBeUndefined() { this.check(this.actual === undefined, 'to be undefined'); }
  toBeTruthy() { this.check(Boolean(this.actual), 'to be truthy'); }
  toBeFalsy() { this.check(!this.actual, 'to be falsy'); }
  toBeGreaterThan(n: number) { this.check((this.actual as number) > n, `to be > ${n}`); }
  toBeGreaterThanOrEqual(n: number) { this.check((this.actual as number) >= n, `to be >= ${n}`); }
  toBeLessThan(n: number) { this.check((this.actual as number) < n, `to be < ${n}`); }
  toBeLessThanOrEqual(n: number) { this.check((this.actual as number) <= n, `to be <= ${n}`); }
  toBeCloseTo(n: number, digits = 2) { this.check(Math.abs((this.actual as number) - n) < 10 ** -digits / 2, `to be close to ${n}`); }
  toHaveLength(n: number) { this.check((this.actual as { length: number }).length === n, `to have length ${n}`); }
  toContain(v: unknown) {
    const a = this.actual;
    const pass = typeof a === 'string' ? a.includes(String(v)) : Array.isArray(a) ? a.includes(v) : false;
    this.check(pass, `to contain ${JSON.stringify(v)}`);
  }
  toMatch(re: RegExp | string) { this.check(typeof re === 'string' ? String(this.actual).includes(re) : re.test(String(this.actual)), `to match ${re}`); }
  toHaveProperty(path: string, value?: unknown) {
    const parts = path.split('.');
    let cur: unknown = this.actual;
    let found = true;
    for (const p of parts) { if (cur !== null && typeof cur === 'object' && p in (cur as object)) cur = (cur as Record<string, unknown>)[p]; else { found = false; break; } }
    this.check(found && (value === undefined || Object.is(cur, value)), `to have property ${path}${value !== undefined ? ` = ${JSON.stringify(value)}` : ''}`);
  }
  toMatchObject(v: unknown) { this.check(matchObject(this.actual, v), `to match object ${JSON.stringify(v)}`); }
  toThrow(re?: RegExp | string) {
    let threw: unknown = null;
    try { (this.actual as () => unknown)(); } catch (e) { threw = e; }
    const pass = threw !== null && (re === undefined || (re instanceof RegExp ? re.test(String((threw as Error).message)) : String((threw as Error).message).includes(re)));
    this.check(pass, `to throw${re ? ` ${re}` : ''}`);
  }
}

export const expect = (actual: unknown, msg?: string) => new Expectation(actual, false, msg);
