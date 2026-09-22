/** Bounded offline reconstruction of the fixed two-persona keyword development screen.
 * Global artifacts contain metadata only; exactly two persona source/capture files
 * are opened. Rankings never receive choice keys, evidence annotations, or scores. */
import { dirname, join } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../../src/semantic-model";
import { CLONEMEM_SOURCE, CLONEMEM_PRIMARY_PERSON_IDS, cloneMemTimestamp, readCloneMemPersona,
  renderCloneMemEvidence, type CloneMemProjection, type CloneMemScorerRow } from "./clonemem-dataset";
import { CLONEMEM_CAPTURE_LIMITS, CLONEMEM_RETRIEVAL_POLICY, prepareCloneMemRetrieval,
  type CloneMemRetrievalResult } from "./clonemem-retrieval";
import { parseCloneMemReplayResult } from "./clonemem-replay";
import { CLONEMEM_KEYWORD_POLICY_V1, prepareCloneMemKeywordReplay,
  type CloneMemKeywordResult, type CloneMemKeywordSemanticCapture } from "./clonemem-keyword-policy";
import { evolutionPin, readEvolutionPin, type EvolutionPin } from "./evolution-budget";
import { parsePairedMemorySource, selectPairedMemoryIds, type PairedMemorySource } from "./paired-memory-study";
import { SEMANTIC_MODEL_SHA256 } from "./deductive-semantic-cache";

export const CLONEMEM_KEYWORD_DEV_PERSON_IDS = Object.freeze([
  "2684282b-1e09-42a8-9425-533e2a95901d", "11ccc069-2a93-4e9d-af03-cdacb0b8d568"] as const);
export const CLONEMEM_KEYWORD_DEV_ARMS = Object.freeze(["raw-vector", "oh-hybrid-keywords-v1"] as const);
export const CLONEMEM_KEYWORD_DEV_LIMITS = Object.freeze({ questions: 146, personaQuestions: [114, 32],
  repeats: 3, logicalCases: 876, maximumCalls: 876, campaignMicros: 5_000_000, priorTaskMicros: 4_300_145,
  authorizedTaskMicros: 25_000_000, metadataBytes: 4 * 1024 * 1024, probeBytes: 16 * 1024 * 1024,
  provenanceBytes: 8 * 1024 * 1024 });
/** These are immutable historical inputs, not current working-tree identities. */
export const CLONEMEM_KEYWORD_DEV_INPUT_SHA256 = Object.freeze({
  capturePin: "f4e341e870cf3e10c02a5cb1f79a5c9ac209a3f7b05d32b7e420d30d5c172ee0",
  replayPin: "6c36b727269ef64b7b0eb4dec562f3133d56530c0a497cf385683cb59f5bb753",
  choicePin: "f5be473fa88f2ac001780a27526010e8d00e722e51098e4686a26102c189808c",
  probeFreezePin: "642f9f47e82f3b3cade4a957ba38fa312bb79afa112975655e35ebb199a730dc",
  probeResultPin: "a3609af631e982fad65eb7ef5794f04004fb1b9fb047f411886c893630cadd6a",
  probeCodePin: "692bf00ba4eed63972bd98e82ae26b822cba2eac244b087c62e906e14d3c5b37",
  recommendationPin: "fc88e8912ed74f356cd084169556e9011714832ea68cc506f1e2b2e5887c762c",
});
export type CloneMemKeywordDevInputPins = Readonly<Record<keyof typeof CLONEMEM_KEYWORD_DEV_INPUT_SHA256, EvolutionPin>>;
export type CloneMemKeywordDevScorer = Readonly<{ protocol: "oh.clonemem-keyword-dev-scorer.v1";
  sourceRevision: string; sourceSha256: string; rows: readonly CloneMemScorerRow[] }>;
export type CloneMemKeywordDevRankRow = Readonly<{ questionId: string; personId: string; originalResultSha256: string;
  candidateResultSha256: string; semanticCaptureSha256: string; eligibleTraceIdsSha256: string;
  arms: readonly Readonly<{ armId: string; traceIds: readonly string[]; contextSha256: string; contextBytes: number }>[] }>;
