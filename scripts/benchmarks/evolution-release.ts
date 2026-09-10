/** Full500 descriptive admission. No source text, answer, store or provider I/O. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { DATASETS, type Dataset } from "./datasets";
import { evolutionPin, type EvolutionPin } from "./evolution-budget";
import { assertExactEvolutionCoverage, evolutionRunnerQuestionId, validateEvolutionDatasetManifest, type EvolutionDatasetManifest } from "./evolution-dataset";
import { makeEvolutionEvaluationScope, validateEvolutionEvaluationScope, type EvolutionEvaluationScope } from "./evolution-evaluation-scope";
import { EVOLUTION_PROFILES } from "./evolution-model";
import type { EvolutionRetrievalVariant } from "./evolution-retrieval";

/** Readers admitted for a full-release study. The first is the original frozen nano candidate; later entries
 * keep the same answer contract on a different model/effort and must be declared in the study before any score. */
export const EVOLUTION_RELEASE_READERS = ["gpt5-nano-explicit-abstention-composition-v1-reader",
  "gpt5-mini-explicit-abstention-composition-v1-reader", "gpt5-nano-high-explicit-abstention-composition-v1-reader"] as const;
export type EvolutionReleaseReader = typeof EVOLUTION_RELEASE_READERS[number];
export const EVOLUTION_RELEASE_READER: EvolutionReleaseReader = EVOLUTION_RELEASE_READERS[0];
/** A rebound study reuses the exact retrieval contexts of an earlier study whose only differences are reader and campaign. */
export type EvolutionReleaseRetrievalProvenance = Readonly<{ parentStudySha256: string; parentRetrievalSourceSha256: string }>;
export const EVOLUTION_RELEASE_JUDGE = "gpt4o-gateway-native-rubric-16-judge-v1" as const;
export const EVOLUTION_RELEASE_RUBRIC_SHA = "00d319ba0a194a69871576d8c677c1557d7706f69b599c9b7beee32441d58cfc";
export type EvolutionReleaseStudy = Readonly<{
  protocol: "oh.memory.evolution-release-study.v1"; mode: "full-release-descriptive"; dataset: "longmemeval-s";
  datasetPin: EvolutionPin; manifestPin: EvolutionPin; campaignPin: EvolutionPin; retrievalSourceSha256: string;
  variants: readonly EvolutionRetrievalVariant[]; reader: EvolutionReleaseReader; judge: typeof EVOLUTION_RELEASE_JUDGE;
  rubricSha256: typeof EVOLUTION_RELEASE_RUBRIC_SHA; candidatePresentation: "retrieval-order";
  repeatPolicy: "predeclared-full-matrix-first-attempt"; retrievalProvenance?: EvolutionReleaseRetrievalProvenance;
}>;
export type EvolutionReleaseAuthorization = Readonly<{ study: EvolutionReleaseStudy; studySha256: string;
  scope: EvolutionEvaluationScope; scopeFileSha256: string }>;
