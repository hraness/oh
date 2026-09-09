import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { invokeMem0Request, mem0ResponseStorageUpperBounds, validateMem0BatchStorageAdmission, makeMem0BatchEmbeddingRequest, makeMem0EmbeddingRequest, makeMem0LlmRequest, openMem0Ledger, parseMem0BatchEmbeddingResponse, parseMem0Response, splitMem0EmbeddingBatch, validateMem0BatchEmbeddingRequest, validateMem0Request, type Mem0AnyRequest } from "../scripts/benchmarks/mem0-ledger";
const policy = { protocol: "oh.memory.mem0-bridge-policy.v1", runSha256: "a".repeat(64), namespace: "b".repeat(64),
  llmProfile: { id: "mem0-test-extract", kind: "llm", model: "openai/test-extract", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions", maxInputTokens: 100_000, maxOutputTokens: 100, embeddingDimensions: null, timeoutMs: 1000, inputNanodollarsPerToken: 50, outputNanodollarsPerToken: 400 },
  embeddingProfile: { id: "mem0-test-embed", kind: "embedding", model: "openai/test-embed", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/embeddings", maxInputTokens: 8192, maxOutputTokens: 0, embeddingDimensions: 3, timeoutMs: 1000, inputNanodollarsPerToken: 20, outputNanodollarsPerToken: 0 } } as const;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
function envelope(request: Mem0AnyRequest, data: unknown) { return { object: "list", model: request.profile.model, providerMetadata: { gateway: { routing: { finalProvider: request.profile.provider, originalModelId: request.profile.model, canonicalSlug: request.profile.model }, cost: 0.000002 } }, usage: { prompt_tokens: 2, total_tokens: 2 }, data }; }
const legacy = makeMem0EmbeddingRequest(policy, 0, "query-embed", "alpha\nbeta");
const single = [{ index: 0, embedding: [0.1, 0.2, 0.3] }];
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(cap = 1_000_000, maximumCalls = 5) {
 const directory = await realpath(await mkdtemp(join(tmpdir(), "mem0-batch-test-"))); directories.push(directory);
 const pin = async (name: string, value: unknown) => { const path = join(directory, name), raw = encode(value); await writeFile(path, raw, { mode: 0o600 }); return { path, sha256: sha256Hex(raw) }; };
 const history = join(directory, "history.jsonl"); await writeFile(history, "", { mode: 0o600 });
 const authAuthority = await pin("auth.json", { schema: "oh.gateway-v3-authority.v1", project: "test", scope: "scope", environment: "development" });
 const campaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic", storeDirectory: join(directory, "unused-store"), approval: "Synthetic fake transport only", additionalBudgetMicros: 100, maximumCalls: 10, historicalExposureMicros: 0, historicalLedgers: [{ path: history, sha256: sha256Hex(""), bytes: 0 }], authAuthority };
 const campaignPin = await pin("campaign.json", campaign), policyPin = await pin("policy.json", policy), antecedentAccountingPin = await pin("accounting.json", { protocol: "oh.memory.mem0-antecedent-accounting.v1", campaignPin, campaignSha256: canonicalSha256(campaign), historicalExposureMicros: 0, completedCampaignExposureMicros: 17, cumulativeExposureMicros: 17 });
 const authority = { protocol: "oh.memory.mem0-ledger-authority.v1", ledgerId: "synthetic", directory, additionalBudgetMicros: cap, maximumCalls, policyPins: [policyPin], antecedentAccountingPin };
 return { directory, authority, ledger: await openMem0Ledger(authority) };
}
function credential() { const now = Math.floor(Date.now() / 1000), b64 = (v: unknown) => encode(v).toString("base64url"); return { token: `${b64({alg:"RS256"})}.${b64({sub:"owner:scope:project:test:environment:development",aud:"https://vercel.com/scope",iss:"https://oidc.vercel.com/scope",iat:now,exp:now+600})}.synthetic`, auth: { method: "project-oidc", project: "test", scope: "scope", environment: "development" } } as const; }

test("batch transport preserves text bytes, stable splits, positive shared reservation and distinct protocol", () => {
 const request = makeMem0BatchEmbeddingRequest(policy, 1, "query-embed", ["alpha\nbeta", "alpha\nbeta"]);
 expect(request.body.input).toEqual(["alpha\nbeta", "alpha\nbeta"]); expect(request.inputCount).toBe(2); expect(request.protocol).toBe("oh.memory.mem0-call.v2");
 expect(request.reservationMicros).toBe(164); expect(validateMem0BatchEmbeddingRequest(request)).toEqual(request);
 expect(() => validateMem0Request(request)).toThrow(); expect(() => validateMem0BatchEmbeddingRequest(legacy)).toThrow();
 expect(() => makeMem0BatchEmbeddingRequest(policy, 1, "extract", ["alpha"])).toThrow();
 expect(() => makeMem0BatchEmbeddingRequest(policy, 1, "query-embed", Array(101).fill("a"))).toThrow();
 expect(() => makeMem0BatchEmbeddingRequest(policy, 1, "query-embed", [])).toThrow();
 const input = ["x".repeat(3000), "y".repeat(3000), "z".repeat(3000)]; const groups = splitMem0EmbeddingBatch(policy, input);
 expect(groups.flat()).toEqual(input); expect(groups.length).toBe(2); expect(() => splitMem0EmbeddingBatch(policy, ["ok", "x".repeat(8192)])).toThrow();
});

test("strict batch vectors are matched by exact unique indices and retain order", () => {
 const request = makeMem0BatchEmbeddingRequest(policy, 2, "ingest-embed", ["alpha", "beta"]);
 const valid = envelope(request, [{ object: "embedding", index: 1, embedding: [4,5,6] }, { index: 0, embedding: [1,2,3] }]);
 expect(parseMem0BatchEmbeddingResponse(encode(valid), request).value.embeddings).toEqual([[1,2,3],[4,5,6]]);
 for (const data of [single, [...single, ...single], [{index:0,embedding:[1,2]},{index:1,embedding:[3,4,5]}], [{index:0,embedding:[1,2,3]},{index:2,embedding:[1,2,3]}], [{index:0,embedding:[true,2,3]},{index:1,embedding:[1,2,3]}]]) expect(() => parseMem0BatchEmbeddingResponse(encode({...valid,data}), request)).toThrow();
 expect(() => parseMem0BatchEmbeddingResponse(encode({...valid,usage:{...valid.usage,unrecognized:1}}),request)).toThrow("ambiguous usage");
 expect(() => parseMem0BatchEmbeddingResponse(encode({...valid,model:"other"}),request)).toThrow("route");
 expect(() => validateMem0BatchEmbeddingRequest({...request,inputCount:1})).toThrow("reconstruction");
});

test("batch-only response capacity does not widen legacy single-vector response admission", () => {
 const largePolicy={...policy,embeddingProfile:{...policy.embeddingProfile,embeddingDimensions:1536}};
 const request=makeMem0BatchEmbeddingRequest(largePolicy,3,"ingest-embed",Array(100).fill("a"));
 const data=Array.from({length:100},(_,index)=>({index,embedding:Array(1536).fill(0.12345678901234567)})), raw=encode(envelope(request,data));
 expect(raw.length).toBeGreaterThan(1_048_576); expect(parseMem0BatchEmbeddingResponse(raw,request).value.embeddings).toHaveLength(100);
 expect(()=>parseMem0Response(Buffer.concat([encode(envelope(legacy,single)),Buffer.alloc(1_048_576,32)]),legacy)).toThrow("response bytes");
});

test("V1 and V2 share one cap, exact replay, and malformed batches cannot retry",async()=>{
 const f=await fixture(), batch=makeMem0BatchEmbeddingRequest(policy,4,"ingest-embed",["alpha","beta"]), auth=credential();let fetches=0;
 const fetcher=async()=>{fetches++;return new Response(encode(envelope(batch,[{index:1,embedding:[4,5,6]},{index:0,embedding:[1,2,3]}])))};
 const result=await invokeMem0Request({request:batch,ledger:f.ledger,credential:auth,fetcher});
 expect(result.kind).toBe("embedding-batch");expect(result.value.embeddings).toEqual([[1,2,3],[4,5,6]]);
 await invokeMem0Request({request:legacy,ledger:f.ledger,credential:auth,fetcher:async()=>new Response(encode(envelope(legacy,single)))});
 const before=f.ledger.summary(); expect(before).toMatchObject({calls:2,exposureMicros:4,antecedentExposureMicros:17,combinedExposureMicros:21});await f.ledger.close();
 const reopened=await openMem0Ledger(f.authority);expect(reopened.summary()).toEqual(before);expect(await invokeMem0Request({request:batch,ledger:reopened,credential:auth,fetcher})).toEqual(result);expect(fetches).toBe(1);
 const invalid=makeMem0BatchEmbeddingRequest(policy,5,"ingest-embed",["one","two"]);
 await expect(invokeMem0Request({request:invalid,ledger:reopened,credential:auth,fetcher:async()=>{fetches++;return new Response(encode(envelope(invalid,single)))}})).rejects.toThrow("vector count");
 expect(reopened.lookup(invalid)).toEqual({kind:"occupied",state:"captured"});expect(reopened.summary().exposureMicros).toBe(4+invalid.reservationMicros);await reopened.close();
 const second=await openMem0Ledger(f.authority);await expect(invokeMem0Request({request:invalid,ledger:second,credential:auth,fetcher})).rejects.toThrow("cannot be retried");expect(fetches).toBe(2);await second.close();
});

test("concurrent mixed-format admissions cannot multiply a shared allowance",async()=>{
 const f=await fixture(164,2), batch=makeMem0BatchEmbeddingRequest(policy,6,"ingest-embed",["a","b"]);
 const result=await Promise.allSettled([f.ledger.admit(legacy),f.ledger.admit(batch)]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.ledger.summary()).toMatchObject({calls:1,exposureMicros:164});await f.ledger.close();
});

test("published V1 profile, request/body and parsed-response hashes remain byte-identical",()=>{
 expect(legacy.requestSha256).toBe("59cddc822020ad870669c216ff93eea152d301a7a380e0076432f8b49583527e");
 expect(String(canonicalSha256(parseMem0Response(encode(envelope(legacy,single)),legacy)))).toBe("e016522bd3a4110794d4a15d5dbefdc10c484378dac6f9a5e41f27934693ae20");
 const request=makeMem0LlmRequest(policy,7,[{role:"system",content:"Extract."},{role:"user",content:"Synthetic source."}]);
 expect(request.requestSha256).toBe("65a0f7be2448861d85eddac140e37c55e5bd1e8bf430101ebf0a746054dac0e9");expect(String(canonicalSha256(request.body))).toBe("2eebfe885b65884af17120e3c40b0adc182d615896479a881fec0683582fceb7");expect(request.profileSha256).toBe("93e907115ffeb2a066b1a9d6362b009c35e6716224db8ef626403ae4a0a304fa");
});

test("batch opt-in keeps ordinary inbound and outbound worker frames at1MiB", async () => {
 const { startMem0Worker, validateMem0SelectedCorpus } = await import("../scripts/benchmarks/mem0-parent");
 const turns=[{turnId:sha256Hex('part'),sourceTurnId:sha256Hex('turn'),sourceTurnSha256:sha256Hex('alpha'),sessionId:sha256Hex('session'),date:'2024-01-01',role:'user',text:'alpha',utf8Start:0,utf8End:5,sourceUtf8Bytes:5}];
 const chunks=[{chunkId:sha256Hex('chunk'),sourceSha256:canonicalSha256(turns),turns}];
 const source=validateMem0SelectedCorpus({protocol:'oh.memory.mem0-selected-corpus.v1',dataset:'longmemeval-s',partition:'development',corpusId:sha256Hex('corpus'),sourceReceiptSha256:sha256Hex('source'),chunks,corpusSha256:canonicalSha256(chunks.map(({chunkId,sourceSha256})=>({chunkId,sourceSha256})))});
 for(const direction of ['incoming','outgoing']) {
  let dispatched=0,closed=false;
  const dispatcher={derivation:{corpusSha256:source.corpusSha256,namespace:policy.namespace},batchEmbeddings:true,embeddingDimensions:3,maximumCallTimeoutMs:1000,abort(){},beginIngest(){},endActivity(){},async close(){closed=true},async handle(){dispatched++;return {kind:'rpc-result',id:'one',ok:true,result:{content:'x'.repeat(1_048_576)}}}} as unknown as Parameters<typeof startMem0Worker>[0]['dispatcher'];
  const code=`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const c=JSON.parse(line);if(c.kind==='prepare')console.log(JSON.stringify({kind:'result',id:c.id,ok:true,result:{prepared:true}}));else if(c.kind==='add')console.log(JSON.stringify(${direction==='incoming'?"{kind:'result',id:c.id,ok:true,result:{text:'x'.repeat(1_048_576)}}":"{kind:'rpc',id:'one',operation:'llm',namespace:c.namespace,payload:{}}"}));});`;
  const worker=await startMem0Worker({command:[process.execPath,'-e',code],workerDirectory:'/tmp',mem0Directory:'/tmp',dispatcher,corpus:source});
  try{await worker.prepare();await expect(worker.add(chunks[0]!.chunkId)).rejects.toThrow(direction==='incoming'?'worker frame JSON':'outbound worker frame bound')}finally{await worker.close()}
  expect(dispatched).toBe(direction==='incoming'?0:1);expect(closed).toBe(true);
 }
},10000);

test("derived storage headroom covers exact new rows and outstanding replay states before admission",()=>{
 const batch=makeMem0BatchEmbeddingRequest(policy,8,'ingest-embed',['alpha','beta']),bounds=mem0ResponseStorageUpperBounds(batch);
 const initial=validateMem0BatchStorageAdmission({ledgerBytes:0,pending:[],request:batch});
 const reservationBytes=encode({kind:'reserved',request:batch}).length+1;
 expect(initial).toBe(reservationBytes+bounds.captureBytes+bounds.settlementBytes);
 const capacity=1000*(Math.ceil(1_048_576*4/3)+16_384);
 expect(validateMem0BatchStorageAdmission({ledgerBytes:capacity-initial,pending:[],request:batch})).toBe(capacity);
 expect(()=>validateMem0BatchStorageAdmission({ledgerBytes:capacity-initial+1,pending:[],request:batch})).toThrow('headroom');
 const legacyBounds=mem0ResponseStorageUpperBounds(legacy);
 expect(validateMem0BatchStorageAdmission({ledgerBytes:17,pending:[{request:legacy,state:'reserved'}],request:batch})).toBe(17+initial+legacyBounds.captureBytes+legacyBounds.settlementBytes);
 expect(validateMem0BatchStorageAdmission({ledgerBytes:17,pending:[{request:legacy,state:'captured'}],request:batch})).toBe(17+initial+legacyBounds.settlementBytes);
 const nextSingle=validateMem0BatchStorageAdmission({ledgerBytes:0,pending:[],request:legacy});
 expect(()=>validateMem0BatchStorageAdmission({ledgerBytes:capacity-nextSingle,pending:[{request:batch,state:'captured'}],request:legacy})).toThrow('headroom');
 const response=encode(envelope(batch,[{index:0,embedding:[-.0000012345678901234567,Number.MAX_VALUE,-Number.MIN_VALUE]},{index:1,embedding:[1,2,3]}]));
 const result=parseMem0BatchEmbeddingResponse(response,batch);
 const captured={kind:'captured',requestSha256:batch.requestSha256,rawBase64:response.toString('base64'),transport:{httpStatus:200,complete:true,receivedBytes:response.length,error:null,serviceMs:.0000012345678901234567}};
 expect(encode(captured).length+1).toBeLessThanOrEqual(bounds.captureBytes);
 expect(encode({kind:'settled',requestSha256:batch.requestSha256,result}).length+1).toBeLessThanOrEqual(bounds.settlementBytes);
 const fullBatch=makeMem0BatchEmbeddingRequest({...policy,embeddingProfile:{...policy.embeddingProfile,embeddingDimensions:1536}},9,'ingest-embed',Array(100).fill('x'));
 expect(mem0ResponseStorageUpperBounds(fullBatch).settlementBytes).toBeGreaterThan(100*1536*32);
});
