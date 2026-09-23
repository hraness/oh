/** Offline assembly of the frozen CloneMem comparison. No provider calls or scores.
 * Dataset gold is written only to the separately pinned scorer artifact. */
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { CLONEMEM_PRIMARY_PERSON_IDS, CLONEMEM_SOURCE, eligibleCloneMemMemory, makeCloneMemChoiceMessages,
  readCloneMemPersona, renderCloneMemEvidence, type CloneMemProjection } from "./clonemem-dataset";
import { CLONEMEM_CAPTURE_LIMITS, CLONEMEM_RETRIEVAL_POLICY, type CloneMemRetrievalResult } from "./clonemem-retrieval";
import { readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { makePairedMemoryPlan, parsePairedMemorySource, selectPairedMemoryIds,
  type PairedMemorySource } from "./paired-memory-study";
import { ROOT, writeNew } from "./io";
import { SEMANTIC_MODEL_SHA256 } from "./deductive-semantic-cache";

const MAX_MANIFEST = 4 * 1024 * 1024;
function fail(reason: string): never { throw new TypeError(`CloneMem study: ${reason}.`); }
function equal(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [...keys])) fail("artifact shape"); return value;
}
function sealed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = object(value, [...keys, "resultSha256"]), { resultSha256, ...payload } = row;
  if (canonicalSha256(payload) !== resultSha256) fail("artifact digest"); return row;
}
function decode(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
export async function cloneMemFilePin(path: string, maximum = MAX_MANIFEST): Promise<EvolutionPin> {
  const full = resolve(path), stat = await lstat(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || await realpath(full) !== full) fail("pin path or size");
  const raw = await readFile(full); if (raw.length > maximum) fail("pin grew");
  return { path: full, sha256: sha256Hex(raw) };
}

/** Authenticates every source, context and eligible set. Native SDK ranking replay
 * is an additional independent gate; this loader does not invent vector rankings. */
export async function readCloneMemCapture(pin: EvolutionPin) {
  const manifest = sealed(decode(await readEvolutionPin(pin, MAX_MANIFEST)), ["protocol", "scored", "sourceRevision", "source", "policy",
    "policySha256", "personas", "totalQueries", "totalBytes", "elapsedMs", "complete"]);
  if (manifest.protocol !== "oh.clonemem-primary-capture.v1" || manifest.scored !== false || manifest.complete !== true
    || manifest.sourceRevision !== CLONEMEM_SOURCE.revision || !equal(manifest.policy, CLONEMEM_RETRIEVAL_POLICY)
    || manifest.policySha256 !== canonicalSha256(CLONEMEM_RETRIEVAL_POLICY) || manifest.totalQueries !== 1007
    || typeof manifest.totalBytes !== "number" || manifest.totalBytes > CLONEMEM_CAPTURE_LIMITS.totalBytes
    || !Array.isArray(manifest.personas) || manifest.personas.length !== 9 || !isPlainRecord(manifest.source)) fail("capture identity or coverage");
  const mechanism = object(manifest.source, ["protocol", "files", "mechanismSha256"]);
  if (mechanism.protocol !== "oh.clonemem-mechanism.v1" || canonicalSha256(mechanism.files) !== mechanism.mechanismSha256) fail("mechanism digest");
  const projections: CloneMemProjection[] = [], rows = new Map<string, CloneMemRetrievalResult>();
  const runtimes: Record<string, unknown>[] = [];
  let totalBytes = 0;
  for (const [index, raw] of manifest.personas.entries()) {
    const persona = object(raw, ["personId", "path", "bytes", "sha256", "resultSha256", "questions", "traces", "sourceSha256"]);
    const personId = CLONEMEM_PRIMARY_PERSON_IDS[index]!;
    if (persona.personId !== personId || persona.path !== `${personId}.json` || typeof persona.sha256 !== "string"
      || typeof persona.bytes !== "number" || persona.bytes > CLONEMEM_CAPTURE_LIMITS.personaBytes) fail("persona pin");
    const bytes = await readEvolutionPin({ path: join(dirname(pin.path), persona.path), sha256: persona.sha256 }, CLONEMEM_CAPTURE_LIMITS.personaBytes);
    if (bytes.length !== persona.bytes) fail("persona bytes");
    const captured = sealed(decode(bytes), ["protocol", "scored", "personId", "sourceSha256", "retrievalSha256", "mechanismSha256",
      "policySha256", "runtime", "identity", "preparationMs", "rows"]);
    const projection = await readCloneMemPersona(personId); projections.push(projection);
    const runtime = object(captured.runtime, ["engine", "nodeLlamaCpp", "sqliteVec", "bun", "platform", "arch", "gpu", "forceCpu",
      "embedContextSize", "embedParallelism", "search", "modelSha256", "semanticProfileSha256", "queryPath", "qmdForceCpu", "qmdLlamaGpu", "nativeStartupMs"]);
    if (runtime.modelSha256 !== SEMANTIC_MODEL_SHA256 || runtime.semanticProfileSha256 !== CLONEMEM_RETRIEVAL_POLICY.semanticProfileSha256
      || runtime.search !== "shipped-oh-qmd-searchVector-global-query-v1") fail("runtime identity");
    runtimes.push(runtime);
    if (captured.protocol !== "oh.clonemem-persona-capture.v1" || captured.scored !== false || captured.personId !== personId
      || captured.resultSha256 !== persona.resultSha256 || captured.sourceSha256 !== projection.sourceSha256
      || persona.sourceSha256 !== projection.sourceSha256 || captured.retrievalSha256 !== projection.retrievalSha256
      || captured.mechanismSha256 !== mechanism.mechanismSha256 || captured.policySha256 !== manifest.policySha256
      || !Array.isArray(captured.rows) || captured.rows.length !== projection.queries.length
      || persona.questions !== projection.queries.length || persona.traces !== projection.memory.traces.length) fail("source projection or persona coverage");
    const queries = new Map(projection.queries.map(query => [query.id, query]));
    for (const value of captured.rows) {
      const row = object(value, ["questionId", "result"]);
      if (typeof row.questionId !== "string" || rows.has(row.questionId)) fail("duplicate query");
      const query = queries.get(row.questionId); if (!query) fail("unknown query");
      const result = sealed(row.result, ["protocol", "personId", "querySha256", "identitySha256", "questionDate", "eligibleTraceIds",
        "authorityHeadSha256", "semanticCapture", "semanticCaptureSha256", "arms", "timing"]);
      const eligible = eligibleCloneMemMemory(projection.memory, query.questionDate), ids = new Set(eligible.traces.map(trace => trace.id));
      if (result.protocol !== "oh.clonemem-retrieval-result.v1" || result.personId !== personId || result.querySha256 !== sha256Hex(query.question)
        || result.questionDate !== query.questionDate || result.identitySha256 !== canonicalSha256(captured.identity)
        || !equal(result.eligibleTraceIds, [...ids]) || result.semanticCaptureSha256 !== canonicalSha256(result.semanticCapture)
        || !Array.isArray(result.arms) || result.arms.length !== 3) fail("query or eligibility changed");
      for (const [armIndex, armRaw] of result.arms.entries()) {
        const arm = object(armRaw, ["arm", "traceIds", "context", "contextBytes", "contextSha256", "sources", "evidence"]);
        if (arm.arm !== CLONEMEM_RETRIEVAL_POLICY.arms[armIndex] || !Array.isArray(arm.traceIds) || arm.traceIds.length > 10
          || new Set(arm.traceIds).size !== arm.traceIds.length || arm.traceIds.some(id => typeof id !== "string" || !ids.has(id))
          || typeof arm.context !== "string" || arm.context !== renderCloneMemEvidence(projection.memory, arm.traceIds as string[])
          || arm.contextSha256 !== sha256Hex(arm.context) || arm.contextBytes !== Buffer.byteLength(arm.context)) fail("rank or whole-trace context changed");
      }
      totalBytes += Buffer.byteLength(canonicalJson(value));
      rows.set(query.id, result as unknown as CloneMemRetrievalResult);
    }
  }
  if (rows.size !== 1007 || totalBytes !== manifest.totalBytes) fail("complete capture denominator or byte count");
  const { nativeStartupMs: ignoredStartup, ...runtime } = runtimes[0]!;
  void ignoredStartup;
  if (runtimes.some(({ nativeStartupMs, ...value }) => !equal(value, runtime) || typeof nativeStartupMs !== "number"
    || !Number.isFinite(nativeStartupMs) || nativeStartupMs < 0)) fail("runtime changed between personas");
  return { manifest, projections, rows, runtime, mechanismSha256: mechanism.mechanismSha256 as string };
}

export async function verifyCloneMemReplay(replayPin: EvolutionPin, capturePin: EvolutionPin,
  captured: Awaited<ReturnType<typeof readCloneMemCapture>>) {
  const replay = decode(await readEvolutionPin(replayPin));
  if (!isPlainRecord(replay)) fail("replay receipt shape");
  const { resultSha256: replayDigest, ...replayPayload } = replay;
  const expectedReplayCode = await cloneMemFilePin(join(ROOT, "scripts/benchmarks/clonemem-replay.ts"));
  if (replayDigest !== canonicalSha256(replayPayload) || replay.protocol !== "oh.clonemem-primary-replay-receipt.v1"
    || replay.scored !== false || replay.manifestFileSha256 !== capturePin.sha256
    || replay.sourceCaptureSha256 !== captured.manifest.resultSha256 || replay.mechanismSha256 !== captured.mechanismSha256
    || replay.replayCodeSha256 !== expectedReplayCode.sha256 || replay.queries !== 1007 || replay.exactSdkReplay !== true
    || replay.futureSources !== 0 || replay.futureCaptures !== 0 || replay.replayBackendCloses !== 9 || replay.networkDisabled !== true
    || replay.modelEnvironment !== "/nonexistent/clonemem-replay.gguf" || replay.nativeExitCode !== 0 || replay.nativeChildCollected !== true
    || replay.nativeCleanupWarnings !== 0 || !Array.isArray(replay.personas) || replay.personas.length !== 9
    || replay.personas.some((row, index) => !isPlainRecord(row) || row.personId !== CLONEMEM_PRIMARY_PERSON_IDS[index]
      || row.queries !== captured.projections[index]!.queries.length || row.exactSdkReplay !== true)) fail("full native replay gate");
  return replay;
}

/** One source reconstruction for preparation and final scoring prevents mismatching
 * the recall rankings with different reader questions, options, or contexts. */
export function cloneMemPairedSource(captured: Pick<Awaited<ReturnType<typeof readCloneMemCapture>>, "projections" | "rows">, count: 100 | 300): PairedMemorySource {
  if (count !== 100 && count !== 300) fail("predeclared sample size");
  const questions = captured.projections.flatMap(projection => projection.readerQuestions);
  const population = questions.map(question => ({ questionId: question.id, groupId: question.personId }));
  const ids = selectPairedMemoryIds(population, 17, count), byId = new Map(questions.map(question => [question.id, question]));
  const arms = ["oh-hybrid", "raw-vector"] as const;
  return parsePairedMemorySource({ protocol: "oh.memory.paired-source.v1", datasetRevision: CLONEMEM_SOURCE.revision,
    selection: { algorithm: "clonemem-balanced-sha256-v1", seed: 17, population, count }, arms,
    questions: ids.map(id => {
      const question = byId.get(id)!, ranks = captured.rows.get(id)!;
      return { id, groupId: question.personId, question: question.question, questionDate: question.questionDate,
        personName: question.personName, choices: question.choices, contexts: arms.map(armId => ({ armId, text: ranks.arms.find(arm => arm.arm === armId)!.context })) };
    }) });
}

export function verifyCloneMemPairedSource(value: unknown,
  captured: Pick<Awaited<ReturnType<typeof readCloneMemCapture>>, "projections" | "rows">, count: 100 | 300): PairedMemorySource {
  const expected = cloneMemPairedSource(captured, count);
  if (!equal(value, expected)) fail("reader source differs from captured native questions or contexts");
  return expected;
}

export async function prepareCloneMemStudy(input: Readonly<{ capturePin: EvolutionPin; selectionPin: EvolutionPin;
  campaignPin: EvolutionPin; replayPin: EvolutionPin; outputDirectory: string }>) {
  const captured = await readCloneMemCapture(input.capturePin), { campaign } = await verifyEvolutionCampaign(input.campaignPin);
  if (campaign.additionalBudgetMicros !== 20_000_000 || campaign.maximumCalls !== 1800) fail("frozen campaign limits");
  await verifyCloneMemReplay(input.replayPin, input.capturePin, captured);
  const selection = object(decode(await readEvolutionPin(input.selectionPin)), ["protocol", "sourceRevision", "algorithm", "seed", "population",
    "preferredIds", "fallbackIds", "fallbackCriterion", "qualityScoresInspected"]);
  const questions = captured.projections.flatMap(projection => projection.readerQuestions);
  const population = questions.map(question => ({ questionId: question.id, groupId: question.personId }));
  const ids = selectPairedMemoryIds(population, 17, 300);
  if (selection.protocol !== "oh.clonemem-reader-selection.v1" || selection.sourceRevision !== CLONEMEM_SOURCE.revision
    || selection.algorithm !== "clonemem-balanced-sha256-v1" || selection.seed !== 17 || selection.qualityScoresInspected !== false
    || !equal(selection.population, population) || !equal(selection.preferredIds, ids) || !equal(selection.fallbackIds, ids.slice(0, 100))) fail("frozen reader draw changed");
  const outputDirectory = resolve(input.outputDirectory); await mkdir(outputDirectory, { mode: 0o700 });
  if (await realpath(outputDirectory) !== outputDirectory) fail("output directory alias");
  const scorerCodePin = await cloneMemFilePin(join(ROOT, "scripts/benchmarks/clonemem-score.ts"));
  const promptPin = await cloneMemFilePin(join(ROOT, "scripts/benchmarks/clonemem-dataset.ts"));
  const gold = { protocol: "oh.clonemem-scorer-source.v1", sourceRevision: CLONEMEM_SOURCE.revision, capturePin: input.capturePin,
    selectionPin: input.selectionPin, replayPin: input.replayPin, scorerCodePin, rows: captured.projections.flatMap(projection => projection.scorer) };
  const scorerPath = join(outputDirectory, "scorer.json"); await writeNew(scorerPath, canonicalJson(gold) + "\n");
  const scorerPin = await cloneMemFilePin(scorerPath);
  let preferredReservationMicros: number | null = null;
  for (const count of [300, 100] as const) {
    const source = cloneMemPairedSource(captured, count);
    const sourcePath = join(outputDirectory, `reader-source-${count}.json`); await writeNew(sourcePath, canonicalJson(source) + "\n");
    const sourcePin = await cloneMemFilePin(sourcePath, 64 * 1024 * 1024);
    // Plan construction enforces the complete campaign reservation. The only allowed
    // fallback is this cost failure; malformed contexts or requests stop preparation.
    let plan;
    try { plan = makePairedMemoryPlan({ source, sourcePin, promptPin, scorerPin, campaignPin: input.campaignPin,
      campaign, readerProfile: "gpt4o-mini-clonemem-choice-v1-reader", renderMessages: makeCloneMemChoiceMessages }); }
    catch (error) {
      if (count !== 300 || !(error instanceof Error) || error.message !== "Paired memory study: complete-plan reservation or call cap.") throw error;
      preferredReservationMicros = -1; continue;
    }
    const planPath = join(outputDirectory, "plan.json"); await writeNew(planPath, canonicalJson(plan) + "\n");
    const planPin = await cloneMemFilePin(planPath, 128 * 1024 * 1024);
    const receipt = { protocol: "oh.clonemem-prepared.v1", capturePin: input.capturePin, selectionPin: input.selectionPin,
      replayPin: input.replayPin, sourcePin, scorerPin, promptPin, campaignPin: input.campaignPin, planPin, mechanismSha256: captured.mechanismSha256,
      selectedQuestions: count, preferredSizeFit: preferredReservationMicros === null, maximumReservationMicros: plan.maximumReservationMicros,
      maximumPhysicalCalls: plan.maximumPhysicalCalls, logicalCases: plan.cases.length, scoresComputed: false };
    await writeNew(join(outputDirectory, "prepared.json"), canonicalJson(receipt) + "\n"); return receipt;
  }
  return fail("neither preregistered draw fits");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 6 && args[0] === "prepare") {
    const [capturePin, selectionPin, campaignPin, replayPin] = await Promise.all(args.slice(1, 5).map(path => cloneMemFilePin(path)));
    console.log(JSON.stringify(await prepareCloneMemStudy({ capturePin: capturePin!, selectionPin: selectionPin!, campaignPin: campaignPin!, replayPin: replayPin!, outputDirectory: args[5]! })));
  } else if (args.length === 1 && args[0] === "--help") console.log("bun run scripts/benchmarks/clonemem-study.ts prepare CAPTURE_MANIFEST SELECTION CAMPAIGN REPLAY_RECEIPT NEW_PRIVATE_DIRECTORY\nOffline only: authenticate all contexts and frozen draw, prepare exact paired requests within the campaign cap. No scoring or provider calls.");
  else fail("use prepare or --help");
}
