/** Pure literal operations over already source-validated quote cards. No source
 * search, entity resolution, model, network, date inference or generated facts.
 * A resolved operation proves literal arithmetic only, never that the chosen
 * operands describe distinct events or increments rather than cumulative totals. */

const UNITS = Object.freeze({
  mm: Object.freeze({ dimension: "length", baseScale: 1 }),
  cm: Object.freeze({ dimension: "length", baseScale: 10 }),
  m: Object.freeze({ dimension: "length", baseScale: 1000 }),
  km: Object.freeze({ dimension: "length", baseScale: 1000000 }),
  mg: Object.freeze({ dimension: "mass", baseScale: 1 }),
  g: Object.freeze({ dimension: "mass", baseScale: 1000 }),
  kg: Object.freeze({ dimension: "mass", baseScale: 1000000 }),
  s: Object.freeze({ dimension: "duration", baseScale: 1 }),
  min: Object.freeze({ dimension: "duration", baseScale: 60 }),
  h: Object.freeze({ dimension: "duration", baseScale: 3600 }),
  d: Object.freeze({ dimension: "duration", baseScale: 86400 }),
});
export const EVOLUTION_FACT_CARD_OPERATION_POLICY = Object.freeze({
  protocol: "oh.evolution-fact-card-operation-policy.v1" as const,
  maximumCards: 32, maximumQuoteBytes: 2048, maximumOperations: 16,
  maximumOperands: 32, maximumLiteralBytes: 2048,
  literalMatch: "one-exact-case-sensitive-occurrence-with-utf8-offsets" as const,
  distinctMeaning: "distinct-literal-strings-not-entities-or-events" as const,
  numericGrammar: "-?(0|[1-9][0-9]{0,29})(\\.[0-9]{1,12})?; no negative zero" as const,
  units: UNITS,
  numericUnitSyntax: "bare-number-with-unit-null-or-number-single-space-supported-unit-with-explicit-output-unit" as const,
  arithmetic: "exact-rational-no-rounding; reduced-fraction-if-decimal-does-not-terminate" as const,
  difference: "first-minus-second" as const,
  calendar: "complete-valid-ISO-YYYY-MM-DD-0001-through-9999-proleptic-Gregorian-UTC" as const,
  dateInterval: "second-minus-first-in-whole-days-output-unit-d" as const,
  dateOrder: "ascending-operand-index-groups-with-explicit-equal-date-ties" as const,
  qualification: "Source-literal custody and deterministic operations do not prove semantic relevance, distinct events, additivity or cumulative-versus-increment meaning." as const,
});

export type EvolutionFactCardOperationKind = "distinct-literals" | "sum" | "difference" | "date-interval-days" | "date-order";
export type EvolutionFactCardOperationEvidence = Readonly<{ cardId: string; literal: string; utf8Start: number; utf8End: number }>;
export type EvolutionFactCardOperationResult = Readonly<{
  index: number; kind: EvolutionFactCardOperationKind | "unsupported";
  status: "resolved" | "unresolved"; value: string | null; unit: string | null;
  evidence: readonly EvolutionFactCardOperationEvidence[]; reason: string | null;
}>;
type Card = Readonly<{ id: string; quote: string }>;
type Unit = keyof typeof UNITS;
type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;
const KINDS = new Set<EvolutionFactCardOperationKind>(["distinct-literals", "sum", "difference", "date-interval-days", "date-order"]);
const NUMBER = /^(-?)(0|[1-9][0-9]{0,29})(?:\.([0-9]{1,12}))?$/;

