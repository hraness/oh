import { canonicalJson, parseCanonicalInstantV1, utf8ByteLength } from "./canonical";
import type { KnowledgeGraphRecordV1 } from "./graph";
import { searchOhV1, type OhSearchModeV1 } from "./search";
import type { OhSemanticSearchBackend } from "./semantic";
import type { OhSqliteStore } from "./sqlite/store";

/** Recall composes bounded V1 searches; it never widens the 1..100 search limit. */
export const OH_RECALL_LIMITS_V1 = Object.freeze({
  maximumQueries: 6,
  maximumQueryBytes: 16_384,
  maximumLimit: 100,
  maximumRenderedResults: 8_192,
  maximumBudgetBytes: 4_000_000,
  maximumScannedRecords: 65_536,
  rrfConstant: 60,
  v: 1,
});
export const OH_RECALL_RENDERER_V1 = "oh.recall-render.v1" as const;

export type OhRecallWindowV1 = Readonly<{ since: string; until: string; v: 1 }>;
export type OhRecallDiagnosticV1 = Readonly<{
  code: "semantic-unavailable" | "window-unavailable";
  message: string;
  v: 1;
}>;
export type OhRecallRecordViewV1 = Readonly<{
  instant: string | null;
  order: number | null;
  session: string;
  text: string;
}>;
export type OhRecallViewV1 = (record: KnowledgeGraphRecordV1) => OhRecallRecordViewV1;
export type OhRecallEvidenceV1 = Readonly<{
  lane: "query" | "window";
  query: number | null;
  rank: number;
  score: number;
  v: 1;
}>;
export type OhRecallResultV1 = Readonly<{
  evidence: readonly OhRecallEvidenceV1[];
  record: KnowledgeGraphRecordV1;
  score: number;
  v: 1;
}>;
export type OhRecallResponseV1 = Readonly<{
  asOf: string | null;
  diagnostics: readonly OhRecallDiagnosticV1[];
  mode: OhSearchModeV1;
  queries: readonly string[];
  results: readonly OhRecallResultV1[];
  window: OhRecallWindowV1 | null;
  v: 1;
}>;
export type OhRecallRenderingV1 = Readonly<{
  bytes: number;
  keys: readonly string[];
  omitted: number;
  renderer: typeof OH_RECALL_RENDERER_V1;
  text: string;
  v: 1;
}>;
export type OhRecallDateWindowV1 = Readonly<{
  expression: string;
  rule: string;
  since: string;
  until: string;
  v: 1;
}>;

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_MS = 86_400_000;

/**
 * The relative-date grammar is a frozen rule table. Every rule maps one
 * matched expression to a UTC calendar-day window anchored on the question
 * instant. Unknown or ambiguous expressions resolve to nothing; recall never
 * guesses a window. `day` windows name one day at an offset; `around` windows
 * surround the day one unit count away with a symmetric tolerance; `week`,
 * `month`, and `year` windows are whole calendar periods (weeks start on
 * Monday); `weekday` windows name one weekday relative to the question day;
 * `weekend` windows name the Saturday and Sunday of a calendar week; `past`
 * windows run from one unit count before the question day up to that day.
 * When one expression contains another ("in the last month" contains "last
 * month"), only the containing expression counts.
 */
