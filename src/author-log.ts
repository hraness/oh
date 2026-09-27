import { canonicalJson, parseCanonicalInstantV1, utf8ByteLength } from "./canonical";
import { OH_GRAPH_LIMITS_V1, type KnowledgeGraphRecordV1 } from "./graph";
import {
  compareInstants, compareKeys, compareOrders, dayNumber, formatDay, instantOrNull, offsetLabel,
  OH_RECALL_DATE_GRAMMAR_V1, OH_RECALL_LIMITS_V1, resolveRelativeDatesV1, resolveRelativeDateWindowV1,
  type OhRecallDateWindowV1,
} from "./recall";

/**
 * Opt-in memory configurations built on recall. The author log shows every
 * message one author wrote, in order, beside fused retrieval of everything
 * else; the session zoom shows whole sessions for a second reading after a
 * reader declines. Both are pure, deterministic, and make no model calls.
 */
export const OH_AUTHOR_LOG_RENDERER_V1 = "oh.recall-render.author-log.v1" as const;
export const OH_SESSION_ZOOM_RENDERER_V1 = "oh.recall-render.session-zoom.v1" as const;
export const OH_AUTHOR_LOG_LIMITS_V1 = Object.freeze({
  defaultAuthor: "user",
  defaultBudgetBytes: 180_000,
  defaultRetrievedBytes: 96_000,
  defaultLogReserveBytes: 24_000,
  defaultZoomBudgetBytes: 100_000,
  defaultZoomMessageChars: 12_000,
  maximumAuthorBytes: 64,
  maximumRecords: OH_GRAPH_LIMITS_V1.recordsPerSnapshot,
  zoomDateSessions: 4,
  zoomLexicalSessions: 3,
  zoomPadDays: 3,
  v: 1,
});

/** A neutral description of the author-log layout for a reader instruction. It contains no examples. */
export const OH_AUTHOR_LOG_READER_NOTE_V1 = "The memory has two parts. First, the log of the user's own messages from the "
  + "conversation history, verbatim, in chronological order and grouped by session; each session header gives the session "
  + "date and its distance from the question date. The log is complete unless its heading says it is partial. Lines "
  + "beginning with \"Resolved dates\" give absolute dates that the system computed from that message's own date for the "
  + "relative time expressions in it; ≈ marks an approximate date. Second, other messages retrieved for the question, "
  + "verbatim, which are only a subset of the history; each names the user message it follows. Use the log to find, list "
  + "and count what the user said and did across sessions and to find the latest state of anything that changed; use the "
  + "retrieved messages for what others said. If the memory notes that every session has the same timestamp, date and "
  + "order events by the dates and tense stated inside the messages. Treat a question as unanswerable only when neither "
  + "part contains the asked-about fact or event.";
/** A neutral description of the session-zoom layout for a second reading. It contains no examples. */
export const OH_SESSION_ZOOM_READER_NOTE_V1 = "The memory contains the complete text of the sessions of the conversation "
  + "history most relevant to the question, every message verbatim and in chronological order, including sessions dated "
  + "near any time the question refers to; other sessions are not shown. Read every message, including details mentioned "
  + "in passing and earlier replies. If these sessions contain the asked-about fact or event, answer from them. If the "
  + "question assumes something that the sessions contradict, say what the sessions record instead of answering as if "
  + "the assumption were true.";

export type OhAuthorLogRecordViewV1 = Readonly<{
  instant: string | null;
  order: number | null;
  session: string;
  speaker: string | null;
  text: string;
}>;
export type OhAuthorLogViewV1 = (record: KnowledgeGraphRecordV1) => OhAuthorLogRecordViewV1;
export type OhAuthorLogRenderingV1 = Readonly<{
  bytes: number;
  keys: readonly string[];
  log: Readonly<{ bytes: number; included: number; mode: "complete" | "ranked"; total: number }>;
  renderer: typeof OH_AUTHOR_LOG_RENDERER_V1;
  retrieved: Readonly<{ bytes: number; included: number; omitted: number }>;
  sharedTimestamp: boolean;
  text: string;
  v: 1;
}>;
export type OhSessionZoomRenderingV1 = Readonly<{
  bytes: number;
  keys: readonly string[];
  renderer: typeof OH_SESSION_ZOOM_RENDERER_V1;
  sessions: readonly string[];
  text: string;
  window: OhRecallDateWindowV1 | null;
  v: 1;
}>;
type RankedInput = readonly Readonly<{ record: KnowledgeGraphRecordV1 }>[];

