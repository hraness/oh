import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { BEAM_SUPERMEMORY_SESSION_PROTOCOL_V1, buildBeamSupermemorySearchRequestV1, parseBeamSupermemorySearchV1, prepareBeamSupermemorySessionsV1,
  renderBeamSupermemoryEvidenceV1, validateBeamSupermemoryReadinessV1 } from "../scripts/benchmarks/beam-supermemory";
import { FRAMEWORK_PILOT_SOURCE_V1 } from "../scripts/benchmarks/framework-pilot-source-v1";
import { FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1 } from "../scripts/benchmarks/framework-pilot-supermemory-v1";

function fixture() {
  const source = { protocol: FRAMEWORK_PILOT_SOURCE_V1, sessions: [
    { sessionId: "s0001", sessionIndex: 0, date: "2025-03-01 09:00", turns: [
      { role: "user", text: "Invented date for planting: March 8. 🦀" },
      { role: "assistant", text: "I suggested fictional blue pots.\n e\u0301" },
      { role: "user", text: "I adopted that suggestion." }] },
    { sessionId: "s0002", sessionIndex: 1, date: "2025-03-04 09:00", turns: [
      { role: "user", text: "Correction: planting will be March 9." }] },
  ] };
  const input = { protocol: BEAM_SUPERMEMORY_SESSION_PROTOCOL_V1, namespace: "oh_beam1_0123456789abcdef0123456789abcdef",
    target: { origin: "https://api.supermemory.ai", projectId: "test_project", resourceId: "test_resource" }, source, dreaming: "instant",
    documentDates: source.sessions.map(session => ({ sourceSha256: canonicalSha256(source), sessionIndex: session.sessionIndex,
      sourceDate: session.date, documentDate: session.date.slice(0, 10) })) };
  const plan = prepareBeamSupermemorySessionsV1(input);
  const accepted = plan.documents.map((document, index) => ({ customId: document.customId, documentId: `doc_${index + 1}` }));
  const ready = plan.documents.map((document, index) => ({ id: accepted[index]!.documentId, customId: document.customId,
    containerTags: [input.namespace], metadata: { ...document.metadata }, status: "done", dreamingStatus: "done", raw: document.content }));
  const refs = accepted.map(row => ({ id: row.documentId, createdAt: "2025-03-01T00:00:00Z", updatedAt: "2025-03-04T00:00:00Z" }));
  const response = { results: [
    { id: "memory_1", memory: "Provider-generated fictional planting change: March 8 to March 9.", metadata: null,
      updatedAt: "2025-03-04T00:00:00Z", similarity: 0.95, documents: refs },
    { id: "chunk_1", chunk: "Provider chunk with an invented assistant suggestion.", metadata: {},
      updatedAt: "2025-03-04T00:00:00Z", similarity: 0.8, documents: refs.slice(0, 1) },
  ], total: 2, timing: 4.5 };
  return { input, plan, accepted, ready, response };
}

