import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { auditBeamRunCellsV1, assertBeamRunResumeV1, BEAM_BINARY_JUDGE_PROTOCOL_V2, BEAM_REFERENCE_FIELDS_V2,
  BEAM_RELEASED_SCORER_PIN, buildBeamBinaryJudgePromptV2, buildBeamJudgeReferenceV2, createBeamRunManifestV1,
  parseBeamBinaryVerdictV2, parseBeamEvaluationDataV1 } from "../scripts/benchmarks/beam-evaluation";

describe("BEAM corrected custom judge references (invented data only)", () => {
  test("preserves all five explicit answer schemas alongside the rubric", () => {
    for (const field of BEAM_REFERENCE_FIELDS_V2) {
      const raw = { [field]: `Invented answer for ${field}`, rubric: ["Include the fictional name", "Include the fictional date"],
        source_chat_ids: [4, 8], difficulty: "synthetic", private_metadata: "DO_NOT_SEND_METADATA" };
      const reference = buildBeamJudgeReferenceV2(JSON.stringify(raw));
      expect(reference.protocol).toBe(BEAM_BINARY_JUDGE_PROTOCOL_V2);
      expect(reference.answers).toEqual([{ field, value: raw[field] }]);
      expect(reference.text).toContain(`Invented answer for ${field}`);
      expect(reference.text).toContain("Include the fictional date");
      expect(reference.text).not.toContain("DO_NOT_SEND_METADATA");
      expect(reference.text).not.toContain("source_chat_ids");
      const { referenceSha256, ...payload } = reference;
      expect(referenceSha256).toBe(canonicalSha256(payload));
    }
  });

  test("does not discard additional or structured answer fields", () => {
    const input = { ideal_response: "First explicit answer", ideal_answer: "Second explicit answer",
      answer: ["Plant", "Water", "Bloom"], ideal_summary: { subject: "An invented garden", events: 3 },
      expected_compliance: true, rubric: ["Use only the invented history"] };
    const result = buildBeamJudgeReferenceV2(input);
    expect(result.answers.map(row => row.field)).toEqual([...BEAM_REFERENCE_FIELDS_V2]);
    expect(result.answers.map(row => row.value)).toEqual(BEAM_REFERENCE_FIELDS_V2.map(field => input[field]));
    input.answer.push("Changed input");
    expect(result.text).not.toContain("Changed input");
    expect(Object.isFrozen(result.answers[2]!.value)).toBeTrue();
    expect(buildBeamJudgeReferenceV2({ rubric: ["An explicit rubric-only reference"] }).answers).toEqual([]);
    expect(BEAM_RELEASED_SCORER_PIN.endToEndScorerImplemented).toBeFalse();
    expect(BEAM_BINARY_JUDGE_PROTOCOL_V2).toContain("custom-binary");
  });

  test("rejects malformed, empty, duplicate-key and accessor references without raw fallback", () => {
    for (const input of ["not JSON", '{"answer":"first","answer":"second","rubric":["x"]}',
      '{"answer":"first","\\u0061nswer":"second","rubric":["x"]}',
      { answer: "x" }, { answer: "x", rubric: [] }, { answer: "x", rubric: [42] },
      { answer: "", rubric: ["x"] }, { ideal_summary: null, rubric: ["x"] }, { answer: [], rubric: ["x"] },
      { answer: {}, rubric: ["x"] }, { answer: "x", rubric: ["x".repeat(4_097)] },
      { answer: "\ud800", rubric: ["x"] }, ["unexpected"]]) {
      expect(() => buildBeamJudgeReferenceV2(input)).toThrow();
    }
    let read = false;
    const accessor = { rubric: ["x"] };
    Object.defineProperty(accessor, "answer", { enumerable: true, get: () => { read = true; return "x"; } });
    expect(() => buildBeamJudgeReferenceV2(accessor)).toThrow("data fields"); expect(read).toBeFalse();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => parseBeamEvaluationDataV1(cycle)).toThrow("structure bound");
  });

  test("binds the complete question, reference and response without substituting source placeholders", () => {
    const prompt = buildBeamBinaryJudgePromptV2("Question includes {answer} and {response}",
      { expected_compliance: "Keep literal {response}", rubric: ["Fictional criterion"] }, "Synthetic reply");
    expect(prompt).toContain("Question includes {answer} and {response}");
    expect(prompt).toContain("Keep literal {response}");
    expect(prompt).toContain("Synthetic reply");
    expect(prompt).toContain("Fictional criterion");
    expect(() => buildBeamBinaryJudgePromptV2("", { rubric: ["x"] }, "y")).toThrow();
  });

  test("accepts only a complete yes or no verdict; malformed responses remain unresolved", () => {
    for (const reply of ["yes", "YES", " Yes \n"]) expect(parseBeamBinaryVerdictV2(reply)).toEqual({ status: "resolved", correct: true });
    for (const reply of ["no", "NO", "\tNo\n"]) expect(parseBeamBinaryVerdictV2(reply)).toEqual({ status: "resolved", correct: false });
    for (const reply of [null, undefined, true, "", "y", "yes.", "no, because", "yes or no", "{\"answer\":\"yes\"}",
      "```yes```", "yesterday", "not correct", " yes ".repeat(9), "yes\u0000", "yeſ"]) {
      expect(parseBeamBinaryVerdictV2(reply)).toEqual({ status: "unresolved", correct: null });
    }
  });
});

