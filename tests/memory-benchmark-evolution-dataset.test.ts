import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../src/canonical";
import type { Dataset } from "../scripts/benchmarks/datasets";
import { assertExactEvolutionCoverage, createEvolutionDatasetManifest, evolutionRunnerQuestionId,
  projectEvolutionRunnerInput, selectEvolutionPartition, validateEvolutionDatasetManifest,
  type EvolutionDatasetManifestInput } from "../scripts/benchmarks/evolution-dataset";

function fixture(): Dataset {
  const corpus = (id: string, groupId: string) => ({ id, groupId,
    turns: [{ id: "turn-1", sessionId: "session-1", sessionIndex: 0, date: "2026-01-01", speaker: "user", text: "I moved to Boston." }] });
  const question = (id: string, corpusId: string) => ({ id, corpusId, category: "knowledge-update", question: "Where do I live?",
    questionDate: "2026-02-01", answer: "Boston", unanswerable: id.endsWith("_abs"), evidenceTurnIds: ["turn-1"], evidenceSessionIds: ["session-1"] });
  return { corpora: [corpus("family-a", "family-a"), corpus("family-a_abs", "family-a"), corpus("history-b", "family-b")],
    questions: [question("family-a", "family-a"), question("family-a_abs", "family-a_abs"), question("question-b", "history-b")] };
}
function input(): EvolutionDatasetManifestInput {
  return { dataset: "synthetic", revision: "fixture-v1", sourceSha256: "a".repeat(64), groups: [
    { groupId: "family-a", partition: "development", exposure: "development", evidence: "Existing development family." },
    { groupId: "family-b", partition: "sealed", exposure: "unseen", evidence: "Declared unexposed synthetic holdout." },
  ] };
}

