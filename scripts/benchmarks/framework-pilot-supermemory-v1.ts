import { canonicalJson, canonicalSha256, isPlainRecord, parseCanonicalInstantV1, sha256Hex } from "../../src/canonical";
import { validateFrameworkPilotSourceUnitsV1 } from "./framework-pilot-source-v1";

/** A declared comparative profile, not Supermemory's defaults or an optimality claim.
 * v4 API: https://supermemory.ai/docs/api-reference/recall-search/search-memory-entries
 * Reranking is also a billed operation: https://supermemory.ai/pricing/ (2026-09-23).
 * HTTP request counts below do not count provider-internal work or establish a cash cap. */
export const FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1 = Object.freeze({
  identity: "hybrid-rerank-20.v1", searchMode: "hybrid", limit: 20, threshold: 0.6,
  rerank: true, aggregate: false, rewriteQuery: false,
  include: Object.freeze({ documents: true, summaries: false, relatedMemories: false, forgottenMemories: false, chunks: false }),
});
export type FrameworkPilotSupermemoryTargetV1 = Readonly<{
  origin: "https://api.supermemory.ai"; projectId: string; resourceId: string;
}>;
export type FrameworkPilotSupermemoryBudgetV1 = Readonly<{
  maximumDocuments: number; maximumMemoryEntries: number;
  maximumMainRequests: number; maximumCleanupRequests: number;
  maximumRequestBytes: number; maximumResponseBytes: number;
  maximumMainResponseBytes: number; maximumCleanupResponseBytes: number;
  requestTimeoutMs: number; workTimeoutMs: number; cleanupTimeoutMs: number;
  readinessTimeoutMs: number; maximumPollsPerDocument: number; pollIntervalMs: number; cleanupObservationDelayMs: number;
}>;
export type FrameworkPilotSupermemoryRequestV1 = Readonly<{
  sequence: number; phase: "work" | "cleanup"; target: FrameworkPilotSupermemoryTargetV1;
  operation: "inventory" | "ingest" | "readiness" | "search" | "delete" | "absence";
  method: "GET" | "POST" | "DELETE"; path: string; body: string | null;
  requestSha256: string; operationId: string; deadlineMs: number; responseReadLimit: number;
  automaticRetries: 0; redirects: 0;
}>;
/** This is an injection boundary, not a shipped live transport or durable store.
 * claim must atomically create and fsync a permanent, namespace-unique claim; reuse
 * must reject even after cleanup. append must persist exact entries before resolving.
 * dispatch must enforce deadline/read limit, never retry/redirect, and settle only
 * after its connection is closed. A throwing write has uncertain provider outcome.
 * A real owner must separately qualify these guarantees, credential/target binding,
 * admission, billing, process custody and recovery. Never use Promise.race to leave
 * a mutating request running while cleanup starts. No credentials are accepted here. */
export type FrameworkPilotSupermemoryIOV1 = Readonly<{
  target: FrameworkPilotSupermemoryTargetV1;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  claim(entry: Readonly<Record<string, unknown>>): Promise<void>;
  append(entry: Readonly<Record<string, unknown>>): Promise<void>;
  dispatch(request: FrameworkPilotSupermemoryRequestV1): Promise<unknown>;
}>;
export type FrameworkPilotSupermemoryEvidenceV1 = Readonly<{
  rank: number; kind: "provider-generated-memory" | "provider-document-chunk";
  providerId: string; content: string; similarity: number;
  documentReferences: readonly Readonly<{ documentId: string; sourceUnitId: string; sourceUnitSha256: string }>[];
  sourceTextAuthenticated: false;
}>;

