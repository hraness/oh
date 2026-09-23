/** Offline preparation and explicit local native capture. No provider dispatch. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { OhQmdRerankBackendV1, OH_RERANK_PROFILE_V1 } from "../../src/rerank";
import { parseOhRerankResultsV1, type OhRerankBackendV1 } from "../../src/rerank-model";
import { CLONEMEM_SOURCE, makeCloneMemChoiceMessages, type CloneMemMemory } from "./clonemem-dataset";
import { cloneMemKeywordDevCodePins } from "./clonemem-keyword-dev-prepare";
import { parseCloneMemReplayResult } from "./clonemem-replay";
import { cloneMemFilePin } from "./clonemem-study";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { ROOT, writeNew } from "./io";
import { percentile } from "./metrics";
import { makePairedMemoryPlan, parsePairedMemorySource } from "./paired-memory-study";
import { openSdkQualificationPersona, parseSdkQualificationPersona, SDK_QUALIFICATION_ARMS,
  SDK_QUALIFICATION_PEOPLE, SDK_QUALIFICATION_POLICY, type SdkQualificationPersona, type SdkQualificationRow } from "./sdk-retrieval-qualification";

const OLD_INPUTS_SHA = "5d5a13053cdccd08142092b61a432c955f6ac1940137efd3dcf4f1b97bef7c97";
const OLD_PREPARED_SHA = "a8e4503a7d8e356b6f840d24a4688eaaa986f2ff1bd25ead4e260f2f7c0acf4a";
const MODEL_BYTES = 639_153_184;
const ENV = { GGML_METAL_NO_RESIDENCY: "1", QMD_RERANK_CONTEXT_SIZE: "4096", QMD_EMBED_PARALLELISM: "1", QMD_LLAMA_GPU: "metal" };
function need(v: unknown, message: string): asserts v { if (!v) throw Error(`SDK qualification: ${message}`); }
function obj(v: unknown): Record<string, unknown> { need(isPlainRecord(v), "object"); return v; }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
async function read(pin: EvolutionPin, max = 64 * 1024 * 1024): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEvolutionPin(pin, max)));
}
async function artifact(directory: string, name: string, value: unknown, max = 64 * 1024 * 1024) {
  const body = canonicalJson(value) + "\n";
  need(Buffer.byteLength(body) <= max, "output bound");
  const path = join(directory, name); await writeNew(path, body); return cloneMemFilePin(path, max);
}
async function newDirectory(path: string) {
  const actual = resolve(path); await mkdir(dirname(actual), { mode: 0o700, recursive: true });
  await mkdir(actual, { mode: 0o700 });
  need(await realpath(actual) === actual, "output directory alias"); return actual;
}
type Input = Readonly<{ protocol: string; personas: readonly SdkQualificationPersona[];
  provenance: Readonly<{ historicalInputsPin: EvolutionPin; historicalPreparedPin: EvolutionPin; captureManifestPin: EvolutionPin;
    personaCapturePins: readonly EvolutionPin[]; readerSourcePin: EvolutionPin; scorerPin: EvolutionPin }> }>;
export function parseSdkQualificationInputs(value: unknown): Input {
  const r = obj(value);
  need(hasExactKeys(r, ["protocol", "personas", "provenance"]) && r.protocol === "oh.sdk-retrieval-qualification-input.v1"
    && Array.isArray(r.personas) && r.personas.length === 2, "input schema");
  const personas = r.personas.map(parseSdkQualificationPersona);
  need(personas.every((p, i) => p.memory.personId === SDK_QUALIFICATION_PEOPLE[i]
    && p.queries.length === SDK_QUALIFICATION_POLICY.personaQuestions[i]), "fixed dev population");
  const p = obj(r.provenance);
  need(hasExactKeys(p, ["historicalInputsPin", "historicalPreparedPin", "captureManifestPin", "personaCapturePins", "readerSourcePin", "scorerPin"])
    && Array.isArray(p.personaCapturePins) && p.personaCapturePins.length === 2, "provenance roles");
  const provenance = { historicalInputsPin: evolutionPin(p.historicalInputsPin), historicalPreparedPin: evolutionPin(p.historicalPreparedPin),
    captureManifestPin: evolutionPin(p.captureManifestPin), personaCapturePins: p.personaCapturePins.map(evolutionPin),
    readerSourcePin: evolutionPin(p.readerSourcePin), scorerPin: evolutionPin(p.scorerPin) };
  need(provenance.historicalInputsPin.sha256 === OLD_INPUTS_SHA && provenance.historicalPreparedPin.sha256 === OLD_PREPARED_SHA, "historical pins");
  return { protocol: r.protocol, personas, provenance };
}

async function reconstructSdkQualificationInputs(originalRoot: string) {
  const old = resolve(originalRoot), historicalInputsPin = { path: join(old, ".cache/benchmarks/clonemem-rerank-probe-v1/inputs.json"), sha256: OLD_INPUTS_SHA };
  const historicalPreparedPin = { path: join(old, ".cache/benchmarks/clonemem-keyword-dev-v1/prepared/prepared.json"), sha256: OLD_PREPARED_SHA };
  const previous = obj(await read(historicalInputsPin)), prepared = obj(await read(historicalPreparedPin, 256 * 1024));
  need(Array.isArray(previous.memories) && previous.memories.length === 2 && Array.isArray(previous.queries) && previous.queries.length === 146, "historical source coverage");
  const originalQueries = previous.queries.map(obj);
  const captureManifestPin = evolutionPin(obj(prepared.inputPins).capturePin), manifest = obj(await read(captureManifestPin, 4 * 1024 * 1024));
  need(Array.isArray(manifest.personas), "historical capture manifest");
  const personaCapturePins: EvolutionPin[] = [], personas: SdkQualificationPersona[] = [];
  for (const personId of SDK_QUALIFICATION_PEOPLE) {
    const entry = obj(manifest.personas.find(p => obj(p).personId === personId));
    need(entry.path === `${personId}.json`, "historical persona path");
    const pin = evolutionPin({ path: join(dirname(captureManifestPin.path), entry.path), sha256: entry.sha256 });
    const captured = obj(await read(pin));
    need(captured.personId === personId && captured.scored === false && Array.isArray(captured.rows), "unscored capture");
    const memory = previous.memories.map(obj).find(m => m.personId === personId);
    need(memory, "historical memory");
    const queries = captured.rows.map(raw => {
      const row = obj(raw), result = parseCloneMemReplayResult(row.result);
      const q = originalQueries.find(q => q.id === row.questionId);
      need(q && result.personId === personId && result.querySha256 === sha256Hex(String(q.query))
        && result.questionDate === q.questionDate, "source/capture question identity");
      return { id: row.questionId, personId, query: q.query, questionDate: q.questionDate,
        eligibleTraceIds: result.eligibleTraceIds, semanticCapture: result.semanticCapture, originalResultSha256: result.resultSha256 };
    });
    personas.push(parseSdkQualificationPersona({ memory, queries })); personaCapturePins.push(pin);
  }
  return parseSdkQualificationInputs({ protocol: "oh.sdk-retrieval-qualification-input.v1", personas,
    provenance: { historicalInputsPin, historicalPreparedPin, captureManifestPin, personaCapturePins,
      readerSourcePin: prepared.sourcePin, scorerPin: prepared.scorerPin } });
}
export async function prepareSdkQualification(originalRoot: string, outputDirectory: string) {
  const input = await reconstructSdkQualificationInputs(originalRoot);
  const directory = await newDirectory(outputDirectory), inputsPin = await artifact(directory, "inputs.json", input);
  return { inputsPin, questions: 146, providerCalls: 0, nativeCalls: 0, scoresComputed: false };
}
async function verifyModel(path: string) {
  const actual = await realpath(resolve(path)), before = await lstat(actual);
  need(before.isFile() && before.size === MODEL_BYTES, "fixed model size");
  const hash = createHash("sha256"); for await (const chunk of createReadStream(actual)) hash.update(chunk);
  need(hash.digest("hex") === OH_RERANK_PROFILE_V1.modelSha256, "fixed model digest");
  const after = await lstat(actual);
  need(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "model changed");
  return { path: actual, sha256: OH_RERANK_PROFILE_V1.modelSha256 };
}
export async function freezeSdkQualification(directory: string, modelPath: string, qmdPath: string) {
  const dir = await realpath(resolve(directory)), inputsPin = await cloneMemFilePin(join(dir, "inputs.json"), 64 * 1024 * 1024);
  const inputs = parseSdkQualificationInputs(await read(inputsPin));
  need(same(inputs, await reconstructSdkQualificationInputs(resolve(dirname(inputs.provenance.historicalInputsPin.path), "../../.."))), "input projection differs from historical capture chain");
  const qmd = await realpath(resolve(qmdPath)), packagePin = await cloneMemFilePin(join(qmd, "package.json"));
  const specifier: string = "@tobilu/qmd";
  const resolvedQmd = await realpath(join(dirname(fileURLToPath(import.meta.resolve(specifier))), ".."));
  need(qmd === resolvedQmd, "QMD freeze path differs from actual SDK import resolution");
  const pkg = obj(await read(packagePin)); need(pkg.name === "@tobilu/qmd" && pkg.version === "2.5.3", "QMD version");
  const modelPin = await verifyModel(modelPath), codePins = await cloneMemKeywordDevCodePins();
  const protocolPin = await cloneMemFilePin(join(ROOT, "benchmarks/SDK_RETRIEVAL_QUALIFICATION_V1.md"));
  const qmdCodePin = await cloneMemFilePin(join(qmd, "dist/llm.js"));
  const nodeModules = dirname(dirname(qmd)), runtimeRoot = dirname(nodeModules);
  const llamaPackagePin = await cloneMemFilePin(join(nodeModules, "node-llama-cpp/package.json"));
  const llama = obj(await read(llamaPackagePin)); need(llama.version === "3.18.1", "node-llama-cpp version");
  const nativeRoot = join(nodeModules, "@node-llama-cpp/mac-arm64-metal");
  const nativePackagePin = await cloneMemFilePin(join(nativeRoot, "package.json"));
  const native = obj(await read(nativePackagePin)); need(native.version === "3.18.1", "native Metal package version");
  const nativeDirectory = join(nativeRoot, "bins/mac-arm64-metal"), nativeNames = (await readdir(nativeDirectory)).sort();
  need(nativeNames.length > 0 && nativeNames.length <= 32 && nativeNames.includes("llama-addon.node"), "native binary inventory");
  const runtimePins = [await cloneMemFilePin(join(runtimeRoot, "bun.lock")), await cloneMemFilePin(join(runtimeRoot, "package.json")),
    llamaPackagePin, nativePackagePin,
    ...await Promise.all(["bindings/getLlama.js", "evaluator/LlamaRankingContext.js", "evaluator/LlamaContext/LlamaContext.js", "evaluator/LlamaModel/LlamaModel.js"]
      .map(name => cloneMemFilePin(join(nodeModules, "node-llama-cpp/dist", name)))),
    ...await Promise.all(nativeNames.map(name => cloneMemFilePin(join(nativeDirectory, name), 16 * 1024 * 1024)))];
  const bunPin = await cloneMemFilePin(await realpath(process.execPath), 256 * 1024 * 1024);
  const frozen = { protocol: "oh.sdk-retrieval-qualification-freeze.v1", policy: SDK_QUALIFICATION_POLICY,
    policySha256: canonicalSha256(SDK_QUALIFICATION_POLICY), inputsPin, codePins, protocolPin, modelPin,
    qmdPath: qmd, qmdPackagePin: packagePin, qmdCodePin, runtimePins, bunPin,
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, env: ENV },
    scoresComputed: false, providerCalls: 0 };
  return { freezePin: await artifact(dir, "freeze.json", frozen, 512 * 1024), questions: 146, nativeCalls: 0, providerCalls: 0 };
}
async function loadFrozen(directory: string, sha: string) {
  const dir = await realpath(resolve(directory)), freezePin = evolutionPin({ path: join(dir, "freeze.json"), sha256: sha });
  const f = obj(await read(freezePin, 512 * 1024)), runtime = obj(f.runtime);
  need(f.protocol === "oh.sdk-retrieval-qualification-freeze.v1" && same(f.policy, SDK_QUALIFICATION_POLICY)
    && f.policySha256 === canonicalSha256(SDK_QUALIFICATION_POLICY) && f.scoresComputed === false
    && runtime.bun === Bun.version && runtime.platform === process.platform && runtime.arch === process.arch && same(runtime.env, ENV), "frozen policy/runtime");
  need(Array.isArray(f.codePins) && same(f.codePins, await cloneMemKeywordDevCodePins()), "source closure changed");
  for (const role of ["protocolPin", "qmdPackagePin", "qmdCodePin"] as const) await readEvolutionPin(evolutionPin(f[role]));
  need(Array.isArray(f.runtimePins) && f.runtimePins.length <= 40, "runtime inventory");
  for (const pin of f.runtimePins) await readEvolutionPin(evolutionPin(pin), 16 * 1024 * 1024);
  const bunPin = evolutionPin(f.bunPin);
  need(await realpath(process.execPath) === bunPin.path, "Bun executable path drift");
  await readEvolutionPin(bunPin, 256 * 1024 * 1024);
  const specifier: string = "@tobilu/qmd";
  need(await realpath(join(dirname(fileURLToPath(import.meta.resolve(specifier))), "..")) === f.qmdPath, "QMD import resolution drift");
  const inputsPin = evolutionPin(f.inputsPin), input = parseSdkQualificationInputs(await read(inputsPin));
  need(same(input, await reconstructSdkQualificationInputs(resolve(dirname(input.provenance.historicalInputsPin.path), "../../.."))), "input projection differs from historical capture chain");
  return { dir, freezePin, f, inputsPin, input, modelPin: evolutionPin(f.modelPin) };
}

/** Offline replay of authenticated native score rows. This checks that captured
 * rankings and rendered contexts are exactly what the current pinned SDK emits;
 * it never invents scores or invokes a model. Exported for hostile fixtures. */