function objectValue(record: KnowledgeGraphRecordV1): Record<string, unknown> | null {
  const value = record.value;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function dateInstant(value: unknown): string | null {
  const instant = parseCanonicalInstantV1(value);
  if (instant !== null) return instant;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  return parseCanonicalInstantV1(`${value}T00:00:00.000Z`);
}

/**
 * Reads `observedAt` (or a canonical instant or `YYYY-MM-DD` in `date`) as the
 * instant, `sessionId` as the session, `sessionIndex` or `turnIndex` as the
 * order within it, `speaker` or `role` as the speaker, and `text` as the text.
 * Observed turn records and recall records both fit. Any other value renders
 * as canonical JSON under its own key with no speaker.
 */
export function defaultOhAuthorLogViewV1(record: KnowledgeGraphRecordV1): OhAuthorLogRecordViewV1 {
  const object = objectValue(record);
  if (object === null) return { instant: null, order: null, session: record.key, speaker: null, text: canonicalJson(record.value) };
  const instant = parseCanonicalInstantV1(object.observedAt) ?? dateInstant(object.date);
  const session = typeof object.sessionId === "string" && object.sessionId.length > 0 && utf8ByteLength(object.sessionId) <= 512
    ? object.sessionId : record.key;
  const orderValue = object.sessionIndex ?? object.turnIndex;
  const order = Number.isSafeInteger(orderValue) ? orderValue as number : null;
  const speakerValue = object.speaker ?? object.role;
  const speaker = typeof speakerValue === "string" && speakerValue.length > 0
    && utf8ByteLength(speakerValue) <= OH_AUTHOR_LOG_LIMITS_V1.maximumAuthorBytes ? speakerValue : null;
  const text = typeof object.text === "string" ? object.text : canonicalJson(record.value);
  return { instant, order, session, speaker, text };
}

type Viewed = Readonly<{ key: string; view: OhAuthorLogRecordViewV1 }>;

function checkedView(view: OhAuthorLogViewV1, record: KnowledgeGraphRecordV1): Viewed {
  if (typeof record !== "object" || record === null || typeof record.key !== "string") throw new TypeError("Author log needs records.");
  const result: unknown = view(record);
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw new TypeError("Author log view must return an object.");
  const candidate = result as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "instant,order,session,speaker,text") {
    throw new TypeError("Author log view needs exactly instant, order, session, speaker, and text.");
  }
  const instant = instantOrNull(candidate.instant, "view instant");
  if (candidate.order !== null && !Number.isSafeInteger(candidate.order)) throw new TypeError("Author log view order must be null or an integer.");
  if (typeof candidate.session !== "string" || candidate.session.length === 0 || utf8ByteLength(candidate.session) > 512) {
    throw new TypeError("Author log view session must be nonempty text of at most 512 bytes.");
  }
  if (candidate.speaker !== null && (typeof candidate.speaker !== "string" || candidate.speaker.length === 0
    || utf8ByteLength(candidate.speaker) > OH_AUTHOR_LOG_LIMITS_V1.maximumAuthorBytes)) {
    throw new TypeError(`Author log view speaker must be null or nonempty text of at most ${OH_AUTHOR_LOG_LIMITS_V1.maximumAuthorBytes} bytes.`);
  }
  if (typeof candidate.text !== "string" || utf8ByteLength(candidate.text) > OH_RECALL_LIMITS_V1.maximumBudgetBytes) {
    throw new TypeError(`Author log view text exceeds ${OH_RECALL_LIMITS_V1.maximumBudgetBytes} bytes.`);
  }
  return { key: record.key, view: { instant, order: candidate.order as number | null, session: candidate.session,
    speaker: candidate.speaker as string | null, text: candidate.text } };
}
function checkedBytes(value: unknown, fallback: number, label: string, minimum = 1): number {
  const bytes = value ?? fallback;
  if (!Number.isSafeInteger(bytes) || (bytes as number) < minimum || (bytes as number) > OH_RECALL_LIMITS_V1.maximumBudgetBytes) {
    throw new RangeError(`Author log ${label} must be ${minimum} through ${OH_RECALL_LIMITS_V1.maximumBudgetBytes} bytes.`);
  }
  return bytes as number;
}
function checkedRecords(value: unknown, label: string): readonly KnowledgeGraphRecordV1[] {
  if (!Array.isArray(value) || value.length > OH_AUTHOR_LOG_LIMITS_V1.maximumRecords) {
    throw new RangeError(`Author log ${label} accepts at most ${OH_AUTHOR_LOG_LIMITS_V1.maximumRecords} records.`);
  }
  return value as readonly KnowledgeGraphRecordV1[];
}
function checkedRanked(value: unknown): readonly KnowledgeGraphRecordV1[] {
  if (!Array.isArray(value) || value.length > OH_RECALL_LIMITS_V1.maximumRenderedResults) {
    throw new RangeError(`Author log ranking accepts at most ${OH_RECALL_LIMITS_V1.maximumRenderedResults} results.`);
  }
  return (value as RankedInput).map((result) => result.record);
}
function compareViewed(left: Viewed, right: Viewed): number {
  return compareInstants(left.view.instant, right.view.instant) || compareOrders(left.view.order, right.view.order)
    || compareKeys(left.key, right.key);
}

