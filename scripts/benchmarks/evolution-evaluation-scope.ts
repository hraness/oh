/** Pure, additive metadata scope. No dataset text, answers, provider, store or I/O.
 * The caller authenticates the referenced experiment/audit documents and source.
 * A declared exposure or history ID is not proof of freshness or independence. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { assertExactEvolutionCoverage, evolutionRunnerCorpusId, evolutionRunnerQuestionId,
  type EvolutionDatasetManifest, type EvolutionPartition, type EvolutionExposure } from "./evolution-dataset";

export const EVOLUTION_EVALUATION_SCOPE_PROTOCOL = "oh.memory.evaluation-scope.v1" as const;
const MAX_QUESTIONS = 5_000, MAX_BYTES = 8 * 1024 * 1024;
type JsonRecord = Record<string, unknown>;
type NamedSpec = Readonly<{ id: string; specSha256: string }>;
export type EvolutionEvaluationDesign = Readonly<{
  experimentSpecSha256: string; candidate: NamedSpec; controls: readonly NamedSpec[];
  readers: readonly NamedSpec[]; judge: NamedSpec; rubricSha256: string;
}>;
export type EvolutionEvaluationScopeRequest = Readonly<{
  mode: "full-release-descriptive"; maximumQuestionsPerShard: number; design: EvolutionEvaluationDesign;
}> | Readonly<{
  mode: "sealed-confirmation"; maximumQuestionsPerShard: number; design: EvolutionEvaluationDesign;
  selectedQuestionIds: readonly string[]; eligibilityAuditSha256: string;
}>;
export type EvolutionEvaluationScopeInput = Readonly<{
  manifestBytes: Uint8Array; manifestSha256: string;
  source: Readonly<{ dataset: string; revision: string; sourceSha256: string }>;
  request: EvolutionEvaluationScopeRequest;
}>;
export type EvolutionEvaluationScopeQuestion = Readonly<{
  id: string; corpusId: string; groupId: string; historyId: string; clusterId: string;
  category: string; partition: EvolutionPartition; exposure: EvolutionExposure;
  questionContentSha256: string; corpusContentSha256: string;
}>;
export type EvolutionEvaluationScope = Readonly<{
  protocol: typeof EVOLUTION_EVALUATION_SCOPE_PROTOCOL; mode: EvolutionEvaluationScopeRequest["mode"];
  manifestSha256: string; source: EvolutionEvaluationScopeInput["source"]; datasetMetadataSha256: string;
  eligibilityAuditSha256: string | null; design: EvolutionEvaluationDesign;
  maximumQuestionsPerShard: number; questions: readonly EvolutionEvaluationScopeQuestion[];
  shards: readonly Readonly<{ id: string; questionIds: readonly string[]; questionIdsSha256: string }>[];
  coverage: Readonly<{ releaseQuestions: number; selectedQuestions: number; declaredGroups: number;
    declaredHistories: number; connectedDeclaredClusters: number; logicalReaderCases: number }>;
  strata: readonly Readonly<{ partition: EvolutionPartition; exposure: EvolutionExposure; questions: number; groups: number }>[];
  failurePolicy: "all-planned-questions;reader-failure-zero;judge-failure-zero-separate;unadmitted-incomplete;first-attempt-only";
  qualification: "Metadata custody only; declared clusters are not proven independent; unknown exposure is not unseen. Referenced experiment and eligibility documents require separate authentication.";
  scopeSha256: string;
}>;
function fail(message: string): never { throw new TypeError(`Evaluation scope: ${message}.`); }
function record(value: unknown, keys: readonly string[]): JsonRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) fail("exact metadata fields required");
  return value;
}
function text(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum || /\p{Surrogate}/u.test(value)) fail("bounded text required");
  return value;
}
function digest(value: unknown): string { if (parseSha256Hex(value) === null) fail("SHA256 required"); return value as string; }
function list(value: unknown, maximum = MAX_QUESTIONS): readonly unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) fail("bounded nonempty metadata array required"); return value;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function named(value: unknown): NamedSpec {
  const v = record(value, ["id", "specSha256"]); return { id: text(v.id), specSha256: digest(v.specSha256) };
}
function design(value: unknown): EvolutionEvaluationDesign {
  const v = record(value, ["experimentSpecSha256", "candidate", "controls", "readers", "judge", "rubricSha256"]);
  const candidate = named(v.candidate), controls = list(v.controls, 4).map(named), readers = list(v.readers, 2).map(named);
  assertExactEvolutionCoverage([candidate, ...controls].map(x => x.id), [candidate, ...controls].map(x => x.id));
  assertExactEvolutionCoverage(readers.map(x => x.id), readers.map(x => x.id));
  return { experimentSpecSha256: digest(v.experimentSpecSha256), candidate, controls, readers,
    judge: named(v.judge), rubricSha256: digest(v.rubricSha256) };
}
function metadata(input: Pick<EvolutionEvaluationScopeInput, "manifestBytes" | "manifestSha256" | "source">): EvolutionDatasetManifest {
  if (!(input.manifestBytes instanceof Uint8Array) || !input.manifestBytes.length || input.manifestBytes.length > MAX_BYTES
    || sha256Hex(input.manifestBytes) !== digest(input.manifestSha256)) fail("pinned manifest bytes changed or exceeded bound");
  const source = record(input.source, ["dataset", "revision", "sourceSha256"]);
  text(source.dataset); text(source.revision); digest(source.sourceSha256);
  let parsed: unknown; try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.manifestBytes)); } catch { fail("invalid manifest JSON"); }
  const m = record(parsed, ["protocol", "dataset", "revision", "sourceSha256", "datasetSha256", "groups", "corpora", "questions", "qualification"]);
  if (m.protocol !== "oh.memory-evolution.dataset.v1" || m.dataset !== source.dataset || m.revision !== source.revision || m.sourceSha256 !== source.sourceSha256
    || m.qualification !== "Declared grouping and exposure; no independence or freshness inferred.") fail("manifest/source identity");
  digest(m.datasetSha256);
  const groups = list(m.groups).map(value => {
    const g = record(value, ["groupId", "partition", "exposure", "evidence"]);
    text(g.evidence, 4096);
    if (!["development", "search-validation", "sealed", "closed"].includes(text(g.partition))
      || !["unseen", "development", "evaluated", "unknown"].includes(text(g.exposure))
      || g.partition === "sealed" && g.exposure !== "unseen") fail("invalid exposure declaration");
    return { groupId: text(g.groupId), partition: g.partition as EvolutionPartition, exposure: g.exposure as EvolutionExposure, evidence: g.evidence as string };
  });
  assertExactEvolutionCoverage(groups.map(g => g.groupId), groups.map(g => g.groupId));
  const byGroup = new Map(groups.map(g => [g.groupId, g])), historyPartitions = new Map<string, string>();
  const corpora = list(m.corpora).map(value => {
    const c = record(value, ["id", "runnerId", "groupId", "historyId", "contentSha256"]);
    const id = text(c.id), groupId = text(c.groupId), historyId = text(c.historyId), group = byGroup.get(groupId);
    if (!group || c.runnerId !== evolutionRunnerCorpusId(id)) fail("corpus/group/runner identity");
    const previous = historyPartitions.get(historyId);
    if (previous !== undefined && previous !== group.partition) fail("shared history crosses partitions");
    historyPartitions.set(historyId, group.partition);
    return { id, runnerId: c.runnerId as string, groupId, historyId, contentSha256: digest(c.contentSha256) };
  });
  assertExactEvolutionCoverage(corpora.map(c => c.id), corpora.map(c => c.id));
  assertExactEvolutionCoverage([...new Set(corpora.map(c => c.groupId))], groups.map(g => g.groupId));
  const byCorpus = new Map(corpora.map(c => [c.id, c]));
  const questions = list(m.questions).map(value => {
    const q = record(value, ["id", "runnerId", "corpusId", "groupId", "historyId", "category", "partition", "contentSha256"]);
    const id = text(q.id), corpusId = text(q.corpusId), corpus = byCorpus.get(corpusId);
    if (!corpus || q.runnerId !== evolutionRunnerQuestionId(id) || q.groupId !== corpus.groupId || q.historyId !== corpus.historyId
      || q.partition !== byGroup.get(corpus.groupId)!.partition) fail("question/source/partition identity");
    return { id, runnerId: q.runnerId as string, corpusId, groupId: corpus.groupId, historyId: corpus.historyId,
      category: text(q.category), partition: q.partition as EvolutionPartition, contentSha256: digest(q.contentSha256) };
  });
  assertExactEvolutionCoverage(questions.map(q => q.id), questions.map(q => q.id));
  assertExactEvolutionCoverage([...new Set(questions.map(q => q.corpusId))], corpora.map(c => c.id));
  if (sha256Hex(JSON.stringify({ corpora, questions })) !== m.datasetSha256) fail("manifest metadata digest changed");
  return { protocol: m.protocol, dataset: m.dataset as string, revision: m.revision as string, sourceSha256: m.sourceSha256 as string,
    datasetSha256: m.datasetSha256 as string, groups, corpora, questions, qualification: m.qualification };
}

/** Shards keep connected declared family/history components intact. This prevents
 * declared overlap from crossing shards; it does not discover undeclared overlap. */
