import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createMem0DurationClock, MEM0_ONE_CORPUS_DURATION_POLICY, MEM0_QUALIFICATION_DURATION_POLICY, validateMem0DurationPolicy } from "../scripts/benchmarks/mem0-duration";
import { startMem0Worker, validateMem0SelectedCorpus, type createMem0RpcDispatcher } from "../scripts/benchmarks/mem0-parent";

test("explicit live policy gives149 commands a bounded30-minute lifecycle; defaults remain120seconds", () => {
  let now = 0; const live = createMem0DurationClock(MEM0_ONE_CORPUS_DURATION_POLICY, () => now), old = createMem0DurationClock(MEM0_QUALIFICATION_DURATION_POLICY, () => now);
  for (let index = 0; index < 149; index++) { now = index * 10_000; expect(live.beginCommand()).toBe(180_000); }
  expect(old.beginCommand()).toBe(0); now = 1_790_000; expect(live.beginCommand()).toBe(10_000); now += 10_000; expect(live.remaining()).toBe(0);
  expect(live.policySha256).toBe(canonicalSha256(MEM0_ONE_CORPUS_DURATION_POLICY));
  expect(() => validateMem0DurationPolicy({ ...MEM0_ONE_CORPUS_DURATION_POLICY, lifecycleMs: 1_800_001 })).toThrow("bounded");
  expect(() => validateMem0DurationPolicy({ ...MEM0_ONE_CORPUS_DURATION_POLICY, commandMs: NaN })).toThrow("bounded");
  expect(() => validateMem0DurationPolicy({ ...MEM0_ONE_CORPUS_DURATION_POLICY, retry: true })).toThrow("bounded");
});
function corpus() {
  const turns = [{ turnId: sha256Hex("part"), sourceTurnId: sha256Hex("turn"), sourceTurnSha256: sha256Hex("alpha"), sessionId: sha256Hex("session"), date: "2024-01-01", role: "user", text: "alpha", utf8Start: 0, utf8End: 5, sourceUtf8Bytes: 5 }];
  const chunks = [{ chunkId: sha256Hex("chunk"), sourceSha256: canonicalSha256(turns), turns }];
  return validateMem0SelectedCorpus({ protocol: "oh.memory.mem0-selected-corpus.v1", dataset: "longmemeval-s", partition: "development", corpusId: sha256Hex("corpus"), corpusSha256: canonicalSha256(chunks.map(({ chunkId, sourceSha256 }) => ({ chunkId, sourceSha256 }))), chunks, sourceReceiptSha256: sha256Hex("receipt") });
}
test("command deadline aborts an outstanding dispatcher and kills then drains the real child", async () => {
  const source = corpus(), namespace = sha256Hex("namespace"); let aborted = false, closed = false, finish: (() => void) | null = null;
  const dispatcher = { derivation: { corpusSha256: source.corpusSha256, namespace }, embeddingDimensions: 3, maximumCallTimeoutMs: 10,
    beginIngest() {}, endActivity() {}, abort() { aborted = true; finish?.(); },
    async handle() { await new Promise<void>(resolve => { finish = resolve; }); return {}; }, async close() { closed = true; },
  } as unknown as ReturnType<typeof createMem0RpcDispatcher>;
  const code = `const rl=require('node:readline').createInterface({input:process.stdin}); rl.on('line',line=>{const c=JSON.parse(line);if(c.kind==='prepare')console.log(JSON.stringify({kind:'result',id:c.id,ok:true,result:{prepared:true}}));else if(c.kind==='add')console.log(JSON.stringify({kind:'rpc',id:'one',operation:'embed',namespace:c.namespace,payload:{text:'alpha',action:'search'}}));});`;
  const policy = { ...MEM0_ONE_CORPUS_DURATION_POLICY, commandMs: 250, lifecycleMs: 1000, shutdownGraceMs: 25, killGraceMs: 25, drainMs: 100 };
  const worker = await startMem0Worker({ command: [process.execPath, "-e", code], workerDirectory: "/tmp", mem0Directory: "/tmp", dispatcher, corpus: source, durationPolicy: policy });
  try { await worker.prepare(); await expect(worker.add(source.chunks[0]!.chunkId)).rejects.toThrow("RPC deadline"); }
  finally { await worker.close(); }
  expect(aborted).toBe(true); expect(closed).toBe(true); expect(worker.durationPolicySha256).toBe(canonicalSha256(policy));
}, 5000);

test("RPC rejection preserves its original cause and value while aborting and draining the child", async () => {
  const source = corpus(), namespace = sha256Hex("namespace"), cause = new Error("synthetic provider metadata"), failure = new TypeError("invalid gateway cost", { cause });
  for (const rejection of [failure, "synthetic non-Error rejection"]) {
    let aborted = false, closed = false, ended = false;
    const dispatcher = { derivation: { corpusSha256: source.corpusSha256, namespace }, embeddingDimensions: 3, maximumCallTimeoutMs: 10,
      beginIngest() {}, endActivity() { ended = true; }, abort() { aborted = true; },
      async handle() { throw rejection; }, async close() { closed = true; },
    } as unknown as ReturnType<typeof createMem0RpcDispatcher>;
    const code = `const rl=require('node:readline').createInterface({input:process.stdin}); rl.on('line',line=>{const c=JSON.parse(line);if(c.kind==='prepare')console.log(JSON.stringify({kind:'result',id:c.id,ok:true,result:{prepared:true}}));else if(c.kind==='add')console.log(JSON.stringify({kind:'rpc',id:'one',operation:'embed',namespace:c.namespace,payload:{text:'alpha',action:'search'}}));});`;
    const worker = await startMem0Worker({ command: [process.execPath, "-e", code], workerDirectory: "/tmp", mem0Directory: "/tmp", dispatcher, corpus: source });
    let actual: unknown;
    try { await worker.prepare(); try { await worker.add(source.chunks[0]!.chunkId); } catch (error) { actual = error; } }
    finally { await worker.close(); }
    expect(actual).toBe(rejection); expect(aborted).toBe(true); expect(ended).toBe(true); expect(closed).toBe(true);
  }
  expect(failure.cause).toBe(cause);
}, 5000);
