import { canonicalJson, canonicalSha256, isPlainRecord } from "../../src/canonical";

export const FRAMEWORK_PILOT_SOURCE_V1 = "oh.framework-pilot-source.v1" as const;
export const FRAMEWORK_PILOT_SPLIT_PLAN_V1 = "oh.framework-pilot-split-plan.v1" as const;
export const FRAMEWORK_PILOT_SOURCE_UNITS_V1 = "oh.framework-pilot-source-units.v1" as const;
export const FRAMEWORK_PILOT_SOURCE_LIMITS_V1 = Object.freeze({
  maximumSessions: 1_000, maximumTurns: 8_192, maximumTurnBytes: 524_288,
  maximumDateBytes: 256, maximumRoleBytes: 512, maximumSourceBytes: 32 * 1024 * 1024,
  maximumSpansPerTurn: 1_024, maximumUnits: 32_768, maximumPlanBytes: 4 * 1024 * 1024,
  maximumBundleBytes: 64 * 1024 * 1024,
});

export type FrameworkPilotSourceV1 = Readonly<{
  protocol: typeof FRAMEWORK_PILOT_SOURCE_V1;
  sessions: readonly Readonly<{ sessionId: string; sessionIndex: number; date: string;
    turns: readonly Readonly<{ role: string; text: string }>[] }>[];
}>;
export type FrameworkPilotSplitPlanV1 = Readonly<{
  protocol: typeof FRAMEWORK_PILOT_SPLIT_PLAN_V1; sourceSha256: string;
  turns: readonly Readonly<{ turnId: string;
    spans: readonly Readonly<{ startByte: number; endByte: number }>[] }>[];
}>;
export type FrameworkPilotSourceUnitV1 = Readonly<{
  unitId: string; turnId: string; sessionId: string; sessionIndex: number; turnIndex: number; partIndex: number;
  startByte: number; endByte: number; date: string; role: string; text: string; unitSha256: string;
}>;
export type FrameworkPilotSourceOccurrenceV1 = Readonly<{
  sessionId: string; sessionIndex: number; date: string; turnCount: number;
}>;
export type FrameworkPilotSourceUnitsV1 = Readonly<{
  protocol: typeof FRAMEWORK_PILOT_SOURCE_UNITS_V1; sourceSha256: string; splitPlanSha256: string;
  sessionCount: number; sessionClassCount: number; turnCount: number; unitCount: number; sourceTextBytes: number;
  occurrences: readonly FrameworkPilotSourceOccurrenceV1[];
  units: readonly FrameworkPilotSourceUnitV1[]; bundleSha256: string;
}>;

const limits = FRAMEWORK_PILOT_SOURCE_LIMITS_V1;
function fail(reason: string): never { throw new TypeError(`Framework pilot source: ${reason}.`); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("plain record required");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) fail("unknown or missing field");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("enumerable data fields required");
    result[key] = descriptor.value;
  }
  return result;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail("array item limit exceeded or invalid array");
  if (Reflect.ownKeys(value).length !== value.length + 1) fail("dense array without extra fields required");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("dense array data items required");
    result.push(descriptor.value);
  }
  return result;
}
function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= maximum;
}
function text(value: unknown, maximum: number, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum
    || Buffer.byteLength(value) > maximum || /\p{Surrogate}/u.test(value)) fail("invalid bounded Unicode text");
  return value;
}
function bytes(value: unknown): number { return Buffer.byteLength(canonicalJson(value)); }
function boundedBytes(count: number, maximum: number): void { if (count > maximum) fail("canonical byte limit exceeded"); }
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function turnId(sessionId: string, sessionIndex: number, turnIndex: number): string { return `${sessionId}#${sessionIndex}:${turnIndex}`; }

/** Parse an explicit answer-blind projection, never a Corpus or a dataset row.
 * Array order is source order; this layer neither sorts dates nor restores omitted sessions.
 * Empty sessions/text are preserved, but at least one session and one turn are required. */