class Guard extends Error { constructor(readonly code: string) { super(`Framework pilot Supermemory: ${code}.`); } }
function need(value: unknown, code: string): asserts value { if (!value) throw new Guard(code); }
function record(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  need(isPlainRecord(input), "plain-record");
  const keys = Reflect.ownKeys(input), allowed = [...required, ...optional], output: Record<string, unknown> = Object.create(null);
  need(keys.length <= allowed.length && keys.every(key => typeof key === "string" && allowed.includes(key)), "record-fields");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    need(descriptor && descriptor.enumerable && "value" in descriptor, "data-properties");
    output[key as string] = descriptor.value;
  }
  need(required.every(key => Object.hasOwn(output, key)), "required-fields");
  return output;
}
function list(input: unknown, maximum: number): unknown[] {
  need(Array.isArray(input) && input.length <= maximum && Reflect.ownKeys(input).length === input.length + 1, "array-bound");
  const output: unknown[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = Object.getOwnPropertyDescriptor(input, String(i));
    need(item && item.enumerable && "value" in item, "dense-data-array"); output.push(item.value);
  }
  return output;
}
function number(input: unknown, minimum: number, maximum: number): number {
  need(typeof input === "number" && Number.isSafeInteger(input) && !Object.is(input, -0)
    && input >= minimum && input <= maximum, "integer-bound"); return input;
}
function text(input: unknown, maximum: number): string {
  need(typeof input === "string" && input.length > 0 && input.length <= maximum
    && Buffer.byteLength(input) <= maximum && !/\p{Surrogate}/u.test(input), "text-bound"); return input;
}
function id(input: unknown): string { const value = text(input, 128); need(/^[A-Za-z0-9_-]+$/u.test(value), "provider-id"); return value; }
function freeze<T>(input: T): T {
  if (input !== null && typeof input === "object") { for (const item of Object.values(input)) freeze(item); Object.freeze(input); }
  return input;
}
function target(input: unknown): FrameworkPilotSupermemoryTargetV1 {
  const value = record(input, ["origin", "projectId", "resourceId"]);
  need(value.origin === "https://api.supermemory.ai", "provider-origin");
  return Object.freeze({ origin: value.origin, projectId: id(value.projectId), resourceId: id(value.resourceId) });
}
const budgetBounds = {
  maximumDocuments: [1, 2_000], maximumMemoryEntries: [1, 2_000],
  maximumMainRequests: [1, 10_000], maximumCleanupRequests: [1, 2_100],
  maximumRequestBytes: [512, 1_048_576], maximumResponseBytes: [512, 1_048_576],
  maximumMainResponseBytes: [512, 67_108_864], maximumCleanupResponseBytes: [512, 67_108_864],
  requestTimeoutMs: [1, 20_000], workTimeoutMs: [1, 3_600_000], cleanupTimeoutMs: [1, 600_000],
  readinessTimeoutMs: [1, 900_000], maximumPollsPerDocument: [1, 181],
  pollIntervalMs: [1_000, 60_000], cleanupObservationDelayMs: [10_000, 60_000],
} as const;
function budget(input: unknown): FrameworkPilotSupermemoryBudgetV1 {
  const value = record(input, Object.keys(budgetBounds)), result: Record<string, number> = {};
  for (const [key, [minimum, maximum]] of Object.entries(budgetBounds)) result[key] = number(value[key], minimum, maximum);
  return Object.freeze(result) as FrameworkPilotSupermemoryBudgetV1;
}
function isoDate(input: unknown): string {
  const value = text(input, 32);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    need(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value, "document-calendar-date");
  } else need(parseCanonicalInstantV1(value) !== null, "document-iso-instant");
  return value;
}

/** Date mappings are explicit caller assertions tied to the exact occurrence/source.
 * Authored dates remain verbatim in content. No timezone conversion is inferred.
 * The earlier session-document readiness probe does not qualify per-unit ingestion. */
