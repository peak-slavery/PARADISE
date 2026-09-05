/**
 * Bounded JSONB-shape validator.
 *
 * Routes persist `metadata`, `notification_preferences`, `feature_flags`, and
 * other open-shape objects to Postgres `jsonb` columns. The existing handlers
 * already reject non-objects and arrays, but a malicious client could still
 * ship a deeply nested, wide, or large object that bloats the row, breaks
 * Postgres `jsonb` validation, or DoS-es the JSON parser. This helper enforces
 * a depth / key-count / serialized-size cap before the value reaches Supabase.
 *
 * The validator accepts:
 *  - primitives (string, number, boolean, null)
 *  - plain objects whose nested shape also passes
 *  - arrays of the same
 *
 * Rejected:
 *  - functions, symbols, `undefined`, bigints
 *  - any node that exceeds `maxDepth` from the root
 *  - any object whose own enumerable key count exceeds `maxKeysPerObject`
 *  - any value whose serialized JSON form would push the total over
 *    `maxBytes` once written to the column
 */
export interface JsonbShapeLimits {
  maxDepth: number;
  maxKeysPerObject: number;
  maxBytes: number;
}

export const DEFAULT_JSONB_LIMITS: JsonbShapeLimits = {
  maxDepth: 6,
  maxKeysPerObject: 32,
  maxBytes: 8 * 1024,
};

export type JsonbValidationError =
  | 'not-an-object'
  | 'depth-exceeded'
  | 'keys-exceeded'
  | 'unsupported-value'
  | 'bytes-exceeded';

export interface JsonbValidationResult {
  ok: boolean;
  value: Record<string, unknown> | null;
  reason?: JsonbValidationError;
}

class ByteCounter {
  private estimate = 0;
  private readonly encoder = new TextEncoder();

  constructor(private readonly maxBytes: number) {}

  add(value: string): boolean {
    this.estimate += this.encoder.encode(value).byteLength;
    return this.estimate <= this.maxBytes;
  }

  get total(): number {
    return this.estimate;
  }
}

function addOrReject(counter: ByteCounter, value: string): { ok: true } | { ok: false; reason: 'bytes-exceeded' } {
  return counter.add(value) ? { ok: true } : { ok: false, reason: 'bytes-exceeded' };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function validateValue(
  value: unknown,
  depth: number,
  limits: JsonbShapeLimits,
  counter: ByteCounter,
): { ok: true; value: unknown } | { ok: false; reason: JsonbValidationError } {
  if (value === null) {
    const added = addOrReject(counter, 'null');
    if (!added.ok) return added;
    return { ok: true, value: null };
  }
  const t = typeof value;
  if (t === 'string') {
    const added = addOrReject(counter, JSON.stringify(value as string));
    if (!added.ok) return added;
    return { ok: true, value };
  }
  if (t === 'number') {
    if (!Number.isFinite(value as number)) return { ok: false, reason: 'unsupported-value' };
    const added = addOrReject(counter, String(value));
    if (!added.ok) return added;
    return { ok: true, value };
  }
  if (t === 'boolean') {
    const added = addOrReject(counter, (value as boolean) ? 'true' : 'false');
    if (!added.ok) return added;
    return { ok: true, value };
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    return { ok: false, reason: 'unsupported-value' };
  }
  if (t !== 'object') return { ok: false, reason: 'unsupported-value' };

  if (Array.isArray(value)) {
    if (depth >= limits.maxDepth) return { ok: false, reason: 'depth-exceeded' };
    let added = addOrReject(counter, '[');
    if (!added.ok) return added;
    const out: unknown[] = [];
    for (const item of value) {
      const r = validateValue(item, depth + 1, limits, counter);
      if (!r.ok) return r;
      out.push(r.value);
      added = addOrReject(counter, ',');
      if (!added.ok) return added;
    }
    added = addOrReject(counter, ']');
    if (!added.ok) return added;
    return { ok: true, value: out };
  }

  if (!isPlainObject(value)) return { ok: false, reason: 'unsupported-value' };
  if (depth >= limits.maxDepth) return { ok: false, reason: 'depth-exceeded' };
  const keys = Object.keys(value);
  if (keys.length > limits.maxKeysPerObject) return { ok: false, reason: 'keys-exceeded' };
  let added = addOrReject(counter, '{');
  if (!added.ok) return added;
  // Define properties on a null-prototype object so a JSON key named
  // `__proto__` remains data rather than invoking Object.prototype's setter.
  const out = Object.create(null) as Record<string, unknown>;
  let first = true;
  for (const key of keys) {
    if (key.length > 64) return { ok: false, reason: 'unsupported-value' };
    if (!first) {
      added = addOrReject(counter, ',');
      if (!added.ok) return added;
    }
    first = false;
    added = addOrReject(counter, JSON.stringify(key));
    if (!added.ok) return added;
    added = addOrReject(counter, ':');
    if (!added.ok) return added;
    const r = validateValue(value[key], depth + 1, limits, counter);
    if (!r.ok) return r;
    out[key] = r.value;
  }
  added = addOrReject(counter, '}');
  if (!added.ok) return added;
  return { ok: true, value: out };
}

/**
 * Validate that a candidate value is a plain JSON object whose entire shape
 * fits the configured limits. Returns a sanitized copy on success so the route
 * can store only the validated shape directly.
 */
export function validateJsonbObject(
  value: unknown,
  limits: JsonbShapeLimits = DEFAULT_JSONB_LIMITS,
): JsonbValidationResult {
  if (!isPlainObject(value)) return { ok: false, value: null, reason: 'not-an-object' };
  const counter = new ByteCounter(limits.maxBytes);
  const result = validateValue(value, 0, limits, counter);
  if (!result.ok) return { ok: false, value: null, reason: result.reason };
  if (counter.total > limits.maxBytes) return { ok: false, value: null, reason: 'bytes-exceeded' };
  return { ok: true, value: result.value as Record<string, unknown> };
}