function fail(reason: string): never { throw new TypeError(`CloneMem keyword development: ${reason}.`); }
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const decode = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || (keys !== undefined && !hasExactKeys(value, [...keys]))) fail("artifact shape");
  return value;
}
function sealed(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  const row = object(value, keys === undefined ? undefined : [...keys, "resultSha256"]);
  const { resultSha256, ...payload } = row;
  if (canonicalSha256(payload) !== resultSha256) fail("artifact digest"); return row;
}
function bounded(value: unknown, max: number): void {
  if (Buffer.byteLength(canonicalJson(value)) > max) fail("artifact byte bound");
}
export function parseCloneMemKeywordDevInputPins(value: unknown): CloneMemKeywordDevInputPins {
  const raw = object(value, Object.keys(CLONEMEM_KEYWORD_DEV_INPUT_SHA256));
  const result = {} as Record<keyof CloneMemKeywordDevInputPins, EvolutionPin>;
  for (const key of Object.keys(CLONEMEM_KEYWORD_DEV_INPUT_SHA256) as (keyof CloneMemKeywordDevInputPins)[]) {
    const pin = evolutionPin(raw[key]);
    if (pin.sha256 !== CLONEMEM_KEYWORD_DEV_INPUT_SHA256[key]) fail(`fixed ${key} changed`);
    result[key] = pin;
  }
  if (new Set(Object.values(result).map(pin => pin.path)).size !== Object.keys(result).length) fail("input role alias");
  return Object.freeze(result);
}

/** Explicit projection prevents original ranking evidence or dataset labels from
 * entering the new retrieval helper. The full original result is admitted first. */
export function cloneMemKeywordSemanticCapture(result: CloneMemRetrievalResult): CloneMemKeywordSemanticCapture {
  return { personId: result.personId, querySha256: result.querySha256, identitySha256: result.identitySha256,
    questionDate: result.questionDate, eligibleTraceIds: result.eligibleTraceIds,
    semanticCapture: result.semanticCapture, semanticCaptureSha256: result.semanticCaptureSha256 };
}

/** Every native question in the fixed two-persona scope enters the reader. The
 * seed changes dispatch order only; there is no answer-dependent subsampling. */
export function cloneMemKeywordDevPairedSource(
  projections: readonly Pick<CloneMemProjection, "readerQuestions">[],
  contexts: ReadonlyMap<string, Pick<CloneMemKeywordResult, "arms">>,
): PairedMemorySource {
  if (projections.length !== 2 || contexts.size !== 146) fail("fixed source population");
  for (const [index, projection] of projections.entries()) {
    if (projection.readerQuestions.length !== CLONEMEM_KEYWORD_DEV_LIMITS.personaQuestions[index]
      || projection.readerQuestions.some(question => question.personId !== CLONEMEM_KEYWORD_DEV_PERSON_IDS[index])) fail("fixed source persona");
  }
  const questions = projections.flatMap(projection => projection.readerQuestions);
  const population = questions.map(question => ({ questionId: question.id, groupId: question.personId }));
  const ids = selectPairedMemoryIds(population, 17, 146), byId = new Map(questions.map(question => [question.id, question]));
  return parsePairedMemorySource({ protocol: "oh.memory.paired-source.v1", datasetRevision: CLONEMEM_SOURCE.revision,
    selection: { algorithm: "clonemem-balanced-sha256-v1", seed: 17, population, count: 146 }, arms: CLONEMEM_KEYWORD_DEV_ARMS,
    questions: ids.map(id => {
      const question = byId.get(id)!, result = contexts.get(id);
      if (result === undefined) fail("missing reader context");
      return { id, groupId: question.personId, question: question.question,
        questionDate: question.questionDate, personName: question.personName, choices: question.choices,
        contexts: result.arms.map(arm => ({ armId: arm.arm, text: arm.context })) };
    }) });
}

/** Reconstruct one persona using only memory/questions and admitted original rows.
 * Also exposed for synthetic failure-boundary tests; production caller fixes scope. */
