import { canonicalJson, canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { FrameworkPilotJsonBytesV1 } from "./framework-pilot-json-bytes-v1";
import { prepareFrameworkPilotSupermemoryV1 } from "./framework-pilot-supermemory-v1";

/** Source-only helper. The pinned provider schema describes oldest-first processing
 * within a batch; it does not promise cross-batch or equal-date execution order.
 * Byte limits here are engineering bounds, not provider-published byte quotas. */
export const FRAMEWORK_PILOT_SUPERMEMORY_BATCH_SCHEMA_V2 = Object.freeze({
  url: "https://api.supermemory.ai/openapi.json", bytes: 166_681,
  sha256: "05278ca4fc42dccbfed95eeafca1e1697fd72969ee10f8aa596d75c018171b6f",
  maximumDocuments: 600,
});
export const FRAMEWORK_PILOT_SUPERMEMORY_BATCH_INPUT_V2 = "oh.framework-pilot-supermemory-batch-input.v2";
export const FRAMEWORK_PILOT_SUPERMEMORY_BATCH_OBSERVATIONS_V2 = "oh.framework-pilot-supermemory-batch-observations.v2";

function need(value: unknown, code: string): asserts value {
  if (!value) throw new TypeError(`Framework pilot Supermemory batch: ${code}.`);
}
function record(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  need(isPlainRecord(input), "plain-record");
  const keys = Reflect.ownKeys(input), allowed = [...required, ...optional];
  need(keys.length <= allowed.length && keys.every(key => typeof key === "string" && allowed.includes(key)), "record-fields");
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    need(descriptor && descriptor.enumerable && "value" in descriptor, "data-properties");
    output[key as string] = descriptor.value;
  }
  need(required.every(key => Object.hasOwn(output, key)), "required-fields");
  return output;
}
function list(input: unknown, maximum: number): unknown[] {
  need(Array.isArray(input), "array");
  const length = Object.getOwnPropertyDescriptor(input, "length")?.value;
  need(Number.isSafeInteger(length) && length >= 0 && length <= maximum && Reflect.ownKeys(input).length === length + 1, "array-bound");
  const output: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    need(descriptor && descriptor.enumerable && "value" in descriptor, "dense-data-array");
    output.push(descriptor.value);
  }
  return output;
}
function integer(input: unknown, minimum: number, maximum: number): number {
  need(typeof input === "number" && Number.isSafeInteger(input) && !Object.is(input, -0)
    && input >= minimum && input <= maximum, "integer-bound");
  return input;
}
function text(input: unknown, maximum: number, allowEmpty = false): string {
  need(typeof input === "string" && (allowEmpty || input.length > 0) && input.length <= maximum
    && Buffer.byteLength(input) <= maximum && !/\p{Surrogate}/u.test(input), "text-bound");
  return input;
}
function providerId(input: unknown): string {
  const value = text(input, 128);
  need(/^[A-Za-z0-9_-]+$/u.test(value) && value !== "unknown", "provider-id");
  return value;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const bufferGetter = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
function responseBytes(input: unknown): Buffer {
  need(input instanceof Uint8Array, "response-bytes");
  // Read intrinsic slots rather than foreign accessors, and detach before parsing.
  const length: number = byteLengthGetter.call(input), buffer: unknown = bufferGetter.call(input);
  need(length > 0 && length <= 1_048_576 && !(buffer instanceof SharedArrayBuffer), "response-byte-bound");
  const detached = new Uint8Array(length);
  Uint8Array.prototype.set.call(detached, input);
  return Buffer.from(detached);
}

type Batch = Readonly<{
  ordinal: number; firstDocumentIndex: number; documentCount: number;
  method: "POST"; path: "/v3/documents/batch"; body: string; bodyBytes: number; bodySha256: string; requestSha256: string;
  customIds: readonly string[]; sourceUnits: readonly Readonly<{ unitId: string; unitSha256: string }>[];
}>;
function prepare(input: unknown) {
  const value = record(input, ["protocol", "caseInput", "maximumBatchBytes", "maximumBatchDocuments"]);
  need(value.protocol === FRAMEWORK_PILOT_SUPERMEMORY_BATCH_INPUT_V2, "input-protocol");
  const maximumBatchBytes = integer(value.maximumBatchBytes, 32_768, 131_072);
  need(maximumBatchBytes === 32_768 || maximumBatchBytes === 131_072, "fixed-byte-profile");
  const maximumBatchDocuments = integer(value.maximumBatchDocuments, 1, 600);
  const source = prepareFrameworkPilotSupermemoryV1(value.caseInput);
  need(source.documents.length > 0, "nonempty-source");
  const batches: Batch[] = [], emptyBytes = Buffer.byteLength(canonicalJson({ documents: [] }));
  let first = 0, count = 0, bytes = emptyBytes;
  function seal() {
    const documents = source.documents.slice(first, first + count), body = canonicalJson({ documents });
    need(count > 0 && Buffer.byteLength(body) === bytes, "whole-request-accounting");
    batches.push({ ordinal: batches.length + 1, firstDocumentIndex: first, documentCount: count,
      method: "POST", path: "/v3/documents/batch", body, bodyBytes: bytes, bodySha256: sha256Hex(body),
      requestSha256: canonicalSha256({ method: "POST", path: "/v3/documents/batch", body }),
      customIds: documents.map(document => document.customId),
      sourceUnits: documents.map(document => ({ unitId: document.metadata.sourceUnitId, unitSha256: document.metadata.sourceUnitSha256 })) });
    first += count; count = 0; bytes = emptyBytes;
  }
  for (const document of source.documents) {
    const size = Buffer.byteLength(canonicalJson(document));
    need(emptyBytes + size <= maximumBatchBytes, "indivisible-document-byte-bound");
    if (count && (count === maximumBatchDocuments || bytes + size + 1 > maximumBatchBytes)) seal();
    bytes += size + Number(count > 0); count++;
  }
  if (count) seal();
  need(first === source.documents.length, "complete-source-packing");
  const payload = { protocol: "oh.framework-pilot-supermemory-batch-plan.v2" as const,
    schema: FRAMEWORK_PILOT_SUPERMEMORY_BATCH_SCHEMA_V2, inputPlanSha256: source.planSha256,
    target: source.target, namespace: source.namespace, sourceSha256: source.sourceSha256, bundleSha256: source.bundleSha256,
    dreaming: source.documents[0]!.dreaming, maximumBatchBytes, maximumBatchDocuments,
    documentCount: source.documents.length, batches, ingestionRequestCount: batches.length,
    totalRequestBytes: batches.reduce((total, batch) => total + batch.bodyBytes, 0),
    requestOrder: "contiguous-source-order" as const,
    providerDocumentOrder: "documentDate-oldest-first-within-batch; cross-batch-and-tie-order-unspecified" as const,
    automaticRetries: 0 as const, liveTransportQualified: false as const, readinessVerified: false as const };
  return { source, plan: freeze({ ...payload, planSha256: canonicalSha256(payload) }) };
}

/** Plans only: whole source units, explicit per-document dates/task/dreaming, no
 * batch defaults, sorting, splitting, fallback or I/O. V1's preparer validates
 * source input; its single-upload request allocations do not govern a V2 owner. */
export function prepareFrameworkPilotSupermemoryBatchV2(input: unknown) { return prepare(input).plan; }
export type FrameworkPilotSupermemoryBatchPlanV2 = ReturnType<typeof prepareFrameworkPilotSupermemoryBatchV2>;

type ResultRow = Readonly<{ id: string; status: string; error?: string; details?: string; url?: string }>;
function acknowledgement(raw: Buffer, batch: Batch, planSha256: string) {
  // The scanner rejects malformed UTF-8, duplicate decoded keys, excessive depth
  // and non-scalar strings before JSON.parse can discard evidence of ambiguity.
  const scanned = new FrameworkPilotJsonBytesV1(raw);
  const value = record(JSON.parse(raw.toString("utf8")), ["results", "failed", "success"]);
  const success = integer(value.success, 0, batch.documentCount), failed = integer(value.failed, 0, batch.documentCount);
  const rows = list(value.results, 600);
  need(rows.length === batch.documentCount && success + failed === rows.length, "acknowledgement-counts");
  const successfulReportedIds: string[] = [], seen = new Set<string>();
  let observedFailed = 0;
  const results: ResultRow[] = rows.map(rawRow => {
    const row = record(rawRow, ["id", "status"], ["error", "details", "url"]), status = text(row.status, 128);
    const result: { id: string; status: string; error?: string; details?: string; url?: string } = {
      id: text(row.id, 128, true), status,
    };
    for (const key of ["error", "details", "url"] as const) {
      if (Object.hasOwn(row, key)) result[key] = text(row[key], 16_384, true);
    }
    if (status === "error" || status === "failed") {
      // Failed IDs are literal diagnostics (including empty/unknown), never joins.
      observedFailed++;
    } else {
      need(["unknown", "queued", "extracting", "chunking", "embedding", "indexing", "done"].includes(status)
        && !["error", "details", "url"].some(key => Object.hasOwn(row, key)), "acknowledgement-status");
      const id = providerId(result.id);
      need(!seen.has(id), "duplicate-successful-id"); seen.add(id); successfulReportedIds.push(id);
    }
    return result;
  });
  need(observedFailed === failed && successfulReportedIds.length === success, "acknowledgement-status-counts");
  return freeze({ protocol: "oh.framework-pilot-supermemory-batch-acknowledgement.v2" as const,
    planSha256, batchOrdinal: batch.ordinal, requestSha256: batch.requestSha256,
    responseSha256: scanned.sha256, responseBytes: raw.byteLength, reportedSuccess: success, reportedFailed: failed,
    allReportedAccepted: failed === 0, results, successfulReportedIds,
    membershipUnreconciled: true as const, readinessVerified: false as const, liveTransportQualified: false as const });
}

/** The owner must durably capture the first raw response before calling this
 * parser. Invalid/partial/uncertain results stop ingestion, without retries.
 * Successful reported IDs are unordered; response positions never identify units.
 * The exact original input is revalidated instead of trusting a foreign plan. */
export function parseFrameworkPilotSupermemoryBatchAckV2(bytes: unknown, input: unknown, batchOrdinal: unknown) {
  const raw = responseBytes(bytes), { plan } = prepare(input);
  const ordinal = integer(batchOrdinal, 1, plan.batches.length);
  return acknowledgement(raw, plan.batches[ordinal - 1]!, plan.planSha256);
}

const metadataFields = ["ohFrameworkPilot", "sourceSha256", "sourceBundleSha256", "sourceUnitId", "sourceUnitSha256", "sourceContentSha256"] as const;
type OwnedDocument = Readonly<{ customId: string; documentId: string; sourceUnitId: string; sourceUnitSha256: string }>;

/** Joins only supplied observations. Inventory is a minimum ownership projection
 * of preserved provider list rows; pagination completeness remains external.
 * Null ACK bytes mean an unknown/invalid response already preserved by the owner.
 * Every document in an attempted batch was a possible write. Neither complete
 * membership nor cleanup-only ownership admits search or deletion by itself. */
export function reconcileFrameworkPilotSupermemoryBatchV2(input: unknown, observations: unknown) {
  const { source, plan } = prepare(input);
  const value = record(observations, ["protocol", "attemptedBatchCount", "acknowledgements", "inventory"]);
  need(value.protocol === FRAMEWORK_PILOT_SUPERMEMORY_BATCH_OBSERVATIONS_V2, "observations-protocol");
  const attempted = integer(value.attemptedBatchCount, 0, plan.batches.length), rawAcks = list(value.acknowledgements, plan.batches.length);
  need(rawAcks.length === attempted, "attempted-acknowledgement-count");
  let responseTotalBytes = 0;
  const acknowledgements = rawAcks.map((bytes, index) => {
    if (bytes === null) return null;
    const raw = responseBytes(bytes); responseTotalBytes += raw.byteLength;
    need(responseTotalBytes <= 8_388_608, "aggregate-acknowledgement-bytes");
    return acknowledgement(raw, plan.batches[index]!, plan.planSha256);
  });
  need(acknowledgements.slice(0, -1).every(ack => ack?.allReportedAccepted), "attempt-after-failed-or-uncertain-batch");
  const possibleCount = plan.batches.slice(0, attempted).reduce((total, batch) => total + batch.documentCount, 0);
  const possible = source.documents.slice(0, possibleCount), expected = new Map(possible.map(document => [document.customId, document]));
  const owned = new Map<string, OwnedDocument>(), ownedIds = new Map<string, string>();
  for (const rawRow of list(value.inventory, possibleCount)) {
    const row = record(rawRow, ["id", "customId", "containerTags", "metadata"]);
    const customId = text(row.customId, 100), documentId = providerId(row.id), body = expected.get(customId);
    need(body && !owned.has(customId) && !ownedIds.has(documentId), "foreign-or-duplicate-inventory-document");
    const tags = list(row.containerTags, 1), metadata = record(row.metadata, metadataFields);
    need(tags.length === 1 && tags[0] === plan.namespace
      && metadataFields.every(key => metadata[key] === body.metadata[key]), "inventory-source-ownership");
    owned.set(customId, { customId, documentId, sourceUnitId: body.metadata.sourceUnitId, sourceUnitSha256: body.metadata.sourceUnitSha256 });
    ownedIds.set(documentId, customId);
  }
  const reportedIds = new Set<string>(), unmatchedSuccessfulDocumentIds: string[] = [];
  for (const [index, ack] of acknowledgements.entries()) {
    for (const documentId of ack?.successfulReportedIds ?? []) {
      need(!reportedIds.has(documentId), "duplicate-id-across-batches"); reportedIds.add(documentId);
      const customId = ownedIds.get(documentId);
      if (customId === undefined) unmatchedSuccessfulDocumentIds.push(documentId);
      else need(plan.batches[index]!.customIds.includes(customId), "acknowledgement-cross-batch-identity");
    }
  }
  const sourceOrderOwnedDocuments = possible.flatMap(document => owned.has(document.customId) ? [owned.get(document.customId)!] : []);
  const missingPossibleCustomIds = possible.filter(document => !owned.has(document.customId)).map(document => document.customId);
  const unreportedOwnedDocumentIds = sourceOrderOwnedDocuments.filter(document => !reportedIds.has(document.documentId)).map(document => document.documentId);
  const uncertainBatchOrdinals = acknowledgements.flatMap((ack, index) => ack === null ? [index + 1] : []);
  const failedBatchOrdinals = acknowledgements.flatMap((ack, index) => ack !== null && !ack.allReportedAccepted ? [index + 1] : []);
  const sourceMembershipComplete = attempted === plan.batches.length && uncertainBatchOrdinals.length === 0 && failedBatchOrdinals.length === 0
    && missingPossibleCustomIds.length === 0 && unmatchedSuccessfulDocumentIds.length === 0 && unreportedOwnedDocumentIds.length === 0;
  const payload = { protocol: "oh.framework-pilot-supermemory-batch-reconciliation.v2" as const, planSha256: plan.planSha256,
    attemptedBatchCount: attempted, unattemptedDocumentCount: plan.documentCount - possibleCount,
    acknowledgements, sourceOrderOwnedDocuments, missingPossibleCustomIds, unmatchedSuccessfulDocumentIds, unreportedOwnedDocumentIds,
    uncertainBatchOrdinals, failedBatchOrdinals, sourceMembershipComplete,
    inventoryCompletenessVerified: false as const, readinessVerified: false as const,
    liveTransportQualified: false as const, searchAdmitted: false as const, deletionAdmitted: false as const };
  return freeze({ ...payload, reconciliationSha256: canonicalSha256(payload) });
}
