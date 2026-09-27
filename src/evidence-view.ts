import { canonicalJson, hasExactKeys, isPlainRecord, parseCanonicalInstantV1, parseSha256Hex,
  utf8ByteLength, type Sha256Hex } from "./canonical";
import { parseKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "./graph";
import { parseOhObservationDateV1 } from "./observe";
import { resolveRelativeDatesV1, type OhRecallDateWindowV1 } from "./recall";

export const OH_EVIDENCE_VIEW_LIMITS_V1 = Object.freeze({ records: 2048, mentions: 128, links: 256,
  sourceBytes: 4 * 1024 * 1024, quoteBytes: 4096, idBytes: 512, indexBytes: 256 * 1024,
  dateTextBytes: 4096, dateScanBytes: 128 * 1024 });
export type OhEvidenceCitationV1 = Readonly<{ key: string; recordSha256: Sha256Hex; quote: string }>;
export type OhEvidenceMentionV1 = Readonly<{
  id: string;
  kind: "event" | "state" | "plan" | "suggestion" | "unclear";
  source: OhEvidenceCitationV1;
  timeExpression: string | null;
}>;
export type OhEvidenceLinkV1 = Readonly<{
  id: string;
  kind: "supersedes" | "cancels" | "reactivates" | "same-event" | "distinct-event" | "before";
  from: string;
  to: string;
  source: OhEvidenceCitationV1;
}>;
export type OhEvidenceSourceProjectionV1 = Readonly<{ text: string; statedAt: string | null; speaker: string | null }>;
export type OhEvidenceSupportV1 = "supported" | "missing-source" | "stale-source" | "quote-mismatch" | "missing-mention";
export type OhEvidenceIntervalV1 = Readonly<{ since: string; until: string; basis: "literal-date" | "recall-grammar" }>;
export type OhEvidenceResolvedMentionV1 = OhEvidenceMentionV1 & Readonly<{
  support: OhEvidenceSupportV1;
  statedAt: string | null;
  interval: OhEvidenceIntervalV1 | null;
  timeStatus: "resolved" | "unknown" | "ambiguous" | "unsupported";
}>;
export type OhEvidenceSourceV1 = OhEvidenceSourceProjectionV1 & Readonly<{
  record: KnowledgeGraphRecordV1;
  dateExpressions: readonly OhRecallDateWindowV1[];
  dateStatus: "expressions" | "no-expression" | "missing-statement-time" | "scan-limit";
}>;
export type OhEvidenceViewV1 = Readonly<{
  format: "oh.evidence-view.v1";
  coverage: "partial";
  relationMeaning: "caller-asserted";
  sources: readonly OhEvidenceSourceV1[];
  mentions: readonly OhEvidenceResolvedMentionV1[];
  links: readonly (OhEvidenceLinkV1 & Readonly<{ support: OhEvidenceSupportV1 }>)[];
}>;

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const stateKinds = new Set(["supersedes", "cancels", "reactivates"]);
function fail(message: string): never { throw new TypeError(`Evidence view: ${message}.`); }
function bounded(value: unknown, maximum: number, label: string, empty = false): string {
  if (typeof value !== "string" || (!empty && value.length === 0) || utf8ByteLength(value) > maximum || /\p{Surrogate}/u.test(value)) {
    fail(`${label} must be scalar text of at most ${maximum} bytes`);
  }
  return value;
}
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) || Reflect.ownKeys(value).length !== keys.length) fail(`${label} fields`);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(`${label} data fields`);
    result[key] = descriptor.value;
  }
  return result;
}
function array(value: unknown, limit: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} bound`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(`${label} dense data array`);
  }
  return value;
}
function citation(value: unknown): OhEvidenceCitationV1 {
  const item = exact(value, ["key", "recordSha256", "quote"], "citation");
  const recordSha256 = parseSha256Hex(item.recordSha256);
  if (recordSha256 === null) fail("citation digest");
  return { key: bounded(item.key, OH_EVIDENCE_VIEW_LIMITS_V1.idBytes, "source key"), recordSha256,
    quote: bounded(item.quote, OH_EVIDENCE_VIEW_LIMITS_V1.quoteBytes, "quote") };
}
function mention(value: unknown): OhEvidenceMentionV1 {
  const item = exact(value, ["id", "kind", "source", "timeExpression"], "mention");
  if (!["event", "state", "plan", "suggestion", "unclear"].includes(item.kind as string)) fail("mention kind");
  return { id: bounded(item.id, OH_EVIDENCE_VIEW_LIMITS_V1.idBytes, "mention id"), kind: item.kind as OhEvidenceMentionV1["kind"],
    source: citation(item.source), timeExpression: item.timeExpression === null ? null : bounded(item.timeExpression, 256, "time expression") };
}
function link(value: unknown): OhEvidenceLinkV1 {
  const item = exact(value, ["id", "kind", "from", "to", "source"], "link");
  if (!["supersedes", "cancels", "reactivates", "same-event", "distinct-event", "before"].includes(item.kind as string)) fail("link kind");
  return { id: bounded(item.id, OH_EVIDENCE_VIEW_LIMITS_V1.idBytes, "link id"), kind: item.kind as OhEvidenceLinkV1["kind"],
    from: bounded(item.from, OH_EVIDENCE_VIEW_LIMITS_V1.idBytes, "from"), to: bounded(item.to, OH_EVIDENCE_VIEW_LIMITS_V1.idBytes, "to"),
    source: citation(item.source) };
}
function unique<T extends { id: string }>(items: readonly T[]): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) fail("duplicate id");
  return [...items].sort((a, b) => compare(a.id, b.id));
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function support(source: OhEvidenceCitationV1, records: ReadonlyMap<string, OhEvidenceSourceV1>): OhEvidenceSupportV1 {
  const record = records.get(source.key);
  if (record === undefined) return "missing-source";
  if (record.record.recordSha256 !== source.recordSha256) return "stale-source";
  const position = record.text.indexOf(source.quote);
  return position >= 0 && record.text.indexOf(source.quote, position + 1) < 0 ? "supported" : "quote-mismatch";
}

/** This projection reads statement metadata only; it never treats it as the event date. */
export function defaultOhEvidenceSourceV1(record: KnowledgeGraphRecordV1): OhEvidenceSourceProjectionV1 {
  const value = isPlainRecord(record.value) ? record.value : null;
  return { text: typeof value?.text === "string" ? value.text : canonicalJson(record.value),
    statedAt: parseCanonicalInstantV1(value?.statedAt) ?? parseCanonicalInstantV1(value?.observedAt),
    speaker: typeof value?.speaker === "string" ? value.speaker : null };
}
function resolveMention(item: OhEvidenceMentionV1, sources: ReadonlyMap<string, OhEvidenceSourceV1>): OhEvidenceResolvedMentionV1 {
  const status = support(item.source, sources), statedAt = sources.get(item.source.key)?.statedAt ?? null;
  const base = { ...item, support: status, statedAt, interval: null };
  if (status !== "supported") return { ...base, timeStatus: "unsupported" };
  if (item.timeExpression === null) return { ...base, timeStatus: "unknown" };
  const index = item.source.quote.indexOf(item.timeExpression);
  if (index < 0 || item.source.quote.indexOf(item.timeExpression, index + 1) >= 0) return { ...base, timeStatus: "unsupported" };
  const date = parseOhObservationDateV1(item.timeExpression);
  if (date !== null) return { ...base, timeStatus: "resolved", interval: {
    since: `${date}T00:00:00.000Z`, until: `${date}T23:59:59.999Z`, basis: "literal-date" } };
  if (statedAt === null) return { ...base, timeStatus: "unknown" };
  const windows = resolveRelativeDatesV1(item.timeExpression, statedAt);
  const window = windows[0];
  if (windows.length > 1) return { ...base, timeStatus: "ambiguous" };
  // Accept only the whole expression. A matching fragment cannot resolve an ambiguous phrase.
  if (window === undefined || window.expression !== item.timeExpression.normalize("NFC").toLowerCase()) return { ...base, timeStatus: "unknown" };
  return { ...base, timeStatus: "resolved", interval: { since: window.since, until: window.until, basis: "recall-grammar" } };
}

/**
 * Pure opt-in projection over current records, including native ranked {record} results.
 * Quotes and digests are checked; relationship meaning remains the caller's assertion.
 * Unusable pointers stay in the result with their support status. No observation is inferred.
 */
export function buildOhEvidenceViewV1(input: Readonly<{
  records: readonly (KnowledgeGraphRecordV1 | Readonly<{ record: KnowledgeGraphRecordV1 }>)[];
  mentions?: readonly OhEvidenceMentionV1[];
  links?: readonly OhEvidenceLinkV1[];
  sourceView?: (record: KnowledgeGraphRecordV1) => OhEvidenceSourceProjectionV1;
}>): OhEvidenceViewV1 {
  if (!isPlainRecord(input)) fail("input object");
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !["records", "mentions", "links", "sourceView"].includes(key)) fail("input fields");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("input data fields");
  }
  const raw = array(input.records, OH_EVIDENCE_VIEW_LIMITS_V1.records, "records");
  const mentions = unique(array(input.mentions ?? [], OH_EVIDENCE_VIEW_LIMITS_V1.mentions, "mentions").map(mention));
  const links = unique(array(input.links ?? [], OH_EVIDENCE_VIEW_LIMITS_V1.links, "links").map(link));
  if (input.sourceView !== undefined && typeof input.sourceView !== "function") fail("source view function");
  let bytes = 0;
  const sources: OhEvidenceSourceV1[] = [], byKey = new Map<string, OhEvidenceSourceV1>();
  for (const candidate of raw) {
    const recordInput = isPlainRecord(candidate) && Object.hasOwn(candidate, "record")
      ? Object.getOwnPropertyDescriptor(candidate, "record")?.value : candidate;
    const record = parseKnowledgeGraphRecordV1(recordInput);
    if (record === null) fail("current graph record");
    // Detach before deep-freezing so this read does not mutate caller-owned records.
    const detached = freeze(JSON.parse(canonicalJson(record)) as KnowledgeGraphRecordV1);
    bytes += utf8ByteLength(canonicalJson(detached));
    if (bytes > OH_EVIDENCE_VIEW_LIMITS_V1.sourceBytes) fail("source byte bound");
    if (byKey.has(record.key)) fail("duplicate source key");
    const projected = exact((input.sourceView ?? defaultOhEvidenceSourceV1)(detached), ["text", "statedAt", "speaker"], "source view");
    const text = bounded(projected.text, 1024 * 1024, "source text", true);
    if (text !== defaultOhEvidenceSourceV1(detached).text) fail("source view must preserve raw text");
    bytes += utf8ByteLength(text);
    if (bytes > OH_EVIDENCE_VIEW_LIMITS_V1.sourceBytes) fail("source byte bound");
    if (projected.statedAt !== null && parseCanonicalInstantV1(projected.statedAt) === null) fail("canonical statement instant");
    const statedAt = projected.statedAt as string | null;
    const speaker = projected.speaker === null ? null : bounded(projected.speaker, 512, "speaker");
    const source: OhEvidenceSourceV1 = { record: detached, text, statedAt, speaker,
      dateExpressions: [], dateStatus: "missing-statement-time" };
    sources.push(source); byKey.set(record.key, source);
  }
  sources.sort((a, b) => compare(a.record.key, b.record.key));
  let scanBytes = 0;
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!, size = utf8ByteLength(source.text);
    if (source.statedAt === null) continue;
    const limited = size > OH_EVIDENCE_VIEW_LIMITS_V1.dateTextBytes || scanBytes + size > OH_EVIDENCE_VIEW_LIMITS_V1.dateScanBytes;
    // The existing grammar's overlapping-match filter is quadratic in matches, so cap each scan and total work.
    const dateExpressions = limited ? [] : resolveRelativeDatesV1(source.text, source.statedAt);
    if (!limited) scanBytes += size;
    sources[index] = { ...source, dateExpressions, dateStatus: limited ? "scan-limit" : dateExpressions.length ? "expressions" : "no-expression" };
    byKey.set(source.record.key, sources[index]!);
  }
  const resolved = mentions.map((item) => resolveMention(item, byKey)), byId = new Map(resolved.map((item) => [item.id, item]));
  return freeze({ format: "oh.evidence-view.v1", coverage: "partial", relationMeaning: "caller-asserted", sources, mentions: resolved,
    links: links.map((item) => ({ ...item, support: support(item.source, byKey) !== "supported" ? support(item.source, byKey)
      : byId.get(item.from)?.support !== "supported" || byId.get(item.to)?.support !== "supported" ? "missing-mention" : "supported" })) });
}

export type OhEvidenceOrderV1 = Readonly<{ relation: "before" | "after" | "unknown" | "conflict" | "unsupported";
  mentions: readonly OhEvidenceResolvedMentionV1[]; links: readonly OhEvidenceViewV1["links"][number][] }>;
/** Only disjoint event intervals or explicit before links establish an order. */
export function compareOhEvidenceEventsV1(view: OhEvidenceViewV1, leftId: string, rightId: string): OhEvidenceOrderV1 {
  const left = view.mentions.find((item) => item.id === leftId), right = view.mentions.find((item) => item.id === rightId);
  const mentions = [left, right].filter((item): item is OhEvidenceResolvedMentionV1 => item !== undefined);
  const eventIds = new Set(view.mentions.filter((item) => item.support === "supported" && item.kind === "event").map((item) => item.id));
  const links = view.links.filter((item) => item.kind === "before" && item.support === "supported"
    && eventIds.has(item.from) && eventIds.has(item.to));
  if (left?.support !== "supported" || right?.support !== "supported" || left.kind !== "event" || right.kind !== "event") {
    return { relation: "unsupported", mentions, links: [] };
  }
  const reach = (start: string, end: string): boolean => {
    const seen = new Set<string>(), pending = [start];
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const item of links) if (item.from === current) { if (item.to === end) return true; pending.push(item.to); }
    }
    return false;
  };
  const before = reach(leftId, rightId), after = reach(rightId, leftId);
  const relevantLinks = links.filter((item) =>
    ((item.from === leftId || reach(leftId, item.from)) && (item.to === rightId || reach(item.to, rightId)))
    || ((item.from === rightId || reach(rightId, item.from)) && (item.to === leftId || reach(item.to, leftId))));
  const intervalBefore = left.interval !== null && right.interval !== null && left.interval.until < right.interval.since;
  const intervalAfter = left.interval !== null && right.interval !== null && right.interval.until < left.interval.since;
  const conflict = (before && after) || (before && intervalAfter) || (after && intervalBefore) || (leftId === rightId && (before || after));
  return { relation: conflict ? "conflict" : before || intervalBefore ? "before" : after || intervalAfter ? "after" : "unknown", mentions, links: relevantLinks };
}

export type OhEvidenceStateV1 = Readonly<{
  status: "supported" | "unresolved" | "unsupported";
  current: readonly Readonly<{ mention: OhEvidenceResolvedMentionV1; state: "active" | "cancelled" }>[];
  history: readonly OhEvidenceResolvedMentionV1[];
  links: readonly OhEvidenceViewV1["links"][number][];
  reasons: readonly string[];
}>;
/** `asOf` asks what was stated by that instant. It does not infer when a state took effect. */
export function currentOhEvidenceStateV1(view: OhEvidenceViewV1, mentionId: string, asOf: string | null = null): OhEvidenceStateV1 {
  if (asOf !== null && parseCanonicalInstantV1(asOf) === null) fail("canonical asOf instant");
  const linkStatementTime = (item: OhEvidenceViewV1["links"][number]): string | null => view.sources.find((source) =>
    source.record.key === item.source.key && source.record.recordSha256 === item.source.recordSha256)?.statedAt ?? null;
  // Link evidence also determines component membership. A future link must not join two
  // previously independent statements and change the answer to an earlier asOf query.
  // An unknown or stale link timestamp remains visible as unresolved evidence.
  const component = new Set([mentionId]), candidates = view.links.filter((item) => stateKinds.has(item.kind)
    && (asOf === null || linkStatementTime(item) === null || linkStatementTime(item)! <= asOf));
  let changed = true;
  while (changed) { changed = false; for (const item of candidates) if (component.has(item.from) || component.has(item.to)) {
    if (!component.has(item.from) || !component.has(item.to)) changed = true;
    component.add(item.from); component.add(item.to);
  } }
  const history = view.mentions.filter((item) => component.has(item.id));
  const eligible = history.filter((item) => item.support === "supported" && (asOf === null || (item.statedAt !== null && item.statedAt <= asOf)));
  const ids = new Set(eligible.map((item) => item.id)), reasons = new Set<string>();
  const links = candidates.filter((item) => component.has(item.from) && component.has(item.to));
  const activeLinks = links.filter((item) => {
    if (item.support !== "supported" || !ids.has(item.from) || !ids.has(item.to)) return false;
    if (asOf === null) return true;
    const statedAt = linkStatementTime(item);
    if (statedAt === null) { reasons.add("unknown-link-statement-time"); return false; }
    return statedAt <= asOf;
  });
  for (const item of history) {
    if (item.support !== "supported") reasons.add("unsupported-history");
    if (asOf !== null && item.statedAt === null) reasons.add("unknown-statement-time");
  }
  for (const item of links) if (item.support !== "supported") reasons.add("unsupported-link");
  for (const item of activeLinks) {
    const from = eligible.find((value) => value.id === item.from)!, to = eligible.find((value) => value.id === item.to)!;
    if (from.statedAt !== null && to.statedAt !== null && from.statedAt < to.statedAt) reasons.add("reversed-statement-order");
    if (!["state", "plan"].includes(from.kind) || !["state", "plan"].includes(to.kind)) reasons.add("unresolved-statement-kind");
  }
  for (const item of eligible) if (!["state", "plan"].includes(item.kind)) reasons.add("unresolved-statement-kind");
  for (const item of eligible) {
    const kinds = new Set(activeLinks.filter((value) => value.from === item.id).map((value) => value.kind));
    if (kinds.has("cancels") && (kinds.has("reactivates") || kinds.has("supersedes"))) reasons.add("conflicting-change-kinds");
  }
  // Removing a target is justified only by a supported, eligible successor.
  const replaced = new Set(activeLinks.map((item) => item.to));
  const current = eligible.filter((item) => !replaced.has(item.id)).map((item) => ({ mention: item,
    state: activeLinks.some((value) => value.from === item.id && value.kind === "cancels") ? "cancelled" as const : "active" as const }));
  if (current.length > 1) reasons.add("competing-current-statements");
  if (current.length === 0 && eligible.length > 0) reasons.add("cyclic-links");
  // A cycle attached to a terminal branch must remain visible too.
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { reasons.add("cyclic-links"); return; }
    if (done.has(id)) return;
    visiting.add(id); for (const item of activeLinks) if (item.from === id) visit(item.to);
    visiting.delete(id); done.add(id);
  };
  for (const id of ids) visit(id);
  return { status: eligible.length === 0 ? "unsupported" : reasons.size > 0 ? "unresolved" : "supported", current, history, links,
    reasons: [...reasons].sort(compare) };
}

/** Groups only caller-linked mentions. Group count is not an event count or completeness claim. */
export function groupOhEvidenceEventsV1(view: OhEvidenceViewV1): Readonly<{
  groups: readonly (readonly string[])[]; conflicts: readonly string[]; unlinked: readonly string[];
}> {
  const ids = view.mentions.filter((item) => item.support === "supported" && item.kind === "event").map((item) => item.id);
  const parent = new Map(ids.map((id) => [id, id]));
  const root = (id: string): string => { while (parent.get(id) !== id) id = parent.get(id)!; return id; };
  const linked = new Set<string>();
  for (const item of view.links) if (item.support === "supported" && item.kind === "same-event" && parent.has(item.from) && parent.has(item.to)) {
    const a = root(item.from), b = root(item.to); parent.set(a, b); linked.add(item.from); linked.add(item.to);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) { const key = root(id); groups.set(key, [...(groups.get(key) ?? []), id]); }
  const conflicts = view.links.filter((item) => item.support === "supported" && item.kind === "distinct-event"
    && parent.has(item.from) && parent.has(item.to) && root(item.from) === root(item.to)).map((item) => item.id);
  return { groups: [...groups.values()].map((group) => group.sort(compare)).sort((a, b) => compare(a[0]!, b[0]!)),
    conflicts, unlinked: ids.filter((id) => !linked.has(id)) };
}

export type OhEvidenceIndexRenderingV1 = Readonly<{ text: string; bytes: number; omitted: Readonly<{ sources: number; mentions: number; links: number }> }>;
/** Bounded supplementary index. The caller keeps the raw context; this index never replaces it. */
export function renderOhEvidenceViewIndexV1(view: OhEvidenceViewV1, maximumBytes = 16_384): OhEvidenceIndexRenderingV1 {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 512 || maximumBytes > OH_EVIDENCE_VIEW_LIMITS_V1.indexBytes) fail("index byte budget");
  const sources: unknown[] = [], mentions: OhEvidenceResolvedMentionV1[] = [], links: OhEvidenceViewV1["links"][number][] = [];
  const omitted = { sources: view.sources.length, mentions: view.mentions.length, links: view.links.length };
  const serialize = () => canonicalJson({ format: view.format, coverage: view.coverage, relationMeaning: view.relationMeaning,
    dateMeaning: "source-expressions-without-event-association", sources, mentions, links, omitted });
  const add = <T>(target: T[], value: T, kind: keyof typeof omitted): void => {
    target.push(value); omitted[kind]--;
    if (utf8ByteLength(serialize()) > maximumBytes) { target.pop(); omitted[kind]++; }
  };
  for (const item of view.mentions) add(mentions, item, "mentions");
  const renderedIds = new Set(mentions.map((item) => item.id));
  for (const item of view.links) if (renderedIds.has(item.from) && renderedIds.has(item.to)) add(links, item, "links");
  const prioritizedSources = [...view.sources].sort((a, b) => Number(b.dateExpressions.length > 0) - Number(a.dateExpressions.length > 0)
    || compare(a.record.key, b.record.key));
  for (const source of prioritizedSources) {
    // Grammar results use normalized expressions, not source offsets. Quote the full source to avoid
    // attaching a reading to an excluded occurrence or misaligning Unicode case-folded offsets.
    const dates = source.dateExpressions;
    add(sources, { key: source.record.key, recordSha256: source.record.recordSha256, statedAt: source.statedAt,
      speaker: source.speaker, quote: dates.length > 0 ? source.text : null, dates, dateStatus: source.dateStatus }, "sources");
  }
  const text = serialize(); return { text, bytes: utf8ByteLength(text), omitted: { ...omitted } };
}