export async function verifySdkQualificationRows(personas: readonly SdkQualificationPersona[], values: readonly unknown[]) {
  need(values.length === personas.reduce((n, p) => n + p.queries.length, 0), "captured row count");
  let cursor = 0;
  const checked: SdkQualificationRow[] = [];
  const replay: OhRerankBackendV1 = { profile: OH_RERANK_PROFILE_V1, async close() {},
    async rerank(query, documents) {
      const row = obj(values[cursor]);
      need(row.querySha256 === sha256Hex(query) && Array.isArray(row.pool), "native-score replay query");
      const pool = documents.map(doc => ({ key: doc.key, documentSha256: sha256Hex(doc.text), documentBytes: Buffer.byteLength(doc.text) }));
      need(same(pool, row.pool), "native-score replay document pool");
      need(Array.isArray(row.nativeScores), "native score array");
      return parseOhRerankResultsV1(row.nativeScores as Parameters<typeof parseOhRerankResultsV1>[0], new Set(documents.map(d => d.key)));
    } };
  for (const persona of personas) {
    const session = openSdkQualificationPersona(persona, replay);
    try {
      for (const _query of session.questions) {
        const row = obj(values[cursor]);
        need(hasExactKeys(row, ["questionId", "personId", "questionDate", "querySha256", "authorityHeadSha256", "eligibleRecords",
          "semanticCaptureSha256", "arms", "pool", "nativeScores", "rerankMs", "defaultMode", "diagnostics"])
          && typeof row.rerankMs === "number" && Number.isFinite(row.rerankMs) && row.rerankMs >= 0
          && row.rerankMs <= SDK_QUALIFICATION_POLICY.maximumNativeSeconds * 1000
          && Array.isArray(row.arms) && row.arms.length === 3 && same(row.diagnostics, []), "captured row schema/timing/diagnostics");
        const replayed = await session.next();
        for (const key of ["questionId", "personId", "questionDate", "querySha256", "authorityHeadSha256", "eligibleRecords",
          "semanticCaptureSha256", "pool", "nativeScores", "defaultMode", "diagnostics"] as const)
          need(same(replayed[key], row[key]), `captured ${key} differs from SDK replay`);
        for (let i = 0; i < 3; i++) {
          const arm = obj(row.arms[i]);
          need(hasExactKeys(arm, ["armId", "traceIds", "context", "contextSha256", "contextBytes", "searchMs"])
            && typeof arm.searchMs === "number" && Number.isFinite(arm.searchMs) && arm.searchMs >= 0, "captured arm/timing");
          const { searchMs: _ignored, ...actual } = arm;
          const { searchMs: _replayTime, ...expected } = replayed.arms[i]!;
          need(same(actual, expected), "captured rank/source context differs from SDK replay");
        }
        checked.push(row as unknown as SdkQualificationRow); cursor++;
      }
    } finally { await session.close(); }
  }
  return checked;
}