export function prepareFrameworkPilotSupermemoryV1(input: unknown) {
  const value = record(input, ["protocol", "target", "namespace", "query", "dreaming", "budget", "source", "splitPlan", "sourceUnits", "documentDates"]);
  need(value.protocol === "oh.framework-pilot-supermemory-input.v1", "input-protocol");
  const namespace = text(value.namespace, 64), query = text(value.query, 16_384), bounds = budget(value.budget);
  need(/^oh_fp1_[a-f0-9]{32}$/u.test(namespace), "fresh-namespace-shape");
  need(value.dreaming === "instant" || value.dreaming === "dynamic", "explicit-dreaming-profile");
  const bundle = validateFrameworkPilotSourceUnitsV1(value.sourceUnits, value.source, value.splitPlan);
  need(bundle.unitCount <= bounds.maximumDocuments, "document-capacity");
  const dateRows = list(value.documentDates, bundle.sessionCount);
  need(dateRows.length === bundle.sessionCount, "complete-document-dates");
  const dates = dateRows.map((raw, index) => {
    const row = record(raw, ["sourceSha256", "sessionIndex", "sourceDate", "documentDate"]), occurrence = bundle.occurrences[index]!;
    need(row.sourceSha256 === bundle.sourceSha256 && row.sessionIndex === index && row.sourceDate === occurrence.date, "document-date-source-binding");
    return Object.freeze({ sourceSha256: bundle.sourceSha256, sessionIndex: index, sourceDate: occurrence.date, documentDate: isoDate(row.documentDate) });
  });
  const documents = bundle.units.map(unit => {
    const { unitSha256: _unitSha256, ...sourceContent } = unit;
    const content = canonicalJson(sourceContent), body = {
      containerTag: namespace, customId: `${namespace}_${unit.unitId}`, content,
      documentDate: dates[unit.sessionIndex]!.documentDate, taskType: "memory", dreaming: value.dreaming,
      metadata: { ohFrameworkPilot: namespace, sourceSha256: bundle.sourceSha256, sourceBundleSha256: bundle.bundleSha256,
        sourceUnitId: unit.unitId, sourceUnitSha256: unit.unitSha256, sourceContentSha256: sha256Hex(content) },
    };
    need(Buffer.byteLength(canonicalJson(body)) <= bounds.maximumRequestBytes, "ingest-request-byte-bound");
    return body;
  });
  const search = { containerTag: namespace, q: query,
    ...Object.fromEntries(Object.entries(FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1).filter(([key]) => key !== "identity")) };
  need(Buffer.byteLength(canonicalJson(search)) <= bounds.maximumRequestBytes, "search-request-byte-bound");
  const cleanupFloor = Math.ceil(documents.length / 100) + Math.ceil(bounds.maximumMemoryEntries / 100) + documents.length + 5;
  need(bounds.maximumMainRequests >= 3 + 2 * documents.length && bounds.maximumCleanupRequests >= cleanupFloor, "request-capacity-and-cleanup-reserve");
  need(bounds.maximumMainResponseBytes >= bounds.maximumResponseBytes && bounds.maximumCleanupResponseBytes >= bounds.maximumResponseBytes
    && bounds.cleanupTimeoutMs > bounds.cleanupObservationDelayMs, "phase-capacity");
  const payload = { protocol: "oh.framework-pilot-supermemory-plan.v1" as const, target: target(value.target), namespace,
    profile: FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1, sourceSha256: bundle.sourceSha256, bundleSha256: bundle.bundleSha256,
    documentDates: dates, budget: bounds, documents, search };
  return freeze({ ...payload, planSha256: canonicalSha256(payload) });
}
type Plan = ReturnType<typeof prepareFrameworkPilotSupermemoryV1>;
type DocumentBody = Plan["documents"][number];

