/** Private parent-side custody for the credential-free real Mem0 worker.
 * It creates only source-derived, opaque receipts. The worker can request a
 * typed call but cannot choose its profile, endpoint, namespace, or cost. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { invokeMem0Request, makeMem0EmbeddingRequest, makeMem0LlmRequest, validateMem0BridgePolicy, type Mem0BridgePolicy, type Mem0Credential, type Mem0Fetcher, type Mem0Request, type Mem0Result, type openMem0Ledger } from "./mem0-ledger";

import { createMem0DurationClock, MEM0_QUALIFICATION_DURATION_POLICY } from "./mem0-duration";

const MAX_CHUNKS = 1_024, MAX_FRAME = 1_048_576, MAX_TEXT = 262_144;
type Role = "user" | "assistant";
type Ledger = Awaited<ReturnType<typeof openMem0Ledger>>;
export type Mem0SourceTurn = Readonly<{ turnId: string; sourceTurnId: string; sourceTurnSha256: string; sessionId: string; date: string; role: Role; text: string; utf8Start: number; utf8End: number; sourceUtf8Bytes: number }>;
export type Mem0SourceChunk = Readonly<{ chunkId: string; sourceSha256: string; turns: readonly Mem0SourceTurn[] }>;
export type Mem0SelectedCorpus = Readonly<{ protocol: "oh.memory.mem0-selected-corpus.v1"; dataset: "longmemeval-s"; partition: "development"; corpusId: string; corpusSha256: string; chunks: readonly Mem0SourceChunk[]; sourceReceiptSha256: string }>;
export type Mem0DerivationReceipt = Readonly<{ protocol: "oh.memory.mem0-derivation.v1"; policySha256: string; corpusSha256: string; sourceReceiptSha256: string; runSha256: string; namespace: string; chunkCount: number; receiptSha256: string }>;
type Activity = Readonly<{ kind: "ingest"; chunk: Mem0SourceChunk } | { kind: "query"; questionSha256: string }>;
function fail(reason: string): never { throw new TypeError(`Mem0 parent: ${reason}.`); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!isPlainRecord(value) || !hasExactKeys(value, keys)) fail("invalid exact object"); return value; }
function sha(value: unknown): value is string { return typeof value === "string" && parseSha256Hex(value) !== null; }
function text(value: unknown, maximum = MAX_TEXT): string { if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maximum || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value)) !== value) fail("invalid bounded text"); return value; }
function opaque(value: unknown): string { const current = text(value, 128); if (!/^[a-f0-9]{16,64}$/.test(current)) fail("opaque identifier"); return current; }
export function validateMem0SelectedCorpus(value: unknown): Mem0SelectedCorpus {
  const current = exact(value, ["protocol", "dataset", "partition", "corpusId", "corpusSha256", "chunks", "sourceReceiptSha256"]);
  if (current.protocol !== "oh.memory.mem0-selected-corpus.v1" || current.dataset !== "longmemeval-s" || current.partition !== "development"
    || !sha(current.corpusSha256) || !sha(current.sourceReceiptSha256) || !Array.isArray(current.chunks) || current.chunks.length < 1 || current.chunks.length > MAX_CHUNKS) fail("selected corpus identity");
  const chunks: Mem0SourceChunk[] = [], ids = new Set<string>(), turnIds = new Set<string>();
  const originals = new Map<string, Mem0SourceTurn[]>(); let previousOriginal: string | null = null, sourceBytes = 0;
  const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
  for (const item of current.chunks) {
    const chunk = exact(item, ["chunkId", "sourceSha256", "turns"]), chunkId = opaque(chunk.chunkId);
    if (ids.has(chunkId) || !sha(chunk.sourceSha256) || !Array.isArray(chunk.turns) || chunk.turns.length < 1 || chunk.turns.length > 8192) fail("source chunk");
    const projected: Mem0SourceTurn[] = []; let chunkBytes = 0;
    for (const value of chunk.turns) {
      const checked = exact(value, ["turnId", "sourceTurnId", "sourceTurnSha256", "sessionId", "date", "role", "text", "utf8Start", "utf8End", "sourceUtf8Bytes"]);
      const turnId = opaque(checked.turnId), sourceTurnId = opaque(checked.sourceTurnId), content = text(checked.text, 4096), date = text(checked.date, 256);
      if (turnIds.has(turnId) || !sha(checked.sourceTurnSha256) || checked.role !== "user" && checked.role !== "assistant"
        || !uint(checked.utf8Start) || !uint(checked.utf8End) || !uint(checked.sourceUtf8Bytes) || checked.sourceUtf8Bytes > 524_288
        || checked.utf8End <= checked.utf8Start || checked.utf8End > checked.sourceUtf8Bytes || Buffer.byteLength(content) !== checked.utf8End - checked.utf8Start) fail("source turn identity");
      const part: Mem0SourceTurn = Object.freeze({ turnId, sourceTurnId, sourceTurnSha256: checked.sourceTurnSha256,
        sessionId: opaque(checked.sessionId), date, role: checked.role, text: content, utf8Start: checked.utf8Start, utf8End: checked.utf8End, sourceUtf8Bytes: checked.sourceUtf8Bytes });
      const earlier = originals.get(sourceTurnId) ?? [];
      if (earlier.length && previousOriginal !== sourceTurnId) fail("source continuation order");
      if (earlier.length ? earlier.at(-1)!.utf8End !== part.utf8Start : part.utf8Start !== 0) fail("source continuation gap or overlap");
      if (earlier.length && ["sourceTurnSha256", "sourceUtf8Bytes", "sessionId", "date", "role"].some(key => part[key as keyof Mem0SourceTurn] !== earlier[0]![key as keyof Mem0SourceTurn])) fail("source continuation provenance");
      earlier.push(part); originals.set(sourceTurnId, earlier); previousOriginal = sourceTurnId;
      chunkBytes += Buffer.byteLength(`[${date}] ${content}`); sourceBytes += Buffer.byteLength(content);
      if (chunkBytes > 4096 || sourceBytes > 32 * 1024 * 1024 || turnIds.size >= 16_384) fail("source byte or part bound");
      turnIds.add(turnId); projected.push(part);
    }
    const sourceSha256 = canonicalSha256(projected); if (chunk.sourceSha256 !== sourceSha256) fail("source chunk digest");
    ids.add(chunkId); chunks.push(Object.freeze({ chunkId, sourceSha256, turns: Object.freeze(projected) }));
  }
  if (originals.size > 8192) fail("original source turn bound");
  for (const parts of originals.values()) {
    const first = parts[0]!, bytes = Buffer.concat(parts.map(part => Buffer.from(part.text)));
    if (parts.at(-1)!.utf8End !== first.sourceUtf8Bytes || bytes.length !== first.sourceUtf8Bytes || sha256Hex(bytes) !== first.sourceTurnSha256) fail("source continuation reconstruction");
  }
  const candidate = { protocol: current.protocol, dataset: current.dataset, partition: current.partition, corpusId: opaque(current.corpusId), corpusSha256: current.corpusSha256, chunks: Object.freeze(chunks), sourceReceiptSha256: current.sourceReceiptSha256 } as const;
  if (canonicalSha256(candidate.chunks.map(chunk => ({ chunkId: chunk.chunkId, sourceSha256: chunk.sourceSha256 }))) !== candidate.corpusSha256) fail("source corpus digest");
  return Object.freeze(candidate);
}
export function makeMem0DerivationReceipt(policyInput: unknown, corpusInput: unknown): Mem0DerivationReceipt {
  const policy = validateMem0BridgePolicy(policyInput), corpus = validateMem0SelectedCorpus(corpusInput);
  // run/namespace are derived fields. Excluding them prevents a self-referential hash.
  const policyIdentitySha256 = canonicalSha256({ protocol: policy.protocol, llmProfile: policy.llmProfile, embeddingProfile: policy.embeddingProfile });
  const runSha256 = canonicalSha256({ protocol: "oh.memory.mem0-parent-run.v1", policyIdentitySha256, corpusSha256: corpus.corpusSha256, sourceReceiptSha256: corpus.sourceReceiptSha256 });
  const namespace = canonicalSha256({ protocol: "oh.memory.mem0-parent-namespace.v1", runSha256 });
  if (policy.runSha256 !== runSha256 || policy.namespace !== namespace) fail("policy does not bind selected corpus");
  const policySha256 = canonicalSha256(policy), payload = { protocol: "oh.memory.mem0-derivation.v1" as const, policySha256, corpusSha256: corpus.corpusSha256, sourceReceiptSha256: corpus.sourceReceiptSha256, runSha256, namespace, chunkCount: corpus.chunks.length };
  return Object.freeze({ ...payload, receiptSha256: canonicalSha256(payload) });
}
function rpc(value: unknown, policy: Mem0BridgePolicy): Readonly<{ id: string; operation: "llm" | "embed"; payload: Record<string, unknown> }> {
  const current = exact(value, ["kind", "id", "operation", "namespace", "payload"]); if (current.kind !== "rpc" || typeof current.id !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(current.id) || (current.operation !== "llm" && current.operation !== "embed") || current.namespace !== policy.namespace || !isPlainRecord(current.payload)) fail("invalid worker RPC"); return { id: current.id, operation: current.operation, payload: current.payload };
}
/** A serial dispatcher for one worker. It is deliberately not a generic provider
 * proxy: activity derives each SDK call from a selected source chunk or question. */
