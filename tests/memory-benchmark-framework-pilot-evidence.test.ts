import { describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256 } from "../src/canonical";
import { prepareFrameworkPilotEvidenceV1, packFrameworkPilotEvidenceV1 } from "../scripts/benchmarks/framework-pilot-evidence-v1";
import { createFrameworkPilotSourceUnitsV1 } from "../scripts/benchmarks/framework-pilot-source-v1";

function fixture() {
  const source = { protocol: "oh.framework-pilot-source.v1", sessions: [{ sessionId: "s0001", sessionIndex: 0,
    date: "2030/03/01 (Fri) 12:00", turns: [{ role: "user", text: "Cafe\u0301\0\n🧪" }, { role: "assistant", text: "" }] }] };
  const splitPlan = { protocol: "oh.framework-pilot-split-plan.v1", sourceSha256: canonicalSha256(source),
    turns: source.sessions[0]!.turns.map((turn, index) => ({ turnId: `s0001#0:${index}`,
      spans: [{ startByte: 0, endByte: Buffer.byteLength(turn.text) }] })) };
  const sourceUnits = createFrameworkPilotSourceUnitsV1(source, splitPlan);
  return { protocol: "oh.framework-pilot-evidence-input.v1", source, splitPlan, sourceUnits,
    maxContextTokens: 8_192, candidates: [] as unknown[] };
}
function provider(input: ReturnType<typeof fixture>, kind = "provider-generated-memory") {
  return { kind, providerId: "memory_123", content: "A provider-generated account of the conversation.",
    documentReferences: [{ sourceUnitId: input.sourceUnits.units[0]!.unitId, sourceUnitSha256: input.sourceUnits.units[0]!.unitSha256 }] };
}

describe("typed common framework evidence", () => {
  test("derives source bytes but preserves provider statements as separately typed evidence", () => {
    const input = fixture();
    input.candidates = [{ kind: "source-unit", unitId: "u000001" }, provider(input),
      { ...provider(input, "provider-document-chunk"), providerId: "chunk_123", content: "A provider chunk." },
      { kind: "source-unit", unitId: "u000002" }];
    const evidence = prepareFrameworkPilotEvidenceV1(input);
    expect(evidence.candidates.map(row => row.kind)).toEqual(["source-unit", "provider-generated-memory", "provider-document-chunk", "source-unit"]);
    expect(evidence.candidates.map(row => row.evidenceId)).toEqual(["e0001", "e0002", "e0003", "e0004"]);
    const { unitSha256: _digest, ...sourceContent } = input.sourceUnits.units[0]!;
    expect(evidence.candidates[0]!.content).toBe(canonicalJson(sourceContent));
    expect(JSON.parse(evidence.candidates[0]!.content).text).toBe("Cafe\u0301\0\n🧪");
    expect(JSON.parse(evidence.candidates[3]!.content).text).toBe("");
    expect(evidence.candidates[1]!.content).toBe(provider(input).content);
    expect(evidence.candidates[1]).not.toHaveProperty("unitId");
    expect(evidence.candidates[1]!.sourceUnitIds).toEqual(["u000001"]);
    expect(evidence.sourceSha256).toBe(input.sourceUnits.sourceSha256);
    const { evidenceSha256, ...body } = evidence;
    expect(evidenceSha256).toBe(canonicalSha256(body));
    expect(Object.isFrozen(evidence.candidates[0]!.sourceUnitIds)).toBeTrue();
    (input.candidates[1] as { content: string }).content = "later change";
    expect(evidence.candidates[1]!.content).toBe(provider(input).content);
  });

  test("stable first-occurrence evidence identities do not turn provider IDs into source IDs", () => {
    const input = fixture(), memory = provider(input);
    input.candidates = [memory, { kind: "source-unit", unitId: "u000002" }, structuredClone(memory), { kind: "source-unit", unitId: "u000002" }];
    const evidence = prepareFrameworkPilotEvidenceV1(input);
    expect(evidence.candidates.map(row => row.evidenceId)).toEqual(["e0001", "e0002", "e0001", "e0002"]);
    expect(evidence.candidates[0]).toBe(evidence.candidates[2]);
    expect(evidence.candidates[0]!.originalId).toBe("memory_123");
    expect(evidence.candidates[1]!.originalId).toBe("u000002");
    input.candidates[2] = { ...memory, content: "Conflicting statement" };
    expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow("conflicting evidence");
    input.candidates[2] = { ...memory, kind: "provider-document-chunk" };
    expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow("conflicting evidence");
  });

  test("rejects forged source text, invalid references and label fields even in the omitted suffix", () => {
    for (const candidate of [
      { kind: "source-unit", unitId: "u000001", content: "forged" },
      { kind: "source-unit", unitId: "u000999" },
      { kind: "source-unit", unitId: "u000001", answer: "gold" },
      { ...provider(fixture()), documentReferences: [] },
      { ...provider(fixture()), documentReferences: [{ sourceUnitId: "u000001", sourceUnitSha256: "a".repeat(64) }] },
      { ...provider(fixture()), documentReferences: [provider(fixture()).documentReferences[0], provider(fixture()).documentReferences[0]] },
      { ...provider(fixture()), documentReferences: [{ sourceUnitId: "u000999", sourceUnitSha256: "a".repeat(64) }] },
      { ...provider(fixture()), kind: "authenticated-provider-memory" },
      { ...provider(fixture()), sourceTextAuthenticated: true },
    ]) {
      const input = fixture(); input.maxContextTokens = 1;
      input.candidates = [{ kind: "source-unit", unitId: "u000001" }, candidate];
      expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow();
      // Invalid input is rejected before the nonexistent interpreter can be opened.
      expect(() => packFrameworkPilotEvidenceV1(input, { python: "/never-open-python", artifactsDirectory: "/never-open-artifacts" })).toThrow("Framework pilot evidence");
    }
  });

  test("validates every property without invoking accessors and rejects sparse/non-JSON arrays", () => {
    const input = fixture(); let reads = 0;
    input.candidates = [{ get kind() { reads++; return "source-unit"; }, unitId: "u000001" }];
    expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow("kind data");
    input.candidates = [{ kind: "source-unit", get unitId() { reads++; return "u000001"; } }];
    expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow("data fields");
    input.candidates = Array(1);
    expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow();
    input.candidates = [provider(input)];
    Object.defineProperty(input.candidates, "hidden", { value: true });
    expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow();
    expect(reads).toBe(0);
  });

  test("bounds Unicode, serialized content, result count and full envelope before tokenization", () => {
    const input = fixture();
    for (const content of ["", "\ud800", "x".repeat(65_537), "\0".repeat(12_000)]) {
      input.candidates = [{ ...provider(input), content }];
      expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow();
    }
    input.candidates = Array(21).fill({ kind: "source-unit", unitId: "u000001" });
    expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow();
    input.candidates = Array.from({ length: 10 }, (_, index) => ({ ...provider(input), providerId: `memory_${index}`, content: "x".repeat(30_000) }));
    expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow("envelope byte");
    for (const maximum of [-0, 0, 8193, NaN, Infinity, 1.5]) {
      input.maxContextTokens = maximum; input.candidates = [];
      expect(() => prepareFrameworkPilotEvidenceV1(input)).toThrow();
    }
  });
});