async function authenticateCapture(frozen: Awaited<ReturnType<typeof loadFrozen>>, capturePin: EvolutionPin) {
  need(capturePin.path === join(frozen.dir, "capture.json"), "capture path");
  const capture = obj(await read(capturePin));
  need(capture.protocol === "oh.sdk-retrieval-qualification-capture.v1" && same(capture.freezePin, frozen.freezePin)
    && capture.policySha256 === canonicalSha256(SDK_QUALIFICATION_POLICY)
    && capture.questions === 146 && capture.completed === 146 && capture.failed === 0 && capture.cleanupCompleted === true
    && capture.scoresComputed === false && capture.providerCalls === 0 && capture.nativeCalls === 146
    && capture.modelSha256 === frozen.modelPin.sha256 && typeof capture.elapsedMs === "number"
    && Number.isFinite(capture.elapsedMs) && capture.elapsedMs > 0 && capture.elapsedMs < SDK_QUALIFICATION_POLICY.maximumNativeSeconds * 1000
    && Array.isArray(capture.rows) && capture.rows.length === 146, "complete native capture required");
  const queries = frozen.input.personas.flatMap(p => p.queries);
  for (const [index, row] of capture.rows.entries()) {
    const prefix = `q${String(index).padStart(3, "0")}`, q = queries[index]!;
    const intentPath = join(frozen.dir, "capture", `${prefix}.intent.json`), resultPath = join(frozen.dir, "capture", `${prefix}.result.json`);
    const intent = await read(await cloneMemFilePin(intentPath, 4096), 4096);
    need(same(intent, { freezePin: frozen.freezePin, questionId: q.id, querySha256: sha256Hex(q.query) }), "checkpoint intent identity");
    need(same(await read(await cloneMemFilePin(resultPath, 512 * 1024), 512 * 1024), row), "checkpoint result differs from capture");
  }
  const rows = await verifySdkQualificationRows(frozen.input.personas, capture.rows);
  const timings = rows.map(r => r.rerankMs), warm = timings.slice(1), stored = obj(capture.timings);
  const expected = { firstQueryMs: timings[0], p50Ms: percentile(timings, .5), p95Ms: percentile(timings, .95),
    warmP50Ms: percentile(warm, .5), warmP95Ms: percentile(warm, .95), qualification: "reranker backend time only; excludes historical semantic inference" };
  need(same(stored, expected) && expected.warmP95Ms !== null && expected.warmP95Ms <= 30_000, "native latency gate");
  need(capture.totalPairs === rows.reduce((n, r) => n + r.pool.length, 0)
    && capture.maximumPool === Math.max(...rows.map(r => r.pool.length))
    && capture.maximumDocumentBytes === Math.max(...rows.flatMap(r => r.pool.map(d => d.documentBytes))), "capture pool aggregates");
  return { capture, rows };
}