export function createMem0RpcDispatcher(input: Readonly<{ policy: unknown; corpus: unknown; ledger: Ledger; credential: Mem0Credential; fetcher?: Mem0Fetcher }>) {
  const policy = validateMem0BridgePolicy(input.policy), corpus = validateMem0SelectedCorpus(input.corpus), derivation = makeMem0DerivationReceipt(policy, corpus);
  const cancellation = new AbortController();
  let ordinal = 0, activity: Activity | null = null, closed = false, chain: Promise<void> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => { const next = chain.then(action, action); chain = next.then(() => undefined, () => undefined); return next; };
  const choose = (request: Mem0Request) => input.fetcher === undefined
    ? invokeMem0Request({ request, ledger: input.ledger, credential: input.credential, signal: cancellation.signal })
    : invokeMem0Request({ request, ledger: input.ledger, credential: input.credential, fetcher: input.fetcher, signal: cancellation.signal });
  return Object.freeze({ derivation, abort: () => cancellation.abort(), maximumCallTimeoutMs: Math.max(policy.llmProfile.timeoutMs, policy.embeddingProfile.timeoutMs), embeddingDimensions: policy.embeddingProfile.embeddingDimensions,
    beginIngest(chunkIdInput: unknown) { if (closed || cancellation.signal.aborted || activity !== null) fail("invalid ingest activity"); const chunkId = opaque(chunkIdInput), chunk = corpus.chunks.find(candidate => candidate.chunkId === chunkId); if (!chunk) fail("unknown source chunk"); activity = Object.freeze({ kind: "ingest", chunk }); },
    beginQuery(questionSha256: unknown) { if (closed || activity !== null || !sha(questionSha256)) fail("invalid query activity"); activity = Object.freeze({ kind: "query", questionSha256 }); },
    endActivity() { if (activity === null) fail("no active activity"); activity = null; },
    async handle(value: unknown) { return serial(async () => { if (closed || activity === null) fail("RPC without active source-derived activity"); const frame = rpc(value, policy); let result: Mem0Result;
      if (frame.operation === "llm") { if (activity.kind !== "ingest") fail("query cannot extract"); const payload = exact(frame.payload, ["messages", "responseFormat"]), format = payload.responseFormat; if (format !== null && format !== undefined && format !== "json_object" && (!isPlainRecord(format) || !hasExactKeys(format, ["type"]) || format.type !== "json_object")) fail("unexpected extraction response format"); const request = makeMem0LlmRequest(policy, ordinal++, payload.messages); result = await choose(request); if (result.kind !== "llm" || !("content" in result.value)) fail("LLM result identity"); return Object.freeze({ kind: "rpc-result", id: frame.id, ok: true, result: Object.freeze({ content: result.value.content }) }); }
      const payload = exact(frame.payload, ["text", "action"]); if (payload.action !== "add" && payload.action !== "update" && payload.action !== "search") fail("embedding action"); if (activity.kind === "query" && payload.action !== "search") fail("embedding activity mismatch"); const request = makeMem0EmbeddingRequest(policy, ordinal++, activity.kind === "query" ? "query-embed" : "ingest-embed", payload.text); result = await choose(request); if (result.kind !== "embedding" || !("embedding" in result.value)) fail("embedding result identity"); return Object.freeze({ kind: "rpc-result", id: frame.id, ok: true, result: Object.freeze({ embedding: result.value.embedding }) });
    }); },
    async close() { await chain; if (activity !== null) fail("cannot close active activity"); closed = true; },
  });
}