export const OH_RECALL_DATE_GRAMMAR_V1 = Object.freeze({
  id: "oh.recall-date-grammar.v1",
  timeZone: "UTC",
  weekStart: "monday",
  numbers: Object.freeze({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12 }),
  weekdays: WEEKDAY_NAMES,
  rules: Object.freeze([
    { id: "today", pattern: "\\btoday\\b", kind: "day", offset: 0 },
    { id: "yesterday", pattern: "\\byesterday\\b", kind: "day", offset: -1 },
    { id: "tomorrow", pattern: "\\btomorrow\\b", kind: "day", offset: 1 },
    { id: "days-ago", pattern: "\\b(NUMBER) days? ago\\b", kind: "around", unit: "day", sign: -1, toleranceDays: 0 },
    { id: "weeks-ago", pattern: "\\b(NUMBER) weeks? ago\\b", kind: "around", unit: "week", sign: -1, toleranceDays: 3 },
    { id: "months-ago", pattern: "\\b(NUMBER) months? ago\\b", kind: "around", unit: "month", sign: -1, toleranceDays: 15 },
    { id: "years-ago", pattern: "\\b(NUMBER) years? ago\\b", kind: "around", unit: "year", sign: -1, toleranceDays: 45 },
    { id: "in-days", pattern: "\\bin (NUMBER) days?\\b", kind: "around", unit: "day", sign: 1, toleranceDays: 0 },
    { id: "in-weeks", pattern: "\\bin (NUMBER) weeks?\\b", kind: "around", unit: "week", sign: 1, toleranceDays: 3 },
    { id: "in-months", pattern: "\\bin (NUMBER) months?\\b", kind: "around", unit: "month", sign: 1, toleranceDays: 15 },
    { id: "in-years", pattern: "\\bin (NUMBER) years?\\b", kind: "around", unit: "year", sign: 1, toleranceDays: 45 },
    { id: "last-week", pattern: "\\blast week\\b", kind: "week", offset: -1 },
    { id: "this-week", pattern: "\\bthis week\\b", kind: "week", offset: 0 },
    { id: "next-week", pattern: "\\bnext week\\b", kind: "week", offset: 1 },
    { id: "last-month", pattern: "\\blast month\\b", kind: "month", offset: -1 },
    { id: "this-month", pattern: "\\bthis month\\b", kind: "month", offset: 0 },
    { id: "next-month", pattern: "\\bnext month\\b", kind: "month", offset: 1 },
    { id: "last-year", pattern: "\\blast year\\b", kind: "year", offset: -1 },
    { id: "this-year", pattern: "\\bthis year\\b", kind: "year", offset: 0 },
    { id: "next-year", pattern: "\\bnext year\\b", kind: "year", offset: 1 },
    { id: "last-weekend", pattern: "\\blast weekend\\b", kind: "weekend", offset: -1 },
    { id: "this-weekend", pattern: "\\bthis weekend\\b", kind: "weekend", offset: 0 },
    { id: "next-weekend", pattern: "\\bnext weekend\\b", kind: "weekend", offset: 1 },
    { id: "past-span", pattern: "\\b(?:in|over|during|within) the (?:last|past) (?:(NUMBER) )?(UNIT)s?\\b", kind: "past" },
    { id: "last-weekday", pattern: "\\blast (WEEKDAY)\\b", kind: "weekday", offset: -1 },
    { id: "this-weekday", pattern: "\\bthis (WEEKDAY)\\b", kind: "weekday", offset: 0 },
    { id: "next-weekday", pattern: "\\bnext (WEEKDAY)\\b", kind: "weekday", offset: 1 },
  ] as const),
  v: 1,
});
export type OhRecallDateRuleV1 = typeof OH_RECALL_DATE_GRAMMAR_V1.rules[number];

function bounded(value: unknown, maximumBytes: number, label: string): string {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > maximumBytes) {
    throw new TypeError(`Recall ${label} must be nonempty text of at most ${maximumBytes} bytes.`);
  }
  return value;
}
function instantOrNull(value: unknown, label: string): string | null {
  if (value === null) return null;
  const instant = parseCanonicalInstantV1(value);
  if (instant === null) throw new TypeError(`Recall ${label} must be null or a canonical UTC instant.`);
  return instant;
}
function checkedWindow(value: unknown): OhRecallWindowV1 | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("Recall window must be an object.");
  const window = value as Record<string, unknown>;
  const keys = Object.keys(window).sort();
  if (keys.join(",") !== "since,until,v" || window.v !== 1) throw new TypeError("Recall window needs exactly since, until, and v.");
  const since = parseCanonicalInstantV1(window.since), until = parseCanonicalInstantV1(window.until);
  if (since === null || until === null || since > until) throw new TypeError("Recall window needs canonical since <= until.");
  return { since, until, v: 1 };
}
function checkedView(value: unknown): OhRecallViewV1 {
  if (value === undefined) return defaultOhRecallViewV1;
  if (typeof value !== "function") throw new TypeError("Recall view must be a function.");
  return value as OhRecallViewV1;
}
function checkedRecordView(view: OhRecallViewV1, record: KnowledgeGraphRecordV1): OhRecallRecordViewV1 {
  const result: unknown = view(record);
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw new TypeError("Recall view must return an object.");
  const candidate = result as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "instant,order,session,text") {
    throw new TypeError("Recall view needs exactly instant, order, session, and text.");
  }
  const instant = instantOrNull(candidate.instant, "view instant");
  if (candidate.order !== null && !Number.isSafeInteger(candidate.order)) throw new TypeError("Recall view order must be null or an integer.");
  if (typeof candidate.session !== "string" || candidate.session.length === 0 || utf8ByteLength(candidate.session) > 512) {
    throw new TypeError("Recall view session must be nonempty text of at most 512 bytes.");
  }
  if (typeof candidate.text !== "string" || utf8ByteLength(candidate.text) > OH_RECALL_LIMITS_V1.maximumBudgetBytes) {
    throw new TypeError(`Recall view text exceeds ${OH_RECALL_LIMITS_V1.maximumBudgetBytes} bytes.`);
  }
  return { instant, order: candidate.order as number | null, session: candidate.session, text: candidate.text };
}