export function makeEvolutionEvaluationScope(input: EvolutionEvaluationScopeInput): EvolutionEvaluationScope {
  record(input, ["manifestBytes", "manifestSha256", "source", "request"]);
  const m = metadata(input), request = input.request;
  record(request, request.mode === "sealed-confirmation" ? ["mode", "maximumQuestionsPerShard", "design", "selectedQuestionIds", "eligibilityAuditSha256"]
    : ["mode", "maximumQuestionsPerShard", "design"]);
  if (request.mode !== "full-release-descriptive" && request.mode !== "sealed-confirmation") fail("explicit scope mode required");
  const maximum = request.maximumQuestionsPerShard;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100) fail("shards require a1..100 question cap");
  const spec = design(request.design), groupMap = new Map(m.groups.map(g => [g.groupId, g]));
  const byCorpus = new Map(m.corpora.map(c => [c.id, c]));
  // Union question indices by either declared group or history, including transitive overlap.
  const roots = m.questions.map((_, i) => i), groupHeads = new Map<string, number>(), historyHeads = new Map<string, number>();
  const find = (index: number): number => { while (roots[index] !== index) { roots[index] = roots[roots[index]!]!; index = roots[index]!; } return index; };
  m.questions.forEach((q, i) => { for (const [map, key] of [[groupHeads, q.groupId], [historyHeads, q.historyId]] as const) {
    const previous = map.get(key); if (previous === undefined) map.set(key, i); else roots[find(i)] = find(previous);
  } });
  const components = new Map<number, typeof m.questions[number][]>();
  m.questions.forEach((q, i) => { const key = find(i), rows = components.get(key) ?? []; rows.push(q); components.set(key, rows); });
  const allIds = m.questions.map(q => q.runnerId), chosen = request.mode === "full-release-descriptive" ? allIds
    : list(request.selectedQuestionIds).map(value => text(value));
  assertExactEvolutionCoverage(chosen, chosen);
  const chosenSet = new Set(chosen), knownIds = new Set(allIds);
  if (chosen.some(id => !knownIds.has(id))) fail("foreign selected question");
  const eligibilityAuditSha256 = request.mode === "sealed-confirmation" ? digest(request.eligibilityAuditSha256) : null;
  const clusters = [...components.values()].map(rows => rows.sort((a, b) => a.runnerId < b.runnerId ? -1 : a.runnerId > b.runnerId ? 1 : 0))
    .sort((a, b) => a[0]!.runnerId < b[0]!.runnerId ? -1 : 1).filter(rows => {
      const count = rows.filter(q => chosenSet.has(q.runnerId)).length;
      if (count !== 0 && count !== rows.length) fail("selection splits a declared family/history cluster");
      return count > 0;
    });
  const questions: EvolutionEvaluationScopeQuestion[] = [], shardIds: string[][] = []; let shard: string[] = [];
  for (const rows of clusters) {
    if (rows.length > maximum) fail("declared cluster exceeds shard cap; never split it");
    if (shard.length + rows.length > maximum) { shardIds.push(shard); shard = []; }
    const clusterId = `cluster-${canonicalSha256(rows.map(q => q.runnerId))}`;
    for (const q of rows) {
      const g = groupMap.get(q.groupId)!, c = byCorpus.get(q.corpusId)!;
      if (request.mode === "sealed-confirmation" && (g.partition !== "sealed" || g.exposure !== "unseen")) fail("confirmation requires sealed/unseen declarations");
      questions.push({ id: q.runnerId, corpusId: c.runnerId, groupId: q.groupId, historyId: q.historyId, clusterId,
        category: q.category, partition: q.partition, exposure: g.exposure, questionContentSha256: q.contentSha256, corpusContentSha256: c.contentSha256 });
      shard.push(q.runnerId);
    }
  }
  if (shard.length) shardIds.push(shard);
  assertExactEvolutionCoverage(chosen, questions.map(q => q.id));
  const strataKeys = [...new Set(questions.map(q => JSON.stringify([q.partition, q.exposure])))].sort();
  const strata = strataKeys.map(key => {
    const rows = questions.filter(q => JSON.stringify([q.partition, q.exposure]) === key), first = rows[0]!;
    return { partition: first.partition, exposure: first.exposure, questions: rows.length, groups: new Set(rows.map(q => q.groupId)).size };
  });
  const payload = { protocol: EVOLUTION_EVALUATION_SCOPE_PROTOCOL, mode: request.mode, manifestSha256: input.manifestSha256,
    source: { ...input.source }, datasetMetadataSha256: m.datasetSha256, eligibilityAuditSha256, design: spec, maximumQuestionsPerShard: maximum, questions,
    shards: shardIds.map((questionIds, index) => ({ id: `shard-${String(index + 1).padStart(3, "0")}`, questionIds, questionIdsSha256: canonicalSha256(questionIds) })),
    coverage: { releaseQuestions: m.questions.length, selectedQuestions: questions.length, declaredGroups: new Set(questions.map(q => q.groupId)).size,
      declaredHistories: new Set(questions.map(q => q.historyId)).size, connectedDeclaredClusters: clusters.length,
      logicalReaderCases: questions.length * (1 + spec.controls.length) * spec.readers.length }, strata,
    failurePolicy: "all-planned-questions;reader-failure-zero;judge-failure-zero-separate;unadmitted-incomplete;first-attempt-only" as const,
    qualification: "Metadata custody only; declared clusters are not proven independent; unknown exposure is not unseen. Referenced experiment and eligibility documents require separate authentication." as const };
  return freeze({ ...payload, scopeSha256: canonicalSha256(payload) });
}