export async function replayCloneMemKeywordPersona(input: Readonly<{
  projection: Pick<CloneMemProjection, "memory" | "queries">; identity: unknown;
  rows: readonly Readonly<{ questionId: string; result: unknown }>[];
}>) {
  const { memory, queries } = input.projection;
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 512 || !Array.isArray(input.rows)
    || input.rows.length !== queries.length || new Set(queries.map(query => query.id)).size !== queries.length) fail("persona query coverage");
  const ordered = [...queries].sort((a, b) => cloneMemTimestamp(a.questionDate) - cloneMemTimestamp(b.questionDate)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!equal(input.rows.map(row => row.questionId), ordered.map(query => query.id))) fail("original query order");
  const rows = input.rows.map(row => ({ questionId: row.questionId, result: parseCloneMemReplayResult(row.result) }));
  let current = 0, backendCloses = 0;
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(records) { return { indexed: records.length, v: 1 }; },
    async search(query, limit) {
      const row = rows[current++];
      if (row === undefined || limit !== 30 || row.result.querySha256 !== sha256Hex(query)) fail("semantic query identity");
      return row.result.semanticCapture;
    }, async close() { backendCloses++; } };
  const original = await prepareCloneMemRetrieval(memory, backend);
  let candidate: Awaited<ReturnType<typeof prepareCloneMemKeywordReplay>> | undefined;
  const results: { questionId: string; original: CloneMemRetrievalResult; candidate: CloneMemKeywordResult }[] = [];
  try {
    if (!equal(original.identity, input.identity)) fail("original memory identity");
    candidate = await prepareCloneMemKeywordReplay(memory);
    for (const [index, row] of rows.entries()) {
      const query = ordered[index]!;
      if (query.personId !== memory.personId || row.result.personId !== memory.personId
        || row.result.questionDate !== query.questionDate) fail("question persona/date identity");
      const replay = await original.retrieve(query.question, query.questionDate);
      for (const field of ["protocol", "personId", "arms", "semanticCapture", "semanticCaptureSha256", "eligibleTraceIds",
        "authorityHeadSha256", "identitySha256", "questionDate", "querySha256"] as const) {
        if (!equal(replay[field], row.result[field])) fail(`original SDK replay changed ${field}`);
      }
      // Exact original text plus source/evidence was checked above, not merely top-K IDs.
      const rebuilt = await candidate.retrieve(query.question, query.questionDate, cloneMemKeywordSemanticCapture(row.result));
      if (!equal(rebuilt.arms.map(arm => arm.arm), CLONEMEM_KEYWORD_DEV_ARMS)) fail("candidate arm order");
      for (const arm of rebuilt.arms) {
        if (arm.context !== renderCloneMemEvidence(memory, arm.traceIds) || arm.contextSha256 !== sha256Hex(arm.context)
          || arm.contextBytes !== Buffer.byteLength(arm.context) || arm.traceIds.some(id => !row.result.eligibleTraceIds.includes(id))) fail("candidate native rendering");
      }
      const vector = row.result.arms.find(arm => arm.arm === "raw-vector")!;
      const candidateVector = rebuilt.arms[0]!;
      if (!equal(candidateVector.traceIds, vector.traceIds) || candidateVector.context !== vector.context
        || candidateVector.contextSha256 !== vector.contextSha256 || candidateVector.contextBytes !== vector.contextBytes) fail("baseline changed");
      results.push({ questionId: query.id, original: row.result, candidate: rebuilt });
    }
  } finally { try { await candidate?.close(); } finally { await original.close(); } }
  if (current !== rows.length || backendCloses !== 1) fail("semantic replay coverage or cleanup");
  return results;
}