/** Bounded real-SDK process harness. No credential is copied to the Python
 * environment; only dispatcher.handle can turn an SDK RPC into a provider call. */
export async function startMem0Worker(input: Readonly<{ command: readonly string[]; workerDirectory: string; mem0Directory: string; durationPolicy?: unknown; persistentVectorStore?: boolean; dispatcher: ReturnType<typeof createMem0RpcDispatcher>; corpus: unknown }>) {
  const corpus = validateMem0SelectedCorpus(input.corpus), command = [...input.command];
  if (command.length < 2 || command.length > 16 || command.some(part => typeof part !== "string" || part.length < 1 || part.length > 4096 || part.includes("\0")) || input.dispatcher.derivation.corpusSha256 !== corpus.corpusSha256) fail("worker command or corpus binding");
  if (input.persistentVectorStore !== undefined && typeof input.persistentVectorStore !== "boolean") fail("persistent vector-store flag");
  const clock = createMem0DurationClock(input.durationPolicy ?? MEM0_QUALIFICATION_DURATION_POLICY);
  if (input.dispatcher.maximumCallTimeoutMs > clock.policy.drainMs) fail("provider timeout exceeds drain policy");
  const { spawn } = await import("node:child_process");
  const child = spawn(command[0]!, command.slice(1), { cwd: input.workerDirectory, stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", PYTHONPATH: input.workerDirectory, MEM0_DIR: input.mem0Directory, MEM0_VECTOR_DIMENSIONS: String(input.dispatcher.embeddingDimensions), MEM0_VECTOR_PERSISTENCE: input.persistentVectorStore === true ? "local" : "memory", MEM0_TELEMETRY: "false", NO_PROXY: "*", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "" } });
  if (!child.stdin || !child.stdout || !child.stderr) { child.kill(); fail("worker pipes unavailable"); }
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const lifecycleTimer = setTimeout(() => { broken = true; input.dispatcher.abort(); child.kill(); forceKillTimer = setTimeout(() => child.kill("SIGKILL"), clock.policy.killGraceMs); }, clock.policy.lifecycleMs);
  const iterator = child.stdout[Symbol.asyncIterator](); let buffered = Buffer.alloc(0), ended = false, sequence = 0, active = false, broken = false, closed = false, stderrBytes = 0, workerError: Error | null = null;
  const kill = () => { if (!child.killed) child.kill(); };
  let resolveExit!: (value: readonly [number | null, NodeJS.Signals | null]) => void, exitRecorded = false;
  const exited = new Promise<readonly [number | null, NodeJS.Signals | null]>(resolve => { resolveExit = value => { if (!exitRecorded) { exitRecorded = true; resolve(value); } }; });
  child.once("error", error => { workerError = error; resolveExit([null, null]); });
  child.once("exit", (code, signal) => resolveExit([code, signal]));
  child.once("close", (code, signal) => resolveExit([code, signal]));
  child.stdin.on("error", error => { workerError = error; kill(); });
  child.stderr.on("data", chunk => { stderrBytes += Buffer.byteLength(chunk); if (stderrBytes > MAX_FRAME) kill(); });
  const remaining = () => { const value = clock.remaining(); if (value <= 0 || workerError !== null || stderrBytes > MAX_FRAME) { kill(); fail("worker timeout, error or stderr bound"); } return value; };
  const bounded = async <T>(promise: Promise<T>, label: string): Promise<T> => { let timer: ReturnType<typeof setTimeout> | null = null; try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), remaining()); })]); } catch { kill(); fail(label); } finally { if (timer !== null) clearTimeout(timer); } };
  const write = async (value: unknown) => {
    const raw = Buffer.from(JSON.stringify(value) + "\n"); if (raw.length > MAX_FRAME) fail("outbound worker frame bound");
    await bounded(new Promise<void>((resolve, reject) => { child.stdin!.write(raw, error => error ? reject(error) : resolve()); }), "worker write deadline");
  };
  const nextFrame = async (): Promise<Record<string, unknown>> => {
    while (true) { const end = buffered.indexOf(10); if (end >= 0) { const line = buffered.subarray(0, end); buffered = buffered.subarray(end + 1); if (line.length === 0 || line.length > MAX_FRAME) { kill(); fail("worker frame bound"); } try { const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)); if (!isPlainRecord(parsed)) fail("worker frame object"); return parsed; } catch { kill(); fail("worker frame JSON"); } }
      const next = await bounded(iterator.next(), "worker frame deadline"); if (next.done) { ended = true; fail("worker closed frame stream"); } buffered = Buffer.concat([buffered, Buffer.from(next.value)]); if (buffered.length > MAX_FRAME + 1) { kill(); fail("worker oversized frame"); } }
  };
  const send = async (commandValue: Record<string, unknown>, begin: (() => void) | null) => {
    if (closed || broken || ended || active) fail("worker activity overlap or closed"); active = true; clock.beginCommand(); let began = false;
    try {
      if (begin !== null) { begin(); began = true; }
      await write(commandValue);
      while (true) {
        const frame = await nextFrame();
        if (frame.kind === "rpc") { const reply = await bounded(input.dispatcher.handle(frame), "worker RPC deadline"); await write(reply); continue; }
        const result = exact(frame, ["kind", "id", "ok", "result"]);
        if (result.kind !== "result" || result.id !== commandValue.id || result.ok !== true || !isPlainRecord(result.result)) fail("worker command result");
        return result.result;
      }
    } catch (error) { broken = true; input.dispatcher.abort(); kill(); throw error; }
    finally { if (began) input.dispatcher.endActivity(); active = false; }
  };
  const waitExit = async (milliseconds: number): Promise<readonly [number | null, NodeJS.Signals | null] | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([exited, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), milliseconds); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const id = () => `mem0-${++sequence}`;
  return Object.freeze({
    derivation: input.dispatcher.derivation, durationPolicySha256: clock.policySha256,
    prepare: () => send({ kind: "prepare", id: id(), namespace: input.dispatcher.derivation.namespace }, null),
    add: (chunkIdInput: unknown) => { const chunkId = opaque(chunkIdInput), chunk = corpus.chunks.find(candidate => candidate.chunkId === chunkId); if (!chunk) fail("unknown source chunk"); return send({ kind: "add", id: id(), namespace: input.dispatcher.derivation.namespace, messages: chunk.turns.map(turn => ({ role: turn.role, content: `[${turn.date}] ${turn.text}` })), metadata: { chunkId: chunk.chunkId, sourceDigest: chunk.sourceSha256 } }, () => input.dispatcher.beginIngest(chunkId)); },
    search: (questionSha256: unknown, query: unknown) => { if (!sha(questionSha256) || questionSha256 !== sha256Hex(text(query))) fail("invalid query digest"); return send({ kind: "search", id: id(), namespace: input.dispatcher.derivation.namespace, query: text(query), topK: 50, threshold: 0.1 }, () => input.dispatcher.beginQuery(questionSha256)); },
    async close() {
      if (closed) return; if (active) fail("cannot close active worker");
      let closeError: unknown = null;
      try { if (!broken && !ended && !exitRecorded) await send({ kind: "close", id: id(), namespace: input.dispatcher.derivation.namespace }, null); }
      catch (error) { closeError = error; }
      finally { closed = true; clearTimeout(lifecycleTimer); if (forceKillTimer !== undefined) clearTimeout(forceKillTimer); child.stdin!.end(); }
      let exit = await waitExit(clock.policy.shutdownGraceMs);
      if (exit === null) { kill(); exit = await waitExit(clock.policy.killGraceMs); }
      if (exit === null) { child.kill("SIGKILL"); exit = await waitExit(clock.policy.killGraceMs); }
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([input.dispatcher.close(), new Promise<never>((_resolve, reject) => { drainTimer = setTimeout(() => reject(new Error("Mem0 dispatcher drain deadline")), clock.policy.drainMs); })]); }
      finally { if (drainTimer !== undefined) clearTimeout(drainTimer); }
      if (exit === null) fail("worker kill custody");
      const [code, signal] = exit;
      if (closeError !== null) throw closeError;
      if (!broken && (code !== 0 || signal !== null)) fail("worker did not exit cleanly");
      return Object.freeze({ code, signal, stderrBytes, graceful: code === 0 && signal === null });
    },
  });
}