export function parseFrameworkPilotSourceV1(input: unknown): FrameworkPilotSourceV1 {
  const value = exact(input, ["protocol", "sessions"]);
  if (value.protocol !== FRAMEWORK_PILOT_SOURCE_V1) fail("source protocol mismatch");
  const inputSessions = array(value.sessions, limits.maximumSessions);
  if (inputSessions.length === 0) fail("at least one session required");
  const sessions: FrameworkPilotSourceV1["sessions"][number][] = [], classes = new Set<string>();
  let turnCount = 0, sourceBytes = bytes({ protocol: FRAMEWORK_PILOT_SOURCE_V1, sessions: [] });
  for (const [sessionIndex, raw] of inputSessions.entries()) {
    const session = exact(raw, ["sessionId", "sessionIndex", "date", "turns"]);
    const sessionId = text(session.sessionId, 5, false), date = text(session.date, limits.maximumDateBytes);
    if (!/^s[0-9]{4}$/u.test(sessionId) || !integer(session.sessionIndex, limits.maximumSessions - 1)
      || session.sessionIndex !== sessionIndex) fail("neutral session alias or occurrence order invalid");
    if (!classes.has(sessionId)) {
      if (sessionId !== `s${String(classes.size + 1).padStart(4, "0")}`) fail("session aliases must follow first occurrence");
      classes.add(sessionId);
    }
    const inputTurns = array(session.turns, limits.maximumTurns);
    turnCount += inputTurns.length;
    if (turnCount > limits.maximumTurns) fail("total turn limit exceeded");
    sourceBytes += bytes({ sessionId, sessionIndex, date, turns: [] }) + (sessionIndex > 0 ? 1 : 0);
    boundedBytes(sourceBytes, limits.maximumSourceBytes);
    const turns: { role: string; text: string }[] = [];
    for (const [index, rawTurn] of inputTurns.entries()) {
      const turn = exact(rawTurn, ["role", "text"]);
      const projected = { role: text(turn.role, limits.maximumRoleBytes, false), text: text(turn.text, limits.maximumTurnBytes) };
      sourceBytes += bytes(projected) + (index > 0 ? 1 : 0);
      boundedBytes(sourceBytes, limits.maximumSourceBytes);
      turns.push(projected);
    }
    sessions.push({ sessionId, sessionIndex, date, turns });
  }
  if (turnCount === 0) fail("at least one turn required");
  return immutable({ protocol: FRAMEWORK_PILOT_SOURCE_V1, sessions });
}

function splitPlan(input: unknown, source: FrameworkPilotSourceV1): FrameworkPilotSplitPlanV1 {
  const value = exact(input, ["protocol", "sourceSha256", "turns"]), sourceSha256 = canonicalSha256(source);
  if (value.protocol !== FRAMEWORK_PILOT_SPLIT_PLAN_V1 || value.sourceSha256 !== sourceSha256) fail("split plan source binding mismatch");
  const inputTurns = array(value.turns, limits.maximumTurns);
  if (inputTurns.length !== source.sessions.reduce((count, session) => count + session.turns.length, 0)) fail("split plan must cover every turn");
  const turns: FrameworkPilotSplitPlanV1["turns"][number][] = [];
  let ordinal = 0, unitCount = 0, planBytes = bytes({ protocol: FRAMEWORK_PILOT_SPLIT_PLAN_V1, sourceSha256, turns: [] });
  for (const session of source.sessions) for (const [turnIndex, sourceTurn] of session.turns.entries()) {
    const row = exact(inputTurns[ordinal], ["turnId", "spans"]);
    const id = turnId(session.sessionId, session.sessionIndex, turnIndex);
    if (row.turnId !== id) fail("split plan turn membership or order mismatch");
    const inputSpans = array(row.spans, limits.maximumSpansPerTurn), encoded = Buffer.from(sourceTurn.text);
    unitCount += inputSpans.length;
    if (inputSpans.length === 0 || unitCount > limits.maximumUnits) fail("invalid total span count");
    if (encoded.length === 0 && inputSpans.length !== 1) fail("empty turn requires one empty span");
    planBytes += bytes({ turnId: id, spans: [] }) + (ordinal > 0 ? 1 : 0);
    boundedBytes(planBytes, limits.maximumPlanBytes);
    const spans: { startByte: number; endByte: number }[] = [];
    let cursor = 0;
    for (const [partIndex, rawSpan] of inputSpans.entries()) {
      const span = exact(rawSpan, ["startByte", "endByte"]);
      if (!integer(span.startByte, encoded.length) || !integer(span.endByte, encoded.length)
        || span.startByte !== cursor || (encoded.length === 0 ? span.endByte !== 0 : span.endByte <= cursor)
        || span.endByte < encoded.length && (encoded[span.endByte]! & 0xc0) === 0x80) fail("span gap, overlap, order or UTF-8 boundary invalid");
      const checked = { startByte: span.startByte, endByte: span.endByte };
      planBytes += bytes(checked) + (partIndex > 0 ? 1 : 0);
      boundedBytes(planBytes, limits.maximumPlanBytes);
      spans.push(checked); cursor = checked.endByte;
    }
    if (cursor !== encoded.length) fail("split plan omits source text");
    turns.push({ turnId: id, spans }); ordinal++;
  }
  return immutable({ protocol: FRAMEWORK_PILOT_SPLIT_PLAN_V1, sourceSha256, turns });
}