type Session = Readonly<{ day: number | null; id: string; members: readonly Viewed[] }>;
/** Sessions in chronological order of their first dated member; undated sessions follow in key order. */
function sessionsOf(viewed: readonly Viewed[]): readonly Session[] {
  const groups = new Map<string, Viewed[]>();
  for (const item of viewed) {
    const members = groups.get(item.view.session);
    if (members === undefined) groups.set(item.view.session, [item]); else members.push(item);
  }
  return [...groups.entries()].map(([id, members]) => {
    const sorted = [...members].sort(compareViewed);
    const first = sorted.find((item) => item.view.instant !== null);
    return { day: first === undefined ? null : dayNumber(first.view.instant as string), id, members: sorted };
  }).sort((left, right) => (left.day ?? Infinity) - (right.day ?? Infinity) || compareKeys(left.id, right.id));
}
function sessionHeader(session: Session, asOfDay: number | null): string {
  if (session.day === null) return `## Session ${session.id}: date unknown`;
  return `## Session ${session.id}: ${formatDay(session.day)}${asOfDay === null ? "" : `, ${offsetLabel(session.day - asOfDay)}`}`;
}
function dateLabel(day: number, asOfDay: number | null): string {
  return `${formatDay(day)}${asOfDay === null ? "" : `, ${offsetLabel(day - asOfDay)}`}`;
}
const RULE_KINDS = new Map<string, string>(OH_RECALL_DATE_GRAMMAR_V1.rules.map((rule) => [rule.id, rule.kind]));
/** One annotation per resolved expression; an `around` window renders as its approximate centre day. */
function resolvedLine(item: Viewed, asOfDay: number | null): string | null {
  if (item.view.instant === null) return null;
  const windows = resolveRelativeDatesV1(item.view.text, item.view.instant);
  if (windows.length === 0) return null;
  const parts = windows.map((window) => {
    const first = dayNumber(window.since), last = dayNumber(window.until);
    if (first === last) return `"${window.expression}" = ${dateLabel(first, asOfDay)}`;
    if (RULE_KINDS.get(window.rule) === "around") return `"${window.expression}" ≈ ${dateLabel(Math.round((first + last) / 2), asOfDay)}`;
    return `"${window.expression}" = ${formatDay(first)} to ${formatDay(last)}${asOfDay === null ? "" : `, ending ${offsetLabel(last - asOfDay)}`}`;
  });
  return `Resolved dates (from this message's date ${formatDay(dayNumber(item.view.instant))}): ${parts.join("; ")}`;
}
function authorEntry(item: Viewed, author: string, asOfDay: number | null): string {
  const resolved = resolvedLine(item, asOfDay);
  return `[${item.key}] ${author}: ${item.view.text}${resolved === null ? "" : `\n${resolved}`}`;
}
function logText(heading: string, sessions: readonly Session[], entries: ReadonlyMap<string, string>, asOfDay: number | null): string {
  const blocks = sessions.flatMap((session) => {
    const lines = session.members.flatMap((item) => entries.has(item.key) ? [entries.get(item.key) as string] : []);
    return lines.length === 0 ? [] : [`${sessionHeader(session, asOfDay)}\n${lines.join("\n")}`];
  });
  return blocks.length === 0 ? heading : `${heading}\n\n${blocks.join("\n\n")}`;
}

