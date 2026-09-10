import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createEvolutionDatasetManifest, type EvolutionDatasetManifest } from "../scripts/benchmarks/evolution-dataset";
import { assertEvolutionEvaluationShardCoverage, makeEvolutionEvaluationScope, validateEvolutionEvaluationScope,
  type EvolutionEvaluationScopeInput } from "../scripts/benchmarks/evolution-evaluation-scope";

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const hash = (v: unknown) => canonicalSha256(v);
const source = { dataset: "synthetic-benchmark", revision: "synthetic-v1", sourceSha256: hash("source") };
const named = (id: string) => ({ id, specSha256: hash(id) });
const design = { experimentSpecSha256: hash("predeclared experiment"), candidate: named("candidate"), controls: [named("bm25")],
  readers: [named("nano-contract"), named("mini-contract")], judge: named("native-adapter"), rubricSha256: hash("rubric") };
function manifest(count = 8, groups = Array.from({ length: count }, (_, i) => `group-${i}`), sealed = false): EvolutionDatasetManifest {
  const corpora = groups.map((groupId, i) => ({ id: `corpus-${i}`, groupId, turns: [{ id: `turn-${i}`, sessionId: `session-${i}`,
    date: "2026-01-01", speaker: "user", text: "Synthetic source only." }] }));
  return createEvolutionDatasetManifest({ corpora, questions: corpora.map((c, i) => ({ id: `question-${i}`, corpusId: c.id,
    category: i % 2 ? "category-b" : "category-a", question: "Synthetic question?", questionDate: "2026-01-02", answer: "Synthetic gold.",
    unanswerable: false, evidenceTurnIds: [], evidenceSessionIds: [] })) }, { ...source,
    groups: [...new Set(groups)].map((groupId, i) => ({ groupId, partition: sealed ? "sealed" : i < 2 ? "development" : "closed",
      exposure: sealed ? "unseen" : i < 2 ? "development" : "unknown", evidence: "Synthetic metadata fixture." })) });
}
function input(m = manifest()): EvolutionEvaluationScopeInput {
  const manifestBytes = bytes(m);
  return { manifestBytes, manifestSha256: sha256Hex(manifestBytes), source,
    request: { mode: "full-release-descriptive", maximumQuestionsPerShard: 3, design } };
}
function resealManifest(m: EvolutionDatasetManifest): EvolutionDatasetManifest {
  return { ...m, datasetSha256: sha256Hex(JSON.stringify({ corpora: m.corpora, questions: m.questions })) };
}

test("full500 description preserves all IDs and exposure strata in bounded deterministic shards", () => {
  const groups = Array.from({ length: 500 }, (_, i) => `group-${i < 471 ? i : i - 471}`), m = manifest(500, groups);
  const before = bytes(m), selected = { ...input(m), request: { mode: "full-release-descriptive" as const, maximumQuestionsPerShard: 100, design } };
  const scope = makeEvolutionEvaluationScope(selected);
  expect(scope.coverage).toEqual({ releaseQuestions: 500, selectedQuestions: 500, declaredGroups: 471, declaredHistories: 471,
    connectedDeclaredClusters: 471, logicalReaderCases: 2000 });
  expect(new Set(scope.shards.flatMap(s => s.questionIds)).size).toBe(500);
  expect(scope.shards.every(s => s.questionIds.length > 0 && s.questionIds.length <= 100)).toBe(true);
  expect(scope.shards.flatMap(s => s.questionIds)).toEqual(scope.questions.map(q => q.id));
  expect(scope.strata.find(s => s.partition === "closed")!.exposure).toBe("unknown");
  expect(scope.eligibilityAuditSha256).toBeNull(); expect(scope.qualification).toContain("not proven independent");
  expect(makeEvolutionEvaluationScope(selected)).toEqual(scope); expect(validateEvolutionEvaluationScope(selected, bytes(scope))).toEqual(scope);
  expect(bytes(m)).toEqual(before); expect(Object.isFrozen(scope.shards[0]!.questionIds)).toBe(true);
  expect(JSON.stringify(scope)).not.toContain("Synthetic gold"); expect(JSON.stringify(scope)).not.toContain("Synthetic question");
});

test("sealed confirmation requires explicit audit binding and never turns closed/unknown into unseen", () => {
  const m = manifest(8, undefined, true), base = input(m), selectedQuestionIds = m.questions.slice(1, 5).map(q => q.runnerId);
  const selected: EvolutionEvaluationScopeInput = { ...base, request: { mode: "sealed-confirmation", maximumQuestionsPerShard: 3, design,
    selectedQuestionIds, eligibilityAuditSha256: hash("separate exposure review") } };
  const scope = makeEvolutionEvaluationScope(selected);
  expect(scope.coverage.selectedQuestions).toBe(4); expect(scope.eligibilityAuditSha256).toBe(hash("separate exposure review"));
  expect(scope.strata).toEqual([{ partition: "sealed", exposure: "unseen", questions: 4, groups: 4 }]);
  expect(scope.qualification).toContain("separate authentication");
  expect(() => makeEvolutionEvaluationScope({ ...input(), request: selected.request })).toThrow("sealed/unseen");
  expect(() => makeEvolutionEvaluationScope({ ...selected, request: { ...selected.request, eligibilityAuditSha256: "bad" } } as EvolutionEvaluationScopeInput)).toThrow("SHA256");
  expect(() => makeEvolutionEvaluationScope({ ...selected, request: { ...selected.request, selectedQuestionIds: [...selectedQuestionIds, selectedQuestionIds[0]!] } } as EvolutionEvaluationScopeInput)).toThrow("duplicate");
  expect(() => makeEvolutionEvaluationScope({ ...selected, request: { ...selected.request, selectedQuestionIds: [hash("foreign")] } } as EvolutionEvaluationScopeInput)).toThrow("foreign");
  expect(() => makeEvolutionEvaluationScope({ ...selected, request: { ...selected.request, selectedQuestionIds: [] } } as EvolutionEvaluationScopeInput)).toThrow("nonempty");
});

