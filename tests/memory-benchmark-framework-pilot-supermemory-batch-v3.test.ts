import { describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { createFrameworkPilotSourceUnitsV1, FRAMEWORK_PILOT_SOURCE_V1, FRAMEWORK_PILOT_SPLIT_PLAN_V1 } from "../scripts/benchmarks/framework-pilot-source-v1";
import { prepareFrameworkPilotSupermemoryV1 } from "../scripts/benchmarks/framework-pilot-supermemory-v1";
import { FRAMEWORK_PILOT_SUPERMEMORY_BATCH_INPUT_V3, FRAMEWORK_PILOT_SUPERMEMORY_BATCH_OBSERVATIONS_V3,
  parseFrameworkPilotSupermemoryBatchAckV3, prepareFrameworkPilotSupermemoryBatchV3,
  reconcileFrameworkPilotSupermemoryBatchV3 } from "../scripts/benchmarks/framework-pilot-supermemory-batch-v3";
import { prepareFrameworkPilotSupermemoryBatchV2, parseFrameworkPilotSupermemoryBatchAckV2,
  reconcileFrameworkPilotSupermemoryBatchV2 } from "../scripts/benchmarks/framework-pilot-supermemory-batch-v2";

function fixture(texts = [" A🦀e\u0301é\n\0Z ", "", 'Earlier "quotes" \\ stay verbatim.\r\n']) {
  const source = { protocol: FRAMEWORK_PILOT_SOURCE_V1, sessions: [
    { sessionId: "s0001", sessionIndex: 0, date: "2025/03/01 12:00", turns: texts.slice(0, 2).map((text, i) => ({ role: i ? "assistant" : "user", text })) },
    { sessionId: "s0002", sessionIndex: 1, date: "", turns: [] },
    { sessionId: "s0001", sessionIndex: 2, date: "2025/01/01 08:00", turns: texts.slice(2).map(text => ({ role: "user", text })) },
  ] };
  const sourceSha256 = canonicalSha256(source);
  const splitPlan = { protocol: FRAMEWORK_PILOT_SPLIT_PLAN_V1, sourceSha256,
    turns: source.sessions.flatMap(session => session.turns.map((turn, i) => ({ turnId: `${session.sessionId}#${session.sessionIndex}:${i}`,
      spans: [{ startByte: 0, endByte: Buffer.byteLength(turn.text) }] }))) };
  const caseInput = { protocol: "oh.framework-pilot-supermemory-input.v1", namespace: "oh_fp1_0123456789abcdef0123456789abcdef",
    target: { origin: "https://api.supermemory.ai", projectId: "synthetic_project", resourceId: "synthetic_resource" },
    query: "What did the speaker say?", dreaming: "dynamic", source, splitPlan,
    sourceUnits: createFrameworkPilotSourceUnitsV1(source, splitPlan),
    documentDates: source.sessions.map((session, i) => ({ sourceSha256, sessionIndex: i, sourceDate: session.date,
      documentDate: ["2025-03-01", "2025-02-01", "2025-01-01"][i]! })),
    budget: { maximumDocuments: Math.max(1, texts.length), maximumMemoryEntries: 2_000,
      maximumMainRequests: 3 + 2 * texts.length, maximumCleanupRequests: texts.length + Math.ceil(texts.length / 100) + 25,
      maximumRequestBytes: 1_048_576, maximumResponseBytes: 1_048_576,
      maximumMainResponseBytes: 8_388_608, maximumCleanupResponseBytes: 8_388_608,
      requestTimeoutMs: 20_000, workTimeoutMs: 600_000, cleanupTimeoutMs: 180_000,
      readinessTimeoutMs: 300_000, maximumPollsPerDocument: 61, pollIntervalMs: 5_000, cleanupObservationDelayMs: 10_000 } };
  return { protocol: FRAMEWORK_PILOT_SUPERMEMORY_BATCH_INPUT_V3, caseInput, maximumBatchBytes: 131_072, maximumBatchDocuments: 2 };
}
type Input = ReturnType<typeof fixture>;
const raw = (value: unknown) => Buffer.from(JSON.stringify(value));
function ack(ids: string[]) { return raw({ results: ids.map(id => ({ id, status: "queued" })), success: ids.length, failed: 0 }); }
function inventory(input: Input) {
  return prepareFrameworkPilotSupermemoryV1(input.caseInput).documents.map((document, i) => ({ id: `doc_${i + 1}`,
    customId: document.customId, containerTags: [document.containerTag], metadata: { ...document.metadata } }));
}
function observations(input: Input) {
  const plan = prepareFrameworkPilotSupermemoryBatchV3(input);
  return { protocol: FRAMEWORK_PILOT_SUPERMEMORY_BATCH_OBSERVATIONS_V3, attemptedBatchCount: plan.batches.length,
    acknowledgements: plan.batches.map(batch => ack(batch.customIds.map((_, i) => `doc_${batch.firstDocumentIndex + i + 1}`))) as Array<Uint8Array | null>,
    inventory: inventory(input) };
}
function fixtureAtBytes(cap: number) {
  let low = 0, high = cap;
  while (low < high) {
    const middle = Math.floor((low + high) / 2), input = fixture(["x".repeat(middle)]);
    const documents = prepareFrameworkPilotSupermemoryV1(input.caseInput).documents.map(({ dreaming: _dreaming, ...document }) => document);
    const bytes = Buffer.byteLength(canonicalJson({ documents, dreaming: input.caseInput.dreaming }));
    if (bytes < cap) low = middle + 1; else high = middle;
  }
  return fixture(["x".repeat(low)]);
}

describe("pure Supermemory whole-source batch plans", () => {
  test("preserves exact common documents, repeated occurrences, empty text, dates and source order", () => {
    const input = fixture(), source = prepareFrameworkPilotSupermemoryV1(input.caseInput);
    const plan = prepareFrameworkPilotSupermemoryBatchV3(input), documents = plan.batches.flatMap(batch => JSON.parse(batch.body).documents);
    expect(documents).toEqual(source.documents.map(({ dreaming: _dreaming, ...document }) => document));
    expect(plan.batches.map(batch => batch.documentCount)).toEqual([2, 1]);
    expect(plan.batches.map(batch => batch.firstDocumentIndex)).toEqual([0, 2]);
    expect(documents.map(document => document.documentDate)).toEqual(["2025-03-01", "2025-03-01", "2025-01-01"]);
    expect(documents.map(document => JSON.parse(document.content).text)).toEqual([" A🦀e\u0301é\n\0Z ", "", 'Earlier "quotes" \\ stay verbatim.\r\n']);
    expect(documents.map(document => JSON.parse(document.content).sessionIndex)).toEqual([0, 0, 2]);
    expect(plan.inputPlanSha256).toBe(source.planSha256);
    expect(plan.dreaming).toBe("dynamic");
    expect(plan.providerDocumentOrder).toContain("oldest-first-within-batch");
    expect(plan.liveTransportQualified).toBeFalse(); expect(plan.readinessVerified).toBeFalse();
    for (const batch of plan.batches) {
      expect(Object.keys(JSON.parse(batch.body))).toEqual(["documents", "dreaming"]);
      expect(JSON.parse(batch.body).dreaming).toBe("dynamic");
      expect(JSON.parse(batch.body).documents.every((document: unknown) => !Object.hasOwn(document as object, "dreaming"))).toBeTrue();
      expect(batch.bodyBytes).toBe(Buffer.byteLength(batch.body));
      expect(batch.bodySha256).toBe(sha256Hex(batch.body));
      expect(batch.requestSha256).toBe(canonicalSha256({ method: "POST", path: "/v3/documents/batch", body: batch.body }));
      expect(Object.isFrozen(batch.sourceUnits[0])).toBeTrue(); expect(Object.isFrozen(batch.customIds)).toBeTrue();
    }
    expect(plan.totalRequestBytes).toBe(plan.batches.reduce((sum, batch) => sum + batch.bodyBytes, 0));
    const { planSha256, ...payload } = plan;
    expect(planSha256).toBe(canonicalSha256(payload));
    const frozen = canonicalJson(plan);
    input.caseInput.source.sessions[0]!.turns[0]!.text = "changed";
    expect(canonicalJson(plan)).toBe(frozen);
    expect(() => prepareFrameworkPilotSupermemoryBatchV3(input)).toThrow();
  });

  test("sets dynamic or instant once per request and preserves every other single-document field", () => {
    for (const dreaming of ["dynamic", "instant"]) {
      const input = fixture(); input.caseInput.dreaming = dreaming;
      const original = prepareFrameworkPilotSupermemoryV1(input.caseInput), plan = prepareFrameworkPilotSupermemoryBatchV3(input);
      const expected = original.documents.map(({ dreaming: _dreaming, ...document }) => document);
      expect(plan.protocol).toBe("oh.framework-pilot-supermemory-batch-plan.v3");
      expect(plan.inputPlanSha256).toBe(original.planSha256); expect(plan.dreaming).toBe(dreaming);
      expect(plan.batches.flatMap(batch => JSON.parse(batch.body).documents)).toEqual(expected);
      for (const batch of plan.batches) {
        const request = JSON.parse(batch.body);
        expect(request.dreaming).toBe(dreaming); expect(Object.keys(request)).toEqual(["documents", "dreaming"]);
        for (const document of request.documents) {
          expect(Object.keys(document).sort()).toEqual(["containerTag", "content", "customId", "documentDate", "metadata", "taskType"]);
          expect(document.taskType).toBe("memory"); expect(document).not.toHaveProperty("dreaming");
        }
        expect(batch.body).toBe(canonicalJson({ documents: expected.slice(batch.firstDocumentIndex, batch.firstDocumentIndex + batch.documentCount), dreaming }));
      }
      // V1's single-document wire stays unchanged and still carries dreaming.
      expect(original.documents.every(document => document.dreaming === dreaming)).toBeTrue();
    }
  });

  test("retains V2 historical plan, acknowledgement and source reconciliation bytes unchanged", () => {
    const input = { ...fixture(), protocol: "oh.framework-pilot-supermemory-batch-input.v2" };
    const plan = prepareFrameworkPilotSupermemoryBatchV2(input);
    const receipt = parseFrameworkPilotSupermemoryBatchAckV2(ack(["doc_2", "doc_1"]), input, 1);
    const observed = { ...observations(fixture()), protocol: "oh.framework-pilot-supermemory-batch-observations.v2" };
    expect(plan.planSha256).toBe("b892d2f608edb3532a3c27423a9a7d580927d73707b6e77d3b0f82b37c7bfe0f");
    expect(plan.batches.map(batch => batch.bodySha256)).toEqual(["9a5aef3fa7243fc8fb9e8d2be1b395c9b3d9a605b57e02e91563e761fada5a06", "818a31bd21f50429d4f1ad2c24f5546a4952d2f3e99455add698bf5a7d876003"]);
    expect(canonicalSha256(receipt)).toBe("1c427e4c534182ce2c3c9ec4cbd79602f81095c9bfa5dd401692ac61b8b13e77");
    expect(reconcileFrameworkPilotSupermemoryBatchV2(input, observed).reconciliationSha256).toBe("e7e0d2542143a3f9ed1d12b6ba4a70b1548fc952bb8f3459b379466336e027e4");
    for (const batch of plan.batches) {
      const request = JSON.parse(batch.body); expect(Object.keys(request)).toEqual(["documents"]);
      expect(request.documents.every((document: any) => document.dreaming === "dynamic")).toBeTrue();
    }
    expect(() => prepareFrameworkPilotSupermemoryBatchV3(input)).toThrow("input-protocol");
  });

  test("enforces complete 32/128 KiB body bytes including wrappers, escapes and separators", () => {
    for (const cap of [32_768, 131_072]) {
      const input = fixtureAtBytes(cap); input.maximumBatchBytes = cap;
      const plan = prepareFrameworkPilotSupermemoryBatchV3(input);
      expect(plan.batches).toHaveLength(1); expect(plan.batches[0]!.bodyBytes).toBe(cap);
      const oversized = fixture([input.caseInput.source.sessions[0]!.turns[0]!.text + "x"]); oversized.maximumBatchBytes = cap;
      expect(() => prepareFrameworkPilotSupermemoryBatchV3(oversized)).toThrow("indivisible-document-byte-bound");
      const unicode = fixture(["🦀\n\"\\".repeat(1_000)]); unicode.maximumBatchBytes = cap;
      const body = prepareFrameworkPilotSupermemoryBatchV3(unicode).batches[0]!;
      expect(body.bodyBytes).toBe(Buffer.byteLength(body.body));
      expect(body.bodyBytes).toBeGreaterThan(body.body.length);
    }
    const nextFit = fixture(["x".repeat(20_000), "y".repeat(20_000), "z"]);
    nextFit.maximumBatchBytes = 32_768; nextFit.maximumBatchDocuments = 600;
    expect(prepareFrameworkPilotSupermemoryBatchV3(nextFit).batches.map(batch => batch.documentCount)).toEqual([1, 2]);
  });

  test("admits the 600-item profile, rejects 601, and preserves all 601 source documents across batches", () => {
    for (const count of [600, 601]) {
      const input = fixture(Array.from({ length: count }, (_, i) => `Authored ${i}`)); input.maximumBatchDocuments = 600;
      const plan = prepareFrameworkPilotSupermemoryBatchV3(input);
      expect(plan.documentCount).toBe(count);
      expect(plan.batches.flatMap(batch => batch.customIds)).toEqual(prepareFrameworkPilotSupermemoryV1(input.caseInput).documents.map(document => document.customId));
      expect(plan.batches.every(batch => batch.documentCount > 0 && batch.documentCount <= 600 && batch.bodyBytes <= 131_072)).toBeTrue();
      expect(plan.batches.length).toBeGreaterThan(1); // Whole-document overhead makes the byte bound dominant here.
      input.maximumBatchDocuments = 601;
      expect(() => prepareFrameworkPilotSupermemoryBatchV3(input)).toThrow("integer-bound");
    }
  });

  test("rejects foreign fields, invalid profiles, source tampering and accessors without invoking them", () => {
    const changes: Array<(input: Input) => void> = [
      input => { Object.assign(input, { answer: "SYNTHETIC_GOLD" }); },
      input => { Object.assign(input.caseInput, { category: "SYNTHETIC_LABEL" }); },
      input => { input.maximumBatchBytes = 32_769; },
      input => { input.maximumBatchBytes = 262_144; },
      input => { input.maximumBatchDocuments = -0; },
      input => { input.maximumBatchDocuments = 1.5; },
      input => { input.caseInput.documentDates[0]!.sourceDate = "changed"; },
      input => { input.caseInput.source.sessions[0]!.turns[0]!.text = "\ud800"; },
    ];
    for (const change of changes) { const input = fixture(); change(input); expect(() => prepareFrameworkPilotSupermemoryBatchV3(input)).toThrow(); }
    for (const key of ["caseInput", "maximumBatchBytes"]) {
      const input = fixture(); let read = false;
      Object.defineProperty(input, key, { enumerable: true, get() { read = true; throw Error("getter"); } });
      expect(() => prepareFrameworkPilotSupermemoryBatchV3(input)).toThrow("data-properties"); expect(read).toBeFalse();
    }
    expect(() => prepareFrameworkPilotSupermemoryBatchV3(fixture([]))).toThrow("at least one turn required");
  });
});

describe("bounded batch acknowledgements and source joins", () => {
  test("pins deterministic plan, request, acknowledgement and reconciliation identities", () => {
    const input = fixture(), plan = prepareFrameworkPilotSupermemoryBatchV3(input);
    const receipt = parseFrameworkPilotSupermemoryBatchAckV3(ack(["doc_2", "doc_1"]), input, 1);
    expect({ planSha256: plan.planSha256, bodySha256: plan.batches.map(batch => batch.bodySha256),
      acknowledgementSha256: canonicalSha256(receipt), reconciliationSha256: reconcileFrameworkPilotSupermemoryBatchV3(input, observations(input)).reconciliationSha256,
    }).toMatchInlineSnapshot(`
      {
        "acknowledgementSha256": "3ddab628824f3c9575a9e1042852e1d09a356612c2eaf20e52f082d060d4c439",
        "bodySha256": [
          "0a616e513fef4476bd348569bea1b650575ae0cbe3ab7ea6f99ec731391c60dd",
          "9df2ff766252ee0afb328bb20e4456a70d7a08a42b89565be6bd8f5b1534f304",
        ],
        "planSha256": "ae97f4c82062ce53d2af62be76a9503c96546fd83dcd3128092bcfbfd48bf5c7",
        "reconciliationSha256": "2938e31ded639c6058fe171d3c27e391e32a8377d80d83d4b86d3446efe58f38",
      }
    `);
  });

  test("reports reversed successful IDs without inferring row-to-source membership", () => {
    const input = fixture(), bytes = ack(["doc_2", "doc_1"]), saved = Buffer.from(bytes);
    const receipt = parseFrameworkPilotSupermemoryBatchAckV3(bytes, input, 1);
    expect(receipt.successfulReportedIds).toEqual(["doc_2", "doc_1"]);
    expect(receipt.allReportedAccepted).toBeTrue(); expect(receipt.membershipUnreconciled).toBeTrue();
    expect(receipt.readinessVerified).toBeFalse(); expect(receipt.liveTransportQualified).toBeFalse();
    expect(receipt.responseSha256).toBe(sha256Hex(bytes)); expect(receipt.responseBytes).toBe(bytes.length);
    expect(bytes).toEqual(saved); bytes.fill(32);
    expect(receipt.responseSha256).toBe(sha256Hex(saved));
    expect(Object.isFrozen(receipt.results[0])).toBeTrue();
  });

  test("preserves literal failed-item diagnostics and empty/unknown IDs without treating HTTP 200 as complete", () => {
    for (const id of ["", "unknown", "failed_input_id"]) {
      const input = fixture(), failure = { id, status: "error", error: "  Original 🦀 failure\r\n", details: "", url: "synthetic://unchanged" };
      const bytes = raw({ results: [{ id: "doc_1", status: "queued" }, failure], success: 1, failed: 1 });
      const receipt = parseFrameworkPilotSupermemoryBatchAckV3(bytes, input, 1);
      expect(receipt.allReportedAccepted).toBeFalse(); expect(receipt.reportedFailed).toBe(1);
      expect(receipt.successfulReportedIds).toEqual(["doc_1"]); expect(receipt.results[1]).toEqual(failure);
      expect(receipt.membershipUnreconciled).toBeTrue();
    }
  });

  test("rejects ambiguous counts, duplicate IDs, unsupported shapes and malformed raw JSON while leaving bytes untouched", () => {
    const input = fixture(), examples = [
      raw({ results: [{ id: "doc_1", status: "queued" }], success: 1, failed: 0 }),
      ack(["doc_1", "doc_1"]), ack(["doc_1", "doc_2", "doc_3"]), ack(["doc_1", "unknown"]),
      raw({ results: [{ id: "doc_1", status: "queued" }, { id: "", status: "error" }], success: 2, failed: 0 }),
      raw({ results: [{ id: "doc_1", status: "queued", error: "contradiction" }, { id: "doc_2", status: "done" }], success: 2, failed: 0 }),
      raw({ results: [{ id: "doc_1", status: "surprise" }, { id: "doc_2", status: "done" }], success: 2, failed: 0 }),
      raw({ results: [{ id: "doc_1", status: "queued", answer: "SYNTHETIC_GOLD" }, { id: "doc_2", status: "done" }], success: 2, failed: 0 }),
      raw({ results: [], success: 0, failed: 2, gold: "SYNTHETIC_GOLD" }),
      Buffer.from('{"results":[],"success":0,"success":2,"failed":0}'),
      Buffer.from('{"results":[{"id":"doc_1","\\u0069d":"doc_2","status":"queued"}],"success":1,"failed":0}'),
      Buffer.from('{"results":[],"success":-0,"failed":2}'), Buffer.from('{"results":[],"success":1e999,"failed":0}'),
      Buffer.from('{"results":[],"success":2,"failed":0,"x":"\\ud800"}'), Buffer.from([123, 34, 120, 34, 58, 34, 0xc0, 0xaf, 34, 125]),
      Buffer.from('['.repeat(34) + '0' + ']'.repeat(34)),
    ];
    for (const bytes of examples) {
      const saved = Buffer.from(bytes); expect(() => parseFrameworkPilotSupermemoryBatchAckV3(bytes, input, 1)).toThrow(); expect(bytes).toEqual(saved);
    }
    for (const ordinal of [0, -0, 3, 1.5]) expect(() => parseFrameworkPilotSupermemoryBatchAckV3(ack(["doc_1", "doc_2"]), input, ordinal)).toThrow();
  });

  test("bounds native byte views before parsing and does not invoke shadowed typed-array accessors", () => {
    const input = fixture();
    for (const bytes of ["{}", new Uint8Array(), new Uint8Array(1_048_577), new Uint8Array(new SharedArrayBuffer(16))]) {
      expect(() => parseFrameworkPilotSupermemoryBatchAckV3(bytes, input, 1)).toThrow();
    }
    const bytes = ack(["doc_1", "doc_2"]); let read = false;
    for (const key of ["byteLength", "buffer", Symbol.iterator]) Object.defineProperty(bytes, key, { get() { read = true; throw Error("getter"); } });
    expect(parseFrameworkPilotSupermemoryBatchAckV3(bytes, input, 1).reportedSuccess).toBe(2); expect(read).toBeFalse();
  });

  test("reconciles unordered acknowledgements and inventory into source order without admitting readiness, search or deletion", () => {
    const input = fixture(), seen = observations(input);
    seen.acknowledgements[0] = ack(["doc_2", "doc_1"]); seen.inventory.reverse();
    const receipt = reconcileFrameworkPilotSupermemoryBatchV3(input, seen);
    expect(receipt.sourceMembershipComplete).toBeTrue();
    expect(receipt.sourceOrderOwnedDocuments.map(document => document.documentId)).toEqual(["doc_1", "doc_2", "doc_3"]);
    expect(receipt.sourceOrderOwnedDocuments.map(document => document.sourceUnitId)).toEqual(["u000001", "u000002", "u000003"]);
    expect(receipt.inventoryCompletenessVerified).toBeFalse(); expect(receipt.readinessVerified).toBeFalse();
    expect(receipt.searchAdmitted).toBeFalse(); expect(receipt.deletionAdmitted).toBeFalse(); expect(receipt.liveTransportQualified).toBeFalse();
    expect(receipt.missingPossibleCustomIds).toEqual([]); expect(receipt.unmatchedSuccessfulDocumentIds).toEqual([]);
    expect(receipt.unreportedOwnedDocumentIds).toEqual([]);
    const { reconciliationSha256, ...payload } = receipt;
    expect(reconciliationSha256).toBe(canonicalSha256(payload));
    expect(Object.isFrozen(receipt.sourceOrderOwnedDocuments[0])).toBeTrue();
  });

  test("keeps partial and uncertain batches cleanup-only, including unreported owned writes and unattempted source", () => {
    const input = fixture(), seen = observations(input);
    seen.attemptedBatchCount = 1; seen.inventory = seen.inventory.slice(0, 2);
    for (const response of [null, raw({ results: [{ id: "doc_1", status: "queued" }, { id: "", status: "error", error: "failed" }], success: 1, failed: 1 })]) {
      seen.acknowledgements = [response];
      const receipt = reconcileFrameworkPilotSupermemoryBatchV3(input, seen);
      expect(receipt.sourceMembershipComplete).toBeFalse(); expect(receipt.unattemptedDocumentCount).toBe(1);
      expect(receipt.sourceOrderOwnedDocuments).toHaveLength(2); expect(receipt.missingPossibleCustomIds).toEqual([]);
      expect(receipt.unreportedOwnedDocumentIds).toEqual(response === null ? ["doc_1", "doc_2"] : ["doc_2"]);
      expect(receipt.uncertainBatchOrdinals).toEqual(response === null ? [1] : []);
      expect(receipt.failedBatchOrdinals).toEqual(response === null ? [] : [1]);
      expect(receipt.searchAdmitted).toBeFalse(); expect(receipt.deletionAdmitted).toBeFalse();
    }
    seen.acknowledgements = [null]; seen.inventory = [];
    expect(reconcileFrameworkPilotSupermemoryBatchV3(input, seen).missingPossibleCustomIds).toHaveLength(2);
    seen.attemptedBatchCount = 0; seen.acknowledgements = [];
    const unattempted = reconcileFrameworkPilotSupermemoryBatchV3(input, seen);
    expect(unattempted.unattemptedDocumentCount).toBe(3); expect(unattempted.sourceMembershipComplete).toBeFalse();
    const invalid = observations(input); invalid.acknowledgements[0] = null;
    expect(() => reconcileFrameworkPilotSupermemoryBatchV3(input, invalid)).toThrow("attempt-after-failed-or-uncertain-batch");
  });

  test("reports incomplete and mismatched identity sets instead of manufacturing source completeness", () => {
    const input = fixture(), missing = observations(input); missing.inventory.pop();
    const receipt = reconcileFrameworkPilotSupermemoryBatchV3(input, missing);
    expect(receipt.sourceMembershipComplete).toBeFalse(); expect(receipt.missingPossibleCustomIds).toHaveLength(1);
    expect(receipt.unmatchedSuccessfulDocumentIds).toEqual(["doc_3"]);
    const mismatched = observations(input); mismatched.acknowledgements[1] = ack(["another_id"]);
    const inconsistent = reconcileFrameworkPilotSupermemoryBatchV3(input, mismatched);
    expect(inconsistent.sourceMembershipComplete).toBeFalse();
    expect(inconsistent.unmatchedSuccessfulDocumentIds).toEqual(["another_id"]);
    expect(inconsistent.unreportedOwnedDocumentIds).toEqual(["doc_3"]);
    const cross = observations(input); cross.acknowledgements = [ack(["doc_3", "doc_2"]), ack(["doc_1"])];
    expect(() => reconcileFrameworkPilotSupermemoryBatchV3(input, cross)).toThrow("acknowledgement-cross-batch-identity");
    const duplicate = observations(input); duplicate.acknowledgements[1] = ack(["doc_1"]);
    expect(() => reconcileFrameworkPilotSupermemoryBatchV3(input, duplicate)).toThrow("duplicate-id-across-batches");
  });

  test("rejects foreign or duplicate ownership, label-shaped fields and hostile observation descriptors", () => {
    type Seen = ReturnType<typeof observations>;
    const changes: Array<(value: Seen) => void> = [
      value => { value.inventory[0]!.customId = "foreign"; },
      value => { value.inventory[0]!.containerTags = ["foreign"]; },
      value => { value.inventory[0]!.containerTags.push("foreign"); },
      value => { value.inventory[0]!.id = value.inventory[1]!.id; },
      value => { value.inventory[0] = structuredClone(value.inventory[1]!); },
      value => { Object.assign(value, { answer: "SYNTHETIC_GOLD" }); },
      value => { Object.assign(value.inventory[0]!, { answer: "SYNTHETIC_GOLD" }); },
      value => { Object.assign(value.inventory[0]!.metadata, { answer: "SYNTHETIC_GOLD" }); },
      value => { value.acknowledgements.pop(); },
    ];
    const input = fixture();
    for (const key of Object.keys(inventory(input)[0]!.metadata)) {
      changes.push(value => { delete (value.inventory[0]!.metadata as Record<string, unknown>)[key]; });
      changes.push(value => { (value.inventory[0]!.metadata as Record<string, unknown>)[key] = "foreign"; });
    }
    for (const change of changes) { const value = observations(input); change(value); expect(() => reconcileFrameworkPilotSupermemoryBatchV3(input, value)).toThrow(); }
    for (const where of ["inventory", "row", "metadata", "acknowledgement"]) {
      const value = observations(input); let read = false;
      const target = where === "inventory" ? value : where === "row" ? value.inventory[0]! : where === "metadata" ? value.inventory[0]!.metadata : value.acknowledgements;
      const key = where === "inventory" ? "inventory" : where === "row" ? "customId" : where === "metadata" ? "sourceSha256" : "0";
      Object.defineProperty(target, key, { enumerable: true, get() { read = true; throw Error("getter"); } });
      expect(() => reconcileFrameworkPilotSupermemoryBatchV3(input, value)).toThrow(); expect(read).toBeFalse();
    }
  });

  test("enforces an aggregate raw acknowledgement bound including insignificant whitespace", () => {
    const input = fixture(Array.from({ length: 9 }, (_, i) => `Document ${i}`)); input.maximumBatchDocuments = 1;
    const seen = observations(input);
    seen.acknowledgements = seen.acknowledgements.map(bytes => Buffer.concat([Buffer.from(bytes!), Buffer.alloc(1_048_576 - bytes!.byteLength, 32)]));
    seen.attemptedBatchCount = 8; seen.acknowledgements = seen.acknowledgements.slice(0, 8); seen.inventory = seen.inventory.slice(0, 8);
    const receipt = reconcileFrameworkPilotSupermemoryBatchV3(input, seen);
    expect(receipt.acknowledgements.reduce((sum, row) => sum + row!.responseBytes, 0)).toBe(8_388_608);
    expect(receipt.sourceMembershipComplete).toBeFalse(); expect(receipt.unattemptedDocumentCount).toBe(1);
    const ninth = ack(["doc_9"]); seen.acknowledgements.push(Buffer.concat([ninth, Buffer.alloc(1_048_576 - ninth.length, 32)]));
    seen.attemptedBatchCount = 9; seen.inventory = inventory(input);
    expect(() => reconcileFrameworkPilotSupermemoryBatchV3(input, seen)).toThrow("aggregate-acknowledgement-bytes");
  });
});
