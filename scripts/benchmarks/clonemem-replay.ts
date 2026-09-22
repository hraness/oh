/** Re-run shipped SDK ranking from sealed semantic hits with no model or network.
 * Native process custody is separately attested by its actual run owner. */
import { lstat, mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../../src/semantic-model";
import { CLONEMEM_PRIMARY_PERSON_IDS, cloneMemTimestamp, readCloneMemPersona } from "./clonemem-dataset";
import { CLONEMEM_RETRIEVAL_POLICY, cloneMemMechanismManifest, prepareCloneMemRetrieval, type CloneMemRetrievalResult } from "./clonemem-retrieval";
import { ROOT, writeNew } from "./io";
async function boundedFile(path: string, maximum: number): Promise<Buffer> {
  const info = await lstat(path);
  if (resolve(path) !== path || await realpath(path) !== path || !info.isFile() || info.isSymbolicLink()
    || info.size > maximum) throw Error("Replay file path or size bound");
  const bytes = await readFile(path);
  if (bytes.length !== info.size || bytes.length > maximum) throw Error("Replay file changed or grew");
  return bytes;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [...keys])) throw Error("Replay artifact shape");
  return value;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw Error("Replay array bound");
  return value;
}
function string(value: unknown, maximum = 256): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum) throw Error("Replay scalar bound");
  return value;
}
function digest(value: unknown): string {
  const result = string(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw Error("Replay SHA-256 grammar");
  return result;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw Error("Replay integer bound");
  return value;
}
function finite(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw Error("Replay timing/score bound");
}
function sealed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const checked = object(value, [...keys, "resultSha256"]), { resultSha256, ...payload } = checked;
  if (canonicalSha256(payload) !== digest(resultSha256)) throw Error("Invalid result checksum");
  return checked;
}
/** Bounds precede replay. SDK reconstruction then verifies all nested source,
 * lane-evidence and record fields against authoritative native source records. */
