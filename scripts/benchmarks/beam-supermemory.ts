import { canonicalJson, canonicalSha256, isPlainRecord, parseCanonicalInstantV1, sha256Hex } from "../../src/canonical";
import { parseBeamEvaluationDataV1 } from "./beam-evaluation";
import { parseFrameworkPilotSourceV1 } from "./framework-pilot-source-v1";
import { FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1, type FrameworkPilotSupermemoryEvidenceV1,
  type FrameworkPilotSupermemoryTargetV1 } from "./framework-pilot-supermemory-v1";

export const BEAM_SUPERMEMORY_SESSION_PROTOCOL_V1 = "oh.beam-supermemory-sessions.v1" as const;
function need(value: unknown, reason: string): asserts value { if (!value) throw new TypeError(`BEAM Supermemory: ${reason}.`); }
function record(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  need(isPlainRecord(input), "plain object required");
  const keys = Reflect.ownKeys(input), allowed = [...required, ...optional];
  need(required.every(key => Object.hasOwn(input, key)) && keys.every(key => typeof key === "string" && allowed.includes(key)), "unexpected or missing fields");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    need(descriptor?.enumerable && "value" in descriptor, "enumerable data fields required"); result[key as string] = descriptor.value;
  }
  return result;
}
function text(input: unknown, maximum: number): string {
  need(typeof input === "string" && input.length > 0 && input.length <= maximum && Buffer.byteLength(input) <= maximum
    && !/\p{Surrogate}/u.test(input), "bounded text required"); return input;
}
function id(input: unknown): string { const value = text(input, 128); need(/^[A-Za-z0-9_-]+$/u.test(value), "provider ID required"); return value; }
function array(input: unknown, maximum: number): unknown[] {
  need(Array.isArray(input) && input.length <= maximum && Reflect.ownKeys(input).length === input.length + 1, "bounded dense array required");
  return Array.from({ length: input.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    need(descriptor?.enumerable && "value" in descriptor, "array data items required"); return descriptor.value;
  });
}
function freeze<T>(input: T): T {
  if (input !== null && typeof input === "object") { for (const value of Object.values(input)) freeze(value); Object.freeze(input); }
  return input;
}
function documentDate(input: unknown): string {
  const date = text(input, 32);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    need(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date, "valid document date required");
  } else need(parseCanonicalInstantV1(date) !== null, "canonical document instant required");
  return date;
}

/** Pure source-only session projection. This intentionally differs from the
 * framework pilot's later per-unit experiment. Its transport, spending, cleanup
 * and live provider behavior still require a separately qualified owner. */
export function prepareBeamSupermemorySessionsV1(input: unknown) {
  const row = record(input, ["protocol", "target", "namespace", "source", "documentDates", "dreaming"]);
  need(row.protocol === BEAM_SUPERMEMORY_SESSION_PROTOCOL_V1, "input protocol");
  const target = record(row.target, ["origin", "projectId", "resourceId"]);
  need(target.origin === "https://api.supermemory.ai", "provider origin");
  const selectedTarget: FrameworkPilotSupermemoryTargetV1 = { origin: target.origin, projectId: id(target.projectId), resourceId: id(target.resourceId) };
  const namespace = text(row.namespace, 64);
  need(/^oh_beam1_[a-f0-9]{32}$/u.test(namespace), "fresh namespace shape");
  need(row.dreaming === "instant" || row.dreaming === "dynamic", "explicit dreaming profile");
  const source = parseFrameworkPilotSourceV1(row.source), sourceSha256 = canonicalSha256(source);
  const dateRows = array(row.documentDates, source.sessions.length);
  need(dateRows.length === source.sessions.length, "complete document dates required");
  const documents = source.sessions.map((session, index) => {
    const date = record(dateRows[index], ["sourceSha256", "sessionIndex", "sourceDate", "documentDate"]);
    need(date.sourceSha256 === sourceSha256 && date.sessionIndex === session.sessionIndex && date.sourceDate === session.date, "document date source binding");
    const content = canonicalJson(session), sourceUnitId = `session${String(index + 1).padStart(6, "0")}`, sourceUnitSha256 = sha256Hex(content);
    const document = { containerTag: namespace, customId: `${namespace}_${sourceUnitId}`, content,
      documentDate: documentDate(date.documentDate), taskType: "memory", dreaming: row.dreaming,
      metadata: { ohBeamSession: namespace, sourceSha256, sourceUnitId, sourceUnitSha256,
        sourceSessionId: session.sessionId, sourceSessionIndex: session.sessionIndex, sourceContentSha256: sourceUnitSha256 } };
    need(Buffer.byteLength(canonicalJson(document)) <= 1_048_576, "session document request byte bound");
    return document;
  });
  const payload = { protocol: "oh.beam-supermemory-session-plan.v1" as const, target: selectedTarget, namespace, sourceSha256,
    profile: FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1, documents };
  return freeze({ ...payload, planSha256: canonicalSha256(payload) });
}
type Plan = ReturnType<typeof prepareBeamSupermemorySessionsV1>;
type Document = Plan["documents"][number];
export type BeamSupermemoryAcceptanceV1 = Readonly<{ customId: string; documentId: string }>;