/** Reconstruct only one exposed full-history context from its pinned V3 plan.
 * The source rendering is rechecked byte-for-byte; ambiguous separators reject. */
export function loadMem0SelectedCorpusFromFullHistoryContext(input: Readonly<{ contextPlan: unknown; questionId: string; sourceReceiptSha256: string }>): Mem0SelectedCorpus {
  if (!/^q-[a-f0-9]{64}$/.test(input.questionId) || !sha(input.sourceReceiptSha256) || !isPlainRecord(input.contextPlan) || !Array.isArray(input.contextPlan.cases)) fail("pinned full-history context plan");
  const matches = input.contextPlan.cases.filter(candidate => isPlainRecord(candidate) && candidate.questionId === input.questionId && candidate.variantId === "full-history");
  if (matches.length !== 1 || !isPlainRecord(matches[0]!.result)) fail("selected full-history case");
  const result = exact(matches[0]!.result, ["protocol", "policySha256", "preparedSha256", "corpusId", "corpusSha256", "sourceRecordsSha256", "sourceRecordCount", "context", "contextSha256", "contextBytes", "turnIds", "sessionIds", "sources", "omittedForBudget", "resultSha256"]);
  if (result.protocol !== "oh.evolution-full-history.v1" || typeof result.context !== "string" || !sha(result.policySha256) || !sha(result.preparedSha256) || !sha(result.corpusSha256) || !sha(result.sourceRecordsSha256) || !sha(result.contextSha256) || !sha(result.resultSha256) || !Number.isSafeInteger(result.contextBytes) || result.contextBytes !== Buffer.byteLength(result.context) || result.contextSha256 !== sha256Hex(result.context) || result.resultSha256 !== canonicalSha256(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "resultSha256"))) || result.omittedForBudget !== 0 || !Array.isArray(result.turnIds) || !Array.isArray(result.sessionIds) || !Array.isArray(result.sources) || !Number.isSafeInteger(result.sourceRecordCount) || result.sourceRecordCount !== result.sources.length || result.sources.length < 1 || result.sources.length > 8192) fail("unqualified full-history result");
  const context = result.context, marker = /(?:^|\n\n)\[([^\]\n]+)\] \[([^\]\n]*)\] (user|assistant): /g;
  const markers = [...context.matchAll(marker)], parsed = markers.map((match, index) => ({ id: match[1]!, date: match[2]!, role: match[3]! as Role, text: context.slice(match.index! + match[0]!.length, index + 1 < markers.length ? markers[index + 1]!.index! : context.length) }));
  const sourceIds: string[] = [], sourceSessions: string[] = [];
  for (const source of result.sources) { const current = exact(source, ["turnId", "sessionId", "key", "recordSha256"]); if (typeof current.turnId !== "string" || typeof current.sessionId !== "string" || typeof current.key !== "string" || !sha(current.recordSha256)) fail("source receipt record"); sourceIds.push(current.turnId); sourceSessions.push(current.sessionId); }
  const sessions = [...new Set(sourceSessions)];
  if (!parsed.length || parsed.some(turn => !turn.text) || parsed.map(turn => `[${turn.id}] [${turn.date}] ${turn.role}: ${turn.text}`).join("\n\n") !== context || JSON.stringify(parsed.map(turn => turn.id)) !== JSON.stringify(result.turnIds) || JSON.stringify(parsed.map(turn => turn.id)) !== JSON.stringify(sourceIds) || JSON.stringify(sessions) !== JSON.stringify(result.sessionIds)) fail("ambiguous full-history rendering");
  const turns = parsed.flatMap((turn, index) => { const source = Buffer.from(turn.text), original = sha256Hex(`turn:${turn.id}`), parts: Mem0SourceTurn[] = []; for (let start = 0; start < source.length;) { let end = Math.min(start + 4_096 - Buffer.byteLength(`[${turn.date}] `), source.length); while (end > start && end < source.length && (source[end]! & 0xc0) === 0x80) end--; if (end === start) fail("invalid UTF-8 continuation boundary"); const part = source.subarray(start, end).toString("utf8"); parts.push(Object.freeze({ turnId: sha256Hex(`turn-part:${turn.id}:${start}:${end}`), sourceTurnId: original, sourceTurnSha256: sha256Hex(source), sessionId: sha256Hex(`session:${sourceSessions[index]!}`), date: turn.date, role: turn.role, text: part, utf8Start: start, utf8End: end, sourceUtf8Bytes: source.length })); start = end; } return parts; });
  for (const source of parsed) { const sourceId = sha256Hex(`turn:${source.id}`), parts = turns.filter(turn => turn.sourceTurnId === sourceId).sort((a, b) => a.utf8Start - b.utf8Start); if (parts.length === 0 || parts[0]!.utf8Start !== 0 || parts.at(-1)!.utf8End !== Buffer.byteLength(source.text) || parts.some((part, index) => index > 0 && parts[index - 1]!.utf8End !== part.utf8Start) || !Buffer.concat(parts.map(part => Buffer.from(part.text))).equals(Buffer.from(source.text))) fail("source continuation reconstruction"); }
  const chunks: Mem0SourceChunk[] = []; let current: typeof turns = [], bytes = 0;
  for (const turn of turns) { const renderedBytes = Buffer.byteLength(`[${turn.date}] ${turn.text}`); if (renderedBytes > 4_096) fail("dated source part exceeds chunk bound"); if (current.length > 0 && bytes + renderedBytes > 4_096) { const index = chunks.length; chunks.push(Object.freeze({ chunkId: sha256Hex(`chunk:${input.questionId}:${index}`), sourceSha256: canonicalSha256(current), turns: Object.freeze(current) })); current = []; bytes = 0; } current.push(turn); bytes += renderedBytes; }
  if (current.length) { const index = chunks.length; chunks.push(Object.freeze({ chunkId: sha256Hex(`chunk:${input.questionId}:${index}`), sourceSha256: canonicalSha256(current), turns: Object.freeze(current) })); }
  return validateMem0SelectedCorpus({ protocol: "oh.memory.mem0-selected-corpus.v1", dataset: "longmemeval-s", partition: "development", corpusId: sha256Hex(`corpus:${input.questionId}`), corpusSha256: canonicalSha256(chunks.map(chunk => ({ chunkId: chunk.chunkId, sourceSha256: chunk.sourceSha256 }))), chunks, sourceReceiptSha256: input.sourceReceiptSha256 });
}
