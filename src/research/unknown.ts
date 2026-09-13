import type { JsonValue } from "./document-domain";

/**
 * Guards for values parsed from `unknown`. Every parser in the repository
 * starts by proving a foreign value is a record and that its key set is the
 * one the contract names; these are the shared forms of those two steps.
 *
 * Two record guards exist because two boundaries need them. `isRecord` accepts
 * any non-array object, which is what a `JSON.parse` result or a database row
 * needs. `isPlainRecord` also rejects class instances, `Map`, `Date`, and
 * other exotic objects, which is what a value that may have crossed a provider
 * or tool boundary needs.
 *
 * Three key-set checks exist because they answer different questions.
 * `exactKeys` compares the enumerable own string keys, `hasExactKeys` accepts
 * non-enumerable own keys through `Object.hasOwn`, and `hasExactDataKeys`
 * additionally rejects symbol keys and accessor properties. Callers that need
 * one of the stricter forms must not be moved to a looser one.
 */

export type UnknownRecord = Readonly<Record<string, unknown>>;
export type PlainRecord = UnknownRecord;
export type JsonRecord = Readonly<Record<string, JsonValue>>;

/** Accepts any non-null, non-array object. */
export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `isRecord` as a projection: the record, or `null` for anything else. */
export function asRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

/** `isRecord` over an already-typed JSON value. */
export function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts only ordinary JSON-like records, including null-prototype records. */
export function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Requires the enumerable own string keys to equal `keys` as a set. */
/** A bare uppercase error code such as Node's ERR_MODULE_NOT_FOUND; never a message. */
export function safeErrorCode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const code = value["code"];
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/u.test(code) ? code : null;
}

export function exactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

/**
 * Requires every named key to be an own property and the enumerable own
 * string-key count to match. Unlike `exactKeys`, a non-enumerable own key
 * satisfies its entry in `keys`.
 */
export function hasExactKeys(value: PlainRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Requires the own keys to be exactly `expectedKeys`, every one a string and
 * every property an enumerable data property. Accessors and symbol keys fail.
 */
export function hasExactDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== "string")
  ) return false;
  const expected = new Set(expectedKeys);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !expected.has(key)
      || descriptor === undefined
      || !("value" in descriptor)
      || !descriptor.enumerable
    ) return false;
  }
  return true;
}
