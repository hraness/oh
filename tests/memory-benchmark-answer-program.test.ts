import { describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, type Sha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1, knowledgeGraphRecordRefV1 } from "../src/graph";
import { ANSWER_PROGRAM_LIMITS, answerProgramTextSha256, runRecommendationProgram, type RecommendationBinding,
  type RecommendationProgramInput } from "../scripts/benchmarks/answer-program";

const decisionSha256 = canonicalSha256({ synthetic: true });
function fixture(texts = ["Orbit — narrator Ada", "Second title only"]): RecommendationProgramInput {
  const records = texts.map((text, index) => createKnowledgeGraphRecordV1({ dependencies: [],
    key: `view:source-${index}`, kind: "view", v: 1, value: { text } }));
  return { snapshot: { spaceId: "answer.program.test", records, head: { generation: 0, sequence: 0,
    graphRevisionSha256: null, operationSha256: null, recordsSha256: canonicalSha256(records.map(knowledgeGraphRecordRefV1)) } },
  requests: [{ itemId: "orbit", mode: "optional" }], bindings: [] };
}
function bind(input: RecommendationProgramInput, field: "title" | "narrator", value: string,
  recordIndex = 0, itemId = "orbit"): RecommendationBinding {
  const source = input.snapshot.records[recordIndex]!;
  const text = (source.value as { text: string }).text;
  const start = text.indexOf(value);
  if (start < 0) throw new Error("bad test fixture");
  return { itemId, field, admission: { kind: "exact", decisionSha256 },
    source: { recordKey: source.key, recordSha256: source.recordSha256, textPointer: "/value/text",
      start, end: start + value.length, quoteSha256: answerProgramTextSha256(value) } };
}
function complete(): RecommendationProgramInput {
  const input = fixture();
  return { ...input, bindings: [bind(input, "title", "Orbit"), bind(input, "narrator", "Ada")] };
}

