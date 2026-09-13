/** Portable canonical JSON primitives. The legacy error literal is retained for parser compatibility. */
export type Parsed<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: "invalid-title" }>;

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

function isRecord(
  value: JsonValue | undefined,
): value is Readonly<Record<string, JsonValue>>;
function isRecord(value: unknown): value is Record<string, unknown>;
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isJsonArray(
  value: JsonValue | undefined,
): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function parseJsonValue(
  value: unknown,
  limits: Readonly<{ maxDepth?: number; maxNodes?: number }> = {},
): Parsed<JsonValue> {
  const maxDepth = limits.maxDepth ?? 64;
  const maxNodes = limits.maxNodes ?? 40_000;
  let nodes = 0;
  function visit(candidate: unknown, depth: number): JsonValue | undefined {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) return undefined;
    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      typeof candidate === "string"
    ) {
      return candidate;
    }
    if (typeof candidate === "number") {
      return Number.isFinite(candidate) ? candidate : undefined;
    }
    if (Array.isArray(candidate)) {
      const result: JsonValue[] = [];
      for (const item of candidate) {
        const parsed = visit(item, depth + 1);
        if (parsed === undefined) return undefined;
        result.push(parsed);
      }
      return result;
    }
    if (!isRecord(candidate)) return undefined;
    const entries: Array<readonly [string, JsonValue]> = [];
    for (const key of Object.keys(candidate).sort()) {
      const parsed = visit(candidate[key], depth + 1);
      if (parsed === undefined) return undefined;
      entries.push([key, parsed]);
    }
    // Object.fromEntries uses CreateDataProperty, so a JSON key named
    // "__proto__" remains ordinary data instead of invoking the legacy
    // Object.prototype setter and changing the parsed object's prototype.
    return Object.fromEntries(entries);
  }
  const parsed = visit(value, 0);
  return parsed === undefined
    ? { ok: false, error: "invalid-title" }
    : { ok: true, value: parsed };
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (isJsonArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as JsonValue)}`)
    .join(",")}}`;
}