/**
 * Renders the complete log of one author's messages beside fused retrieval
 * of every other record, under a total byte budget.
 *
 * The log holds every record whose view speaker equals `author`, verbatim,
 * chronological, grouped by session, each message followed by rule-resolved
 * dates for its relative time expressions. When the complete log exceeds
 * `budgetBytes - logReserveBytes`, the log admits the author's messages in
 * `ranked` order and then newest first until that budget is full, still
 * rendered chronologically, and its heading says it is partial. The retrieved
 * part then admits the other speakers' records in `ranked` order under
 * `retrievedBytes` and the remaining total budget. Record text is never altered.
 */
export function renderOhAuthorLogV1(input: Readonly<{ ranked: RankedInput; records: readonly KnowledgeGraphRecordV1[] }>,
  options: Readonly<{ asOf: string | null; author?: string; budgetBytes?: number; logReserveBytes?: number;
    retrievedBytes?: number; view?: OhAuthorLogViewV1 }>): OhAuthorLogRenderingV1 {
  const records = checkedRecords(input.records, "records"), ranked = checkedRanked(input.ranked);
  const asOf = instantOrNull(options.asOf, "asOf"), asOfDay = asOf === null ? null : dayNumber(asOf);
  const author = options.author ?? OH_AUTHOR_LOG_LIMITS_V1.defaultAuthor;
  if (typeof author !== "string" || author.length === 0 || utf8ByteLength(author) > OH_AUTHOR_LOG_LIMITS_V1.maximumAuthorBytes
    || /[\r\n]/u.test(author)) {
    throw new TypeError(`Author must be one line of 1 through ${OH_AUTHOR_LOG_LIMITS_V1.maximumAuthorBytes} bytes.`);
  }
  const budget = checkedBytes(options.budgetBytes, OH_AUTHOR_LOG_LIMITS_V1.defaultBudgetBytes, "budget");
  const retrievedCap = checkedBytes(options.retrievedBytes, Math.min(OH_AUTHOR_LOG_LIMITS_V1.defaultRetrievedBytes, budget), "retrieved budget", 0);
  const reserve = checkedBytes(options.logReserveBytes, Math.min(OH_AUTHOR_LOG_LIMITS_V1.defaultLogReserveBytes, budget), "log reserve", 0);
  if (reserve > budget) throw new RangeError("Author log reserve cannot exceed the budget.");
  if (options.view !== undefined && typeof options.view !== "function") throw new TypeError("Author log view must be a function.");
  const view = options.view ?? defaultOhAuthorLogViewV1;

  const viewed = new Map<string, Viewed>();
  for (const record of records) if (!viewed.has(record.key)) viewed.set(record.key, checkedView(view, record));
  const authored = [...viewed.values()].filter((item) => item.view.speaker === author);
  const sessions = sessionsOf(authored);
  const allSessions = sessionsOf([...viewed.values()]);
  const sharedTimestamp = allSessions.length > 1 && allSessions.every((session) => session.day !== null && session.day === allSessions[0]?.day);
  const entries = new Map(authored.map((item) => [item.key, authorEntry(item, author, asOfDay)]));

  const question = asOfDay === null ? "" : `Question date: ${formatDay(asOfDay)}.`;
  const shared = !sharedTimestamp ? "" : `${question === "" ? "" : " "}Every session in this history carries the same timestamp`
    + ` (${formatDay(allSessions[0]?.day as number)}), so session dates give no order or elapsed time between sessions,`
    + " and resolved dates are computed from that shared timestamp; date and order events by the dates and tense stated inside the messages.";
  const preamble = `${question}${shared}`;
  const completeHeading = `# Complete log of ${author} messages: all ${authored.length} messages from ${sessions.length} sessions, verbatim, in chronological order`;
  const withPreamble = (text: string) => preamble === "" ? text : `${preamble}\n\n${text}`;
  let log = withPreamble(logText(completeHeading, sessions, entries, asOfDay));
  let mode: "complete" | "ranked" = "complete", included = authored.length;
  if (utf8ByteLength(log) > budget - reserve) {
    mode = "ranked";
    const priority: Viewed[] = [], seen = new Set<string>();
    for (const record of ranked) {
      const item = viewed.get(record?.key);
      if (item !== undefined && item.view.speaker === author && !seen.has(item.key)) { seen.add(item.key); priority.push(item); }
    }
    for (const item of [...authored].sort((left, right) => compareViewed(right, left))) if (!seen.has(item.key)) priority.push(item);
    const partialHeading = (count: number) => `# Partial log of ${author} messages: ${count} of ${authored.length} messages from `
      + `${sessions.length} sessions, chosen by relevance to the question and then recency, verbatim, in chronological order`;
    const logBudget = budget - reserve, kept = new Map<string, string>(), openSessions = new Set<string>();
    // Admission counts each entry, its line break, and one session header per newly opened session; the exact text is checked after.
    let bound = utf8ByteLength(withPreamble(partialHeading(authored.length)));
    for (const item of priority) {
      const entry = entries.get(item.key) as string;
      const header = openSessions.has(item.view.session) ? 0
        : utf8ByteLength(sessionHeader(sessions.find((session) => session.id === item.view.session) as Session, asOfDay)) + 2;
      const growth = utf8ByteLength(entry) + 1 + header;
      if (bound + growth > logBudget) continue;
      kept.set(item.key, entry); openSessions.add(item.view.session); bound += growth;
    }
    included = kept.size;
    log = withPreamble(logText(partialHeading(included), sessions, kept, asOfDay));
  }

  const retrievedHeading = "# Other messages retrieved for the question: verbatim, in order of relevance; only a subset of the history";
  const authorKeys = new Set(authored.map((item) => item.key));
  const previousAuthor = new Map<string, string>();
  for (const session of allSessions) {
    let last: string | null = null;
    for (const item of session.members) {
      if (authorKeys.has(item.key)) last = item.key;
      else if (last !== null) previousAuthor.set(item.key, last);
    }
  }
  let text = log, retrievedBytes = 0, omitted = 0;
  const retrievedKeys: string[] = [], retrievedSeen = new Set<string>();
  const headingBytes = utf8ByteLength(`\n\n${retrievedHeading}`);
  for (const record of ranked) {
    const item = viewed.get(record?.key);
    if (item === undefined || item.view.speaker === author || retrievedSeen.has(item.key)) continue;
    retrievedSeen.add(item.key);
    const date = item.view.instant === null ? "date unknown" : formatDay(dayNumber(item.view.instant));
    const follows = previousAuthor.get(item.key);
    const line = `[${item.key}] [${date}] ${item.view.speaker ?? "record"}${follows === undefined ? "" : ` (follows [${follows}])`}: ${item.view.text}`;
    const growth = utf8ByteLength(line) + 2 + (retrievedKeys.length === 0 ? headingBytes : 0);
    if (utf8ByteLength(text) + growth > budget || retrievedBytes + growth > retrievedCap) { omitted += 1; continue; }
    text += `${retrievedKeys.length === 0 ? `\n\n${retrievedHeading}` : ""}\n\n${line}`;
    retrievedKeys.push(item.key); retrievedBytes += growth;
  }
  const logKeys = sessions.flatMap((session) => session.members.filter((item) => mode === "complete"
    || log.includes(`[${item.key}] ${author}: `)).map((item) => item.key));
  const bytes = utf8ByteLength(text);
  if (bytes > budget) throw new RangeError("Author log framing exceeds the budget; raise the budget or the log reserve.");
  return { bytes, keys: [...logKeys, ...retrievedKeys], log: { bytes: utf8ByteLength(log), included, mode, total: authored.length },
    renderer: OH_AUTHOR_LOG_RENDERER_V1, retrieved: { bytes: retrievedBytes, included: retrievedKeys.length, omitted },
    sharedTimestamp, text, v: 1 };
}