describe("source-bound recommendation program", () => {
  test("joins complete metadata in real Oh and renders source-derived citations", () => {
    const result = runRecommendationProgram(complete());
    expect(result.status).toBe("complete");
    expect(result.authority).toBe("derived");
    expect(result.projections).toHaveLength(2);
    expect(result.projections[1]!.rows[0]!.proofs[0]!.kind).toBe("derived");
    expect(result.items[0]!.status).toBe("recommended");
    expect(result.items[0]!.fields.narrator!.value).toBe("Ada");
    const cite = result.items[0]!.fields.narrator!.citations[0]!;
    expect(cite.recordSha256).toBe(complete().snapshot.records[0]!.recordSha256);
    expect(cite.quoteSha256).toBe(answerProgramTextSha256("Ada"));
    expect(result.text).toContain('narrator: "Ada"');
    expect(result.text).toContain(cite.recordSha256);
  });
  test("omits incomplete optional items but exposes specifically requested unknown fields", () => {
    const input = fixture();
    const title = bind(input, "title", "Orbit");
    const optional = runRecommendationProgram({ ...input, bindings: [title] });
    expect(optional.items[0]!.status).toBe("omitted-incomplete");
    expect(optional.text).not.toContain("Orbit");
    const requested = runRecommendationProgram({ ...input, bindings: [title], requests: [{ itemId: "orbit", mode: "requested" }] });
    expect(requested.items[0]!.status).toBe("unknown");
    expect(requested.items[0]!.missing).toEqual(["narrator"]);
    expect(requested.text).toContain("narrator unknown in the supplied evidence");
    expect(requested.text).toContain('title "Orbit"');
  });
  test("does not cross-join metadata belonging to another item", () => {
    const input = fixture();
    const result = runRecommendationProgram({ ...input, requests: [{ itemId: "orbit", mode: "requested" },
      { itemId: "other", mode: "optional" }], bindings: [bind(input, "title", "Orbit"), bind(input, "narrator", "Ada", 0, "other")] });
    expect(result.projections[1]!.rows).toHaveLength(0);
    expect(result.items.map((item) => item.status)).toEqual(["unknown", "omitted-incomplete"]);
  });
  test("rejects a changed snapshot, stale or nonexistent source, wrong span and wrong quote digest", () => {
    const input = complete();
    expect(() => runRecommendationProgram({ ...input, snapshot: { ...input.snapshot,
      head: { ...input.snapshot.head, recordsSha256: "0".repeat(64) } } })).toThrow("declared head");
    for (const source of [
      { ...input.bindings[0]!.source, recordSha256: "0".repeat(64) },
      { ...input.bindings[0]!.source, recordKey: "view:absent" },
      { ...input.bindings[0]!.source, start: 1 },
      { ...input.bindings[0]!.source, quoteSha256: "0".repeat(64) },
      { ...input.bindings[0]!.source, textPointer: "/value/missing" },
    ]) expect(() => runRecommendationProgram({ ...input, bindings: [{ ...input.bindings[0], source }] })).toThrow();
    const brokenRecord = { ...input.snapshot.records[0], value: { text: "Tampered" } };
    expect(() => runRecommendationProgram({ ...input, snapshot: { ...input.snapshot, records: [brokenRecord] } })).toThrow("graph record");
  });
  test("preserves distinct supporting spans for the same value and refuses conflicting values", () => {
    const input = fixture(["Orbit — narrator Ada", "Ada", "Bea"]);
    const bindings = [bind(input, "title", "Orbit"), bind(input, "narrator", "Ada"), bind(input, "narrator", "Ada", 1)];
    const result = runRecommendationProgram({ ...input, bindings });
    expect(result.items[0]!.status).toBe("recommended");
    expect(result.items[0]!.fields.narrator!.citations.map((cite) => cite.recordKey).sort()).toEqual(["view:source-0", "view:source-1"]);
    const conflict = runRecommendationProgram({ ...input, bindings: [...bindings, bind(input, "narrator", "Bea", 2)] });
    expect(conflict.items[0]!.status).toBe("conflict");
    expect(conflict.items[0]!.conflicts).toEqual(["narrator"]);
    expect(conflict.text).not.toContain('narrator: "Ada"');
  });
  test("records semantic premises without claiming to validate their interpretation", () => {
    const input = complete();
    const semantic = { ...input.bindings[1]!, admission: { kind: "semantic", decisionSha256 } };
    const result = runRecommendationProgram({ ...input, bindings: [input.bindings[0], semantic] });
    expect(result.items[0]!.fields.narrator!.citations[0]!.admission.kind).toBe("semantic");
    expect(result.items[0]!.fields.narrator!.citations[0]!.admission.decisionSha256).toBe(decisionSha256);
  });
  test("query and proof truncation never become omissions or factual output", () => {
    for (const limits of [{ queryRows: 1 }, { maximumProofDepth: 1 }, { maximumProofNodes: 1 }]) {
      const result = runRecommendationProgram({ ...complete(), limits });
      expect(result.status).toBe("truncated");
      expect(result.items).toHaveLength(0);
      expect(result.text).not.toContain("Orbit");
    }
  });
  test("work or derived-tuple exhaustion is explicit and invalid limits are rejected", () => {
    const input = fixture(["Orbit — narrator Ada and Bea"]);
    const boundInput = { ...input, bindings: [bind(input, "title", "Orbit"), bind(input, "narrator", "Ada"), bind(input, "narrator", "Bea")] };
    for (const limits of [{ maximumWorkUnits: 1 }, { maximumDerivedTuples: 1 }]) {
      const result = runRecommendationProgram({ ...boundInput, limits });
      expect(result.status).toBe("exhausted");
      expect(result.items).toHaveLength(0);
      expect(result.text).not.toContain("Orbit");
    }
    // This one-rule program reaches its fixed point within one derivation round.
    expect(runRecommendationProgram({ ...complete(), limits: { maximumRounds: 1 } }).status).toBe("complete");
    expect(() => runRecommendationProgram({ ...complete(), limits: { maximumWorkUnits: 0 } })).toThrow("invalid maximumWorkUnits");
  });
  test("the composite byte cap drops proofs and factual output even when each projection fits", () => {
    const records = Array.from({ length: 32 }, (_, i) => createKnowledgeGraphRecordV1({ dependencies: [],
      key: `view:${String(i).padStart(2, "0")}${"a".repeat(480)}`, kind: "view", v: 1,
      value: { text: `${"T".repeat(256)} ${"N".repeat(256)}` } }));
    const input: RecommendationProgramInput = { snapshot: { spaceId: "answer.program.composite", records,
      head: { generation: 0, sequence: 0, graphRevisionSha256: null, operationSha256: null,
        recordsSha256: canonicalSha256(records.map(knowledgeGraphRecordRefV1)) } },
      requests: records.map((_, i) => ({ itemId: `item${i}`, mode: "optional" })), bindings: [] };
    const bindings = records.flatMap((_, i) => [bind(input, "title", "T".repeat(256), i, `item${i}`),
      bind(input, "narrator", "N".repeat(256), i, `item${i}`)]);
    const result = runRecommendationProgram({ ...input, bindings });
    expect(result.status).toBe("exhausted");
    expect(result.reasons).toEqual(["composite-result-bytes"]);
    expect(result.projections).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.text).toContain("no recommendation or absence conclusion");
    expect(result.text).not.toContain("TTTT");
    expect(Buffer.byteLength(canonicalJson(result))).toBeLessThanOrEqual(ANSWER_PROGRAM_LIMITS.maximumResultBytes);
  });
  test("strict boundary rejects prose fields, duplicate inputs, accessors and excess bytes", () => {
    const input = complete();
    expect(() => runRecommendationProgram({ ...input, prose: "Invented answer" })).toThrow("input keys");
    expect(() => runRecommendationProgram({ ...input, bindings: [{ ...input.bindings[0], value: "Invented" }] })).toThrow("binding keys");
    expect(() => runRecommendationProgram({ ...input, bindings: [input.bindings[0], input.bindings[0]] })).toThrow("duplicate binding");
    expect(() => runRecommendationProgram({ ...input, requests: [input.requests[0], input.requests[0]] })).toThrow("duplicate requests");
    let touched = false;
    expect(() => runRecommendationProgram({ get snapshot() { touched = true; return input.snapshot; }, requests: [], bindings: [] })).toThrow("accessor");
    expect(touched).toBe(false);
    expect(() => runRecommendationProgram({ ...input, extra: "x".repeat(300_000) })).toThrow("byte bound");
  });
  test("keeps punctuation and Unicode exact and rejects a split surrogate span", () => {
    const input = fixture(["−10% 🌙 — narrator A.B."]);
    const result = runRecommendationProgram({ ...input, bindings: [bind(input, "title", "−10% 🌙"), bind(input, "narrator", "A.B.")] });
    expect(result.items[0]!.fields.title!.value).toBe("−10% 🌙");
    const title = bind(input, "title", "🌙");
    expect(() => runRecommendationProgram({ ...input, bindings: [{ ...title, source: { ...title.source,
      end: title.source.end - 1, quoteSha256: "0".repeat(64) as Sha256Hex } }] })).toThrow("surrogate");
  });
  test("binding order does not alter answer, evidence identity or source citations", () => {
    const input = complete();
    const forward = runRecommendationProgram(input);
    const reversed = runRecommendationProgram({ ...input, bindings: [...input.bindings].reverse() });
    expect(reversed.text).toBe(forward.text);
    expect(reversed.datasetSha256).toBe(forward.datasetSha256);
    expect(reversed.projections).toEqual(forward.projections);
    expect(reversed.items).toEqual(forward.items);
  });
});