const runInput = () => ({ runId: "synthetic-run", config: { reader: "reader-fixture", scorer: BEAM_BINARY_JUDGE_PROTOCOL_V2, repeat: 1,
  sourceSha256: "a".repeat(64), maximumCalls: 2 }, cells: [
  { key: "synthetic-one#0", request: { profile: "fixture-reader", messages: [{ role: "user", content: "Invented one" }] } },
  { key: "synthetic-two#0", request: { profile: "fixture-reader", messages: [{ role: "user", content: "Invented two" }] } },
] });

describe("BEAM immutable run and cell identities", () => {
  test("resumes exactly matching configuration and request bodies", () => {
    const input = runInput(), manifest = createBeamRunManifestV1(input);
    expect(assertBeamRunResumeV1(manifest, JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
    expect(manifest.configSha256).toBe(canonicalSha256(input.config));
    expect(manifest.cells[0]!.requestSha256).toBe(canonicalSha256(input.cells[0]!.request));
    input.cells[0]!.request.messages[0]!.content = "Changed after creation";
    expect(Object.isFrozen(manifest.cells[0])).toBeTrue();
    expect(() => assertBeamRunResumeV1(createBeamRunManifestV1(input), manifest)).toThrow("resume configuration");
  });

  test("refuses config drift, changed requests, cell drift and forged stored digests", () => {
    const old = createBeamRunManifestV1(runInput());
    for (const change of [
      (input: ReturnType<typeof runInput>) => { input.config.scorer = "different" as typeof BEAM_BINARY_JUDGE_PROTOCOL_V2; },
      (input: ReturnType<typeof runInput>) => { input.cells[0]!.request.profile = "different"; },
      (input: ReturnType<typeof runInput>) => { input.cells[0]!.key = "different"; },
      (input: ReturnType<typeof runInput>) => { input.cells.pop(); },
      (input: ReturnType<typeof runInput>) => { input.runId = "other"; },
    ]) { const input = runInput(); change(input); expect(() => assertBeamRunResumeV1(createBeamRunManifestV1(input), old)).toThrow(); }
    expect(() => assertBeamRunResumeV1(old, { ...old, configSha256: "b".repeat(64) })).toThrow("manifest digest mismatch");
    const duplicate = runInput(); duplicate.cells.push(duplicate.cells[0]!);
    expect(() => createBeamRunManifestV1(duplicate)).toThrow("duplicate cell");
  });

  test("requires every distinct expected cell, exact request identity and explicit unresolved status", () => {
    const manifest = createBeamRunManifestV1(runInput()), rows = manifest.cells.map(cell => ({ ...cell, configSha256: manifest.configSha256, status: "resolved" }));
    expect(auditBeamRunCellsV1(manifest, rows)).toEqual({ complete: true, expectedCells: 2, observedCells: 2, missing: [], unresolved: [] });
    expect(auditBeamRunCellsV1(manifest, rows.slice(0, 1))).toMatchObject({ complete: false, missing: [rows[1]!.key] });
    expect(auditBeamRunCellsV1(manifest, [{ ...rows[0], status: "unresolved" }, rows[1]])).toMatchObject({ complete: false, unresolved: [rows[0]!.key] });
    for (const invalid of [[rows[0], rows[0]], [{ ...rows[0], key: "other" }], [{ ...rows[0], configSha256: "f".repeat(64) }],
      [{ ...rows[0], requestSha256: "f".repeat(64) }], [{ ...rows[0], status: "pending" }]]) {
      expect(() => auditBeamRunCellsV1(manifest, invalid)).toThrow();
    }
  });
});