const DECLINE_PATTERN_V1 = /does not contain enough information|not enough information|insufficient information|cannot determine|can.t determine|not specified in|not mentioned|no information about|does not (?:include|mention|contain|record)/iu;
/** True when an English answer says the memory lacks the information: the trigger for a second, wider reading. */
export function isOhDeclineAnswerV1(answer: string): boolean {
  if (typeof answer !== "string") throw new TypeError("Answer must be text.");
  return DECLINE_PATTERN_V1.test(answer);
}

const STOP_WORDS = new Set(("that this with from have been were will would could should what when where which whom whose your yours "
  + "their them they about into after before over under again once here there both each more most other some such only same than "
  + "then very also even much many still like does didn doesn isn aren can't couldn wasn weren want need make made take took "
  + "know knew think said tell told ask asked something anything nothing everything someone anyone thing things first last").split(" "));
/** Distinct lowercase content words of four or more letters, English stop words removed. */
function contentWords(question: string): readonly string[] {
  return [...new Set(question.normalize("NFC").toLowerCase().match(/\p{L}[\p{L}'$-]{3,}/gu) ?? [])].filter((word) => !STOP_WORDS.has(word));
}

/**
 * Whole sessions for a second reading: up to four sessions dated within three
 * days of the single relative date window the question names, then the three
 * sessions whose messages contain the most question content words (scaled by
 * 1 / sqrt(messages + 1)), then sessions in `ranked` order, admitted while
 * they fit the budget and rendered chronologically. A message longer than
 * `messageChars` is cut and marked. The date window is skipped when every
 * session shares one day.
 */
export function renderOhSessionZoomV1(input: Readonly<{ question: string; ranked: RankedInput; records: readonly KnowledgeGraphRecordV1[] }>,
  options: Readonly<{ asOf: string | null; budgetBytes?: number; messageChars?: number; view?: OhAuthorLogViewV1 }>): OhSessionZoomRenderingV1 {
  const records = checkedRecords(input.records, "records"), ranked = checkedRanked(input.ranked);
  if (typeof input.question !== "string" || input.question.length === 0 || utf8ByteLength(input.question) > OH_RECALL_LIMITS_V1.maximumQueryBytes) {
    throw new TypeError(`Session zoom question must be nonempty text of at most ${OH_RECALL_LIMITS_V1.maximumQueryBytes} bytes.`);
  }
  const asOf = instantOrNull(options.asOf, "asOf"), asOfDay = asOf === null ? null : dayNumber(asOf);
  const budget = checkedBytes(options.budgetBytes, OH_AUTHOR_LOG_LIMITS_V1.defaultZoomBudgetBytes, "zoom budget");
  const messageChars = options.messageChars ?? OH_AUTHOR_LOG_LIMITS_V1.defaultZoomMessageChars;
  if (!Number.isSafeInteger(messageChars) || messageChars < 1) throw new RangeError("Session zoom message cap must be a positive integer.");
  if (options.view !== undefined && typeof options.view !== "function") throw new TypeError("Session zoom view must be a function.");
  const view = options.view ?? defaultOhAuthorLogViewV1;
  const viewed = new Map<string, Viewed>();
  for (const record of records) if (!viewed.has(record.key)) viewed.set(record.key, checkedView(view, record));
  const sessions = sessionsOf([...viewed.values()]);
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const distinctDays = new Set(sessions.map((session) => session.day));
  const window = asOf === null || distinctDays.size <= 1 ? null : resolveRelativeDateWindowV1(input.question, asOf);
  const order: string[] = [];
  const push = (id: string) => { if (!order.includes(id)) order.push(id); };
  if (window !== null) {
    const pad = OH_AUTHOR_LOG_LIMITS_V1.zoomPadDays, first = dayNumber(window.since), last = dayNumber(window.until), centre = (first + last) / 2;
    sessions.filter((session) => session.day !== null && session.day >= first - pad && session.day <= last + pad)
      .sort((left, right) => Math.abs((left.day as number) - centre) - Math.abs((right.day as number) - centre) || compareKeys(left.id, right.id))
      .slice(0, OH_AUTHOR_LOG_LIMITS_V1.zoomDateSessions).forEach((session) => push(session.id));
  }
  const words = contentWords(input.question);
  if (words.length > 0) {
    sessions.map((session) => {
      let hits = 0;
      for (const item of session.members) { const lower = item.view.text.toLowerCase(); for (const word of words) if (lower.includes(word)) hits += 1; }
      return { id: session.id, score: hits / Math.sqrt(session.members.length + 1) };
    }).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score || compareKeys(left.id, right.id))
      .slice(0, OH_AUTHOR_LOG_LIMITS_V1.zoomLexicalSessions).forEach((entry) => push(entry.id));
  }
  for (const record of ranked) { const item = viewed.get(record?.key); if (item !== undefined) push(item.view.session); }
  const render = (session: Session) => {
    const lines = session.members.map((item) => {
      const text = item.view.text.length > messageChars ? `${item.view.text.slice(0, messageChars)} …[message continues]` : item.view.text;
      return `[${item.key}] ${item.view.speaker ?? "record"}: ${text}`;
    });
    return `${sessionHeader(session, asOfDay)}\n${lines.join("\n")}`;
  };
  const heading = (count: number) => `${asOfDay === null ? "" : `Question date: ${formatDay(asOfDay)}.`}${window === null ? ""
    : ` The question refers to "${window.expression}" (${formatDay(dayNumber(window.since))}${window.since.slice(0, 10) === window.until.slice(0, 10) ? "" : ` to ${formatDay(dayNumber(window.until))}`}).`}`
    .trim() + `${asOfDay === null && window === null ? "" : "\n\n"}# Full text of the ${count} sessions most relevant to the question, every message verbatim, in chronological order`;
  const chosen: Session[] = [];
  let bytes = utf8ByteLength(heading(sessions.length));
  for (const id of order) {
    const session = byId.get(id) as Session, growth = utf8ByteLength(render(session)) + 2;
    if (bytes + growth > budget) continue;
    chosen.push(session); bytes += growth;
  }
  chosen.sort((left, right) => (left.day ?? Infinity) - (right.day ?? Infinity) || compareKeys(left.id, right.id));
  const text = chosen.length === 0 ? "" : `${heading(chosen.length)}\n\n${chosen.map(render).join("\n\n")}`;
  return { bytes: utf8ByteLength(text), keys: chosen.flatMap((session) => session.members.map((item) => item.key)),
    renderer: OH_SESSION_ZOOM_RENDERER_V1, sessions: chosen.map((session) => session.id), text, window, v: 1 };
}