/** Exact rebuilt scope: serialized candidates are bounded before parsing. A scope
 * can never admit a new selection, rubric, exposure declaration or shard by resealing. */
export function validateEvolutionEvaluationScope(input: EvolutionEvaluationScopeInput, bytes: Uint8Array): EvolutionEvaluationScope {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) fail("bounded serialized scope required");
  const expected = makeEvolutionEvaluationScope(input);
  let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("invalid scope JSON"); }
  if (canonicalSha256(value) !== canonicalSha256(expected)) fail("scope differs from pinned metadata and declared design");
  return expected;
}

/** Check a final shard's ID-only coverage; physical deduplication does not shrink
 * this logical denominator. This helper does not authenticate scored receipts. */
export function assertEvolutionEvaluationShardCoverage(scope: EvolutionEvaluationScope, shardId: string, ids: readonly string[]): void {
  const shard = scope.shards.find(s => s.id === shardId); if (!shard) fail("unknown shard");
  if (!Array.isArray(ids) || ids.length > 100) fail("bounded shard coverage required");
  assertExactEvolutionCoverage(shard.questionIds, ids);
}

/* ---------------------------------------------------------------------------------------------------------
 * V2: explicit ordered selection, shard caps to 260, cluster policies for conversation-level benchmarks.
 * V1 above is untouched; V7 studies keep using it. A V2 scope never reinterprets a V1 scope.
 * ------------------------------------------------------------------------------------------------------- */