test("family and history overlap are transitive and never split by selection or sharding", () => {
  const original = manifest(4, ["g-a", "g-a", "g-b", "g-c"], true);
  // First two share family; second and third share history. All three are one component.
  const shared = structuredClone(original) as any;
  shared.corpora[1]!.historyId = "history-link"; shared.corpora[2]!.historyId = "history-link";
  shared.questions[1]!.historyId = "history-link"; shared.questions[2]!.historyId = "history-link";
  const m = resealManifest(shared), base = input(m), scope = makeEvolutionEvaluationScope(base);
  expect(scope.coverage.connectedDeclaredClusters).toBe(2);
  const linked = scope.questions.filter(q => q.groupId === "g-a" || q.groupId === "g-b");
  expect(new Set(linked.map(q => q.clusterId)).size).toBe(1);
  expect(scope.shards.some(s => linked.every(q => s.questionIds.includes(q.id)))).toBe(true);
  expect(() => makeEvolutionEvaluationScope({ ...base, request: { ...base.request, maximumQuestionsPerShard: 2 } })).toThrow("cluster exceeds");
  expect(() => makeEvolutionEvaluationScope({ ...base, request: { mode: "sealed-confirmation", maximumQuestionsPerShard: 3, design,
    selectedQuestionIds: [m.questions[0]!.runnerId], eligibilityAuditSha256: hash("review") } })).toThrow("splits");
});

test("manifest hashing, exact schemas and metadata joins reject substitutions and gold extras", () => {
  const m = manifest();
  const mutations: Array<(v: any) => void> = [
    v => v.questions.push(v.questions[0]), v => v.corpora.push(v.corpora[0]), v => v.groups.push(v.groups[0]),
    v => v.questions[0].runnerId = hash("wrong runner"), v => v.questions[0].corpusId = "foreign",
    v => v.questions[0].groupId = v.questions[1].groupId, v => v.questions[0].partition = "sealed",
    v => v.questions[0].answer = "DO_NOT_ADMIT_GOLD", v => v.corpora[0].turns = [], v => v.groups[0].unanswerable = true,
    v => v.groups[0].partition = "sealed", v => v.corpora[0].contentSha256 = "bad",
    v => v.questions[0].historyId = "not-corpus-history",
  ];
  for (const mutate of mutations) { const bad = structuredClone(m); mutate(bad); expect(() => makeEvolutionEvaluationScope(input(bad))).toThrow(); }
  const original = input(m); expect(() => makeEvolutionEvaluationScope({ ...original, manifestSha256: hash("wrong") })).toThrow("pinned manifest");
  expect(() => makeEvolutionEvaluationScope({ ...original, source: { ...source, revision: "other" } })).toThrow("manifest/source");
  expect(() => makeEvolutionEvaluationScope({ ...original, manifestBytes: new Uint8Array(8 * 1024 * 1024 + 1) })).toThrow("bound");
  const partition = structuredClone(m) as any; partition.corpora[3]!.historyId = partition.corpora[0]!.historyId;
  partition.questions[3]!.historyId = partition.questions[0]!.historyId;
  expect(() => makeEvolutionEvaluationScope(input(resealManifest(partition)))).toThrow("crosses partitions");
});

test("rebuilt scope binds every shard, design and failure policy despite resealed candidate output", () => {
  const selected = input(), scope = makeEvolutionEvaluationScope(selected);
  for (const mutate of [
    (s: any) => s.shards[0].questionIds.pop(), (s: any) => s.questions.pop(),
    (s: any) => s.questions[0].exposure = "unseen", (s: any) => s.design.candidate.id = "different",
    (s: any) => s.design.readers[0].specSha256 = hash("different"), (s: any) => s.design.rubricSha256 = hash("different rubric"),
    (s: any) => s.failurePolicy = "drop failures", (s: any) => s.mode = "sealed-confirmation",
  ]) {
    const bad = structuredClone(scope) as any; mutate(bad); const { scopeSha256: _, ...payload } = bad; bad.scopeSha256 = hash(payload);
    expect(() => validateEvolutionEvaluationScope(selected, bytes(bad))).toThrow("scope differs");
  }
  expect(() => makeEvolutionEvaluationScope({ ...selected, request: { ...selected.request, design: { ...design, controls: [design.candidate] } } })).toThrow("duplicate");
  expect(() => makeEvolutionEvaluationScope({ ...selected, request: { ...selected.request, design: { ...design, readers: [design.readers[0]!, design.readers[0]!] } } })).toThrow("duplicate");
});

test("every final shard requires its full logical question denominator", () => {
  const scope = makeEvolutionEvaluationScope(input()), first = scope.shards[0]!;
  expect(() => assertEvolutionEvaluationShardCoverage(scope, first.id, [...first.questionIds].reverse())).not.toThrow();
  expect(() => assertEvolutionEvaluationShardCoverage(scope, first.id, first.questionIds.slice(1))).toThrow();
  expect(() => assertEvolutionEvaluationShardCoverage(scope, first.id, [...first.questionIds, first.questionIds[0]!])).toThrow();
  expect(() => assertEvolutionEvaluationShardCoverage(scope, first.id, [hash("foreign")])).toThrow();
  expect(() => assertEvolutionEvaluationShardCoverage(scope, "not-a-shard", [])).toThrow("unknown shard");
});