export async function captureSdkQualification(directory: string, freezeSha256: string) {
  const { dir, freezePin, input, modelPin } = await loadFrozen(directory, freezeSha256);
  for (const [name, value] of Object.entries(ENV)) need(process.env[name] === value, `explicit runtime env ${name}`);
  await verifyModel(modelPin.path);
  const out = await newDirectory(join(dir, "capture")), started = performance.now();
  const ranker = new OhQmdRerankBackendV1({ modelPath: modelPin.path });
  const rows: SdkQualificationRow[] = [];
  let failure: unknown, failed = false;
  try {
    for (const persona of input.personas) {
      const session = openSdkQualificationPersona(persona, ranker);
      try {
        for (const q of session.questions) {
          need(performance.now() - started < SDK_QUALIFICATION_POLICY.maximumNativeSeconds * 1000, "native time budget");
          const number = String(rows.length).padStart(3, "0");
          await artifact(out, `q${number}.intent.json`, { freezePin, questionId: q.id, querySha256: sha256Hex(q.query) }, 4096);
          const row = await session.next(); rows.push(row);
          await artifact(out, `q${number}.result.json`, row, 512 * 1024);
          console.log(JSON.stringify({ completed: rows.length, total: 146, pool: row.pool.length, rerankMs: row.rerankMs, providerCalls: 0 }));
        }
      } finally { await session.close(); }
    }
  } catch (error) { failure = error; failed = true; }
  try { await ranker.close(); } catch (error) { if (!failed) failure = error; failed = true; }
  if (failed) {
    await artifact(out, "failed.json", { protocol: "oh.sdk-retrieval-qualification-failed.v1", freezePin,
      completed: rows.length, failed: 146 - rows.length, providerCalls: 0, scoresComputed: false });
    throw failure;
  }
  await loadFrozen(directory, freezeSha256);
  need(rows.length === 146 && performance.now() - started < SDK_QUALIFICATION_POLICY.maximumNativeSeconds * 1000, "complete bounded capture");
  const timings = rows.map(r => r.rerankMs), warm = timings.slice(1);
  const result = { protocol: "oh.sdk-retrieval-qualification-capture.v1", freezePin, policySha256: canonicalSha256(SDK_QUALIFICATION_POLICY),
    questions: rows.length, completed: rows.length, failed: 0, rows, providerCalls: 0, scoresComputed: false,
    nativeCalls: rows.length, modelSha256: modelPin.sha256, elapsedMs: performance.now() - started,
    timings: { firstQueryMs: timings[0], p50Ms: percentile(timings, .5), p95Ms: percentile(timings, .95),
      warmP50Ms: percentile(warm, .5), warmP95Ms: percentile(warm, .95), qualification: "reranker backend time only; excludes historical semantic inference" },
    totalPairs: rows.reduce((n, r) => n + r.pool.length, 0), maximumPool: Math.max(...rows.map(r => r.pool.length)),
    maximumDocumentBytes: Math.max(...rows.flatMap(r => r.pool.map(d => d.documentBytes))), cleanupCompleted: true };
  return { capturePin: await artifact(dir, "capture.json", result), questions: 146, timings: result.timings, providerCalls: 0 };
}