export const EVOLUTION_EVALUATION_SCOPE_V2_PROTOCOL = "oh.memory.evaluation-scope.v2" as const;
export const EVOLUTION_EVALUATION_SCOPE_V2_MAXIMUM_SHARD = 260;
export const EVOLUTION_EVALUATION_SHARD_POLICIES = ["packed-clusters", "one-cluster-per-shard"] as const;
export type EvolutionEvaluationShardPolicy = typeof EVOLUTION_EVALUATION_SHARD_POLICIES[number];
export type EvolutionEvaluationDesignV2 = EvolutionEvaluationDesign & Readonly<{
  dataset: string; candidateVariantSha256: string; repeats: number; judgeRepeats: number; readerDatePolicySha256: string;
}>;
export type EvolutionEvaluationScopeRequestV2 = Readonly<{
  mode: "explicit-selection"; maximumQuestionsPerShard: number; shardPolicy: EvolutionEvaluationShardPolicy;
  design: EvolutionEvaluationDesignV2; selectedQuestionIds: readonly string[];
}>;
export type EvolutionEvaluationScopeInputV2 = Readonly<{
  manifestBytes: Uint8Array; manifestSha256: string;
  source: Readonly<{ dataset: string; revision: string; sourceSha256: string }>;
  request: EvolutionEvaluationScopeRequestV2;
}>;
export const EVOLUTION_EVALUATION_SCOPE_V2_FAILURE_POLICY = "all-planned-questions;reader-failure-zero;judge-failure-zero-separate;unadmitted-incomplete;indexed-repeats-predeclared" as const;
export const EVOLUTION_EVALUATION_SCOPE_V2_QUALIFICATION = "Metadata custody only; declared clusters are not proven independent; unknown exposure is not unseen; an explicit selection is a declared subset, not a fresh sample. Referenced experiment and eligibility documents require separate authentication." as const;
export type EvolutionEvaluationScopeV2 = Readonly<{
  protocol: typeof EVOLUTION_EVALUATION_SCOPE_V2_PROTOCOL; mode: "explicit-selection"; shardPolicy: EvolutionEvaluationShardPolicy;
  manifestSha256: string; source: EvolutionEvaluationScopeInputV2["source"]; datasetMetadataSha256: string;
  design: EvolutionEvaluationDesignV2; maximumQuestionsPerShard: number; selectedQuestionIdsSha256: string;
  questions: readonly EvolutionEvaluationScopeQuestion[];
  shards: readonly Readonly<{ id: string; clusterIds: readonly string[]; questionIds: readonly string[]; questionIdsSha256: string }>[];
  coverage: Readonly<{ releaseQuestions: number; selectedQuestions: number; declaredGroups: number; declaredHistories: number;
    connectedDeclaredClusters: number; partiallySelectedClusters: number; logicalReaderCases: number; logicalJudgeCases: number }>;
  strata: readonly Readonly<{ partition: EvolutionPartition; exposure: EvolutionExposure; questions: number; groups: number }>[];
  failurePolicy: typeof EVOLUTION_EVALUATION_SCOPE_V2_FAILURE_POLICY;
  qualification: typeof EVOLUTION_EVALUATION_SCOPE_V2_QUALIFICATION;
  scopeSha256: string;
}>;
function repeatCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3) fail("repeats require 1..3");
  return value as number;
}
function designV2(value: unknown): EvolutionEvaluationDesignV2 {
  const v = record(value, ["experimentSpecSha256", "dataset", "candidate", "candidateVariantSha256", "controls", "readers", "judge", "rubricSha256", "repeats", "judgeRepeats", "readerDatePolicySha256"]);
  const candidate = named(v.candidate), controls = list(v.controls, 4).map(named), readers = list(v.readers, 4).map(named);
  assertExactEvolutionCoverage([candidate, ...controls].map(x => x.id), [candidate, ...controls].map(x => x.id));
  assertExactEvolutionCoverage(readers.map(x => x.id), readers.map(x => x.id));
  return { experimentSpecSha256: digest(v.experimentSpecSha256), dataset: text(v.dataset), candidate, candidateVariantSha256: digest(v.candidateVariantSha256),
    controls, readers, judge: named(v.judge), rubricSha256: digest(v.rubricSha256), repeats: repeatCount(v.repeats), judgeRepeats: repeatCount(v.judgeRepeats),
    readerDatePolicySha256: digest(v.readerDatePolicySha256) };
}
/** Explicit ordered selection over declared clusters. `packed-clusters` reproduces the V1 packing over the selected
 * members (the LongMemEval full500 selection therefore yields the V1 shards); `one-cluster-per-shard` gives every
 * declared conversation cluster its own shard for LoCoMo and BEAM. Partially selected clusters (LoCoMo without its
 * adversarial category) are admitted and counted; they are never split across shards. */