function fail(reason: string): never { throw new TypeError(`Evolution full release: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
function decode(bytes: Uint8Array, maximum: number): unknown {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maximum) fail("bounded artifact bytes required");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function parseEvolutionReleaseStudy(value: unknown): EvolutionReleaseStudy {
  const keys = ["protocol", "mode", "dataset", "datasetPin", "manifestPin", "campaignPin", "retrievalSourceSha256", "variants", "reader", "judge", "rubricSha256", "candidatePresentation", "repeatPolicy"];
  const rebound = isPlainRecord(value) && Object.hasOwn(value, "retrievalProvenance");
  if (!isPlainRecord(value) || !hasExactKeys(value, rebound ? [...keys, "retrievalProvenance"] : keys)
    || value.protocol !== "oh.memory.evolution-release-study.v1" || value.mode !== "full-release-descriptive" || value.dataset !== "longmemeval-s"
    || !(EVOLUTION_RELEASE_READERS as readonly unknown[]).includes(value.reader) || value.judge !== EVOLUTION_RELEASE_JUDGE || value.rubricSha256 !== EVOLUTION_RELEASE_RUBRIC_SHA
    || value.candidatePresentation !== "retrieval-order" || value.repeatPolicy !== "predeclared-full-matrix-first-attempt"
    || parseSha256Hex(value.retrievalSourceSha256) === null || !Array.isArray(value.variants) || value.variants.length !== 2) fail("fixed descriptive study required");
  const variants = value.variants.map((v, i) => {
    if (!isPlainRecord(v) || !hasExactKeys(v, ["id", "system", "budget"]) || typeof v.id !== "string" || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(v.id)
      || v.system !== (i === 0 ? "bm25-window" : "oh-semantic") || !isPlainRecord(v.budget) || !hasExactKeys(v.budget, ["topK", "contextBytes"])
      || v.budget.topK !== 100 || v.budget.contextBytes !== 96_000) fail("BM25 first and semantic candidate require top100/96KB");
    return { id: v.id, system: v.system, budget: { topK: 100, contextBytes: 96_000 } } as EvolutionRetrievalVariant;
  });
  assertExactEvolutionCoverage(variants.map(v => v.id), variants.map(v => v.id));
  const datasetPin = evolutionPin(value.datasetPin), manifestPin = evolutionPin(value.manifestPin), campaignPin = evolutionPin(value.campaignPin);
  if (datasetPin.sha256 !== DATASETS["longmemeval-s"].sha256) fail("official dataset pin required");
  if (rebound) {
    const provenance = value.retrievalProvenance;
    if (!isPlainRecord(provenance) || !hasExactKeys(provenance, ["parentStudySha256", "parentRetrievalSourceSha256"])
      || parseSha256Hex(provenance.parentStudySha256) === null || parseSha256Hex(provenance.parentRetrievalSourceSha256) === null) fail("retrieval provenance requires parent study and retrieval source digests");
  }
  return { ...value, datasetPin, manifestPin, campaignPin, variants } as unknown as EvolutionReleaseStudy;
}
function scopeInput(studyBytes: Uint8Array, manifestBytes: Uint8Array) {
  const study = parseEvolutionReleaseStudy(decode(studyBytes, 1_048_576));
  const candidate = study.variants[1]!, control = study.variants[0]!;
  return { study, input: { manifestBytes, manifestSha256: study.manifestPin.sha256,
    source: { dataset: study.dataset, revision: DATASETS[study.dataset].revision, sourceSha256: study.datasetPin.sha256 },
    request: { mode: "full-release-descriptive" as const, maximumQuestionsPerShard: 100,
      design: { experimentSpecSha256: sha256Hex(studyBytes), candidate: { id: candidate.id, specSha256: canonicalSha256({ variant: candidate, presentation: study.candidatePresentation }) },
        controls: [{ id: control.id, specSha256: canonicalSha256({ variant: control, presentation: "retrieval-order" }) }],
        readers: [{ id: study.reader, specSha256: canonicalSha256(EVOLUTION_PROFILES[study.reader]) }],
        judge: { id: study.judge, specSha256: canonicalSha256(EVOLUTION_PROFILES[study.judge]) }, rubricSha256: study.rubricSha256 } } } };
}
export function makeEvolutionReleaseScope(studyBytes: Uint8Array, manifestBytes: Uint8Array) {
  const { input } = scopeInput(studyBytes, manifestBytes), scope = makeEvolutionEvaluationScope(input);
  if (scope.coverage.releaseQuestions !== 500 || scope.coverage.selectedQuestions !== 500 || scope.shards.length !== 5
    || scope.shards.some(s => s.questionIds.length !== 100)) fail("full500 requires five complete100-question shards without splitting declared clusters");
  return scope;
}
export function validateEvolutionReleaseArtifacts(input: Readonly<{ studyBytes: Uint8Array; manifestBytes: Uint8Array; scopeBytes: Uint8Array }>): EvolutionReleaseAuthorization {
  const parsed = scopeInput(input.studyBytes, input.manifestBytes), scope = validateEvolutionEvaluationScope(parsed.input, input.scopeBytes);
  if (!same(scope, makeEvolutionReleaseScope(input.studyBytes, input.manifestBytes))) fail("release scope mismatch");
  return { study: parsed.study, studySha256: sha256Hex(input.studyBytes), scope, scopeFileSha256: sha256Hex(input.scopeBytes) };
}
export function evolutionReleaseShard(authorization: EvolutionReleaseAuthorization, shardId: string) {
  const shard = authorization.scope.shards.find(s => s.id === shardId);
  if (!shard || shard.questionIds.length !== 100) fail("unknown or incomplete shard");
  return shard;
}
/** Full manifest already crossed the source validator; this function revalidates it
 * to keep this standalone seam fail-closed and preserves original dispositions. */
export function selectEvolutionReleaseShard(dataset: Dataset, manifest: EvolutionDatasetManifest, authorization: EvolutionReleaseAuthorization, shardId: string): Dataset {
  const valid = validateEvolutionDatasetManifest(dataset, manifest), { study, scope } = authorization;
  if (valid.sourceSha256 !== study.datasetPin.sha256 || valid.datasetSha256 !== scope.datasetMetadataSha256) fail("source metadata differs from scope");
  const shard = evolutionReleaseShard(authorization, shardId), byId = new Map(dataset.questions.map(q => [evolutionRunnerQuestionId(q.id), q]));
  const questions = shard.questionIds.map(id => { const q = byId.get(id); if (!q) return fail("shard question missing from source"); return q; });
  const corpusIds = new Set(questions.map(q => q.corpusId));
  return { questions, corpora: dataset.corpora.filter(c => corpusIds.has(c.id)) };
}
export function assertEvolutionReleaseConfiguration(config: Readonly<{ dataset: string; datasetPin: EvolutionPin; manifestPin: EvolutionPin;
  campaignPin: EvolutionPin; variants: readonly unknown[]; readers: readonly string[]; judge: string; limit: number; seed: number }>, authorization: EvolutionReleaseAuthorization, shardId: string): void {
  const { study } = authorization;
  if (config.dataset !== study.dataset || !same(config.datasetPin, study.datasetPin) || !same(config.manifestPin, study.manifestPin)
    || !same(config.campaignPin, study.campaignPin) || !same(config.variants, study.variants) || !same(config.readers, [study.reader])
    || config.judge !== study.judge || config.limit !== evolutionReleaseShard(authorization, shardId).questionIds.length || config.seed !== 17) fail("configuration differs from frozen study or shard");
}