// Preserve exact raw bytes in the journal; reject duplicate keys before JSON.parse.
function parseResponse(bytes: Uint8Array): unknown {
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes), stack: Array<Set<string> | null> = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "{") stack.push(new Set()); else if (c === "[") stack.push(null);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === '"') {
      let end = i + 1;
      while (end < raw.length) { if (raw[end] === "\\") end += 2; else if (raw[end++] === '"') break; }
      let next = end; while (/\s/u.test(raw[next] ?? "x")) next++;
      if (raw[next] === ":") {
        const keys = stack.at(-1), key: unknown = JSON.parse(raw.slice(i, end));
        need(keys && typeof key === "string" && !keys.has(key), "duplicate-json-key"); keys.add(key);
      }
      i = end - 1;
    }
    need(stack.length <= 12, "response-depth");
  }
  const parsed: unknown = raw.length === 0 ? null : JSON.parse(raw), queue = [parsed];
  let nodes = 0;
  while (queue.length) {
    const item = queue.pop(); need(++nodes <= 20_000, "response-node-bound");
    if (typeof item === "number") need(Number.isFinite(item) && !Object.is(item, -0), "response-number");
    else if (typeof item === "string") need(!/\p{Surrogate}/u.test(item), "response-unicode");
    else if (item !== null && typeof item === "object") queue.push(...Object.values(item));
  }
  return parsed;
}
function document(value: unknown, body: DocumentBody, expectedId: string): "pending" | "ready" | "failed" {
  need(isPlainRecord(value), "document-response");
  need(value.id === expectedId && value.customId === body.customId && canonicalJson(value.containerTags) === canonicalJson([body.containerTag]), "document-identity");
  const metadata = value.metadata;
  need(isPlainRecord(metadata) && Object.entries(body.metadata).every(([key, expected]) => metadata[key] === expected), "document-source-ownership");
  need(["unknown", "queued", "extracting", "chunking", "embedding", "indexing", "done", "failed"].includes(String(value.status))
    && ["dreaming", "done"].includes(String(value.dreamingStatus)), "document-lifecycle");
  if (value.status === "failed") return "failed";
  if (value.status === "done" && value.dreamingStatus === "done") {
    need(value.raw === body.content || value.content === body.content, "ready-source-echo"); return "ready";
  }
  return "pending";
}

/** Runs exactly one source-bounded case through an injected owner. There is no network
 * implementation, credential discovery, automatic retry, pricing attestation or quality
 * scoring here. All provider results remain provider evidence, never source-unit Recall@20. */