export function makeEvolutionEvaluationScopeV2(input: EvolutionEvaluationScopeInputV2): EvolutionEvaluationScopeV2 {
  record(input, ["manifestBytes", "manifestSha256", "source", "request"]);
  const m = metadata(input), request = input.request;
  record(request, ["mode", "maximumQuestionsPerShard", "shardPolicy", "design", "selectedQuestionIds"]);
  if (request.mode !== "explicit-selection") fail("explicit selection mode required");
  if (!(EVOLUTION_EVALUATION_SHARD_POLICIES as readonly string[]).includes(request.shardPolicy)) fail("unknown shard policy");
  const maximum = request.maximumQuestionsPerShard;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > EVOLUTION_EVALUATION_SCOPE_V2_MAXIMUM_SHARD) fail("shards require a 1..260 question cap");
  const spec = designV2(request.design);
  if (spec.dataset !== input.source.dataset) fail("design dataset differs from source");
  const groupMap = new Map(m.groups.map(g => [g.groupId, g])), byCorpus = new Map(m.corpora.map(c => [c.id, c]));
  const roots = m.questions.map((_, i) => i), groupHeads = new Map<string, number>(), historyHeads = new Map<string, number>();
  const find = (index: number): number => { while (roots[index] !== index) { roots[index] = roots[roots[index]!]!; index = roots[index]!; } return index; };
  m.questions.forEach((q, i) => { for (const [map, key] of [[groupHeads, q.groupId], [historyHeads, q.historyId]] as const) {
    const previous = map.get(key); if (previous === undefined) map.set(key, i); else roots[find(i)] = find(previous);
  } });
  const components = new Map<number, typeof m.questions[number][]>();
  m.questions.forEach((q, i) => { const key = find(i), rows = components.get(key) ?? []; rows.push(q); components.set(key, rows); });
  const chosen = list(request.selectedQuestionIds).map(value => text(value));
  assertExactEvolutionCoverage(chosen, chosen);
  const chosenSet = new Set(chosen), knownIds = new Set(m.questions.map(q => q.runnerId));
  if (chosen.some(id => !knownIds.has(id))) fail("foreign selected question");
  let partial = 0;
  const clusters = [...components.values()].map(rows => rows.sort((a, b) => a.runnerId < b.runnerId ? -1 : a.runnerId > b.runnerId ? 1 : 0))
    .map(rows => ({ clusterId: `cluster-${canonicalSha256(rows.map(q => q.runnerId))}`, rows, selected: rows.filter(q => chosenSet.has(q.runnerId)) }))
    .filter(c => { if (c.selected.length > 0 && c.selected.length !== c.rows.length) partial++; return c.selected.length > 0; })
    .sort((a, b) => a.selected[0]!.runnerId < b.selected[0]!.runnerId ? -1 : 1);
  const questions: EvolutionEvaluationScopeQuestion[] = [], shards: Array<{ clusterIds: string[]; questionIds: string[] }> = [];
  let shard: { clusterIds: string[]; questionIds: string[] } = { clusterIds: [], questionIds: [] };
  for (const cluster of clusters) {
    if (cluster.selected.length > maximum) fail("declared cluster exceeds shard cap; never split it");
    if (request.shardPolicy === "one-cluster-per-shard" ? shard.questionIds.length > 0 : shard.questionIds.length + cluster.selected.length > maximum) {
      shards.push(shard); shard = { clusterIds: [], questionIds: [] };
    }
    shard.clusterIds.push(cluster.clusterId);
    for (const q of cluster.selected) {
      const g = groupMap.get(q.groupId)!, c = byCorpus.get(q.corpusId)!;
      questions.push({ id: q.runnerId, corpusId: c.runnerId, groupId: q.groupId, historyId: q.historyId, clusterId: cluster.clusterId,
        category: q.category, partition: q.partition, exposure: g.exposure, questionContentSha256: q.contentSha256, corpusContentSha256: c.contentSha256 });
      shard.questionIds.push(q.runnerId);
    }
  }
  if (shard.questionIds.length) shards.push(shard);
  if (shards.length > 999) fail("shard count exceeds the three-digit identifier space");
  assertExactEvolutionCoverage(chosen, questions.map(q => q.id));
  const strataKeys = [...new Set(questions.map(q => JSON.stringify([q.partition, q.exposure])))].sort();
  const strata = strataKeys.map(key => {
    const rows = questions.filter(q => JSON.stringify([q.partition, q.exposure]) === key), first = rows[0]!;
    return { partition: first.partition, exposure: first.exposure, questions: rows.length, groups: new Set(rows.map(q => q.groupId)).size };
  });
  const arms = (1 + spec.controls.length) * spec.readers.length;
  const payload = { protocol: EVOLUTION_EVALUATION_SCOPE_V2_PROTOCOL, mode: request.mode, shardPolicy: request.shardPolicy, manifestSha256: input.manifestSha256,
    source: { ...input.source }, datasetMetadataSha256: m.datasetSha256, design: spec, maximumQuestionsPerShard: maximum,
    selectedQuestionIdsSha256: canonicalSha256(chosen), questions,
    shards: shards.map((s, index) => ({ id: `shard-${String(index + 1).padStart(3, "0")}`, clusterIds: s.clusterIds, questionIds: s.questionIds, questionIdsSha256: canonicalSha256(s.questionIds) })),
    coverage: { releaseQuestions: m.questions.length, selectedQuestions: questions.length, declaredGroups: new Set(questions.map(q => q.groupId)).size,
      declaredHistories: new Set(questions.map(q => q.historyId)).size, connectedDeclaredClusters: clusters.length, partiallySelectedClusters: partial,
      logicalReaderCases: questions.length * arms * spec.repeats, logicalJudgeCases: questions.length * arms * spec.repeats * spec.judgeRepeats }, strata,
    failurePolicy: EVOLUTION_EVALUATION_SCOPE_V2_FAILURE_POLICY, qualification: EVOLUTION_EVALUATION_SCOPE_V2_QUALIFICATION };
  return freeze({ ...payload, scopeSha256: canonicalSha256(payload) });
}
export function validateEvolutionEvaluationScopeV2(input: EvolutionEvaluationScopeInputV2, bytes: Uint8Array): EvolutionEvaluationScopeV2 {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) fail("bounded serialized scope required");
  const expected = makeEvolutionEvaluationScopeV2(input);
  let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("invalid scope JSON"); }
  if (canonicalSha256(value) !== canonicalSha256(expected)) fail("scope differs from pinned metadata and declared design");
  return expected;
}
export function assertEvolutionEvaluationShardCoverageV2(scope: EvolutionEvaluationScopeV2, shardId: string, ids: readonly string[]): void {
  const shard = scope.shards.find(s => s.id === shardId); if (!shard) fail("unknown shard");
  if (!Array.isArray(ids) || ids.length > EVOLUTION_EVALUATION_SCOPE_V2_MAXIMUM_SHARD) fail("bounded shard coverage required");
  assertExactEvolutionCoverage(shard.questionIds, ids);
}
