/** Additive full-context companion. The parent V7 study retains its fixed two arms. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { evolutionPin, type EvolutionPin } from "./evolution-budget";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { EVOLUTION_FULL_HISTORY_POLICY } from "./evolution-full-history";
import { EVOLUTION_RELEASE_JUDGE, EVOLUTION_RELEASE_READER, EVOLUTION_RELEASE_RUBRIC_SHA,
  validateEvolutionReleaseArtifacts, evolutionReleaseShard, type EvolutionReleaseAuthorization } from "./evolution-release";

export const EVOLUTION_FULL_CONTEXT_VARIANTS = Object.freeze([Object.freeze({ id: "full-history", system: "full-history" as const })]);
export type EvolutionFullContextStudy = Readonly<{
  protocol: "oh.memory.evolution-full-context-study.v1"; mode: "full-release-descriptive-companion";
  parentStudyPin: EvolutionPin; parentScopePin: EvolutionPin; datasetPin: EvolutionPin; manifestPin: EvolutionPin; campaignPin: EvolutionPin;
  sourceSha256: string; fullHistoryPolicySha256: string; variants: typeof EVOLUTION_FULL_CONTEXT_VARIANTS;
  reader: typeof EVOLUTION_RELEASE_READER; judge: typeof EVOLUTION_RELEASE_JUDGE; rubricSha256: typeof EVOLUTION_RELEASE_RUBRIC_SHA;
  repeatPolicy: "predeclared-full-matrix-first-attempt";
}>;
export type EvolutionFullContextAuthorization = Readonly<{ study: EvolutionFullContextStudy; studySha256: string; parent: EvolutionReleaseAuthorization }>;
function fail(reason: string): never { throw new TypeError(`Evolution full-context companion: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
function decode(bytes: Uint8Array, maximum: number): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > maximum) fail("bounded artifact bytes required");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function parseEvolutionFullContextStudy(value: unknown): EvolutionFullContextStudy {
  boundEvolutionCompletionWire(value, 1_048_576, 100_000);
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "mode", "parentStudyPin", "parentScopePin", "datasetPin", "manifestPin", "campaignPin",
    "sourceSha256", "fullHistoryPolicySha256", "variants", "reader", "judge", "rubricSha256", "repeatPolicy"])
    || value.protocol !== "oh.memory.evolution-full-context-study.v1" || value.mode !== "full-release-descriptive-companion"
    || parseSha256Hex(value.sourceSha256) === null || value.fullHistoryPolicySha256 !== canonicalSha256(EVOLUTION_FULL_HISTORY_POLICY)
    || !same(value.variants, EVOLUTION_FULL_CONTEXT_VARIANTS) || value.reader !== EVOLUTION_RELEASE_READER || value.judge !== EVOLUTION_RELEASE_JUDGE
    || value.rubricSha256 !== EVOLUTION_RELEASE_RUBRIC_SHA || value.repeatPolicy !== "predeclared-full-matrix-first-attempt") fail("fixed complete-source nano/native16 design required");
  const pins = Object.fromEntries((["parentStudyPin", "parentScopePin", "datasetPin", "manifestPin", "campaignPin"] as const).map(k => [k, evolutionPin(value[k])]));
  return freezeEvolutionCompletion(structuredClone({ ...value, ...pins })) as EvolutionFullContextStudy;
}
export function validateEvolutionFullContextArtifacts(input: Readonly<{ studyBytes: Uint8Array; parentStudyBytes: Uint8Array;
  parentScopeBytes: Uint8Array; manifestBytes: Uint8Array }>): EvolutionFullContextAuthorization {
  const study = parseEvolutionFullContextStudy(decode(input.studyBytes, 1_048_576));
  if (sha256Hex(input.parentStudyBytes) !== study.parentStudyPin.sha256 || sha256Hex(input.parentScopeBytes) !== study.parentScopePin.sha256
    || sha256Hex(input.manifestBytes) !== study.manifestPin.sha256) fail("parent or manifest byte identity changed");
  const parent = validateEvolutionReleaseArtifacts({ studyBytes: input.parentStudyBytes, scopeBytes: input.parentScopeBytes, manifestBytes: input.manifestBytes });
  if (!same(study.datasetPin, parent.study.datasetPin) || !same(study.manifestPin, parent.study.manifestPin)
    || study.reader !== parent.study.reader || study.judge !== parent.study.judge || study.rubricSha256 !== parent.study.rubricSha256
    || study.campaignPin.sha256 === parent.study.campaignPin.sha256 || study.campaignPin.path === parent.study.campaignPin.path) fail("same source/profiles and separate campaign pin required");
  return freezeEvolutionCompletion({ study, studySha256: sha256Hex(input.studyBytes), parent });
}
export function assertEvolutionFullContextConfiguration(config: Readonly<{ dataset: string; datasetPin: EvolutionPin; manifestPin: EvolutionPin;
  campaignPin: EvolutionPin; variants: readonly unknown[]; readers: readonly string[]; judge: string; limit: number; seed: number }>,
  authorization: EvolutionFullContextAuthorization, shardId: string): void {
  const { study } = authorization;
  if (config.dataset !== "longmemeval-s" || !same(config.datasetPin, study.datasetPin) || !same(config.manifestPin, study.manifestPin)
    || !same(config.campaignPin, study.campaignPin) || !same(config.variants, study.variants) || !same(config.readers, [study.reader])
    || config.judge !== study.judge || config.limit !== evolutionReleaseShard(authorization.parent, shardId).questionIds.length || config.seed !== 17) fail("configuration differs from companion study or exact parent shard");
}
