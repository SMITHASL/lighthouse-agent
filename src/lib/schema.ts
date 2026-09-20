/**
 * A dependency-free schema library covering exactly the subset Lighthouse uses: strict objects,
 * strings (min / regex), numbers (min / max / int), booleans, literals, enums, arrays (min),
 * nullable, optional, default, refine. Zod-compatible surface (`z.object`, `.parse`, `.safeParse`,
 * `Infer<>`) so the contracts in src/schema read the same as before, plus `toJsonSchema()` for
 * model response formats and tool parameters.
 */
export type Issue = { path: (string | number)[]; message: string };
export type SafeParseResult<T> = { success: true; data: T } | { success: false; error: SchemaError };

export class SchemaError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; '));
    this.name = 'SchemaError';
    this.issues = issues;
  }
  toJSON() { return { name: this.name, issues: this.issues }; }
}

type Ctx = { path: (string | number)[]; issues: Issue[] };
const fail = (ctx: Ctx, message: string) => { ctx.issues.push({ path: [...ctx.path], message }); return undefined; };

export abstract class Schema<T> {
  /** Phantom for type inference only. */
  declare readonly _output: T;
  abstract _check(value: unknown, ctx: Ctx): T | undefined;
  abstract toJsonSchema(): Record<string, unknown>;

