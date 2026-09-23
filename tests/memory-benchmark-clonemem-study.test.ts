import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { cloneMemPairedSource, verifyCloneMemPairedSource } from "../scripts/benchmarks/clonemem-study";
import type { CloneMemProjection } from "../scripts/benchmarks/clonemem-dataset";
import type { CloneMemRetrievalResult } from "../scripts/benchmarks/clonemem-retrieval";

function fixture() {
  const questions = Array.from({ length: 100 }, (_, i) => ({ id: `person:q${i}`, localId: `q${i}`, personId: "person",
    personName: "Person", question: `Question ${i}?`, questionDate: "2024-01-01T00:00:00", choices: [{ id: "A", text: "First" }, { id: "B", text: "Second" }] }));
  const projection: CloneMemProjection = { memory: { personId: "person", personName: "Person", traces: [] },
    queries: questions, readerQuestions: questions, scorer: questions.map(q => ({ questionId: q.id, personId: "person", category: "test",
      correctChoiceId: "A", evidenceGroups: [["trace"]] })), sourceSha256: "a".repeat(64), retrievalSha256: "b".repeat(64),
    readerSha256: "c".repeat(64), scorerSha256: "d".repeat(64) };
  const rows = new Map<string, CloneMemRetrievalResult>(questions.map(q => [q.id, {
    protocol: "oh.clonemem-retrieval-result.v1", personId: "person", querySha256: "a".repeat(64), identitySha256: "b".repeat(64),
    questionDate: q.questionDate, eligibleTraceIds: ["trace"], authorityHeadSha256: "c".repeat(64), semanticCapture: [], semanticCaptureSha256: "d".repeat(64),
    arms: (["oh-hybrid", "raw-vector", "oh-keyword"] as const).map(arm => ({ arm, traceIds: ["trace"], context: `${q.id} ${arm} evidence`,
      contextBytes: 1, contextSha256: "e".repeat(64), sources: [], evidence: [] })),
    timing: { incrementalIndexMs: 0, hybridWallMs: 0, sharedSemanticTop30Ms: 0, keywordWallMs: 0 }, resultSha256: "f".repeat(64),
  }]));
  return { projections: [projection], rows };
}

describe("CloneMem source and scored-context binding", () => {
  test("gold changes never affect the fixed reader projection", () => {
    const captured = fixture(), source = cloneMemPairedSource(captured, 100), changed = structuredClone(captured);
    changed.projections[0] = { ...changed.projections[0]!, scorer: changed.projections[0]!.scorer.map(row => ({ ...row, correctChoiceId: "B", evidenceGroups: [["different"]] })) };
    expect(canonicalSha256(cloneMemPairedSource(changed, 100))).toBe(canonicalSha256(source));
    expect(verifyCloneMemPairedSource(structuredClone(source), captured, 100)).toEqual(source);
    expect(JSON.stringify(source)).not.toContain("correctChoiceId");
  });
  test("final scoring rejects question, option, context and population transplants", () => {
    const captured = fixture(), source = cloneMemPairedSource(captured, 100);
    const variants = [
      { ...source, questions: source.questions.map((q, i) => i ? q : { ...q, question: "Another question?" }) },
      { ...source, questions: source.questions.map((q, i) => i ? q : { ...q, choices: [...q.choices].reverse() }) },
      { ...source, questions: source.questions.map((q, i) => i ? q : { ...q, contexts: q.contexts.map(c => ({ ...c, text: "unrelated context" })) }) },
      { ...source, selection: { ...source.selection, population: source.selection.population.slice(1) } },
    ];
    for (const changed of variants) expect(() => verifyCloneMemPairedSource(changed, captured, 100)).toThrow("differs from captured");
  });
});
