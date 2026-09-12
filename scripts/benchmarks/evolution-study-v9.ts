/** V9 study admission: explicit ordered selection, candidate/control systems, indexed repeats, a declared reader
 * date policy and an optional derived-record pin. No source text, answer, store or provider I/O. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { DATASETS, type Dataset } from "./datasets";
import { evolutionPin, type EvolutionPin } from "./evolution-budget";
import { assertExactEvolutionCoverage, evolutionRunnerQuestionId, validateEvolutionDatasetManifest, type EvolutionDatasetManifest } from "./evolution-dataset";
import { makeEvolutionEvaluationScopeV2, validateEvolutionEvaluationScopeV2, EVOLUTION_EVALUATION_SHARD_POLICIES, EVOLUTION_EVALUATION_SCOPE_V2_MAXIMUM_SHARD,
  type EvolutionEvaluationScopeV2, type EvolutionEvaluationShardPolicy } from "./evolution-evaluation-scope";
import { type EvolutionJudgeProfileId } from "./evolution-judge";
import { EVOLUTION_LOCOMO_J_CATEGORIES, EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA } from "./evolution-locomo-judge";
import { EVOLUTION_PROFILES, type EvolutionProfileId } from "./evolution-model";
import { evolutionReaderDatePolicySha256, parseEvolutionReaderDatePolicy, type EvolutionReaderDatePolicy } from "./evolution-reader-date-policy";
import { EVOLUTION_RELEASE_RUBRIC_SHA } from "./evolution-release";
import { EVOLUTION_RETRIEVAL_SYSTEMS, isEvolutionDerivedSystem, isEvolutionV2System, type EvolutionRetrievalVariant } from "./evolution-retrieval";

export const EVOLUTION_STUDY_V9_PROTOCOL = "oh.memory.evolution-study.v9" as const;
/** `beam` is admitted by the grammar so a later pin can be declared without a protocol change; until
 * `DATASETS` carries its revision, bytes and digest every BEAM study fails closed. */
export const EVOLUTION_V9_DATASETS = ["longmemeval-s", "locomo", "beam"] as const;
export type EvolutionV9Dataset = typeof EVOLUTION_V9_DATASETS[number];
export const EVOLUTION_V9_JUDGES = ["gpt4o-gateway-native-rubric-16-judge-v1", "gpt4o-gateway-native-rubric-judge-v1", "gpt4o-official-snapshot-judge", EVOLUTION_LOCOMO_JUDGE_PROFILE_ID] as const;
export type EvolutionV9Judge = typeof EVOLUTION_V9_JUDGES[number];
export type EvolutionV9RetrievalProvenance = Readonly<{ parentStudySha256: string; parentRetrievalSourceSha256: string }>;
export type EvolutionStudyV9 = Readonly<{
  protocol: typeof EVOLUTION_STUDY_V9_PROTOCOL; mode: "explicit-selection-descriptive"; dataset: EvolutionV9Dataset;
  datasetPin: EvolutionPin; manifestPin: EvolutionPin; campaignPin: EvolutionPin; retrievalSourceSha256: string;
  candidate: EvolutionRetrievalVariant; control: EvolutionRetrievalVariant; readers: readonly EvolutionProfileId[];
  judge: EvolutionV9Judge; rubricSha256: string; repeats: number; judgeRepeats: number;
  selection: readonly string[]; maximumQuestionsPerShard: number; shardPolicy: EvolutionEvaluationShardPolicy;
  derivedRecordsPin: EvolutionPin | null; retrievalProvenance: EvolutionV9RetrievalProvenance | null;
  readerDatePolicy: EvolutionReaderDatePolicy; candidatePresentation: "retrieval-order"; repeatPolicy: "predeclared-full-matrix-indexed-repeats";
}>;
export type EvolutionStudyV9Authorization = Readonly<{ study: EvolutionStudyV9; studySha256: string;
  scope: EvolutionEvaluationScopeV2; scopeFileSha256: string }>;