/** Apply an explicit, complete split plan. These byte spans establish no tokenizer,
 * model-context or serialized provider-request fit, and authenticate only the supplied projection. */
export function createFrameworkPilotSourceUnitsV1(sourceInput: unknown, planInput: unknown): FrameworkPilotSourceUnitsV1 {
  const source = parseFrameworkPilotSourceV1(sourceInput), plan = splitPlan(planInput, source);
  const metadata = { protocol: FRAMEWORK_PILOT_SOURCE_UNITS_V1, sourceSha256: plan.sourceSha256,
    splitPlanSha256: canonicalSha256(plan), sessionCount: source.sessions.length,
    sessionClassCount: new Set(source.sessions.map(session => session.sessionId)).size,
    turnCount: plan.turns.length, unitCount: plan.turns.reduce((count, turn) => count + turn.spans.length, 0),
    sourceTextBytes: source.sessions.reduce((count, session) => count + session.turns.reduce((sum, turn) => sum + Buffer.byteLength(turn.text), 0), 0),
    occurrences: source.sessions.map(session => ({ sessionId: session.sessionId, sessionIndex: session.sessionIndex,
      date: session.date, turnCount: session.turns.length })) };
  const units: FrameworkPilotSourceUnitV1[] = [];
  let ordinal = 0, bundleBytes = bytes({ ...metadata, units: [], bundleSha256: "0".repeat(64) });
  for (const session of source.sessions) for (const [turnIndex, turn] of session.turns.entries()) {
    const row = plan.turns[ordinal++]!, encoded = Buffer.from(turn.text);
    for (const [partIndex, span] of row.spans.entries()) {
      const payload = { unitId: `u${String(units.length + 1).padStart(6, "0")}`, turnId: row.turnId,
        sessionId: session.sessionId, sessionIndex: session.sessionIndex, turnIndex, partIndex,
        startByte: span.startByte, endByte: span.endByte, date: session.date, role: turn.role,
        text: encoded.subarray(span.startByte, span.endByte).toString("utf8") };
      const unit = { ...payload, unitSha256: canonicalSha256(payload) };
      bundleBytes += bytes(unit) + (units.length > 0 ? 1 : 0);
      boundedBytes(bundleBytes, limits.maximumBundleBytes);
      units.push(unit);
    }
  }
  const payload = { ...metadata, units };
  return immutable({ ...payload, bundleSha256: canonicalSha256(payload) });
}

/** Recompute from the admitted source and plan, so rehashing an altered bundle cannot
 * authenticate fabricated metadata, omitted units or a different source occurrence. */
export function validateFrameworkPilotSourceUnitsV1(value: unknown, sourceInput: unknown, planInput: unknown): FrameworkPilotSourceUnitsV1 {
  const expected = createFrameworkPilotSourceUnitsV1(sourceInput, planInput), candidate = exact(value, Object.keys(expected));
  for (const [key, field] of Object.entries(expected)) {
    if (key !== "units" && key !== "occurrences" && candidate[key] !== field) fail("source unit bundle metadata mismatch");
  }
  for (const [name, maximum] of [["units", limits.maximumUnits], ["occurrences", limits.maximumSessions]] as const) {
    const rows = array(candidate[name], maximum);
    if (rows.length !== expected[name].length) fail("source unit bundle count mismatch");
    for (const [index, row] of expected[name].entries()) {
      const current = exact(rows[index], Object.keys(row));
      for (const [key, field] of Object.entries(row)) if (current[key] !== field) fail("source unit bundle content or provenance mismatch");
    }
  }
  return expected;
}