function fail(reason: string): never { throw new TypeError(`Fact-card operations: ${reason}.`); }
function scalar(value: unknown, maximum: number, empty = false): value is string {
  return typeof value === "string" && (empty || value.length > 0) && Buffer.byteLength(value) <= maximum && !/\p{Surrogate}/u.test(value);
}
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function dataField(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("data fields required");
  return descriptor.value;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plain(value)) fail("plain object required");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) fail("exact operation fields required");
  const result: Record<string, unknown> = {};
  for (const key of keys) result[key] = dataField(value, key);
  return result;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) fail("bounded dense array required");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("data array entries required");
    result.push(descriptor.value);
  }
  return result;
}
function cards(value: unknown): Map<string, Card> {
  const result = new Map<string, Card>();
  for (const item of array(value, EVOLUTION_FACT_CARD_OPERATION_POLICY.maximumCards)) {
    if (!plain(item)) fail("invalid card");
    // Only these two data descriptors are projected. Source metadata and any
    // extra getters (including gold-shaped ones) are never read or enumerated.
    const id = dataField(item, "id"), quote = dataField(item, "quote");
    if (!scalar(id, 128) || !scalar(quote, EVOLUTION_FACT_CARD_OPERATION_POLICY.maximumQuoteBytes) || result.has(id)) fail("invalid or duplicate card");
    result.set(id, Object.freeze({ id, quote }));
  }
  return result;
}
function rational(numerator: bigint, denominator: bigint): Rational {
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b) { const next = a % b; a = b; b = next; }
  return { numerator: numerator / a, denominator: denominator / a };
}
function numeric(literal: string): Rational | null {
  const match = NUMBER.exec(literal);
  if (!match) return null;
  const numerator = BigInt(match[2]! + (match[3] ?? "")) * (match[1] ? -1n : 1n);
  if (numerator === 0n && match[1]) return null;
  return rational(numerator, 10n ** BigInt((match[3] ?? "").length));
}
function format(value: Rational): string {
  if (value.denominator === 1n) return String(value.numerator);
  let d = value.denominator, twos = 0, fives = 0;
  while (d % 2n === 0n) { twos++; d /= 2n; }
  while (d % 5n === 0n) { fives++; d /= 5n; }
  if (d !== 1n) return `${value.numerator}/${value.denominator}`;
  const scale = Math.max(twos, fives), absolute = value.numerator < 0n ? -value.numerator : value.numerator;
  const digits = String(absolute * (10n ** BigInt(scale) / value.denominator)).padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale), fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${value.numerator < 0n ? "-" : ""}${whole}${fraction ? "." + fraction : ""}`;
}
function unit(value: unknown): value is Unit { return typeof value === "string" && Object.hasOwn(UNITS, value); }
function date(literal: string): number | null {
  if (!/^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(literal)) return null;
  const value = new Date(`${literal}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== literal) return null;
  return value.getTime() / 86_400_000;
}
function output(index: number, kind: EvolutionFactCardOperationResult["kind"], value: string | null,
  unit: string | null, evidence: readonly EvolutionFactCardOperationEvidence[], reason: string | null): EvolutionFactCardOperationResult {
  return Object.freeze({ index, kind, status: reason === null ? "resolved" : "unresolved", value, unit,
    evidence: Object.freeze(evidence.map(item => Object.freeze({ ...item }))), reason });
}

/** Only exact substrings are accepted; numeric/calendar operands must also be
 * complete lexical tokens, so a selector cannot quote `5` from `15` or `-5`. */