function validatePlan(plan: Plan): void {
  const { planSha256, ...payload } = plan;
  need(canonicalSha256(payload) === planSha256 && plan.protocol === "oh.beam-supermemory-session-plan.v1"
    && canonicalJson(plan.profile) === canonicalJson(FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1), "plan identity mismatch");
}
function identityMap(plan: Plan, input: unknown) {
  validatePlan(plan);
  const rows = array(input, plan.documents.length);
  need(rows.length === plan.documents.length, "complete accepted documents required");
  const expected = new Map(plan.documents.map(document => [document.customId, document])), accepted = new Map<string, { documentId: string; body: Document }>();
  const aliases = new Map<string, { documentId: string; body: Document }>();
  for (const raw of rows) {
    const row = record(raw, ["customId", "documentId"]), customId = id(row.customId), documentId = id(row.documentId), body = expected.get(customId);
    need(body && !accepted.has(customId), "foreign or duplicate accepted document");
    const value = { documentId, body }; accepted.set(customId, value);
    for (const alias of new Set([customId, documentId])) { need(!aliases.has(alias), "ambiguous document alias"); aliases.set(alias, value); }
  }
  return { accepted, aliases };
}
function sourceOwnership(value: Record<string, unknown>, documentId: string, body: Document): void {
  need(value.id === documentId && value.customId === body.customId && canonicalJson(value.containerTags) === canonicalJson([body.containerTag]), "document identity mismatch");
  const metadata = value.metadata;
  need(isPlainRecord(metadata) && Object.entries(body.metadata).every(([key, expected]) => metadata[key] === expected), "document source metadata mismatch");
}

/** GET observations, not list rows, must authenticate every accepted document.
 * Failure and incomplete dreaming disqualify search; neither counts as ready. */
export function validateBeamSupermemoryReadinessV1(plan: Plan, acceptedInput: unknown, observationsInput: unknown) {
  const identity = identityMap(plan, acceptedInput), observations = array(parseBeamEvaluationDataV1(observationsInput, 33_554_432), plan.documents.length);
  need(observations.length === plan.documents.length, "complete readiness observations required");
  const seen = new Set<string>();
  for (const value of observations) {
    need(isPlainRecord(value), "document observation required");
    const customId = id(value.customId), owned = identity.accepted.get(customId);
    need(owned && !seen.has(customId), "foreign or duplicate readiness observation"); seen.add(customId);
    sourceOwnership(value, owned.documentId, owned.body);
    need(value.status !== "failed", "document failed");
    need(value.status === "done" && value.dreamingStatus === "done", "document and dreaming readiness incomplete");
    need(value.raw === owned.body.content || value.content === owned.body.content, "ready source echo mismatch");
  }
  return freeze({ planSha256: plan.planSha256, readyDocuments: seen.size, searchAdmitted: true as const });
}

/** Construct the declared query only after validating complete GET readiness.
 * The owner still supplies the qualified transport and its bounded journal. */
export function buildBeamSupermemorySearchRequestV1(plan: Plan, acceptedInput: unknown, observationsInput: unknown, query: unknown) {
  validateBeamSupermemoryReadinessV1(plan, acceptedInput, observationsInput);
  const { identity: _identity, ...profile } = plan.profile;
  return freeze({ method: "POST" as const, path: "/v4/search" as const,
    body: { containerTag: plan.namespace, q: text(query, 16_384), ...profile } });
}

