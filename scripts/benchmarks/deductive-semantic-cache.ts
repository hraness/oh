/** Content-addressed local replay records. No model or QMD import occurs here. */
import { closeSync, constants, fstatSync, linkSync, mkdirSync, openSync, readSync,
  readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../../src/semantic-model";
import type { Corpus } from "./datasets";
import type { AlgalFactV1 } from "./consistency-rules";

export const SEMANTIC_PRODUCER_ID = "oh.deductive-semantic-producer.v2" as const;
/** Expected bytes; live capture verifies the file actually loaded by QMD. */
export const SEMANTIC_MODEL_SHA256 = "b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63";
export const SEMANTIC_PROFILE_SHA256 = canonicalSha256(OH_EMBEDDING_PROFILE_V1);
export const SEMANTIC_CACHE_LIMITS = Object.freeze({ queryBytes: 16_384, turns: 100_000,
  corpusBytes: 64 * 1024 * 1024, rankLimit: 1024, entryBytes: 256 * 1024, entries: 4096, indexes: 16 });
export const SEMANTIC_RUNTIME = Object.freeze({ engine: OH_EMBEDDING_PROFILE_V1.engine,
  nodeLlamaCpp: "3.18.1", sqliteVec: "0.1.9", bun: Bun.version, platform: process.platform,
  arch: process.arch, gpu: process.env.QMD_LLAMA_GPU ?? "auto",
  forceCpu: process.env.QMD_FORCE_CPU ?? "",
  embedContextSize: process.env.QMD_EMBED_CONTEXT_SIZE ?? "",
  embedParallelism: process.env.QMD_EMBED_PARALLELISM ?? "",
  search: "qmd.searchVec:owned-query:oh:v1" });

export interface SemanticFacts {
  readonly facts: readonly AlgalFactV1[];
  readonly nearTurns: readonly string[];
  readonly producerDigest: string;
}
export interface SemanticRank { readonly turnId: string; readonly score: number }
export interface SemanticResult extends SemanticFacts { readonly ranked: readonly SemanticRank[] }
export interface SemanticRequest {
  readonly v: 1;
  readonly corpusSha256: string;
  readonly query: string;
  readonly questionDigest: string;
  readonly tau: number;
  readonly topN: number;
  readonly rankLimit: number;
  readonly producer: typeof SEMANTIC_PRODUCER_ID;
  readonly model: string;
  readonly modelSha256: string;
  readonly profileSha256: string;
  readonly runtime: typeof SEMANTIC_RUNTIME;
}
export function semanticFail(message: string): never {
  throw new TypeError(`deductive semantic producer: ${message}`);
}
function boundedText(value: unknown, max: number, label: string): asserts value is string {
  if (typeof value !== "string" || Buffer.byteLength(value) > max) semanticFail(`invalid ${label}`);
}
export function semanticCorpusSha256(corpus: Corpus): string {
  if (!Array.isArray(corpus.turns) || corpus.turns.length > SEMANTIC_CACHE_LIMITS.turns) semanticFail("corpus turn limit exceeded");
  boundedText(corpus.id, 512, "corpus id");
  boundedText(corpus.groupId, 512, "group id");
  const ids = new Set<string>();
  let bytes = 0;
  for (const turn of corpus.turns) {
    boundedText(turn.id, 512, "turn id");
    if (turn.id.length === 0 || ids.has(turn.id)) semanticFail("empty or duplicate turn id");
    ids.add(turn.id);
    for (const key of ["sessionId", "date", "speaker", "text"] as const) {
      boundedText(turn[key], SEMANTIC_CACHE_LIMITS.corpusBytes, `turn ${key}`);
      bytes += Buffer.byteLength(turn[key]);
    }
    if (bytes > SEMANTIC_CACHE_LIMITS.corpusBytes) semanticFail("corpus byte limit exceeded");
  }
  return canonicalSha256(corpus);
}
export function semanticRequest(corpusSha256: string, query: string, questionDigest: string,
  tau: number, topN: number, rankLimit: number): SemanticRequest {
  boundedText(query, SEMANTIC_CACHE_LIMITS.queryBytes, "query");
  if (!/^(?:sha256:)?[0-9a-f]{64}$/.test(questionDigest)) semanticFail("invalid question digest");
  if (!/^[0-9a-f]{64}$/.test(corpusSha256)) semanticFail("invalid corpus digest");
  if (!Number.isFinite(tau) || tau < 0 || tau >= 1) semanticFail("invalid tau");
  if (!Number.isSafeInteger(topN) || topN < 1 || topN > 256) semanticFail("invalid topN");
  if (!Number.isSafeInteger(rankLimit) || rankLimit < 0 || rankLimit > SEMANTIC_CACHE_LIMITS.rankLimit) semanticFail("invalid rankLimit");
  return Object.freeze({ v: 1, corpusSha256, query, questionDigest, tau, topN, rankLimit,
    producer: SEMANTIC_PRODUCER_ID, model: OH_EMBEDDING_PROFILE_V1.model,
    modelSha256: SEMANTIC_MODEL_SHA256, profileSha256: SEMANTIC_PROFILE_SHA256,
    runtime: SEMANTIC_RUNTIME });
}
function validateRanks(value: unknown, request: SemanticRequest,
  turnIds: ReadonlySet<string>): readonly SemanticRank[] {
  if (!Array.isArray(value) || value.length > Math.max(request.topN, request.rankLimit)) semanticFail("invalid cached rank count");
  const seen = new Set<string>();
  let previous = Infinity;
  for (const row of value) {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["turnId", "score"])
      || typeof row.turnId !== "string" || !turnIds.has(row.turnId) || seen.has(row.turnId)
      || typeof row.score !== "number" || !Number.isFinite(row.score) || Object.is(row.score, -0)
      || row.score < -1 || row.score > 1 || row.score > previous) semanticFail("invalid cached rank id, score, or ordering");
    previous = row.score;
    seen.add(row.turnId);
  }
  return value as SemanticRank[];
}
export function semanticResult(request: SemanticRequest, rawRanks: readonly SemanticRank[],
  turnIds: ReadonlySet<string>): SemanticResult {
  const ranked = validateRanks(rawRanks, request, turnIds);
  // topN limits semantic facts independently of the vector arm's fetch budget.
  const near = ranked.slice(0, request.topN).filter((hit) => hit.score >= request.tau);
  const producerDigest = `sha256:${canonicalSha256({ producer: request.producer,
    corpusSha256: request.corpusSha256, query: request.query, question: request.questionDigest,
    model: request.model, modelSha256: request.modelSha256,
    profileSha256: request.profileSha256, runtime: request.runtime,
    tau: request.tau, topN: request.topN, near })}`;
  return Object.freeze({ producerDigest,
    facts: Object.freeze(near.map(({ turnId }): AlgalFactV1 => Object.freeze({ relation: "sem-near",
      tuple: Object.freeze([`turn:${turnId}`]), sources: Object.freeze([producerDigest]) }))),
    nearTurns: Object.freeze(near.map(({ turnId }) => turnId)),
    ranked: Object.freeze(ranked.slice(0, request.rankLimit).map((row) => Object.freeze({ ...row }))) });
}
export function semanticCachePath(root: string, request: SemanticRequest): string {
  return join(root, "replay-v1", `${canonicalSha256(request)}.json`);
}
function readBounded(path: string): string | null {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > SEMANTIC_CACHE_LIMITS.entryBytes) semanticFail("cache entry byte limit exceeded");
    // Read at most the bound even if another process changes the file after stat.
    const bytes = Buffer.alloc(SEMANTIC_CACHE_LIMITS.entryBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > SEMANTIC_CACHE_LIMITS.entryBytes) semanticFail("cache entry byte limit exceeded");
    return bytes.subarray(0, length).toString("utf8");
  } finally { closeSync(fd); }
}
export function readSemanticCache(root: string, request: SemanticRequest,
  turnIds: ReadonlySet<string>): SemanticResult | null {
  const text = readBounded(semanticCachePath(root, request));
  if (text === null) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { semanticFail("cache entry is not JSON"); }
  if (!isPlainRecord(value) || !hasExactKeys(value, ["request", "rawRanks", "result", "sha256"])) semanticFail("invalid cache entry shape");
  // Exact expected request avoids recursing into arbitrary untrusted structures.
  if (JSON.stringify(value.request) !== JSON.stringify(JSON.parse(canonicalJson(request)))) semanticFail("cache request mismatch");
  const rawRanks = validateRanks(value.rawRanks, request, turnIds);
  const result = semanticResult(request, rawRanks, turnIds);
  if (JSON.stringify(value.result) !== JSON.stringify(JSON.parse(canonicalJson(result)))) semanticFail("cache facts/provenance mismatch");
  if (value.sha256 !== canonicalSha256({ request, rawRanks, result })) semanticFail("cache content digest mismatch");
  return result;
}
export function writeSemanticCache(root: string, request: SemanticRequest,
  rawRanks: readonly SemanticRank[], turnIds: ReadonlySet<string>): SemanticResult {
  const result = semanticResult(request, rawRanks, turnIds);
  const payload = { request, rawRanks, result };
  const bytes = canonicalJson({ ...payload, sha256: canonicalSha256(payload) }) + "\n";
  if (Buffer.byteLength(bytes) > SEMANTIC_CACHE_LIMITS.entryBytes) semanticFail("cache entry byte limit exceeded");
  const dir = join(root, "replay-v1");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destination = semanticCachePath(root, request);
  const existing = readBounded(destination);
  if (existing !== null) {
    readSemanticCache(root, request, turnIds);
    if (existing !== bytes) semanticFail("immutable cache entry conflicts with new result");
    return result;
  }
  // 4096 * 256 KiB is a hard 1 GiB bound for completed records. Runs sharing a
  // cache must have one writer (the benchmark runner owns that process).
  if (readdirSync(dir).length >= SEMANTIC_CACHE_LIMITS.entries) semanticFail("cache entry count limit exceeded");
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  try {
    try { linkSync(temporary, destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      readSemanticCache(root, request, turnIds);
      if (readBounded(destination) !== bytes) semanticFail("immutable cache entry conflicts with concurrent result");
    }
  } finally { unlinkSync(temporary); }
  return result;
}
