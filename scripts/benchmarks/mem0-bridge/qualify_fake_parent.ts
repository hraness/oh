/** No-network qualification of the real Python SDK through the production TS
 * dispatcher and typed ledger. Every provider response/credential is synthetic.
 * Source admission is a separately pinned prepareMem0OneCorpusQualification receipt. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalSha256, isPlainRecord, sha256Hex } from "../../../src/canonical";
import { evolutionPin, readEvolutionPin, type EvolutionPin } from "../evolution-budget";
import { createMem0RpcDispatcher, startMem0Worker, validateMem0SelectedCorpus, type Mem0SourceChunk } from "../mem0-parent";
import { openMem0Ledger, type Mem0BridgePolicy, type Mem0Request, type Mem0Fetcher } from "../mem0-ledger";

export async function qualifyMem0FakeParent(input: Readonly<{ sourceReceipt: EvolutionPin; python: string; output: string }>) {
  const sourcePin = evolutionPin(input.sourceReceipt), raw = await readEvolutionPin(sourcePin, 40 * 1024 * 1024);
  const receipt: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  assert(isPlainRecord(receipt)); const { receiptSha256, ...payload } = receipt;
  assert.equal(sha256Hex(JSON.stringify(payload)), receiptSha256);
  assert.equal(receipt.protocol, "oh.memory.mem0-one-corpus-qualification.v1");
  assert.equal(receipt.status, "prepared-no-dispatch"); assert.equal(receipt.physicalCalls, 0);
  const corpus = validateMem0SelectedCorpus(receipt.corpus), started = performance.now();
  assert.equal(corpus.sourceReceiptSha256, receipt.sourceReceiptSha256);
  assert.equal(resolve(input.python), input.python); assert.equal(resolve(input.output), input.output);
  const runtimeRaw = await promisify(execFile)(input.python, ["-c", "import hashlib, importlib.metadata as m, json, pathlib, sys; d=m.distribution('mem0ai'); print(json.dumps({'python':sys.version,'mem0':d.version,'qdrant':m.version('qdrant-client'),'source':json.loads(d.read_text('direct_url.json')),'memoryMainSha256':hashlib.sha256(pathlib.Path(d.locate_file('mem0/memory/main.py')).read_bytes()).hexdigest()}))"], { timeout: 5_000, maxBuffer: 16_384, env: { PATH: process.env.PATH ?? "" } });
  const runtime = JSON.parse(runtimeRaw.stdout); assert.equal(runtime.mem0, "2.0.20"); assert.equal(runtime.qdrant, "1.19.0");
  assert.equal(runtime.source.vcs_info.commit_id, "9a7924befd7026e41e445ba809370009e5e985a6");
  const directory = await realpath(await mkdtemp(join(tmpdir(), "mem0-real-sdk-fake-parent-")));
  const pin = async (name: string, value: unknown) => { const path = join(directory, name), bytes = Buffer.from(JSON.stringify(value)); await writeFile(path, bytes, { mode: 0o600, flag: "wx" }); return { path, sha256: sha256Hex(bytes) }; };
  const workerDirectory = join(directory, "worker"), stateDirectory = join(directory, "state"), ledgerDirectory = join(directory, "ledger");
  let ledger: Awaited<ReturnType<typeof openMem0Ledger>> | null = null, worker: Awaited<ReturnType<typeof startMem0Worker>> | null = null;
  try {
    await Promise.all([mkdir(workerDirectory, { mode: 0o700 }), mkdir(stateDirectory, { mode: 0o700 }), mkdir(ledgerDirectory, { mode: 0o700 })]);
    await copyFile(join(import.meta.dir, "mem0_bridge_worker.py"), join(workerDirectory, "mem0_bridge_worker.py"));
    // Installed before SDK import; attempted network terminates the child and
    // leaves its admitted request charged rather than supplying a fake success.
    await writeFile(join(workerDirectory, "sitecustomize.py"), "import os, socket\ndef blocked(*args, **kwargs): os._exit(81)\nsocket.socket.connect = blocked\nsocket.socket.connect_ex = blocked\n", { mode: 0o600 });
    const llmProfile = { id: "mem0-fake-extract", kind: "llm", model: "openai/fake-extract", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions", maxInputTokens: 100_000, maxOutputTokens: 2_048, embeddingDimensions: null, timeoutMs: 5_000, inputNanodollarsPerToken: 50, outputNanodollarsPerToken: 400 } as const;
    const embeddingProfile = { id: "mem0-fake-embed", kind: "embedding", model: "openai/fake-embed", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/embeddings", maxInputTokens: 8_192, maxOutputTokens: 0, embeddingDimensions: 1_536, timeoutMs: 5_000, inputNanodollarsPerToken: 20, outputNanodollarsPerToken: 0 } as const;
    const identity = canonicalSha256({ protocol: "oh.memory.mem0-bridge-policy.v1", llmProfile, embeddingProfile });
    const runSha256 = canonicalSha256({ protocol: "oh.memory.mem0-parent-run.v1", policyIdentitySha256: identity, corpusSha256: corpus.corpusSha256, sourceReceiptSha256: corpus.sourceReceiptSha256 });
    const policy: Mem0BridgePolicy = { protocol: "oh.memory.mem0-bridge-policy.v1", runSha256, namespace: canonicalSha256({ protocol: "oh.memory.mem0-parent-namespace.v1", runSha256 }), llmProfile, embeddingProfile };
    const historical = join(directory, "synthetic-history.jsonl"); await writeFile(historical, "", { mode: 0o600 });
    const authAuthority = await pin("synthetic-auth.json", { schema: "oh.gateway-v3-authority.v1", project: "test", scope: "scope", environment: "development" });
    const campaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic-no-network", storeDirectory: join(directory, "unused-campaign-store"), approval: "Synthetic fixture only: fake fetch, no provider permission", additionalBudgetMicros: 100, maximumCalls: 10, historicalExposureMicros: 0, historicalLedgers: [{ path: historical, sha256: sha256Hex(""), bytes: 0 }], authAuthority };
    const campaignPin = await pin("synthetic-campaign.json", campaign), policyPin = await pin("synthetic-policy.json", policy);
    const antecedentAccountingPin = await pin("synthetic-accounting.json", { protocol: "oh.memory.mem0-antecedent-accounting.v1", campaignPin, campaignSha256: canonicalSha256(campaign), historicalExposureMicros: 0, completedCampaignExposureMicros: 17, cumulativeExposureMicros: 17 });
    const authority = { protocol: "oh.memory.mem0-ledger-authority.v1", ledgerId: "synthetic-no-network", directory: ledgerDirectory, additionalBudgetMicros: 1_000_000, maximumCalls: 1_000, policyPins: [policyPin], antecedentAccountingPin } as const;
    ledger = await openMem0Ledger(authority);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"), now = Math.floor(Date.now() / 1_000);
    const token = `${encode({ alg: "RS256" })}.${encode({ sub: "owner:scope:project:test:environment:development", aud: "https://vercel.com/scope", iss: "https://oidc.vercel.com/scope", iat: now, exp: now + 600 })}.synthetic`;
    const query = "Find the synthetic qualification facts.";
    let activeChunk: Mem0SourceChunk | null = null, activeChunkIndex = -1, llmCalls = 0, ingestEmbeddings = 0, queryEmbeddings = 0;
    const ingestedChunkIds: string[] = [], llmChunkIds: string[] = [], sourceSearchChunkIds: string[] = [], calls: { endpoint: string; bodySha256: string; responseSha256: string }[] = [];
    const fact = (index: number) => `Synthetic qualification fact ${index}.`;
    const fetcher: Mem0Fetcher = async (endpoint, init) => {
      assert.equal(init?.method, "POST"); assert.equal(init.redirect, "error"); assert.equal(typeof init.body, "string");
      assert(calls.length < 1_000); const body = JSON.parse(init.body as string) as Record<string, any>;
      assert.deepEqual(body.providerOptions, { gateway: { only: ["openai"], order: ["openai"] } });
      const embedding = String(endpoint).endsWith("/embeddings"), profile = embedding ? embeddingProfile : llmProfile;
      assert.equal(String(endpoint), profile.endpoint); assert.equal(body.model, profile.model);
      const gateway = { routing: { finalProvider: profile.provider, originalModelId: profile.model, canonicalSlug: profile.model }, cost: 0.000002 };
      let response: unknown;
      if (embedding) {
        assert.equal(body.encoding_format, "float");
        if (activeChunk === null) { assert.equal(body.input, query); queryEmbeddings++; }
        else { ingestEmbeddings++; if (body.input !== fact(activeChunkIndex)) { for (const turn of activeChunk.turns) assert(String(body.input).includes(`${turn.role}: [${turn.date}] ${turn.text}`)); sourceSearchChunkIds.push(activeChunk.chunkId); } }
        response = { object: "list", model: profile.model, providerMetadata: { gateway }, usage: { prompt_tokens: 2, total_tokens: 2 }, data: [{ index: 0, embedding: Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0) }] };
      } else {
        assert(activeChunk !== null); assert.equal(body.messages.length, 2); assert.equal(body.messages[0].role, "system"); assert.equal(body.messages[1].role, "user");
        assert.deepEqual(body.response_format, { type: "json_object" });
        for (const turn of activeChunk.turns) assert(String(body.messages[1].content).includes(`${turn.role}: [${turn.date}] ${turn.text}`));
        llmCalls++; llmChunkIds.push(activeChunk.chunkId);
        response = { model: profile.model, providerMetadata: { gateway }, usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }, choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ memory: [{ event: "ADD", text: fact(activeChunkIndex) }] }), refusal: null } }] };
      }
      const responseBytes = Buffer.from(JSON.stringify(response)); calls.push({ endpoint: String(endpoint), bodySha256: sha256Hex(init.body as string), responseSha256: sha256Hex(responseBytes) });
      return new Response(responseBytes, { status: 200 });
    };
    const dispatcher = createMem0RpcDispatcher({ policy, corpus, ledger, credential: { token, auth: { method: "project-oidc", project: "test", scope: "scope", environment: "development" } }, fetcher });
    worker = await startMem0Worker({ command: [input.python, "-m", "mem0_bridge_worker"], workerDirectory, mem0Directory: stateDirectory, dispatcher, corpus });
    assert.deepEqual(await worker.prepare(), { prepared: true });
    for (const [index, chunk] of corpus.chunks.entries()) {
      activeChunk = chunk; activeChunkIndex = index; assert.deepEqual(await worker.add(chunk.chunkId), { count: 1 }); ingestedChunkIds.push(chunk.chunkId);
    }
    activeChunk = null;
    const found = await worker.search(sha256Hex(query), query);
    assert(Array.isArray(found.results) && found.results.length === Math.min(50, corpus.chunks.length));
    for (const row of found.results) {
      assert(isPlainRecord(row) && isPlainRecord(row.metadata)); const metadata = row.metadata; const chunk = corpus.chunks.find(item => item.chunkId === metadata.chunkId);
      assert(chunk); assert.equal(row.metadata.sourceDigest, chunk.sourceSha256); assert.equal(row.memory, fact(corpus.chunks.indexOf(chunk)));
    }
    const custody = await worker.close(); worker = null; assert(custody?.graceful && custody.code === 0 && custody.signal === null);
    const summary = ledger.summary(); assert.equal(summary.calls, calls.length); assert.equal(queryEmbeddings, 1);
    assert.equal(llmCalls, corpus.chunks.length); assert.equal(ingestEmbeddings, corpus.chunks.length * 2);
    assert.deepEqual(ingestedChunkIds, corpus.chunks.map(chunk => chunk.chunkId)); assert.deepEqual(llmChunkIds, ingestedChunkIds); assert.deepEqual(sourceSearchChunkIds, ingestedChunkIds);
    const events = (await readFile(join(ledgerDirectory, "ledger.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
    const requests = events.filter(event => event.kind === "reserved").map(event => event.request as Mem0Request);
    assert.equal(events.length, calls.length * 3); assert.equal(events.filter(event => event.kind === "settled").length, calls.length);
    assert.equal(summary.exposureMicros, calls.length * 2); assert.equal(summary.combinedExposureMicros, summary.exposureMicros + 17);
    for (const request of requests) assert.equal(ledger.lookup(request).kind, "hit");
    const ledgerSha256 = sha256Hex(await readFile(join(ledgerDirectory, "ledger.jsonl")));
    await ledger.close(); ledger = await openMem0Ledger(authority); assert.deepEqual(ledger.summary(), summary);
    for (const request of requests) assert.equal(ledger.lookup(request).kind, "hit");
    await ledger.close(); ledger = null;
    const parts = corpus.chunks.flatMap(chunk => chunk.turns);
    const result = { protocol: "oh.memory.mem0-real-sdk-fake-parent-qualification.v1", status: "passed", sourceReceipt: sourcePin,
      corpusSha256: corpus.corpusSha256, sourceReceiptSha256: corpus.sourceReceiptSha256, originalTurns: new Set(parts.map(part => part.sourceTurnId)).size,
      sourceParts: parts.length, sourceBytes: parts.reduce((sum, part) => sum + Buffer.byteLength(part.text), 0), chunks: corpus.chunks.length,
      maximumDatedChunkBytes: Math.max(...corpus.chunks.map(chunk => chunk.turns.reduce((sum, part) => sum + Buffer.byteLength(`[${part.date}] ${part.text}`), 0))),
      ingestedChunkIdsSha256: canonicalSha256(ingestedChunkIds), callsSha256: canonicalSha256(calls), ledgerSha256,
      fakeCalls: { total: calls.length, llm: llmCalls, ingestEmbedding: ingestEmbeddings, queryEmbedding: queryEmbeddings },
      results: found.results.length, replayedSettledCalls: requests.length, simulatedExposureMicros: summary.exposureMicros,
      physicalProviderCalls: 0, actualCostMicros: 0, runtime, socketGuard: true, custody, elapsedMs: performance.now() - started,
      qualification: "Real Mem0 SDK and local Qdrant, complete admitted source through TS custody, deterministic fake provider only; no answer-quality or live-route qualification." };
    await rm(directory, { recursive: true, force: true });
    await mkdir(dirname(input.output), { recursive: true, mode: 0o700 });
    const output = { ...result, temporaryStateRemoved: true, receiptSha256: canonicalSha256({ ...result, temporaryStateRemoved: true }) };
    await writeFile(input.output, JSON.stringify(output, null, 2) + "\n", { mode: 0o600, flag: "wx" }); return output;
  } finally { try { if (worker !== null) await worker.close(); } finally { if (ledger !== null) await ledger.close(); await rm(directory, { recursive: true, force: true }); } }
}
if (import.meta.main) {
  const args = process.argv.slice(2); assert.equal(args.length, 8); assert.deepEqual(args.filter((_, i) => i % 2 === 0), ["--source-receipt", "--source-receipt-sha256", "--python", "--output"]);
  console.log(JSON.stringify(await qualifyMem0FakeParent({ sourceReceipt: { path: args[1]!, sha256: args[3]! }, python: args[5]!, output: args[7]! })));
}