describe("BEAM Supermemory source-only session adapter (no provider calls)", () => {
  test("stores a complete ordered session per document with explicit source date bindings", () => {
    const { input, plan } = fixture();
    expect(plan.documents).toHaveLength(2);
    expect(plan.profile).toEqual(FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1);
    expect(JSON.parse(plan.documents[0]!.content)).toEqual(input.source.sessions[0]);
    expect(plan.documents[0]!.content).toContain("assistant");
    expect(plan.documents[0]!.content).toContain("I adopted that suggestion.");
    expect(plan.documents[1]!.documentDate).toBe("2025-03-04");
    expect(plan.documents[0]!.metadata.sourceUnitId).toBe("session000001");
    const { planSha256, ...payload } = plan; expect(planSha256).toBe(canonicalSha256(payload));
    expect(Object.isFrozen(plan.documents[0]!.metadata)).toBeTrue();
    input.source.sessions[0]!.turns[0]!.text = "Changed source after creation";
    expect(plan.documents[0]!.content).not.toContain("Changed source");
  });

  test("rejects answer metadata, wrong dates, source mismatch and unsafe identities", () => {
    const changes: Array<(input: ReturnType<typeof fixture>["input"]) => void> = [
      input => { Object.assign(input, { answer: "synthetic forbidden answer" }); },
      input => { Object.assign(input.source.sessions[0]!, { rubric: ["forbidden"] }); },
      input => { input.namespace = "an_existing_container"; },
      input => { input.target.origin = "https://foreign.example"; },
      input => { input.documentDates[0]!.documentDate = "2025-02-30"; },
      input => { input.documentDates[0]!.sourceDate = "different"; },
      input => { input.documentDates[0]!.sourceSha256 = "a".repeat(64); },
      input => { input.documentDates.pop(); },
      input => { input.dreaming = "default"; },
    ];
    for (const change of changes) { const { input } = fixture(); change(input); expect(() => prepareBeamSupermemorySessionsV1(input)).toThrow(); }
  });

  test("requires done ingestion and done dreaming for every document before retrieval", () => {
    const { plan, accepted, ready } = fixture();
    expect(validateBeamSupermemoryReadinessV1(plan, accepted, ready)).toMatchObject({ readyDocuments: 2, searchAdmitted: true });
    expect(buildBeamSupermemorySearchRequestV1(plan, accepted, ready, "Invented query")).toMatchObject({ method: "POST", path: "/v4/search",
      body: { containerTag: plan.namespace, q: "Invented query", searchMode: "hybrid", rerank: true, include: { documents: true } } });
    for (const status of ["queued", "extracting", "chunking", "embedding", "indexing", "unknown", "failed"]) {
      const sample = fixture(); sample.ready[1]!.status = status;
      expect(() => parseBeamSupermemorySearchV1(sample.plan, sample.accepted, sample.ready, sample.response)).toThrow();
      expect(() => buildBeamSupermemorySearchRequestV1(sample.plan, sample.accepted, sample.ready, "Invented query")).toThrow();
    }
    for (const dreamingStatus of ["dreaming", "failed", "", "unknown"]) {
      const sample = fixture(); sample.ready[1]!.dreamingStatus = dreamingStatus;
      expect(() => renderBeamSupermemoryEvidenceV1(sample.plan, sample.accepted, sample.ready, sample.response)).toThrow("readiness incomplete");
    }
    expect(() => validateBeamSupermemoryReadinessV1(plan, accepted, ready.slice(0, 1))).toThrow("complete readiness");
    expect(() => validateBeamSupermemoryReadinessV1(plan, accepted.slice(0, 1), ready)).toThrow("complete accepted");
    expect(() => validateBeamSupermemoryReadinessV1(plan, accepted, [ready[0], ready[0]])).toThrow("duplicate readiness");
  });

  test("binds readiness to exact IDs, metadata, namespace and verbatim source echo", () => {
    const changes: Array<(row: ReturnType<typeof fixture>["ready"][number]) => void> = [
      row => { row.id = "different"; }, row => { row.customId = "different"; }, row => { row.containerTags = ["different"]; },
      row => { row.metadata.sourceSha256 = "a".repeat(64); }, row => { row.raw = "altered"; },
    ];
    for (const change of changes) {
      const sample = fixture(); change(sample.ready[0]!);
      expect(() => validateBeamSupermemoryReadinessV1(sample.plan, sample.accepted, sample.ready)).toThrow();
    }
    const sample = fixture(); sample.accepted[0]!.documentId = sample.plan.documents[1]!.customId;
    expect(() => validateBeamSupermemoryReadinessV1(sample.plan, sample.accepted, sample.ready)).toThrow("ambiguous document alias");
  });

  test("preserves generated memory/chunk content and every reference through internal/custom aliases", () => {
    const { plan, accepted, ready, response } = fixture();
    response.results[0]!.documents[1]!.id = plan.documents[1]!.customId;
    const result = parseBeamSupermemorySearchV1(plan, accepted, ready, response);
    expect(result.evidence.map(row => row.kind)).toEqual(["provider-generated-memory", "provider-document-chunk"]);
    expect(result.evidence[0]!.content).toBe(response.results[0]!.memory!);
    expect(result.evidence[1]!.content).toBe(response.results[1]!.chunk!);
    expect(result.evidence[0]!.documentReferences.map(ref => ref.documentId)).toEqual(["doc_1", "doc_2"]);
    expect(result.evidence[0]!.documentReferences.map(ref => ref.sourceUnitId)).toEqual(["session000001", "session000002"]);
    expect(result.evidence.every(row => row.sourceTextAuthenticated === false)).toBeTrue();
    expect(result.liveTransportQualified).toBeFalse(); expect(result.emptyRetrieval).toBeFalse();
    const rendered = renderBeamSupermemoryEvidenceV1(plan, accepted, ready, response);
    expect(rendered).toContain(response.results[0]!.memory!);
    expect(rendered).toContain(response.results[1]!.chunk!);
    expect(rendered).toContain("doc_2");
    expect(rendered).not.toContain("I adopted that suggestion.");
  });

  test("never guesses suffixes, drops mapping failures, or folds aliases into duplicate source refs", () => {
    for (const mode of ["foreign", "suffix", "duplicate-alias", "wrong-metadata", "no-ref"]) {
      const sample = fixture(), refs = sample.response.results[0]!.documents;
      if (mode === "foreign") refs[1]!.id = "foreign";
      if (mode === "suffix") refs[1]!.id = `foreign_${sample.plan.documents[1]!.metadata.sourceUnitId}`;
      if (mode === "duplicate-alias") refs[1]!.id = sample.plan.documents[0]!.customId;
      if (mode === "wrong-metadata") Object.assign(refs[0]!, { metadata: sample.plan.documents[1]!.metadata });
      if (mode === "no-ref") sample.response.results[0]!.documents = [];
      expect(() => parseBeamSupermemorySearchV1(sample.plan, sample.accepted, sample.ready, sample.response)).toThrow();
    }
  });

  test("distinguishes real empty retrieval from malformed or truncated provider data", () => {
    const { plan, accepted, ready, response } = fixture();
    const empty = parseBeamSupermemorySearchV1(plan, accepted, ready, { results: [], total: 0, timing: 0 });
    expect(empty.emptyRetrieval).toBeTrue(); expect(empty.evidence).toEqual([]);
    for (const malformed of [{ ...response, total: 3 }, { results: [], timing: 0 }, { results: [], total: 0, timing: -1 },
      { ...response, results: [response.results[0], response.results[0]] },
      '{"results":[],"total":0,"total":1,"timing":0}',
      { ...response, results: [{ ...response.results[0], chunk: "ambiguous" }, response.results[1]] },
      { ...response, results: [{ ...response.results[0], memory: "" }, response.results[1]] }]) {
      expect(() => parseBeamSupermemorySearchV1(plan, accepted, ready, malformed)).toThrow();
    }
    expect(() => validateBeamSupermemoryReadinessV1({ ...plan, planSha256: "f".repeat(64) }, accepted, ready)).toThrow("plan identity");
  });
});