/** Existing two-arm framework stays closed. Primary and secondary plans are
 * separate comparisons; candidate repetitions are fresh in each campaign. */
export async function prepareSdkQualificationPaid(directory: string, freezeSha256: string, captureSha256: string, ownerSha256: string,
  comparison: "semantic" | "hybrid", campaignPin: EvolutionPin, outputDirectory: string) {
  const frozen = await loadFrozen(directory, freezeSha256);
  const capturePin = evolutionPin({ path: join(frozen.dir, "capture.json"), sha256: captureSha256 });
  const { rows } = await authenticateCapture(frozen, capturePin);
  const ownerPin = evolutionPin({ path: join(frozen.dir, "native-owner.json"), sha256: ownerSha256 });
  const owner = obj(await read(ownerPin, 16 * 1024));
  need(hasExactKeys(owner, ["protocol", "freezePin", "capturePin", "exitCode", "nativeCleanupWarnings", "nativeErrors",
    "ownedChildCollected", "deadlineSeconds", "stdoutSha256", "stderrSha256"])
    && owner.protocol === "oh.sdk-retrieval-native-owner.v1" && same(owner.freezePin, frozen.freezePin)
    && same(owner.capturePin, capturePin) && owner.exitCode === 0 && owner.nativeCleanupWarnings === 0 && owner.nativeErrors === 0
    && owner.ownedChildCollected === true && owner.deadlineSeconds === 3600
    && typeof owner.stdoutSha256 === "string" && /^[a-f0-9]{64}$/.test(owner.stdoutSha256)
    && typeof owner.stderrSha256 === "string" && /^[a-f0-9]{64}$/.test(owner.stderrSha256), "root-owned native exit/cleanup receipt");
  const old = parsePairedMemorySource(await read(frozen.input.provenance.readerSourcePin));
  const arms = [`sdk-${comparison}`, "sdk-default-rerank"] as const;
  const rowMap = new Map(rows.map(row => [row.questionId, row]));
  need(rowMap.size === 146, "unique captured questions");
  const source = parsePairedMemorySource({ ...old, arms, questions: old.questions.map(q => {
    const row = rowMap.get(q.id); need(row && row.personId === q.groupId && row.querySha256 === sha256Hex(q.question), "captured source identity");
    const capturedArms = row.arms;
    return { ...q, contexts: arms.map(armId => {
      const arm = obj(capturedArms.find(a => obj(a).armId === armId));
      need(typeof arm.context === "string" && sha256Hex(arm.context) === arm.contextSha256 && Buffer.byteLength(arm.context) === arm.contextBytes, "captured context bytes");
      return { armId, text: arm.context };
    }) };
  }) });
  // This happens only after complete capture and native cleanup. Scorer is a
  // separate artifact and is not used for selection, capture or admission.
  const priorScorer = obj(await read(frozen.input.provenance.scorerPin, 8 * 1024 * 1024));
  const scorer = { protocol: "oh.sdk-retrieval-qualification-scorer.v1", sourceRevision: CLONEMEM_SOURCE.revision,
    sourceSha256: canonicalSha256(source), rows: priorScorer.rows };
  const { campaign } = await verifyEvolutionCampaign(campaignPin);
  need(campaign.campaignId === `oh-sdk-retrieval-${comparison}-20260923-v1`
    && campaign.additionalBudgetMicros <= 12_500_000 && campaign.maximumCalls <= 876, "campaign identity/cap");
  const out = await newDirectory(outputDirectory), sourcePin = await artifact(out, "source.json", source);
  const scorerPin = await artifact(out, "scorer.json", scorer, 8 * 1024 * 1024);
  const promptPin = await cloneMemFilePin(join(ROOT, "scripts/benchmarks/clonemem-dataset.ts"));
  const plan = makePairedMemoryPlan({ source, sourcePin, scorerPin, promptPin, campaignPin, campaign,
    readerProfile: "gpt4o-mini-clonemem-choice-v1-reader", renderMessages: makeCloneMemChoiceMessages });
  need(plan.cases.length === 876 && plan.maximumPhysicalCalls <= 876 && plan.maximumReservationMicros <= 12_500_000, "complete paid reservation");
  const planPin = await artifact(out, "plan.json", plan, 128 * 1024 * 1024);
  return { preparedPin: await artifact(out, "prepared.json", { protocol: "oh.sdk-retrieval-qualification-paid-prepared.v1",
    comparison, freezePin: frozen.freezePin, capturePin, ownerPin, sourcePin, scorerPin, promptPin, planPin, campaignPin,
    codePins: await cloneMemKeywordDevCodePins(), protocolPin: frozen.f.protocolPin, policy: SDK_QUALIFICATION_POLICY,
    questions: 146, logicalCases: 876, maximumPhysicalCalls: plan.maximumPhysicalCalls,
    maximumReservationMicros: plan.maximumReservationMicros, scoresComputed: false }, 512 * 1024),
    maximumPhysicalCalls: plan.maximumPhysicalCalls, maximumReservationMicros: plan.maximumReservationMicros, providerCalls: 0 };
}