export async function runFrameworkPilotSupermemoryV1(input: unknown, suppliedIO: FrameworkPilotSupermemoryIOV1) {
  const plan = prepareFrameworkPilotSupermemoryV1(input), b = plan.budget;
  const ioValue = record(suppliedIO, ["target", "now", "sleep", "claim", "append", "dispatch"]);
  need(canonicalJson(target(ioValue.target)) === canonicalJson(plan.target), "transport-target-binding");
  for (const key of ["now", "sleep", "claim", "append", "dispatch"]) need(typeof ioValue[key] === "function", "io-function");
  const io = ioValue as unknown as FrameworkPilotSupermemoryIOV1;
  let previousClock = -Infinity;
  function now() { const value = io.now(); need(Number.isFinite(value) && value >= 0 && value >= previousClock, "monotonic-clock"); previousClock = value; return value; }
  const started = now(), workEnd = started + b.workTimeoutMs;
  let phase: "work" | "cleanup" = "work", cleanupEnd = 0, sequence = 0, journalHealthy = true, fresh = false;
  const counts = { work: 0, cleanup: 0 }, responseBytes = { work: 0, cleanup: 0 }, requestBytes = { work: 0, cleanup: 0 };
  const submitted = new Map<string, DocumentBody>(), submissionStarted = new Map<string, number>();
  const accepted = new Map<string, { id: string; body: DocumentBody; submittedAt: number }>();
  const errors: { stage: string; code: string }[] = [], observations: { documentId: string; elapsedMs: number; status: string }[] = [];
  let evidence: FrameworkPilotSupermemoryEvidenceV1[] = [], readyDocuments = 0, retrievalCaptured = false, cleanupObservedAbsent = false;
  let providerSearchTimingMs: number | null = null, searchElapsedMs: number | null = null, ingestionElapsedMs: number | null = null;
  const error = (stage: string, value: unknown) => errors.push({ stage, code: value instanceof Guard ? value.code : "external-io-or-invalid-response" });
  async function append(entry: Record<string, unknown>) {
    need(journalHealthy, "durable-journal-unavailable");
    try { await io.append(freeze(entry)); } catch (value) { journalHealthy = false; throw value; }
  }
  await io.claim(freeze({ protocol: "oh.framework-pilot-supermemory-claim.v1", target: plan.target, namespace: plan.namespace,
    planSha256: plan.planSha256, automaticRetries: 0 }));
  function deadline(extra = Infinity) { return Math.min(phase === "work" ? workEnd : cleanupEnd, extra); }
  async function pause(ms: number, end = Infinity) {
    need(now() + ms < deadline(end), "phase-sleep-deadline"); await io.sleep(ms); need(now() < deadline(end), "phase-sleep-deadline");
  }
  async function call(operation: FrameworkPilotSupermemoryRequestV1["operation"], method: FrameworkPilotSupermemoryRequestV1["method"],
    path: string, payload: unknown, expected = [200], end = Infinity, upload?: DocumentBody) {
    need(journalHealthy, "durable-journal-unavailable");
    const body = payload === null ? null : canonicalJson(payload), size = body === null ? 0 : Buffer.byteLength(body);
    const cap = phase === "work" ? b.maximumMainRequests : b.maximumCleanupRequests;
    const bytesCap = phase === "work" ? b.maximumMainResponseBytes : b.maximumCleanupResponseBytes;
    const responseReadLimit = Math.min(b.maximumResponseBytes + 1, bytesCap - responseBytes[phase]);
    const began = now(), endAt = Math.min(deadline(end), began + b.requestTimeoutMs);
    need(size <= b.maximumRequestBytes && counts[phase] < cap && responseReadLimit > 0 && began < endAt, "request-budget");
    const request = freeze({ sequence: ++sequence, phase, target: plan.target, operation, method, path, body,
      requestSha256: canonicalSha256({ method, path, body }), operationId: `${plan.namespace}:${sequence}`,
      deadlineMs: endAt, responseReadLimit, automaticRetries: 0 as const, redirects: 0 as const });
    await append({ kind: "intent", request, planSha256: plan.planSha256 });
    // A persisted intent is conservatively a possible dispatch, even if time expires here.
    if (upload) { submitted.set(upload.customId, upload); submissionStarted.set(upload.customId, began); }
    counts[phase]++; requestBytes[phase] += size; responseBytes[phase] += responseReadLimit;
    try {
      need(now() < endAt, "dispatch-deadline");
      const response = record(await io.dispatch(request), ["status", "body", "complete"]);
      const status = number(response.status, 100, 599);
      need(response.body instanceof Uint8Array && response.body.byteLength <= responseReadLimit && typeof response.complete === "boolean", "transport-response-bound");
      const raw = Buffer.from(response.body);
      responseBytes[phase] += raw.byteLength - responseReadLimit;
      await append({ kind: "response", sequence, status, complete: response.complete, bodyBase64: raw.toString("base64"),
        responseSha256: sha256Hex(raw), observedElapsedMs: now() - began });
      need(now() <= endAt, "transport-deadline");
      need(response.complete && raw.byteLength < responseReadLimit, "response-byte-budget-or-incomplete");
      need(expected.includes(status), "http-status");
      return { status, value: parseResponse(raw) };
    } catch (value) {
      if (journalHealthy) await append({ kind: "failure", sequence, uncertainAttempt: true, retried: false,
        code: value instanceof Guard ? value.code : "external-io-or-invalid-response" });
      throw value;
    }
  }
  async function inventory(kind: "documents" | "memories", empty = false): Promise<Record<string, unknown>[]> {
    const field = kind === "documents" ? "memories" : "memoryEntries", maximum = kind === "documents" ? b.maximumDocuments : b.maximumMemoryEntries;
    const path = kind === "documents" ? "/v3/documents/list" : "/v4/memories/list";
    const rows: Record<string, unknown>[] = [], seen = new Set<string>();
    let total: number | null = null, pages = 1;
    for (let page = 1; page <= pages; page++) {
      const result = record((await call("inventory", "POST", path, { containerTags: [plan.namespace], limit: 100, page })).value, [field, "pagination"]);
      const paging = record(result.pagination, ["currentPage", "limit", "totalItems", "totalPages"]);
      const count = number(paging.totalItems, 0, maximum), declared = number(paging.totalPages, 0, Math.ceil(maximum / 100));
      need(paging.currentPage === page && paging.limit === 100 && declared === (count === 0 ? declared : Math.ceil(count / 100))
        && (count !== 0 || declared <= 1) && (total === null || total === count), "inventory-pagination");
      total = count; pages = Math.max(1, declared);
      const entries = list(result[field], 100);
      need(!empty || count === 0 && entries.length === 0, "scope-not-empty");
      for (const row of entries) {
        need(isPlainRecord(row), "inventory-row"); const key = id(row.id);
        need(!seen.has(key), "inventory-duplicate"); seen.add(key); rows.push(row);
      }
    }
    need(rows.length === total, "inventory-incomplete"); return rows;
  }
  try {
    await inventory("documents", true); await inventory("memories", true); fresh = true;
    const ingestStart = now();
    for (const body of plan.documents) {
      const result = record((await call("ingest", "POST", "/v3/documents", body, [200], Infinity, body)).value, ["id", "status"]);
      const documentId = id(result.id); text(result.status, 128);
      need(![...accepted.values()].some(row => row.id === documentId), "duplicate-accepted-document");
      accepted.set(body.customId, { id: documentId, body, submittedAt: submissionStarted.get(body.customId)! });
    }
    for (const row of accepted.values()) {
      // Includes upload transport time and time waiting behind every other upload.
      const end = row.submittedAt + b.readinessTimeoutMs;
      let ready = false;
      for (let poll = 0; poll < b.maximumPollsPerDocument; poll++) {
        if (poll) await pause(b.pollIntervalMs, end);
        const result = (await call("readiness", "GET", `/v3/documents/${row.id}`, null, [200], end)).value;
        const state = document(result, row.body, row.id);
        observations.push({ documentId: row.id, elapsedMs: now() - row.submittedAt, status: state });
        need(state !== "failed", "document-processing-failed");
        if (state === "ready") { ready = true; readyDocuments++; break; }
      }
      need(ready, "document-dreaming-readiness-incomplete");
    }
    ingestionElapsedMs = now() - ingestStart;
    need(readyDocuments === plan.documents.length, "complete-ingestion-barrier");
    const searchStart = now();
    const response = record((await call("search", "POST", "/v4/search", plan.search)).value, ["results", "total", "timing"]);
    searchElapsedMs = now() - searchStart;
    const rows = list(response.results, 20), owned = new Map([...accepted.values()].map(row => [row.id, row.body]));
    need(number(response.total, 0, 20) === rows.length && typeof response.timing === "number"
      && Number.isFinite(response.timing) && response.timing >= 0, "search-total-or-timing");
    providerSearchTimingMs = response.timing;
    const seen = new Set<string>();
    evidence = rows.map((raw, index) => {
      const row = record(raw, ["id", "metadata", "updatedAt", "similarity", "documents"],
        ["memory", "chunk", "version", "rootMemoryId", "context", "chunks", "isAggregated", "filepath"]);
      const providerId = id(row.id); need(!seen.has(providerId), "duplicate-search-result"); seen.add(providerId);
      need(Object.hasOwn(row, "memory") !== Object.hasOwn(row, "chunk"), "search-evidence-kind");
      need(!Object.hasOwn(row, "isAggregated") || row.isAggregated === false, "undeclared-search-expansion");
      if (Object.hasOwn(row, "context")) {
        const context = record(row.context, [], ["parents", "children", "related"]);
        for (const rows of Object.values(context)) need(list(rows, 0).length === 0, "undeclared-search-expansion");
      }
      need(!Object.hasOwn(row, "chunks") || list(row.chunks, 0).length === 0, "undeclared-search-expansion");
      need(row.metadata === null || isPlainRecord(row.metadata), "search-metadata");
      need(typeof row.similarity === "number" && Number.isFinite(row.similarity) && row.similarity >= 0 && row.similarity <= 1, "search-similarity");
      text(row.updatedAt, 128);
      const refs = list(row.documents, b.maximumDocuments), seenRefs = new Set<string>();
      need(refs.length > 0, "unmapped-search-evidence");
      const documentReferences = refs.map(rawRef => {
        const ref = record(rawRef, ["id", "createdAt", "updatedAt"], ["title", "type", "metadata", "summary"]), documentId = id(ref.id);
        const source = owned.get(documentId); need(source && !seenRefs.has(documentId), "search-source-ownership"); seenRefs.add(documentId);
        return { documentId, sourceUnitId: source.metadata.sourceUnitId, sourceUnitSha256: source.metadata.sourceUnitSha256 };
      });
      return { rank: index + 1, kind: Object.hasOwn(row, "memory") ? "provider-generated-memory" as const : "provider-document-chunk" as const,
        providerId, content: text(row.memory ?? row.chunk, 65_536), similarity: row.similarity,
        documentReferences, sourceTextAuthenticated: false as const };
    });
    retrievalCaptured = true;
  } catch (value) { error("work", value); }
  phase = "cleanup"; cleanupEnd = Math.min(started + b.workTimeoutMs + b.cleanupTimeoutMs, now() + b.cleanupTimeoutMs);
  try {
    if (fresh && submitted.size > 0) {
      const docs = await inventory("documents"), memories = await inventory("memories"), owned = new Set<string>(), found = new Set<string>();
      for (const doc of docs) {
        const customId = text(doc.customId, 100), body = submitted.get(customId), documentId = id(doc.id);
        need(body && !found.has(customId), "foreign-or-duplicate-cleanup-document");
        need(!accepted.has(customId) || accepted.get(customId)!.id === documentId, "cleanup-accepted-identity");
        document(doc, body, documentId); found.add(customId); owned.add(documentId);
        if (!accepted.has(customId)) accepted.set(customId, { id: documentId, body, submittedAt: submissionStarted.get(customId)! });
      }
      for (const memory of memories) {
        const refs = list(memory.documentIds, b.maximumDocuments);
        need(refs.length > 0 && new Set(refs).size === refs.length && refs.every(ref => typeof ref === "string" && owned.has(ref)), "foreign-or-unmapped-cleanup-memory");
      }
      for (const row of accepted.values()) if (!owned.has(row.id)) await call("absence", "GET", `/v3/documents/${row.id}`, null, [404]);
      const deleted = await call("delete", "DELETE", `/v3/container-tags/${plan.namespace}`, null, [200, 404]);
      if (deleted.status === 404) need(owned.size === 0 && memories.length === 0, "missing-owned-delete-receipt");
      else {
        const receipt = record(deleted.value, ["success", "containerTag", "deletedDocumentsCount", "deletedMemoriesCount"]);
        need(receipt.success === true && receipt.containerTag === plan.namespace && receipt.deletedDocumentsCount === owned.size, "owned-delete-receipt");
        number(receipt.deletedMemoriesCount, 0, memories.length);
      }
      for (const documentId of owned) await call("absence", "GET", `/v3/documents/${documentId}`, null, [404]);
      for (let observation = 0; observation < 2; observation++) {
        if (observation) await pause(b.cleanupObservationDelayMs);
        await inventory("documents", true); await inventory("memories", true);
      }
      cleanupObservedAbsent = true;
    } else if (fresh && submitted.size === 0) cleanupObservedAbsent = true;
  } catch (value) { error("cleanup", value); }
  const uncertainWriteCustomIds = [...submitted.keys()].filter(customId => !accepted.has(customId));
  const result = freeze({ protocol: "oh.framework-pilot-supermemory-outcome.v1", planSha256: plan.planSha256,
    namespace: plan.namespace, target: plan.target, profile: plan.profile.identity,
    success: retrievalCaptured && cleanupObservedAbsent && errors.length === 0 && uncertainWriteCustomIds.length === 0,
    retrievalCaptured, readyDocuments, evidence, uncertainWriteCustomIds,
    acceptedDocuments: [...accepted.values()].map(row => ({ customId: row.body.customId, documentId: row.id,
      sourceUnitId: row.body.metadata.sourceUnitId, sourceUnitSha256: row.body.metadata.sourceUnitSha256 })),
    cleanupObservedAbsent, cleanupMeaning: "Scoped absence at two observations; no physical-erasure, worker-cancellation or final-cost guarantee.",
    providerFinalSettlementVerified: false, liveTransportQualified: false, errors, readinessObservations: observations,
    counts, requestBytes, responseBytes, ingestionElapsedMs, searchElapsedMs, providerSearchTimingMs, elapsedMs: now() - started });
  if (journalHealthy) await append({ kind: "outcome", result });
  return result;
}