/**
 * The default view reads a record value's `observedAt` as the canonical
 * instant, `sessionId` as the session, and `text` as the raw text. Any other
 * value renders as its canonical JSON under the record key.
 */
export function defaultOhRecallViewV1(record: KnowledgeGraphRecordV1): OhRecallRecordViewV1 {
  const value = record.value;
  const object = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const observedAt = object === null ? null : parseCanonicalInstantV1(object.observedAt);
  const session = object !== null && typeof object.sessionId === "string" && object.sessionId.length > 0
    && utf8ByteLength(object.sessionId) <= 512 ? object.sessionId : record.key;
  const text = object !== null && typeof object.text === "string" ? object.text : canonicalJson(value);
  return { instant: observedAt, order: null, session, text };
}

type Fused = { evidence: OhRecallEvidenceV1[]; record: KnowledgeGraphRecordV1; score: number };

function compareInstants(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}
function compareOrders(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

/**
 * Fused, bounded recall over `searchOhV1`. Each query runs as one ordinary V1
 * search whose results are already rejoined to the current record digest.
 * Lanes fuse by reciprocal rank, 1 / (60 + rank), over every query and, when
 * a window is given, over the window lane: the current records whose viewed
 * instant lies inside the window, in instant order. The response holds at
 * most (queries + 1) x limit results and never widens any lane past 100.
 */
export async function recallOhV1(input: Readonly<{
  asOf: string | null;
  backend?: OhSemanticSearchBackend;
  limit?: number;
  mode?: OhSearchModeV1;
  queries: readonly string[];
  store: OhSqliteStore;
  view?: OhRecallViewV1;
  window?: OhRecallWindowV1 | null;
}>): Promise<OhRecallResponseV1> {
  if (!Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > OH_RECALL_LIMITS_V1.maximumQueries) {
    throw new RangeError(`Recall needs 1 through ${OH_RECALL_LIMITS_V1.maximumQueries} queries.`);
  }
  const queries = input.queries.map((query) => bounded(query, OH_RECALL_LIMITS_V1.maximumQueryBytes, "query"));
  if (new Set(queries).size !== queries.length) throw new TypeError("Recall queries must be distinct.");
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OH_RECALL_LIMITS_V1.maximumLimit) {
    throw new RangeError(`Recall limit must be 1 through ${OH_RECALL_LIMITS_V1.maximumLimit}.`);
  }
  const mode = input.mode ?? "keyword";
  if (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid") throw new TypeError("Recall mode must be keyword, semantic, or hybrid.");
  const asOf = instantOrNull(input.asOf, "asOf"), window = checkedWindow(input.window), view = checkedView(input.view);
  const fused = new Map<string, Fused>();
  const diagnostics: OhRecallDiagnosticV1[] = [];
  const add = (record: KnowledgeGraphRecordV1, evidence: OhRecallEvidenceV1): void => {
    const current = fused.get(record.key) ?? { evidence: [], record, score: 0 };
    current.evidence.push(evidence);
    current.score += 1 / (OH_RECALL_LIMITS_V1.rrfConstant + evidence.rank);
    fused.set(record.key, current);
  };
  for (const [index, query] of queries.entries()) {
    const response = await searchOhV1({ ...(input.backend === undefined ? {} : { backend: input.backend }), limit, mode, query, store: input.store });
    diagnostics.push(...response.diagnostics);
    response.results.forEach((result, position) => {
      add(result.record, { lane: "query", query: index, rank: position + 1, score: result.score, v: 1 });
    });
  }
  if (window !== null) {
    let scanned: readonly KnowledgeGraphRecordV1[] = [];
    try { scanned = input.store.snapshotRecords(OH_RECALL_LIMITS_V1.maximumScannedRecords); }
    catch (error) {
      diagnostics.push({ code: "window-unavailable",
        message: error instanceof Error ? error.message : "The window lane could not scan the current records.", v: 1 });
    }
    const dated = scanned.flatMap((record) => {
      const viewed = checkedRecordView(view, record);
      return viewed.instant !== null && viewed.instant >= window.since && viewed.instant <= window.until ? [{ record, viewed }] : [];
    }).sort((left, right) => compareInstants(left.viewed.instant, right.viewed.instant)
      || compareOrders(left.viewed.order, right.viewed.order) || left.record.key.localeCompare(right.record.key));
    dated.slice(0, limit).forEach((entry, position) => {
      const rank = position + 1;
      add(entry.record, { lane: "window", query: null, rank, score: 1 / (OH_RECALL_LIMITS_V1.rrfConstant + rank), v: 1 });
    });
  }
  const results = [...fused.entries()]
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .map(([, entry]): OhRecallResultV1 => ({ evidence: entry.evidence, record: entry.record, score: entry.score, v: 1 }));
  return { asOf, diagnostics, mode, queries, results, window, v: 1 };
}

function dayNumber(instant: string): number { return Math.floor(Date.parse(instant) / DAY_MS); }
function dayStart(day: number): string { return new Date(day * DAY_MS).toISOString(); }
function dayEnd(day: number): string { return new Date(day * DAY_MS + DAY_MS - 1).toISOString(); }
function weekdayOf(day: number): number { return new Date(day * DAY_MS).getUTCDay(); }
function mondayOf(day: number): number { return day - ((weekdayOf(day) + 6) % 7); }
function formatDay(day: number): string {
  const date = new Date(day * DAY_MS);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} (${WEEKDAY_LABELS[date.getUTCDay()]})`;
}
/** Calendar arithmetic in whole units; a day past the end of the target month clamps to its last day. */
function shiftDay(day: number, unit: "day" | "week" | "month" | "year", count: number): number {
  if (unit === "day") return day + count;
  if (unit === "week") return day + count * 7;
  const date = new Date(day * DAY_MS);
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + (unit === "month" ? count : 12 * count);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)) / DAY_MS);
}
function windowFor(rule: OhRecallDateRuleV1, count: number, weekday: number | null, unit: string | null, asOfDay: number): readonly [number, number] {
  const date = new Date(asOfDay * DAY_MS), year = date.getUTCFullYear(), month = date.getUTCMonth();
  switch (rule.kind) {
    case "day": return [asOfDay + rule.offset, asOfDay + rule.offset];
    case "around": {
      const target = shiftDay(asOfDay, rule.unit, rule.sign * count);
      return [target - rule.toleranceDays, target + rule.toleranceDays];
    }
    case "week": { const monday = mondayOf(asOfDay) + rule.offset * 7; return [monday, monday + 6]; }
    case "month": return [Math.floor(Date.UTC(year, month + rule.offset, 1) / DAY_MS), Math.floor(Date.UTC(year, month + rule.offset + 1, 0) / DAY_MS)];
    case "year": return [Math.floor(Date.UTC(year + rule.offset, 0, 1) / DAY_MS), Math.floor(Date.UTC(year + rule.offset, 11, 31) / DAY_MS)];
    case "weekend": { const saturday = mondayOf(asOfDay) + rule.offset * 7 + 5; return [saturday, saturday + 1]; }
    case "past": return [shiftDay(asOfDay, unit as "day" | "week" | "month" | "year", -count), asOfDay];
    case "weekday": {
      const target = weekday as number, current = weekdayOf(asOfDay);
      if (rule.offset < 0) { const back = (current - target + 7) % 7 || 7; return [asOfDay - back, asOfDay - back]; }
      if (rule.offset > 0) { const forward = (target - current + 7) % 7 || 7; return [asOfDay + forward, asOfDay + forward]; }
      const day = mondayOf(asOfDay) + ((target + 6) % 7);
      return [day, day];
    }
  }
}

/**
 * Pure, rule-based resolution of one relative date expression against the
 * question instant. Returns `null` for no match and for more than one distinct
 * match; the grammar table above is the complete vocabulary.
 */
export function resolveRelativeDateWindowV1(query: string, asOf: string): OhRecallDateWindowV1 | null {
  const text = bounded(query, OH_RECALL_LIMITS_V1.maximumQueryBytes, "query").normalize("NFC").toLowerCase();
  const asOfInstant = parseCanonicalInstantV1(asOf);
  if (asOfInstant === null) throw new TypeError("Recall asOf must be a canonical UTC instant.");
  const numbers = OH_RECALL_DATE_GRAMMAR_V1.numbers as Readonly<Record<string, number>>;
  const numberPattern = `(\\d{1,3}|${Object.keys(numbers).join("|")})`;
  const weekdayPattern = `(${WEEKDAY_NAMES.join("|")})`, unitPattern = "(day|week|month|year)";
  type Match = { expression: string; rule: OhRecallDateRuleV1; count: number; weekday: number | null; unit: string | null; start: number; end: number };
  const found: Match[] = [];
  for (const rule of OH_RECALL_DATE_GRAMMAR_V1.rules) {
    const source = rule.pattern.replace("(NUMBER)", numberPattern).replace("(WEEKDAY)", weekdayPattern).replace("(UNIT)", unitPattern);
    for (const match of text.matchAll(new RegExp(source, "gu"))) {
      const capture = match[1] ?? "";
      let count = 0, weekday: number | null = null, unit: string | null = null;
      if (rule.kind === "weekday") weekday = WEEKDAY_NAMES.indexOf(capture as typeof WEEKDAY_NAMES[number]);
      else if (rule.kind === "around" || rule.kind === "past") {
        count = capture.length === 0 && rule.kind === "past" ? 1 : /^\d+$/u.test(capture) ? Number(capture) : numbers[capture] ?? 0;
        if (count < 1) continue;
        if (rule.kind === "past") unit = match[2] ?? null;
      }
      const start = match.index ?? 0;
      found.push({ expression: match[0], rule, count, weekday, unit, start, end: start + match[0].length });
    }
  }
  // A shorter expression inside a longer match ("last month" inside "in the last month") is not a second reading.
  const outer = found.filter((item) => !found.some((other) => other !== item && other.start <= item.start && other.end >= item.end
    && other.end - other.start > item.end - item.start));
  const distinct = new Map(outer.map((item) => [`${item.rule.id}:${item.count}:${item.weekday ?? ""}:${item.unit ?? ""}`, item]));
  if (distinct.size !== 1) return null;
  const [{ expression, rule, count, weekday, unit }] = [...distinct.values()] as [Match];
  const [first, last] = windowFor(rule, count, weekday, unit, dayNumber(asOfInstant));
  return { expression, rule: rule.id, since: dayStart(first), until: dayEnd(last), v: 1 };
}

function offsetLabel(days: number): string {
  if (days === 0) return "the day of the question";
  const count = Math.abs(days), unit = count === 1 ? "day" : "days";
  return `${count} ${unit} ${days < 0 ? "before" : "after"} the question`;
}
function gapMarker(days: number): string {
  if (days < 14) return `[${days} ${days === 1 ? "day" : "days"} later]`;
  if (days < 61) { const weeks = Math.floor(days / 7); return `[${weeks} ${weeks === 1 ? "week" : "weeks"} later]`; }
  if (days < 365) { const months = Math.floor(days / 30); return `[${months} ${months === 1 ? "month" : "months"} later]`; }
  const years = Math.floor(days / 365);
  return `[${years} ${years === 1 ? "year" : "years"} later]`;
}

type Viewed = Readonly<{ index: number; key: string; view: OhRecallRecordViewV1 }>;
type Layout = Readonly<{ blocks: readonly string[]; keys: readonly string[] }>;

function compose(selected: readonly Viewed[], asOf: string | null): Layout {
  if (asOf === null) return { blocks: selected.map((item) => item.view.text), keys: selected.map((item) => item.key) };
  const sessions = new Map<string, Viewed[]>();
  for (const item of selected) {
    const members = sessions.get(item.view.session);
    if (members === undefined) sessions.set(item.view.session, [item]); else members.push(item);
  }
  const compareMembers = (left: Viewed, right: Viewed): number => compareInstants(left.view.instant, right.view.instant)
    || compareOrders(left.view.order, right.view.order) || left.index - right.index;
  const grouped = [...sessions.entries()].map(([session, members]) => {
    const sorted = [...members].sort(compareMembers);
    return { instant: sorted[0]?.view.instant ?? null, members: sorted, session };
  });
  const dated = grouped.filter((group) => group.instant !== null)
    .sort((left, right) => compareInstants(left.instant, right.instant) || left.session.localeCompare(right.session));
  const undated = grouped.filter((group) => group.instant === null);
  const asOfDay = dayNumber(asOf);
  const blocks: string[] = [`Question date: ${formatDay(asOfDay)}`], keys: string[] = [];
  let previousDay: number | null = null;
  for (const group of dated) {
    const day = dayNumber(group.instant as string);
    if (previousDay !== null && day - previousDay >= 1) blocks.push(gapMarker(day - previousDay));
    previousDay = day;
    blocks.push(`Date: ${formatDay(day)}, ${offsetLabel(day - asOfDay)}\n${group.members.map((item) => item.view.text).join("\n\n")}`);
    keys.push(...group.members.map((item) => item.key));
  }
  for (const group of undated) {
    blocks.push(`Date: unknown\n${group.members.map((item) => item.view.text).join("\n\n")}`);
    keys.push(...group.members.map((item) => item.key));
  }
  return { blocks, keys };
}
function composedBytes(blocks: readonly string[]): number {
  let bytes = 0;
  for (const [index, block] of blocks.entries()) bytes += utf8ByteLength(block) + (index === 0 ? 0 : 2);
  return bytes;
}

/**
 * Chronological rendering with question-relative session headers, gap
 * markers, and a UTF-8 byte budget. Results are admitted in their given
 * (fused rank) order; a result whose admission would exceed the budget is
 * omitted while later, smaller results may still fit. Record text is never
 * altered. Without a question instant the text is the plain rank-ordered list.
 */
export function renderOhRecallV1(input: Readonly<{ results: readonly Readonly<{ record: KnowledgeGraphRecordV1 }>[] }>,
  options: Readonly<{ asOf: string | null; budgetBytes: number; view?: OhRecallViewV1 }>): OhRecallRenderingV1 {
  if (!Array.isArray(input.results) || input.results.length > OH_RECALL_LIMITS_V1.maximumRenderedResults) {
    throw new RangeError(`Recall rendering accepts at most ${OH_RECALL_LIMITS_V1.maximumRenderedResults} results.`);
  }
  const asOf = instantOrNull(options.asOf, "asOf"), view = checkedView(options.view), budget = options.budgetBytes;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > OH_RECALL_LIMITS_V1.maximumBudgetBytes) {
    throw new RangeError(`Recall budget must be 1 through ${OH_RECALL_LIMITS_V1.maximumBudgetBytes} bytes.`);
  }
  const seen = new Set<string>(), selected: Viewed[] = [];
  let omitted = 0, layout: Layout = compose([], asOf);
  for (const [index, result] of input.results.entries()) {
    const record = result.record;
    if (typeof record !== "object" || record === null || typeof record.key !== "string") throw new TypeError("Recall rendering needs records.");
    if (seen.has(record.key)) continue;
    seen.add(record.key);
    const candidate: Viewed = { index, key: record.key, view: checkedRecordView(view, record) };
    const attempt = compose([...selected, candidate], asOf);
    if (composedBytes(attempt.blocks) > budget) { omitted += 1; continue; }
    selected.push(candidate); layout = attempt;
  }
  const text = selected.length === 0 ? "" : layout.blocks.join("\n\n");
  return { bytes: utf8ByteLength(text), keys: layout.keys, omitted, renderer: OH_RECALL_RENDERER_V1, text, v: 1 };
}