export async function readCloneMemKeywordDevSources(input: CloneMemKeywordDevInputPins) {
  const pins = parseCloneMemKeywordDevInputPins(input);
  // Historical metadata pin checks never require a current broad source manifest;
  // current participating code is frozen independently by the new study wrapper.
  const choice = object(decode(await readEvolutionPin(pins.choicePin, 64 * 1024)));
  const frozen = object(decode(await readEvolutionPin(pins.probeFreezePin, 64 * 1024)));
  const probe = object(decode(await readEvolutionPin(pins.probeResultPin, CLONEMEM_KEYWORD_DEV_LIMITS.probeBytes)));
  await readEvolutionPin(pins.probeCodePin, 64 * 1024);
  await readEvolutionPin(pins.recommendationPin, 64 * 1024);
  if (!equal(choice.selectedPersonIds, CLONEMEM_KEYWORD_DEV_PERSON_IDS) || choice.answerOrOutcomeInspectionBeforeChoice !== false
    || choice.sourceRevision !== CLONEMEM_SOURCE.revision || !equal(choice.primaryPersonIds, CLONEMEM_PRIMARY_PERSON_IDS)
    || frozen.choiceSha256 !== pins.choicePin.sha256 || frozen.codeSha256 !== pins.probeCodePin.sha256
    || frozen.policySha256 !== canonicalSha256(frozen.policy) || frozen.scoresComputed !== false
    || probe.policySha256 !== frozen.policySha256 || probe.questions !== 146 || probe.parityQuestions !== 146
    || probe.modelCalls !== 0 || probe.providerCalls !== 0 || !Array.isArray(probe.rows) || probe.rows.length !== 146) fail("frozen development inputs");
  const manifest = sealed(decode(await readEvolutionPin(pins.capturePin, CLONEMEM_KEYWORD_DEV_LIMITS.metadataBytes)));
  const mechanism = object(manifest.source, ["protocol", "files", "mechanismSha256"]);
  if (manifest.protocol !== "oh.clonemem-primary-capture.v1" || manifest.scored !== false || manifest.complete !== true
    || manifest.sourceRevision !== CLONEMEM_SOURCE.revision || !equal(manifest.policy, CLONEMEM_RETRIEVAL_POLICY)
    || manifest.policySha256 !== canonicalSha256(CLONEMEM_RETRIEVAL_POLICY) || manifest.totalQueries !== 1007
    || typeof manifest.totalBytes !== "number" || manifest.totalBytes > CLONEMEM_CAPTURE_LIMITS.totalBytes
    || mechanism.protocol !== "oh.clonemem-mechanism.v1" || canonicalSha256(mechanism.files) !== mechanism.mechanismSha256
    || !Array.isArray(manifest.personas) || manifest.personas.length !== 9) fail("original capture metadata");
  const entries = manifest.personas.map((value, index) => {
    const entry = object(value, ["personId", "path", "bytes", "sha256", "resultSha256", "questions", "traces", "sourceSha256"]);
    if (entry.personId !== CLONEMEM_PRIMARY_PERSON_IDS[index] || entry.path !== `${entry.personId}.json`
      || !Number.isSafeInteger(entry.bytes) || (entry.bytes as number) < 1
      || (entry.bytes as number) > CLONEMEM_CAPTURE_LIMITS.personaBytes) fail("original persona metadata");
    return entry;
  });
  const replay = sealed(decode(await readEvolutionPin(pins.replayPin, CLONEMEM_KEYWORD_DEV_LIMITS.metadataBytes)));
  if (replay.protocol !== "oh.clonemem-primary-replay-receipt.v1" || replay.scored !== false
    || replay.manifestFileSha256 !== pins.capturePin.sha256 || replay.sourceCaptureSha256 !== manifest.resultSha256
    || replay.mechanismSha256 !== mechanism.mechanismSha256 || replay.queries !== 1007 || replay.exactSdkReplay !== true
    || replay.futureSources !== 0 || replay.futureCaptures !== 0 || replay.replayBackendCloses !== 9
    || replay.networkDisabled !== true || replay.nativeExitCode !== 0 || replay.nativeChildCollected !== true
    || replay.nativeCleanupWarnings !== 0 || !Array.isArray(replay.personas) || replay.personas.length !== 9
    || replay.personas.some((value, index) => { const row = object(value); return row.personId !== entries[index]!.personId
      || row.queries !== entries[index]!.questions || row.exactSdkReplay !== true; })) fail("original native replay receipt");

  const projections: CloneMemProjection[] = [], rankRows: CloneMemKeywordDevRankRow[] = [], contextRows = new Map<string, CloneMemKeywordResult>();
  const personaPins: { personId: string; sourceSha256: string; capturePin: EvolutionPin; identitySha256: string; queries: number }[] = [];
  const probeRows = new Map(probe.rows.map(value => { const row = object(value); return [row.questionId, row]; }));
  if (probeRows.size !== 146) fail("probe duplicate IDs");
  for (const [scopeIndex, personId] of CLONEMEM_KEYWORD_DEV_PERSON_IDS.entries()) {
    const entry = entries.find(value => value.personId === personId)!;
    // These are the only source and persona-capture opens. Never call readCloneMemCapture.
    const projection = await readCloneMemPersona(personId);
    const capturePin = evolutionPin({ path: join(dirname(pins.capturePin.path), entry.path as string), sha256: entry.sha256 });
    const raw = await readEvolutionPin(capturePin, CLONEMEM_CAPTURE_LIMITS.personaBytes);
    if (raw.length !== entry.bytes) fail("persona pinned bytes");
    const captured = sealed(decode(raw), ["protocol", "scored", "personId", "sourceSha256", "retrievalSha256", "mechanismSha256",
      "policySha256", "runtime", "identity", "preparationMs", "rows"]);
    const runtime = object(captured.runtime);
    if (captured.protocol !== "oh.clonemem-persona-capture.v1" || captured.scored !== false || captured.personId !== personId
      || captured.resultSha256 !== entry.resultSha256 || captured.sourceSha256 !== projection.sourceSha256
      || entry.sourceSha256 !== projection.sourceSha256 || captured.retrievalSha256 !== projection.retrievalSha256
      || captured.mechanismSha256 !== mechanism.mechanismSha256 || captured.policySha256 !== manifest.policySha256
      || runtime.modelSha256 !== SEMANTIC_MODEL_SHA256 || runtime.semanticProfileSha256 !== CLONEMEM_RETRIEVAL_POLICY.semanticProfileSha256
      || runtime.search !== "shipped-oh-qmd-searchVector-global-query-v1" || !Array.isArray(captured.rows)
      || captured.rows.length !== projection.queries.length || entry.questions !== projection.queries.length
      || projection.queries.length !== CLONEMEM_KEYWORD_DEV_LIMITS.personaQuestions[scopeIndex]
      || entry.traces !== projection.memory.traces.length) fail("selected persona source or runtime");
    const rows = captured.rows.map(value => { const row = object(value, ["questionId", "result"]);
      if (typeof row.questionId !== "string") fail("question identity"); return { questionId: row.questionId, result: row.result }; });
    const results = await replayCloneMemKeywordPersona({ projection: { memory: projection.memory, queries: projection.queries }, identity: captured.identity, rows });
    for (const row of results) {
      const probed = probeRows.get(row.questionId);
      if (!probed || probed.personId !== personId || !Array.isArray(probed.variants)) fail("probe scope");
      for (const [index, arm] of row.candidate.arms.entries()) {
        const variant = object(probed.variants.find(value => object(value).id === (index === 0 ? "captured-vector" : "normalized-stem-hybrid")));
        if (!equal(variant.traceIds, arm.traceIds) || variant.contextBytes !== arm.contextBytes || variant.contextSha256 !== arm.contextSha256) fail("frozen probe ranking changed");
      }
      contextRows.set(row.questionId, row.candidate);
      rankRows.push({ questionId: row.questionId, personId, originalResultSha256: row.original.resultSha256,
        candidateResultSha256: canonicalSha256(row.candidate), semanticCaptureSha256: row.original.semanticCaptureSha256,
        eligibleTraceIdsSha256: canonicalSha256(row.original.eligibleTraceIds), arms: row.candidate.arms.map(arm => ({
          armId: arm.arm, traceIds: arm.traceIds, contextSha256: arm.contextSha256, contextBytes: arm.contextBytes })) });
    }
    projections.push(projection);
    personaPins.push({ personId, sourceSha256: projection.sourceSha256, capturePin,
      identitySha256: canonicalSha256(captured.identity), queries: results.length });
  }
  if (contextRows.size !== 146 || rankRows.length !== 146) fail("complete development population");
  const source = cloneMemKeywordDevPairedSource(projections, contextRows), ids = source.questions.map(question => question.id);
  // Gold leaves this adapter only through this separate artifact, after all ranks exist.
  const scorer: CloneMemKeywordDevScorer = { protocol: "oh.clonemem-keyword-dev-scorer.v1", sourceRevision: CLONEMEM_SOURCE.revision,
    sourceSha256: canonicalSha256(source), rows: projections.flatMap(projection => projection.scorer) };
  const provenance = { protocol: "oh.clonemem-keyword-dev-source-admission.v1", inputPins: pins,
    sourceRevision: CLONEMEM_SOURCE.revision, sourceArchive: CLONEMEM_SOURCE,
    policySha256: canonicalSha256(CLONEMEM_KEYWORD_POLICY_V1), probePolicySha256: frozen.policySha256,
    historicalMechanismSha256: mechanism.mechanismSha256, personaPins, selectedQuestionIdsSha256: canonicalSha256(ids),
    sourceSha256: canonicalSha256(source), scorerSha256: canonicalSha256(scorer), rankRows,
    originalSdkReplay: true, exactOriginalContextBytes: true, selectedQuestions: 146, personas: 2,
    originalBackendCloses: 2, candidateBackendCloses: 2, providerCalls: 0, modelCalls: 0, scoresComputed: false };
  bounded(scorer, CLONEMEM_KEYWORD_DEV_LIMITS.provenanceBytes); bounded(provenance, CLONEMEM_KEYWORD_DEV_LIMITS.provenanceBytes);
  return { source, scorer, provenance };
}