if (import.meta.main) {
  const [command, a, b, c, d, e, f, g, ...extra] = process.argv.slice(2);
  if (command === "prepare" && a && b && !c) console.log(JSON.stringify(await prepareSdkQualification(a, b)));
  else if (command === "freeze" && a && b && c && !d) console.log(JSON.stringify(await freezeSdkQualification(a, b, c)));
  else if (command === "capture" && a && b && !c) console.log(JSON.stringify(await captureSdkQualification(a, b)));
  else if (command === "prepare-paid" && a && b && c && d && (e === "semantic" || e === "hybrid") && f && g && extra.length === 0)
    console.log(JSON.stringify(await prepareSdkQualificationPaid(a, b, c, d, e, await cloneMemFilePin(resolve(f)), g)));
  else if (command === "--help" && !a) console.log("prepare ORIGINAL_ROOT NEW_DIRECTORY\nfreeze DIRECTORY MODEL_PATH QMD_PACKAGE_PATH\ncapture DIRECTORY FREEZE_SHA\nprepare-paid DIRECTORY FREEZE_SHA CAPTURE_SHA OWNER_SHA semantic|hybrid CAMPAIGN_JSON NEW_DIRECTORY\nNo provider dispatch; native capture requires root-owned host admission.");
  else throw Error("Use --help for bounded SDK qualification commands");
}