describe("evolution exposure manifest", () => {
  test("keeps family variants together and does not infer independent histories", () => {
    const dataset = fixture(), manifest = createEvolutionDatasetManifest(dataset, input());
    expect(manifest.questions.filter(q => q.groupId === "family-a").map(q => q.partition)).toEqual(["development", "development"]);
    expect(new Set(manifest.corpora.map(c => c.historyId)).size).toBe(2);
    expect(manifest.qualification).toContain("no independence or freshness inferred");
    expect(selectEvolutionPartition(dataset, manifest, "development").questions.map(q => q.id)).toEqual(["family-a", "family-a_abs"]);
    expect(validateEvolutionDatasetManifest(dataset, JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
    expect(validateEvolutionDatasetManifest(dataset, JSON.parse(canonicalJson(manifest)))).toEqual(manifest);
  });
  test("requires complete explicit group dispositions", () => {
    const dataset = fixture(), config = input();
    expect(() => createEvolutionDatasetManifest(dataset, { ...config, groups: config.groups.slice(1) })).toThrow("missing");
    expect(() => createEvolutionDatasetManifest(dataset, { ...config, groups: [config.groups[0]!, config.groups[0]!] })).toThrow("duplicates");
    expect(() => createEvolutionDatasetManifest(dataset, { ...config, groups: [...config.groups, { ...config.groups[0]!, groupId: "foreign" }] })).toThrow("foreign");
  });
  test("unknown exposure is explicit and cannot qualify sealed data", () => {
    const config = input();
    const groups = config.groups.map(g => ({ ...g, exposure: "unknown" as const }));
    expect(() => createEvolutionDatasetManifest(fixture(), { ...config, groups })).toThrow("unseen");
    groups[1] = { ...groups[1]!, partition: "closed" };
    const manifest = createEvolutionDatasetManifest(fixture(), { ...config, groups });
    expect(manifest.groups[1]!.exposure).toBe("unknown");
    expect(() => selectEvolutionPartition(fixture(), manifest, "closed" as "development")).toThrow("cannot open");
    expect(() => selectEvolutionPartition(fixture(), manifest, "sealed" as "development")).toThrow("cannot open");
  });
  test("explicit shared histories cannot straddle family partitions", () => {
    const dataset = fixture();
    expect(() => createEvolutionDatasetManifest(dataset, { ...input(), histories: dataset.corpora.map(c => ({ corpusId: c.id, historyId: "same-user" })) })).toThrow("crosses partitions");
    expect(() => createEvolutionDatasetManifest(dataset, { ...input(), histories: [{ corpusId: "family-a", historyId: "a" }] })).toThrow("missing");
  });
  test("authenticates corpus content and scorer-only labels before selection", () => {
    const dataset = fixture(), manifest = createEvolutionDatasetManifest(dataset, input());
    const changed = { ...dataset, corpora: dataset.corpora.map((c, i) => i ? c : {
      ...c, turns: c.turns.map(t => ({ ...t, text: "I moved to Austin." })),
    }) };
    expect(() => validateEvolutionDatasetManifest(changed, manifest)).toThrow("does not match");
    const relabeled = { ...dataset, questions: dataset.questions.map((q, i) => i ? q : { ...q, answer: "Austin" }) };
    expect(() => selectEvolutionPartition(relabeled, manifest, "development")).toThrow("does not match");
    expect(() => validateEvolutionDatasetManifest(dataset, { ...manifest, unexpected: true })).toThrow("invalid keys");
  });
  test("rejects ambiguous source IDs and malformed source identity", () => {
    const dataset = fixture();
    expect(() => createEvolutionDatasetManifest({ ...dataset, questions: [...dataset.questions, dataset.questions[0]!] }, input())).toThrow("duplicates");
    expect(() => createEvolutionDatasetManifest({ ...dataset, questions: [{ ...dataset.questions[0]!, corpusId: "foreign" }] }, input())).toThrow("foreign corpus");
    expect(() => createEvolutionDatasetManifest(dataset, { ...input(), sourceSha256: "bad" })).toThrow("SHA-256");
    expect(() => createEvolutionDatasetManifest(dataset, { ...input(), groups: input().groups.map(g => ({ ...g, evidence: "" })) })).toThrow("nonempty");
  });
});

describe("evolution runner boundary and denominator", () => {
  test("copies only allowed fields and removes labels from question IDs", () => {
    const dataset = fixture();
    Object.assign(dataset.questions[0]!, { judgeResult: true });
    Object.assign(dataset.corpora[0]!.turns[0]!, { has_answer: true });
    const projected = projectEvolutionRunnerInput(dataset);
    expect(projected.questions[1]!.id).toBe(evolutionRunnerQuestionId("family-a_abs"));
    expect(projected.questions[1]!.id).not.toContain("_abs");
    expect(Object.keys(projected.questions[0]!)).toEqual(["id", "corpusId", "question", "questionDate"]);
    expect(Object.keys(projected.corpora[0]!)).toEqual(["id", "turns"]);
    expect(Object.keys(projected.corpora[0]!.turns[0]!)).not.toContain("has_answer");
    expect(JSON.stringify(projected)).not.toContain("evidenceTurnIds");
    expect(JSON.stringify(projected)).not.toContain("knowledge-update");
    expect(projected.questions[0]!.corpusId).toBe(projected.corpora[0]!.id);
    expect(projected.corpora[0]!.turns[0]).not.toBe(dataset.corpora[0]!.turns[0]);
  });
  test("requires every eligible ID once, independently of order", () => {
    expect(() => assertExactEvolutionCoverage(["a", "b"], ["b", "a"])).not.toThrow();
    expect(() => assertExactEvolutionCoverage(["a", "b"], ["a"])).toThrow("missing");
    expect(() => assertExactEvolutionCoverage(["a", "b"], ["a", "a"])).toThrow("duplicates");
    expect(() => assertExactEvolutionCoverage(["a", "b"], ["a", "c"])).toThrow("foreign");
    expect(() => assertExactEvolutionCoverage(["a", "a"], ["a", "b"])).toThrow("duplicates");
  });
});
