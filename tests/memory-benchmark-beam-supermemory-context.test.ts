import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { BEAM_SUPERMEMORY_CONTEXT_INPUT_V1, packBeamSupermemoryEvidenceV1,
  prepareBeamSupermemoryContextInputV1 } from "../scripts/benchmarks/beam-supermemory-context";
import { BEAM_SUPERMEMORY_SESSION_PROTOCOL_V1, prepareBeamSupermemorySessionsV1 } from "../scripts/benchmarks/beam-supermemory";
import { packFrameworkPilotEvidenceV1 } from "../scripts/benchmarks/framework-pilot-evidence-v1";
import { createFrameworkPilotSourceUnitsV1, type FrameworkPilotSourceV1 } from "../scripts/benchmarks/framework-pilot-source-v1";

function fixture(source: FrameworkPilotSourceV1 = { protocol: "oh.framework-pilot-source.v1", sessions: [
  { sessionId: "s0001", sessionIndex: 0, date: "2036-03-01", turns: [
    { role: "user", text: "Planting is on March 8. 🦀" },
    { role: "assistant", text: "Consider blue pots." },
    { role: "user", text: "I adopted that suggestion." }] },
  { sessionId: "s0002", sessionIndex: 1, date: "2036-03-04", turns: [
    { role: "user", text: "Correction: planting will be March 9." }] },
] }) {
  const splitPlan = { protocol: "oh.framework-pilot-split-plan.v1", sourceSha256: canonicalSha256(source),
    turns: source.sessions.flatMap(session => session.turns.map((turn, index) => ({ turnId: `${session.sessionId}#${session.sessionIndex}:${index}`,
      spans: session.sessionIndex === 0 && index === 0 && turn.text.startsWith("Planting")
        ? [{ startByte: 0, endByte: 8 }, { startByte: 8, endByte: Buffer.byteLength(turn.text) }]
        : [{ startByte: 0, endByte: Buffer.byteLength(turn.text) }] }))) };
  const sourceUnits = createFrameworkPilotSourceUnitsV1(source, splitPlan);
  const sessionInput = { protocol: BEAM_SUPERMEMORY_SESSION_PROTOCOL_V1, source, dreaming: "dynamic",
    namespace: "oh_beam1_0123456789abcdef0123456789abcdef",
    target: { origin: "https://api.supermemory.ai", projectId: "test_project", resourceId: "test_resource" },
    documentDates: source.sessions.map(session => ({ sourceSha256: canonicalSha256(source), sessionIndex: session.sessionIndex,
      sourceDate: session.date, documentDate: session.date })) };
  const plan = prepareBeamSupermemorySessionsV1(sessionInput);
  const accepted = plan.documents.map((document, index) => ({ customId: document.customId, documentId: `doc_${index + 1}` }));
  const observations = plan.documents.map((document, index) => ({ id: accepted[index]!.documentId, customId: document.customId,
    containerTags: [plan.namespace], metadata: { ...document.metadata }, status: "done", dreamingStatus: "done", raw: document.content }));
  const documents = accepted.map(row => ({ id: row.documentId, createdAt: "2036-03-01T00:00:00Z", updatedAt: "2036-03-04T00:00:00Z" }));
  const response = { results: [
    { id: "memory_1", memory: "Planting moved from March 8 to March 9.\nBlue pots were chosen. 🦀", metadata: null,
      updatedAt: "2036-03-04T00:00:00Z", similarity: 0.95, documents: [...documents].reverse() },
    { id: "chunk_1", chunk: "A distinct provider chunk, preserved verbatim.", metadata: null,
      updatedAt: "2036-03-04T00:00:00Z", similarity: 0.7, documents: documents.slice(0, 1) },
  ], total: 2, timing: 3 };
  return { protocol: BEAM_SUPERMEMORY_CONTEXT_INPUT_V1, sessionInput, splitPlan, sourceUnits,
    accepted, observations, response, maxContextTokens: 8_192 };
}
const absent = { python: "/never-open-bridge-python", artifactsDirectory: "/never-open-bridge-artifacts" };