export function parseCloneMemReplayResult(value: unknown): CloneMemRetrievalResult {
  const result = sealed(value, ["protocol", "personId", "querySha256", "identitySha256", "questionDate", "eligibleTraceIds",
    "authorityHeadSha256", "semanticCapture", "semanticCaptureSha256", "arms", "timing"]);
  if (result.protocol !== "oh.clonemem-retrieval-result.v1") throw Error("Replay result protocol");
  string(result.personId, 128); string(result.questionDate, 512);
  for (const key of ["querySha256", "identitySha256", "authorityHeadSha256", "semanticCaptureSha256"]) digest(result[key]);
  for (const id of array(result.eligibleTraceIds, 2_000)) string(id);
  for (const raw of array(result.semanticCapture, 30)) {
    const hit = object(raw, ["key", "recordSha256", "score", "v"]);
    string(hit.key, 512); digest(hit.recordSha256); finite(hit.score);
    if (hit.v !== 1) throw Error("Replay hit version");
  }
  const arms = array(result.arms, 3);
  if (arms.length !== 3) throw Error("Replay arm count");
  for (const [index, raw] of arms.entries()) {
    const arm = object(raw, ["arm", "traceIds", "context", "contextBytes", "contextSha256", "sources", "evidence"]);
    if (arm.arm !== CLONEMEM_RETRIEVAL_POLICY.arms[index]) throw Error("Replay arm order");
    const ids = array(arm.traceIds, 10); for (const id of ids) string(id);
    if (array(arm.sources, 10).length !== ids.length || array(arm.evidence, 10).length !== ids.length) throw Error("Replay source/evidence count");
    for (const evidence of arm.evidence as unknown[]) array(evidence, 2);
    if (typeof arm.context !== "string" || Buffer.byteLength(arm.context) > 1024 * 1024
      || integer(arm.contextBytes, 0, 1024 * 1024) !== Buffer.byteLength(arm.context)
      || digest(arm.contextSha256) !== sha256Hex(arm.context)) throw Error("Replay context bound or checksum");
  }
  const timing = object(result.timing, ["incrementalIndexMs", "hybridWallMs", "sharedSemanticTop30Ms", "keywordWallMs"]);
  Object.values(timing).forEach(finite);
  return result as unknown as CloneMemRetrievalResult;
}
export async function replayCloneMemCapture(capturePath: string, custodyPath: string) {
  if (process.env.QMD_EMBED_MODEL !== "/nonexistent/clonemem-replay.gguf") throw Error("Replay requires deliberately unavailable model environment");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw Error("Network forbidden in pure captured-rank replay"); }) as unknown as typeof fetch;
  try {
    const directory = dirname(capturePath), encoded = await boundedFile(capturePath, 4 * 1024 * 1024);
    const manifestInput: unknown = JSON.parse(encoded.toString("utf8"));
    const manifest = sealed(manifestInput, ["protocol", "scored", "sourceRevision", "source", "policy", "policySha256", "personas", "totalQueries", "totalBytes", "elapsedMs", "complete"]);
    const custodyBytes = await boundedFile(custodyPath, 64 * 1024), custodyInput: unknown = JSON.parse(custodyBytes.toString("utf8"));
    const custody = sealed(custodyInput, ["protocol", "sourceCaptureSha256", "manifestFileSha256", "nativeExitCode", "nativeChildCollected", "nativeCleanupWarnings", "observedWarnings", "owner", "toolSession", "timeoutMs", "nativeArgv", "qualityScoresComputed"]);
    if (custody.protocol !== "oh.clonemem-native-custody.v1" || custody.manifestFileSha256 !== sha256Hex(encoded)
      || custody.sourceCaptureSha256 !== manifest.resultSha256 || custody.nativeExitCode !== 0
      || custody.nativeChildCollected !== true || custody.nativeCleanupWarnings !== 0) throw Error("Native custody receipt mismatch");
    if (manifest.protocol !== "oh.clonemem-primary-capture.v1" || manifest.scored !== false || manifest.complete !== true || manifest.totalQueries !== 1007
      || canonicalJson(manifest.policy) !== canonicalJson(CLONEMEM_RETRIEVAL_POLICY)
      || manifest.policySha256 !== canonicalSha256(CLONEMEM_RETRIEVAL_POLICY)) throw Error("Capture policy or coverage");
    const rawPersonas = array(manifest.personas, 9);
    if (rawPersonas.length !== 9) throw Error("Incomplete capture population");
    integer(manifest.totalBytes, 1, 256 * 1024 * 1024);
    const source = await cloneMemMechanismManifest();
    if (canonicalJson(source) !== canonicalJson(manifest.source)) throw Error("Source mechanism drift before replay");
    const entries = rawPersonas.map((raw, index) => {
      const row = object(raw, ["personId", "path", "bytes", "sha256", "resultSha256", "questions", "traces", "sourceSha256"]);
      const personId = string(row.personId, 128);
      if (personId !== CLONEMEM_PRIMARY_PERSON_IDS[index] || row.path !== `${personId}.json`) throw Error("Persona population or path");
      return { personId, path: string(row.path), bytes: integer(row.bytes, 1, 64 * 1024 * 1024),
        sha256: digest(row.sha256), resultSha256: digest(row.resultSha256), sourceSha256: digest(row.sourceSha256),
        questions: integer(row.questions, 1, 512), traces: integer(row.traces, 1, 2_000) };
    });
    let total = 0, futureSources = 0, futureCaptures = 0, closed = 0;
    const timingRows: CloneMemRetrievalResult["timing"][] = [], personaReceipts = [];
    let totalRowBytes = 0;
    for (const entry of entries) {
      if (entry.path !== `${entry.personId}.json`) throw Error("Unsafe persona artifact path");
      const path = `${directory}/${entry.path}`, bytes = await boundedFile(path, 64 * 1024 * 1024);
      const artifactInput: unknown = JSON.parse(bytes.toString("utf8"));
      const artifact = sealed(artifactInput, ["protocol", "scored", "personId", "sourceSha256", "retrievalSha256", "mechanismSha256", "policySha256", "runtime", "identity", "preparationMs", "rows"]);
      if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256) throw Error("Persona artifact bytes changed");
      if (artifact.protocol !== "oh.clonemem-persona-capture.v1" || artifact.personId !== entry.personId || artifact.policySha256 !== manifest.policySha256
        || artifact.resultSha256 !== entry.resultSha256 || artifact.scored !== false || artifact.mechanismSha256 !== source.mechanismSha256) throw Error("Artifact parent mismatch");
      const projected = await readCloneMemPersona(entry.personId);
      if (artifact.sourceSha256 !== projected.sourceSha256 || entry.sourceSha256 !== projected.sourceSha256
        || artifact.retrievalSha256 !== projected.retrievalSha256 || entry.traces !== projected.memory.traces.length) throw Error("Source projection changed");
      const queries = [...projected.queries].sort((a,b)=>cloneMemTimestamp(a.questionDate)-cloneMemTimestamp(b.questionDate)||a.id.localeCompare(b.id));
      const rawRows = array(artifact.rows, 512);
      if (rawRows.length !== queries.length) throw Error("Persona query count");
      const rows = rawRows.map(raw => {
        const row = object(raw, ["questionId", "result"]);
        totalRowBytes += Buffer.byteLength(canonicalJson(row));
        if (totalRowBytes > 256 * 1024 * 1024) throw Error("Total row byte bound");
        return { questionId: string(row.questionId, 512), result: parseCloneMemReplayResult(row.result) };
      });
      if (rows.length !== entry.questions || canonicalJson(rows.map(row=>row.questionId)) !== canonicalJson(queries.map(query=>query.id))) throw Error("Query population/order mismatch");
      let current = 0;
      const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
        async index(records) { return { indexed: records.length, v: 1 }; },
        async search(query, limit) {
          const row = rows[current++]!;
          if (row.result.querySha256 !== sha256Hex(query) || limit !== 30) throw Error("Query capture mismatch");
          return row.result.semanticCapture;
        }, async close() { closed++; } };
      const prepared = await prepareCloneMemRetrieval(projected.memory, backend);
      try {
        if (canonicalJson(prepared.identity) !== canonicalJson(artifact.identity)) throw Error("Prepared identity mismatch");
        for (const [index,row] of rows.entries()) {
          const query = queries[index]!, replay = await prepared.retrieve(query.question,query.questionDate);
          for (const key of ["arms","semanticCapture","semanticCaptureSha256","eligibleTraceIds","authorityHeadSha256","identitySha256","questionDate","querySha256"] as const) {
            if (canonicalJson(replay[key]) !== canonicalJson(row.result[key])) throw Error(`Replay mismatch ${key}`);
          }
          const eligible = new Set(projected.memory.traces.filter(trace=>cloneMemTimestamp(trace.date)<=cloneMemTimestamp(query.questionDate)).map(trace=>trace.id));
          if (canonicalJson([...eligible]) !== canonicalJson(row.result.eligibleTraceIds)) throw Error("Eligibility proof mismatch");
          for (const arm of row.result.arms) for (const id of arm.traceIds) if (!eligible.has(id)) futureSources++;
          for (const hit of row.result.semanticCapture) {
            const ordinal = Number(hit.key.split("-").at(-1));
            if (!eligible.has(projected.memory.traces[ordinal]!.id)) futureCaptures++;
          }
          timingRows.push(row.result.timing); total++;
        }
      } finally { await prepared.close(); }
      if (current !== queries.length) throw Error("Unconsumed semantic capture");
      personaReceipts.push({ personId:entry.personId,queries:current,exactSdkReplay:true });
      console.log(JSON.stringify({status:"replay",personId:entry.personId,queries:current,total}));
    }
    if (totalRowBytes !== manifest.totalBytes || canonicalJson(await cloneMemMechanismManifest()) !== canonicalJson(source)) throw Error("Source mechanism drift or row bytes mismatch");
    const timing = Object.fromEntries((["incrementalIndexMs","hybridWallMs","sharedSemanticTop30Ms","keywordWallMs"] as const).map(key=>{
      const entries=timingRows.map(row=>row[key]).sort((a,b)=>a-b); return [key,{sum:entries.reduce((a,b)=>a+b,0),mean:entries.reduce((a,b)=>a+b,0)/entries.length,p95:entries[Math.ceil(.95*entries.length)-1],max:entries.at(-1)}];
    }));
    const payload = {protocol:"oh.clonemem-primary-replay-receipt.v1",scored:false,sourceCaptureSha256:manifest.resultSha256,
      manifestFileSha256:sha256Hex(encoded),mechanismSha256:source.mechanismSha256,queries:total,
      personas:personaReceipts,exactSdkReplay:true,futureSources,futureCaptures,replayBackendCloses:closed,
      networkDisabled:true,modelEnvironment:process.env.QMD_EMBED_MODEL,nativeExitCode:custody.nativeExitCode,
      nativeChildCollected:custody.nativeChildCollected,nativeCleanupWarnings:custody.nativeCleanupWarnings,
      nativeCustodyPin:{path:custodyPath,sha256:sha256Hex(custodyBytes)},
      replayCodeSha256:sha256Hex(await boundedFile(resolve(import.meta.path),1024*1024)),timing};
    if(total!==1007 || closed!==9 || futureSources!==0 || futureCaptures!==0) throw Error("Incomplete replay or future source");
    const base=join(ROOT,".cache/benchmarks"); await mkdir(base,{recursive:true});
    const output=join(await mkdtemp(join(base,"clonemem-replay-")),"result.json");
    const result={...payload,resultSha256:canonicalSha256(payload)};
    await writeNew(output,canonicalJson(result)+"\n");
    return {path:output,result};
  } finally {globalThis.fetch=originalFetch;}
}

if(import.meta.main){
  const args=process.argv.slice(2);
  if(args.length===3 && args[0]==="replay") {
    const output=await replayCloneMemCapture(resolve(args[1]!),resolve(args[2]!));
    console.log(JSON.stringify({path:output.path,...output.result,personas:output.result.personas.length},null,2));
  } else if(args.length===1 && args[0]==="--help") console.log("QMD_EMBED_MODEL=/nonexistent/clonemem-replay.gguf bun run scripts/benchmarks/clonemem-replay.ts replay CAPTURE_MANIFEST NATIVE_CUSTODY_RECEIPT\nReplays all1,007queries through actualSDK using captured semantic ranks, with network disabled and no native model. Produces fresh private .cache/benchmarks/clonemem-replay-*/result.json. No quality scoring.");
  else throw Error("Use replay or --help");
}
