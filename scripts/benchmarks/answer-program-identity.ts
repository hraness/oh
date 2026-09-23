// Benchmark-only veto. This does not establish support, source authority,
// freshness or eligibility, and it never admits a binding by itself.
export const ANSWER_PROGRAM_IDENTITY_LIMITS_V1 = Object.freeze({
  statementBytes: 4096, subjectBytes: 256, valueBytes: 256,
});

export type RecommendationIdentityResultV1 =
  | Readonly<{ status: "exact-match" }>
  | Readonly<{ status: "exact-mismatch"; mismatches: readonly ("subject" | "field" | "value")[] }>
  | Readonly<{ status: "unrecognized" }>;

function invalid(label: string): never { throw new TypeError(`Recommendation identity: invalid ${label}`); }
function data(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object") invalid(label);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(label);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) invalid(label);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid(`${label} property`);
    result[key] = descriptor.value;
  }
  return result;
}
function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") invalid(label);
  if (value.length > maximum || Buffer.byteLength(value, "utf8") > maximum) {
    throw new RangeError(`Recommendation identity: ${label} exceeds byte bound`);
  }
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(`${label} Unicode`);
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid(`${label} Unicode`);
  }
  return value;
}

/**
 * Recognizes only the complete canonical V5 assertion grammar. Equivalent
 * noncanonical spellings remain unrecognized. Use only as a veto after an
 * independent supported decision; neither match nor unrecognized admits one.
 */
export function inspectRecommendationIdentityV1(input: unknown): RecommendationIdentityResultV1 {
  const root = data(input, ["statement", "expected"], "input");
  const expected = data(root.expected, ["subject", "field", "value"], "expected");
  const limits = ANSWER_PROGRAM_IDENTITY_LIMITS_V1;
  const statement = boundedString(root.statement, limits.statementBytes, "statement");
  const subject = boundedString(expected.subject, limits.subjectBytes, "subject");
  const value = boundedString(expected.value, limits.valueBytes, "value");
  if (expected.field !== "title" && expected.field !== "narrator") invalid("field");
  const match = /^Audiobook ("(?:[^"\\]|\\.)*"): (title|narrator) = ("(?:[^"\\]|\\.)*")\.$/u.exec(statement);
  if (match === null) return { status: "unrecognized" };
  let decodedSubject: unknown, decodedValue: unknown;
  try { decodedSubject = JSON.parse(match[1]!); decodedValue = JSON.parse(match[3]!); }
  catch { return { status: "unrecognized" }; }
  const actualSubject = boundedString(decodedSubject, limits.subjectBytes, "source subject");
  const actualValue = boundedString(decodedValue, limits.valueBytes, "source value");
  const actualField = match[2]!;
  if (statement !== `Audiobook ${JSON.stringify(actualSubject)}: ${actualField} = ${JSON.stringify(actualValue)}.`) {
    return { status: "unrecognized" };
  }
  const mismatches: ("subject" | "field" | "value")[] = [];
  if (actualSubject !== subject) mismatches.push("subject");
  if (actualField !== expected.field) mismatches.push("field");
  if (actualValue !== value) mismatches.push("value");
  return mismatches.length ? { status: "exact-mismatch", mismatches } : { status: "exact-match" };
}