function fail(reason: string): never { throw new TypeError(`Evolution study V9: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
const STUDY_KEYS = ["protocol", "mode", "dataset", "datasetPin", "manifestPin", "campaignPin", "retrievalSourceSha256", "candidate", "control", "readers", "judge",
  "rubricSha256", "repeats", "judgeRepeats", "selection", "maximumQuestionsPerShard", "shardPolicy", "derivedRecordsPin", "retrievalProvenance", "readerDatePolicy",
  "candidatePresentation", "repeatPolicy"] as const;
function decode(bytes: Uint8Array, maximum: number): unknown {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maximum) fail("bounded artifact bytes required");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function repeatCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3) fail("repeats require 1..3");
  return value as number;
}
export function parseEvolutionV9Variant(value: unknown): EvolutionRetrievalVariant {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["id", "system", "budget"]) || typeof value.id !== "string" || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(value.id)
    || !(EVOLUTION_RETRIEVAL_SYSTEMS as readonly unknown[]).includes(value.system) || !isPlainRecord(value.budget) || !hasExactKeys(value.budget, ["topK", "contextBytes"])
    || !Number.isSafeInteger(value.budget.topK) || (value.budget.topK as number) < 1 || (value.budget.topK as number) > 400 || isEvolutionV2System(String(value.system)) && (value.budget.topK as number) > 100
    || !Number.isSafeInteger(value.budget.contextBytes) || (value.budget.contextBytes as number) < 1 || (value.budget.contextBytes as number) > 4_000_000) fail("whole-turn retrieval variant required");
  return { id: value.id, system: value.system as EvolutionRetrievalVariant["system"], budget: { topK: value.budget.topK as number, contextBytes: value.budget.contextBytes as number } };
}
export function evolutionV9RubricSha256(judge: EvolutionV9Judge): string {
  return judge === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID ? EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA : EVOLUTION_RELEASE_RUBRIC_SHA;
}
export function parseEvolutionStudyV9(value: unknown): EvolutionStudyV9 {
  if (!isPlainRecord(value) || !hasExactKeys(value, STUDY_KEYS) || value.protocol !== EVOLUTION_STUDY_V9_PROTOCOL || value.mode !== "explicit-selection-descriptive"
    || !(EVOLUTION_V9_DATASETS as readonly unknown[]).includes(value.dataset) || parseSha256Hex(value.retrievalSourceSha256) === null
    || !(EVOLUTION_V9_JUDGES as readonly unknown[]).includes(value.judge) || value.candidatePresentation !== "retrieval-order"
    || value.repeatPolicy !== "predeclared-full-matrix-indexed-repeats" || !(EVOLUTION_EVALUATION_SHARD_POLICIES as readonly unknown[]).includes(value.shardPolicy)
    || !Number.isSafeInteger(value.maximumQuestionsPerShard) || (value.maximumQuestionsPerShard as number) < 1
    || (value.maximumQuestionsPerShard as number) > EVOLUTION_EVALUATION_SCOPE_V2_MAXIMUM_SHARD) fail("fixed explicit-selection study required");
  const dataset = value.dataset as EvolutionV9Dataset, judge = value.judge as EvolutionV9Judge;
  if (!Object.hasOwn(DATASETS, dataset)) fail(`dataset ${dataset} has no pinned official release yet`);
  const pinned = DATASETS[dataset as keyof typeof DATASETS];
  const candidate = parseEvolutionV9Variant(value.candidate), control = parseEvolutionV9Variant(value.control);
  if (candidate.id === control.id) fail("candidate and control require distinct identifiers");
  if (!Array.isArray(value.readers) || value.readers.length < 1 || value.readers.length > 4) fail("one to four readers required");
  const readers = value.readers.map((r: unknown) => {
    if (typeof r !== "string" || !r.endsWith("-reader") || !Object.hasOwn(EVOLUTION_PROFILES, r)) fail("invalid reader profile");
    return r as EvolutionProfileId;
  });
  if (new Set(readers).size !== readers.length) fail("duplicate reader");
  if (value.rubricSha256 !== evolutionV9RubricSha256(judge)) fail("rubric digest differs from the judge's pinned rubric");
  // The parity judge and the LoCoMo dataset imply each other: LoCoMo J is read only under the leaders' CORRECT/WRONG
  // protocol, and that protocol never grades a LongMemEval question.
  if ((judge === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID) !== (dataset === "locomo")) fail("the LoCoMo parity judge and the locomo dataset require each other");
  if (!Array.isArray(value.selection) || value.selection.length < 1 || value.selection.length > 5_000) fail("bounded explicit selection required");
  const selection = value.selection.map((id: unknown) => {
    if (typeof id !== "string" || !/^q-[a-f0-9]{64}$/.test(id)) fail("selection requires runner question identifiers");
    return id;
  });
  assertExactEvolutionCoverage(selection, selection);
  const datasetPin = evolutionPin(value.datasetPin), manifestPin = evolutionPin(value.manifestPin), campaignPin = evolutionPin(value.campaignPin);
  if (datasetPin.sha256 !== pinned.sha256) fail("official dataset pin required");
  const derivedRecordsPin = value.derivedRecordsPin === null ? null : evolutionPin(value.derivedRecordsPin);
  if ([control, candidate].some(v => isEvolutionDerivedSystem(v.system)) !== (derivedRecordsPin !== null)) fail("derived systems and the derived-record pin require each other");
  let retrievalProvenance: EvolutionV9RetrievalProvenance | null = null;
  if (value.retrievalProvenance !== null) {
    const p = value.retrievalProvenance;
    if (!isPlainRecord(p) || !hasExactKeys(p, ["parentStudySha256", "parentRetrievalSourceSha256"])
      || parseSha256Hex(p.parentStudySha256) === null || parseSha256Hex(p.parentRetrievalSourceSha256) === null) fail("retrieval provenance requires parent study and retrieval source digests");
    retrievalProvenance = { parentStudySha256: p.parentStudySha256 as string, parentRetrievalSourceSha256: p.parentRetrievalSourceSha256 as string };
  }
  return Object.freeze({ protocol: EVOLUTION_STUDY_V9_PROTOCOL, mode: "explicit-selection-descriptive", dataset, datasetPin, manifestPin, campaignPin,
    retrievalSourceSha256: value.retrievalSourceSha256 as string, candidate, control, readers, judge, rubricSha256: value.rubricSha256 as string,
    repeats: repeatCount(value.repeats), judgeRepeats: repeatCount(value.judgeRepeats), selection, maximumQuestionsPerShard: value.maximumQuestionsPerShard as number,
    shardPolicy: value.shardPolicy as EvolutionEvaluationShardPolicy, derivedRecordsPin, retrievalProvenance,
    readerDatePolicy: parseEvolutionReaderDatePolicy(value.readerDatePolicy), candidatePresentation: "retrieval-order", repeatPolicy: "predeclared-full-matrix-indexed-repeats" });
}
/** Ordered [control, candidate]: the first variant is the paired reference in every report. */
export function evolutionStudyV9Variants(study: EvolutionStudyV9): readonly EvolutionRetrievalVariant[] { return [study.control, study.candidate]; }
function scopeInput(studyBytes: Uint8Array, manifestBytes: Uint8Array) {
  const study = parseEvolutionStudyV9(decode(studyBytes, 4 * 1024 * 1024)), pinned = DATASETS[study.dataset as keyof typeof DATASETS];
  return { study, input: { manifestBytes, manifestSha256: study.manifestPin.sha256,
    source: { dataset: study.dataset, revision: pinned.revision, sourceSha256: study.datasetPin.sha256 },
    request: { mode: "explicit-selection" as const, maximumQuestionsPerShard: study.maximumQuestionsPerShard, shardPolicy: study.shardPolicy,
      design: { experimentSpecSha256: sha256Hex(studyBytes), dataset: study.dataset,
        candidate: { id: study.candidate.id, specSha256: canonicalSha256({ variant: study.candidate, presentation: study.candidatePresentation }) },
        candidateVariantSha256: canonicalSha256(study.candidate),
        controls: [{ id: study.control.id, specSha256: canonicalSha256({ variant: study.control, presentation: "retrieval-order" }) }],
        readers: study.readers.map(id => ({ id, specSha256: canonicalSha256(EVOLUTION_PROFILES[id]) })),
        judge: { id: study.judge, specSha256: canonicalSha256(EVOLUTION_PROFILES[study.judge]) }, rubricSha256: study.rubricSha256,
        repeats: study.repeats, judgeRepeats: study.judgeRepeats, readerDatePolicySha256: evolutionReaderDatePolicySha256(study.readerDatePolicy) },
      selectedQuestionIds: study.selection } } };
}
function checkScope(study: EvolutionStudyV9, scope: EvolutionEvaluationScopeV2): EvolutionEvaluationScopeV2 {
  if (study.judge === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID && scope.questions.some(q => !(EVOLUTION_LOCOMO_J_CATEGORIES as readonly string[]).includes(q.category))) {
    fail("the LoCoMo J denominator admits categories 1-4 only");
  }
  return scope;
}
export function makeEvolutionStudyV9Scope(studyBytes: Uint8Array, manifestBytes: Uint8Array): EvolutionEvaluationScopeV2 {
  const { study, input } = scopeInput(studyBytes, manifestBytes);
  return checkScope(study, makeEvolutionEvaluationScopeV2(input));
}
export function validateEvolutionStudyV9Artifacts(input: Readonly<{ studyBytes: Uint8Array; manifestBytes: Uint8Array; scopeBytes: Uint8Array }>): EvolutionStudyV9Authorization {
  const parsed = scopeInput(input.studyBytes, input.manifestBytes), scope = checkScope(parsed.study, validateEvolutionEvaluationScopeV2(parsed.input, input.scopeBytes));
  if (!same(scope, makeEvolutionStudyV9Scope(input.studyBytes, input.manifestBytes))) fail("scope mismatch");
  return { study: parsed.study, studySha256: sha256Hex(input.studyBytes), scope, scopeFileSha256: sha256Hex(input.scopeBytes) };
}
export function evolutionStudyV9Shard(authorization: EvolutionStudyV9Authorization, shardId: string) {
  const shard = authorization.scope.shards.find(s => s.id === shardId);
  if (!shard || shard.questionIds.length < 1) fail("unknown or empty shard");
  return shard;
}
/** Revalidates the manifest against the source and selects the shard's exact questions and their corpora. */
export function selectEvolutionStudyV9Shard(dataset: Dataset, manifest: EvolutionDatasetManifest, authorization: EvolutionStudyV9Authorization, shardId: string): Dataset {
  const valid = validateEvolutionDatasetManifest(dataset, manifest), { study, scope } = authorization;
  if (valid.sourceSha256 !== study.datasetPin.sha256 || valid.datasetSha256 !== scope.datasetMetadataSha256) fail("source metadata differs from scope");
  const shard = evolutionStudyV9Shard(authorization, shardId), byId = new Map(dataset.questions.map(q => [evolutionRunnerQuestionId(q.id), q]));
  const questions = shard.questionIds.map(id => { const q = byId.get(id); if (!q) return fail("shard question missing from source"); return q; });
  const corpusIds = new Set(questions.map(q => q.corpusId));
  return { questions, corpora: dataset.corpora.filter(c => corpusIds.has(c.id)) };
}
export function assertEvolutionStudyV9Configuration(config: Readonly<{ dataset: string; datasetPin: EvolutionPin; manifestPin: EvolutionPin; campaignPin: EvolutionPin;
  variants: readonly unknown[]; readers: readonly string[]; judge: string; limit: number; repeats: number; judgeRepeats: number;
  readerDatePolicy: string; derivedRecordsPin: EvolutionPin | null }>, authorization: EvolutionStudyV9Authorization, shardId: string): void {
  const { study } = authorization;
  if (config.dataset !== study.dataset || !same(config.datasetPin, study.datasetPin) || !same(config.manifestPin, study.manifestPin)
    || !same(config.campaignPin, study.campaignPin) || !same(config.variants, evolutionStudyV9Variants(study)) || !same(config.readers, study.readers)
    || config.judge !== study.judge || config.limit !== evolutionStudyV9Shard(authorization, shardId).questionIds.length
    || config.repeats !== study.repeats || config.judgeRepeats !== study.judgeRepeats || config.readerDatePolicy !== study.readerDatePolicy
    || !same(config.derivedRecordsPin, study.derivedRecordsPin)) fail("configuration differs from frozen study or shard");
}