function partialToken(quote: string, literal: string, start: number, outputUnit: unknown): boolean {
  const left = [...quote.slice(0, start)].at(-1) ?? "", after = quote.slice(start + literal.length), right = [...after][0] ?? "";
  if (/[\p{L}\p{N}_+\-.$€£/*^]/u.test(left) || /[\p{L}\p{N}_+\-%/*^]/u.test(right) || /^\.[0-9]/.test(after)) return true;
  if (outputUnit === null && /^\s+(mm|cm|m|km|mg|g|kg|s|min|h|d)(?![\p{L}\p{N}_])/u.test(after)) return true;
  return false;
}

function operation(index: number, input: unknown, source: ReadonlyMap<string, Card>): EvolutionFactCardOperationResult {
  let kind: EvolutionFactCardOperationResult["kind"] = "unsupported";
  let parsed: Record<string, unknown>, operands: unknown[];
  try {
    parsed = exact(input, ["kind", "operands", "unit"]);
    if (typeof parsed.kind !== "string" || !KINDS.has(parsed.kind as EvolutionFactCardOperationKind)) return output(index, kind, null, null, [], "unsupported-kind");
    kind = parsed.kind as EvolutionFactCardOperationKind;
    if (parsed.unit !== null && !scalar(parsed.unit, 32)) return output(index, kind, null, null, [], "invalid-unit");
    operands = array(parsed.operands, EVOLUTION_FACT_CARD_OPERATION_POLICY.maximumOperands);
  } catch { return output(index, kind, null, null, [], "invalid-operation-shape"); }
  const evidence: EvolutionFactCardOperationEvidence[] = [], seen = new Set<string>();
  const unresolved = (reason: string) => output(index, kind, null, null, evidence, reason);
  if (!operands.length || ((kind === "difference" || kind === "date-interval-days") && operands.length !== 2)
    || kind === "date-order" && operands.length < 2) return unresolved("operand-count");
  for (const value of operands) {
    let operand: Record<string, unknown>;
    try { operand = exact(value, ["cardId", "literal"]); } catch { return unresolved("invalid-operand-shape"); }
    if (!scalar(operand.cardId, 128) || !scalar(operand.literal, EVOLUTION_FACT_CARD_OPERATION_POLICY.maximumLiteralBytes)) return unresolved("invalid-operand");
    const card = source.get(operand.cardId);
    if (!card) return unresolved("missing-source-card");
    const start = card.quote.indexOf(operand.literal);
    if (start < 0 || card.quote.indexOf(operand.literal, start + 1) !== -1) return unresolved("literal-absent-or-ambiguous");
    if (kind !== "distinct-literals" && partialToken(card.quote, operand.literal, start, parsed.unit)) return unresolved("partial-number-or-date-token");
    const identity = JSON.stringify([operand.cardId, start, start + operand.literal.length]);
    if (seen.has(identity)) return unresolved("duplicate-source-operand");
    seen.add(identity);
    const utf8Start = Buffer.byteLength(card.quote.slice(0, start));
    evidence.push({ cardId: operand.cardId, literal: operand.literal, utf8Start, utf8End: utf8Start + Buffer.byteLength(operand.literal) });
  }
  if (kind === "distinct-literals") {
    if (parsed.unit !== null) return unresolved("distinct-literals-requires-null-unit");
    return output(index, kind, String(new Set(evidence.map(item => item.literal)).size), null, evidence, null);
  }
  if (kind === "date-interval-days" || kind === "date-order") {
    if (parsed.unit !== (kind === "date-interval-days" ? "d" : null)) return unresolved("calendar-unit-mismatch");
    const dates = evidence.map(item => date(item.literal));
    if (dates.some(value => value === null)) return unresolved("complete-calendar-date-required");
    const days = dates as number[];
    if (kind === "date-interval-days") return output(index, kind, String(days[1]! - days[0]!), "d", evidence, null);
    const groups = new Map<number, number[]>();
    days.forEach((day, operand) => { const group = groups.get(day) ?? []; group.push(operand); groups.set(day, group); });
    const ordered = [...groups.entries()].sort(([left], [right]) => left - right).map(([, group]) => group);
    return output(index, kind, JSON.stringify(ordered), null, evidence, null);
  }
  if (parsed.unit !== null && !unit(parsed.unit)) return unresolved("unsupported-unit");
  const outputUnit = parsed.unit as Unit | null, numbers: Rational[] = [];
  for (const item of evidence) {
    let value: Rational | null;
    if (outputUnit === null) value = numeric(item.literal);
    else {
      const split = item.literal.split(" ");
      if (split.length !== 2 || !unit(split[1])) return unresolved("explicit-supported-unit-required");
      if (UNITS[split[1]].dimension !== UNITS[outputUnit].dimension) return unresolved("unit-dimension-mismatch");
      value = numeric(split[0]!);
      if (value) value = rational(value.numerator * BigInt(UNITS[split[1]].baseScale), value.denominator * BigInt(UNITS[outputUnit].baseScale));
    }
    if (!value) return unresolved("exact-decimal-literal-required");
    numbers.push(value);
  }
  let result = numbers[0]!;
  for (let position = 1; position < numbers.length; position++) {
    const current = numbers[position]!, sign = kind === "difference" ? -1n : 1n;
    result = rational(result.numerator * current.denominator + sign * current.numerator * result.denominator, result.denominator * current.denominator);
  }
  return output(index, kind, format(result), outputUnit, evidence, null);
}

/** Invalid outer bounds/cards throw. An unsupported or ambiguous requested
 * operation remains an explicit unresolved row; it is never silently omitted. */
export function runEvolutionFactCardOperations(cardInput: unknown, operationsInput: unknown): readonly EvolutionFactCardOperationResult[] {
  const source = cards(cardInput), operations = array(operationsInput, EVOLUTION_FACT_CARD_OPERATION_POLICY.maximumOperations);
  return Object.freeze(operations.map((value, index) => operation(index, value, source)));
}