  safeParse(value: unknown): SafeParseResult<T> {
    const ctx: Ctx = { path: [], issues: [] };
    const data = this._check(value, ctx);
    return ctx.issues.length ? { success: false, error: new SchemaError(ctx.issues) } : { success: true, data: data as T };
  }
  parse(value: unknown): T {
    const r = this.safeParse(value);
    if (!r.success) throw r.error;
    return r.data;
  }
  nullable(): Schema<T | null> { return new Nullable(this); }
  optional(): Optional<T> { return new Optional(this); }
  default(v: T): Default<T> { return new Default(this, v); }
  refine(pred: (v: T) => boolean, opts: { message: string }): Schema<T> { return new Refined(this, pred, opts.message); }
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

class Str extends Schema<string> {
  private minLen = 0;
  private re?: RegExp;
  min(n: number) { this.minLen = n; return this; }
  regex(re: RegExp) { this.re = re; return this; }
  _check(v: unknown, ctx: Ctx) {
    if (typeof v !== 'string') return fail(ctx, `expected string, got ${typeOf(v)}`);
    if (v.length < this.minLen) return fail(ctx, `string must contain at least ${this.minLen} character(s)`);
    if (this.re && !this.re.test(v)) return fail(ctx, `string does not match ${this.re}`);
    return v;
  }
  toJsonSchema() { return { type: 'string', ...(this.minLen ? { minLength: this.minLen } : {}), ...(this.re ? { pattern: this.re.source } : {}) }; }
}

class Num extends Schema<number> {
  private lo?: number; private hi?: number; private isInt = false;
  min(n: number) { this.lo = n; return this; }
  max(n: number) { this.hi = n; return this; }
  int() { this.isInt = true; return this; }
  _check(v: unknown, ctx: Ctx) {
    if (typeof v !== 'number' || Number.isNaN(v)) return fail(ctx, `expected number, got ${typeOf(v)}`);
    if (this.isInt && !Number.isInteger(v)) return fail(ctx, 'expected integer');
    if (this.lo !== undefined && v < this.lo) return fail(ctx, `number must be >= ${this.lo}`);
    if (this.hi !== undefined && v > this.hi) return fail(ctx, `number must be <= ${this.hi}`);
    return v;
  }
  toJsonSchema() { return { type: this.isInt ? 'integer' : 'number', ...(this.lo !== undefined ? { minimum: this.lo } : {}), ...(this.hi !== undefined ? { maximum: this.hi } : {}) }; }
}

class Bool extends Schema<boolean> {
  _check(v: unknown, ctx: Ctx) { return typeof v === 'boolean' ? v : fail(ctx, `expected boolean, got ${typeOf(v)}`); }
  toJsonSchema() { return { type: 'boolean' }; }
}

class Lit<T extends string | number | boolean> extends Schema<T> {
  private readonly value: T;
  constructor(value: T) { super(); this.value = value; }
  _check(v: unknown, ctx: Ctx) { return v === this.value ? this.value : fail(ctx, `expected literal ${JSON.stringify(this.value)}`); }
  toJsonSchema() { return { const: this.value }; }
}

class Enum<T extends string> extends Schema<T> {
  private readonly values: readonly T[];
  constructor(values: readonly T[]) { super(); this.values = values; }
  _check(v: unknown, ctx: Ctx) { return (this.values as readonly unknown[]).includes(v) ? (v as T) : fail(ctx, `expected one of ${this.values.map((x) => JSON.stringify(x)).join(' | ')}`); }
  toJsonSchema() { return { type: 'string', enum: [...this.values] }; }
}

class Arr<T> extends Schema<T[]> {
  private minLen = 0;
  private readonly item: Schema<T>;
  constructor(item: Schema<T>) { super(); this.item = item; }
  min(n: number) { this.minLen = n; return this; }
  _check(v: unknown, ctx: Ctx) {
    if (!Array.isArray(v)) return fail(ctx, `expected array, got ${typeOf(v)}`);
    if (v.length < this.minLen) return fail(ctx, `array must contain at least ${this.minLen} element(s)`);
    const out: T[] = [];
    v.forEach((item, i) => { ctx.path.push(i); const r = this.item._check(item, ctx); ctx.path.pop(); if (r !== undefined) out.push(r); });
    return ctx.issues.length ? undefined : out;
  }
  toJsonSchema() { return { type: 'array', items: this.item.toJsonSchema(), ...(this.minLen ? { minItems: this.minLen } : {}) }; }
}

class Nullable<T> extends Schema<T | null> {
  private readonly inner: Schema<T>;
  constructor(inner: Schema<T>) { super(); this.inner = inner; }
  _check(v: unknown, ctx: Ctx) { return v === null ? null : this.inner._check(v, ctx); }
  toJsonSchema() { return { anyOf: [this.inner.toJsonSchema(), { type: 'null' }] }; }
}

class Optional<T> extends Schema<T | undefined> {
  readonly isOptional = true;
  readonly inner: Schema<T>;
  constructor(inner: Schema<T>) { super(); this.inner = inner; }
  _check(v: unknown, ctx: Ctx) { return v === undefined ? undefined : this.inner._check(v, ctx); }
  toJsonSchema() { return this.inner.toJsonSchema(); }
}

class Default<T> extends Schema<T> {
  readonly isOptional = true;
  readonly inner: Schema<T>;
  private readonly value: T;
  constructor(inner: Schema<T>, value: T) { super(); this.inner = inner; this.value = value; }
  _check(v: unknown, ctx: Ctx) { return v === undefined ? this.value : this.inner._check(v, ctx); }
  toJsonSchema() { return { ...this.inner.toJsonSchema(), default: this.value }; }
}

class Refined<T> extends Schema<T> {
  private readonly inner: Schema<T>;
  private readonly pred: (v: T) => boolean;
  private readonly message: string;
  constructor(inner: Schema<T>, pred: (v: T) => boolean, message: string) { super(); this.inner = inner; this.pred = pred; this.message = message; }
  _check(v: unknown, ctx: Ctx) {
    const before = ctx.issues.length;
    const r = this.inner._check(v, ctx);
    if (ctx.issues.length > before || r === undefined) return undefined;
    return this.pred(r) ? r : fail(ctx, this.message);
  }
  toJsonSchema() { return this.inner.toJsonSchema(); }
}

export type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends { isOptional: true } ? K : never }[keyof S];
type Flatten<T> = { [K in keyof T]: T[K] } & {};
export type ObjectOutput<S extends Shape> = Flatten<{ [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> }>;

class Obj<S extends Shape> extends Schema<ObjectOutput<S>> {
  private isStrict = false;
  readonly shape: S;
  constructor(shape: S) { super(); this.shape = shape; }
  /** Unknown keys are rejected — this is what makes the applicant record a fairness boundary. */
  strict() { this.isStrict = true; return this; }
  _check(v: unknown, ctx: Ctx) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(ctx, `expected object, got ${typeOf(v)}`);
    const input = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, schema] of Object.entries(this.shape)) {
      ctx.path.push(k);
      const r = schema._check(input[k], ctx);
      ctx.path.pop();
      if (r !== undefined) out[k] = r;
    }
    if (this.isStrict) for (const k of Object.keys(input)) if (!(k in this.shape)) fail(ctx, `unrecognized key "${k}"`);
    return ctx.issues.length ? undefined : (out as ObjectOutput<S>);
  }
  toJsonSchema() {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, s] of Object.entries(this.shape)) {
      properties[k] = s.toJsonSchema();
      if (!(s as { isOptional?: boolean }).isOptional) required.push(k);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
}

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

export const z = {
  string: () => new Str(),
  number: () => new Num(),
  boolean: () => new Bool(),
  literal: <T extends string | number | boolean>(v: T) => new Lit(v),
  enum: <T extends string>(values: readonly [T, ...T[]]) => new Enum(values),
  array: <T>(item: Schema<T>) => new Arr(item),
  object: <S extends Shape>(shape: S) => new Obj(shape),
  infer: undefined as never, // type-level only; use `Infer<typeof X>`
};
export type { Obj as ObjectSchema };