describe("BEAM session references to common evidence (invented sources only)", () => {
  test("retains generated content and complete coarse references across turns and split parts", () => {
    const input = fixture(), bridge = prepareBeamSupermemoryContextInputV1(input);
    expect(bridge.sourceSha256).toBe(input.sourceUnits.sourceSha256);
    expect(bridge.bundleSha256).toBe(input.sourceUnits.bundleSha256);
    expect(bridge.planSha256).toBe(prepareBeamSupermemorySessionsV1(input.sessionInput).planSha256);
    expect(bridge.referenceScope).toBe("session-document");
    expect(bridge.sourceTextAuthenticated).toBeFalse();
    expect(bridge.originalEvidence.liveTransportQualified).toBeFalse();
    expect(bridge.commonEvidence.candidates.map(row => row.evidenceId)).toEqual(["e0001", "e0002"]);
    expect(bridge.commonEvidence.candidates.map(row => row.kind)).toEqual(["provider-generated-memory", "provider-document-chunk"]);
    expect(bridge.commonEvidence.candidates.map(row => row.content)).toEqual([input.response.results[0]!.memory!, input.response.results[1]!.chunk!]);
    expect(bridge.commonEvidence.candidates[0]!.sourceUnitIds).toEqual(["u000001", "u000002", "u000003", "u000004", "u000005"]);
    expect(bridge.commonEvidence.candidates[1]!.sourceUnitIds).toEqual(["u000001", "u000002", "u000003", "u000004"]);
    expect(bridge.commonEvidenceInput.candidates[0]!.documentReferences).toEqual(input.sourceUnits.units.map(unit => ({
      sourceUnitId: unit.unitId, sourceUnitSha256: unit.unitSha256 })));
    expect(bridge.provenance[0]!.references.map(row => row.documentId)).toEqual(["doc_2", "doc_1"]);
    expect(bridge.provenance[0]!.references.map(row => row.sessionIndex)).toEqual([1, 0]);
    expect(bridge.provenance[0]!.references[1]!.units).toHaveLength(4);
    expect(bridge.commonEvidenceInput.splitPlan).toEqual(input.splitPlan);
    const { bridgeSha256, ...payload } = bridge;
    expect(bridgeSha256).toBe(canonicalSha256(payload));
    expect(Object.isFrozen(bridge.provenance[0]!.references[0]!.units)).toBeTrue();
    input.response.results[0]!.memory = "changed after mapping";
    expect(bridge.commonEvidence.candidates[0]!.content).not.toBe("changed after mapping");
    expect(Object.isFrozen(input.sessionInput)).toBeFalse();
  });

  test("joins exact occurrences when a session alias appears more than once", () => {
    const input = fixture({ protocol: "oh.framework-pilot-source.v1", sessions: [
      { sessionId: "s0001", sessionIndex: 0, date: "2036-03-01", turns: [{ role: "user", text: "First occurrence." }] },
      { sessionId: "s0001", sessionIndex: 1, date: "2036-03-02", turns: [{ role: "user", text: "Second occurrence." }] },
    ] });
    input.response.results = [input.response.results[0]!]; input.response.total = 1;
    input.response.results[0]!.documents = input.response.results[0]!.documents.slice(0, 1);
    const bridge = prepareBeamSupermemoryContextInputV1(input);
    expect(bridge.commonEvidence.candidates[0]!.sourceUnitIds).toEqual(["u000002"]);
    expect(bridge.provenance[0]!.references[0]!.sessionId).toBe("s0001");
    expect(bridge.provenance[0]!.references[0]!.sessionIndex).toBe(1);
    expect(bridge.provenance[0]!.references[0]!.sourceUnitId).toBe("session000002");
  });

  test("rejects referenced empty sessions but preserves valid empty-turn units", () => {
    const source = { protocol: "oh.framework-pilot-source.v1" as const, sessions: [
      { sessionId: "s0001", sessionIndex: 0, date: "2036-03-01", turns: [{ role: "user", text: "" }] },
      { sessionId: "s0002", sessionIndex: 1, date: "2036-03-02", turns: [] },
    ] };
    const input = fixture(source);
    expect(() => packBeamSupermemoryEvidenceV1(input, absent)).toThrow("no complete unit mapping");
    input.response.results[0]!.documents = input.response.results[0]!.documents.filter(row => row.id === "doc_1");
    const bridge = prepareBeamSupermemoryContextInputV1(input);
    expect(bridge.commonEvidence.candidates[0]!.sourceUnitIds).toEqual(["u000001"]);
    expect(bridge.commonEvidenceInput.sourceUnits.units[0]!.text).toBe("");
    expect(bridge.originalEvidence.readiness.readyDocuments).toBe(2);
  });

  test("rejects changed source or rehashed unit provenance, incomplete parts and foreign provider IDs", () => {
    const changes: ((input: ReturnType<typeof fixture>) => void)[] = [
      input => { const units = structuredClone(input.sourceUnits) as any; units.units[0].unitSha256 = "a".repeat(64); input.sourceUnits = units; },
      input => { const units = structuredClone(input.sourceUnits) as any; units.units[0].sessionIndex = 1;
        const { unitSha256: _unit, ...unit } = units.units[0]; units.units[0].unitSha256 = canonicalSha256(unit);
        const { bundleSha256: _bundle, ...bundle } = units; units.bundleSha256 = canonicalSha256(bundle); input.sourceUnits = units; },
      input => { input.sessionInput.source = { ...input.sessionInput.source, sessions: input.sessionInput.source.sessions.map((session, index) =>
        index === 0 ? { ...session, turns: [{ role: "user", text: "changed source" }] } : session) }; },
      input => { input.splitPlan.turns[0]!.spans.pop(); },
      input => { input.response.results[0]!.documents[0]!.id = "foreign_document"; },
      input => { input.observations[0]!.metadata.sourceUnitSha256 = "b".repeat(64); },
      input => { input.accepted[0]!.documentId = input.accepted[1]!.documentId; },
      input => { input.observations[0]!.raw = "different source echo"; },
    ];
    for (const change of changes) {
      const input = fixture(); change(input);
      expect(() => prepareBeamSupermemoryContextInputV1(input)).toThrow();
      expect(() => packBeamSupermemoryEvidenceV1(input, absent)).toThrow(TypeError);
    }
  });

  test("requires complete processing and dreaming, even for unreturned sessions", () => {
    for (const change of [
      (input: ReturnType<typeof fixture>) => { input.observations[1]!.status = "processing"; },
      (input: ReturnType<typeof fixture>) => { input.observations[1]!.dreamingStatus = "pending"; },
      (input: ReturnType<typeof fixture>) => { input.observations[1]!.status = "failed"; },
      (input: ReturnType<typeof fixture>) => { input.observations.pop(); },
    ]) {
      const input = fixture(); input.response.results = [input.response.results[1]!]; input.response.total = 1; change(input);
      expect(() => packBeamSupermemoryEvidenceV1(input, absent)).toThrow("BEAM Supermemory:");
    }
  });

  test("enforces expanded reference and context budgets before tokenization", () => {
    const many = (count: number) => fixture({ protocol: "oh.framework-pilot-source.v1", sessions: [
      { sessionId: "s0001", sessionIndex: 0, date: "2036-03-01",
        turns: Array.from({ length: count }, (_, index) => ({ role: "user", text: `Invented turn ${index}.` })) },
    ] });
    expect(prepareBeamSupermemoryContextInputV1(many(2_000)).commonEvidence.candidates[0]!.sourceUnitIds).toHaveLength(2_000);
    expect(() => packBeamSupermemoryEvidenceV1(many(2_001), absent)).toThrow("expanded reference limit");
    for (const budget of [0, -0, 8_193, NaN, Infinity, 1.5]) {
      const input = fixture(); input.maxContextTokens = budget;
      expect(() => packBeamSupermemoryEvidenceV1(input, absent)).toThrow("context token budget");
    }
    const input = fixture(); input.maxContextTokens = 1;
    input.response.results[1]!.documents[0]!.id = "foreign_suffix";
    expect(() => packBeamSupermemoryEvidenceV1(input, absent)).toThrow("foreign or duplicate search source");
    input.response.results[1]!.documents[0]!.id = "doc_1";
    input.response.results[1]!.chunk = "\0".repeat(12_000);
    expect(() => packBeamSupermemoryEvidenceV1(input, absent)).toThrow("candidate byte bound");
  });

  test("rejects label fields and accessors without reading them; empty retrieval remains explicit", () => {
    let reads = 0;
    const input = fixture();
    for (const value of [{ ...input, expectedAnswer: "forbidden" },
      { ...input, get response() { reads++; return input.response; } },
      { ...input, sessionInput: { ...input.sessionInput, get source() { reads++; return input.sessionInput.source; } } },
      { ...input, sessionInput: { ...input.sessionInput, answer: "forbidden" } }]) {
      expect(() => packBeamSupermemoryEvidenceV1(value, absent)).toThrow("BEAM Supermemory context:");
    }
    expect(reads).toBe(0);
    input.response.results = []; input.response.total = 0;
    const bridge = prepareBeamSupermemoryContextInputV1(input);
    expect(bridge.originalEvidence.emptyRetrieval).toBeTrue();
    expect(bridge.commonEvidence.candidates).toEqual([]);
    expect(bridge.provenance).toEqual([]);
  });

  const python = process.env.OH_BENCH_TOKENIZER_PYTHON, artifactsDirectory = process.env.OH_BENCH_TOKENIZER_ARTIFACTS;
  test.skipIf(python === undefined && artifactsDirectory === undefined)("packs complete neutral blocks with the real pinned offline tokenizer", () => {
    expect(python).toBeDefined(); expect(artifactsDirectory).toBeDefined();
    const configuration = { python: python!, artifactsDirectory: artifactsDirectory! }, input = fixture();
    const packed = packBeamSupermemoryEvidenceV1(input, configuration);
    const common = packFrameworkPilotEvidenceV1(packed.bridge.commonEvidenceInput, configuration);
    expect(packed.context).toEqual(common);
    expect(packed.context.contextTokens).toBeGreaterThan(0);
    expect(packed.context.contextTokens).toBeLessThanOrEqual(input.maxContextTokens);
    const blocks = packed.context.context.split("\n").map(line => JSON.parse(line));
    expect(blocks).toEqual(packed.bridge.commonEvidence.candidates.map(row => ({ evidenceId: row.evidenceId, kind: row.kind, content: row.content })));
    expect(packed.context.context).not.toContain("memory_1");
    expect(packed.context.context).not.toContain("sourceUnitIds");
    expect(packed.context.context).not.toContain("similarity");
    input.maxContextTokens = packed.context.tokenization.rows[1]!.tokens;
    const limited = packBeamSupermemoryEvidenceV1(input, configuration);
    expect(limited.context.context).toBe(packed.context.context.split("\n")[0]!);
    expect(limited.context.contextTokens).toBe(input.maxContextTokens);
    expect(limited.context.included.map(row => row.evidenceId)).toEqual(["e0001"]);
    expect(limited.context.omitted.map(row => row.reason)).toEqual(["overflow"]);
    expect(limited.bridge.provenance).toEqual(packed.bridge.provenance);
    input.response.results = []; input.response.total = 0;
    const empty = packBeamSupermemoryEvidenceV1(input, configuration);
    expect(empty.context.context).toBe(""); expect(empty.context.contextTokens).toBe(0);
  });
});