/** Keep provider-generated statements and chunks verbatim, with every exact
 * source reference. An unmapped row invalidates retrieval; no suffix guesses. */
export function parseBeamSupermemorySearchV1(plan: Plan, acceptedInput: unknown, observationsInput: unknown, input: unknown) {
  const readiness = validateBeamSupermemoryReadinessV1(plan, acceptedInput, observationsInput), identity = identityMap(plan, acceptedInput);
  const response = record(parseBeamEvaluationDataV1(input, 4_194_304), ["results", "total", "timing"]);
  const rows = array(response.results, plan.profile.limit);
  need(response.total === rows.length && typeof response.timing === "number" && Number.isFinite(response.timing) && response.timing >= 0, "search total or timing invalid");
  const seen = new Set<string>();
  const evidence: FrameworkPilotSupermemoryEvidenceV1[] = rows.map((value, index) => {
    const row = record(value, ["id", "metadata", "updatedAt", "similarity", "documents"],
      ["memory", "chunk", "version", "rootMemoryId", "context", "chunks", "isAggregated", "filepath"]);
    const providerId = id(row.id); need(!seen.has(providerId), "duplicate search result"); seen.add(providerId);
    need(Object.hasOwn(row, "memory") !== Object.hasOwn(row, "chunk"), "exactly one evidence kind required");
    need(!Object.hasOwn(row, "isAggregated") || row.isAggregated === false, "undeclared search expansion");
    if (Object.hasOwn(row, "context")) {
      const context = record(row.context, [], ["parents", "children", "related"]);
      for (const related of Object.values(context)) need(array(related, 0).length === 0, "undeclared search expansion");
    }
    need(!Object.hasOwn(row, "chunks") || array(row.chunks, 0).length === 0, "undeclared search expansion");
    need(row.metadata === null || isPlainRecord(row.metadata), "search metadata invalid");
    need(typeof row.similarity === "number" && Number.isFinite(row.similarity) && row.similarity >= 0 && row.similarity <= 1, "search similarity invalid");
    text(row.updatedAt, 128);
    const refs = array(row.documents, plan.documents.length), seenRefs = new Set<string>();
    need(refs.length > 0, "unmapped search evidence");
    const documentReferences = refs.map(value => {
      const ref = record(value, ["id", "createdAt", "updatedAt"], ["title", "type", "metadata", "summary"]);
      const owned = identity.aliases.get(id(ref.id));
      need(owned && !seenRefs.has(owned.documentId), "foreign or duplicate search source"); seenRefs.add(owned.documentId);
      text(ref.createdAt, 128); text(ref.updatedAt, 128);
      if (ref.metadata !== undefined && ref.metadata !== null) {
        const metadata = ref.metadata;
        need(isPlainRecord(metadata) && Object.entries(owned.body.metadata).every(([key, expected]) => metadata[key] === expected), "search source metadata mismatch");
      }
      return { documentId: owned.documentId, sourceUnitId: owned.body.metadata.sourceUnitId, sourceUnitSha256: owned.body.metadata.sourceUnitSha256 };
    });
    return { rank: index + 1, kind: Object.hasOwn(row, "memory") ? "provider-generated-memory" : "provider-document-chunk",
      providerId, content: text(row.memory ?? row.chunk, 65_536), similarity: row.similarity, documentReferences, sourceTextAuthenticated: false };
  });
  return freeze({ protocol: "oh.beam-supermemory-evidence.v1" as const, planSha256: plan.planSha256, readiness,
    evidence, providerSearchTimingMs: response.timing, emptyRetrieval: evidence.length === 0, liveTransportQualified: false as const });
}

/** Serialize the validated result without replacing generated content with raw
 * source turns. No clipping is performed here: a later packer must declare any
 * omissions, preserve complete references, and use the shared context budget. */
export function renderBeamSupermemoryEvidenceV1(plan: Plan, acceptedInput: unknown, observationsInput: unknown, response: unknown): string {
  const result = parseBeamSupermemorySearchV1(plan, acceptedInput, observationsInput, response);
  return canonicalJson({ protocol: result.protocol, emptyRetrieval: result.emptyRetrieval, evidence: result.evidence });
}
