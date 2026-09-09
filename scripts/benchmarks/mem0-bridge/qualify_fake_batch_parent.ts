/** Two tiny synthetic corpora through real Mem0/Qdrant and the production TS
 * dispatcher. This never uses a real credential, dataset or provider transport. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalSha256, isPlainRecord, sha256Hex } from "../../../src/canonical";
import { createMem0RpcDispatcher, startMem0Worker, validateMem0SelectedCorpus } from "../mem0-parent";
import { openMem0Ledger, type Mem0AnyRequest, type Mem0BridgePolicy, type Mem0Fetcher } from "../mem0-ledger";

export async function qualifyMem0FakeBatchParent(input: { python: string; output: string }) {
  assert.equal(resolve(input.python), input.python); assert.equal(resolve(input.output), input.output);
  const started = performance.now(), directory = await realpath(await mkdtemp(join(tmpdir(), "mem0-batch-fake-parent-")));
  const runtimeRaw = await promisify(execFile)(input.python, ["-c", "import importlib.metadata as m,json;d=m.distribution('mem0ai');print(json.dumps({'mem0':d.version,'qdrant':m.version('qdrant-client'),'source':json.loads(d.read_text('direct_url.json'))}))"], { timeout: 5000, maxBuffer: 16384, env: { PATH: process.env.PATH ?? "" } });
  const runtime = JSON.parse(runtimeRaw.stdout); assert.equal(runtime.mem0, "2.0.20"); assert.equal(runtime.qdrant, "1.19.0"); assert.equal(runtime.source.vcs_info.commit_id, "9a7924befd7026e41e445ba809370009e5e985a6");
  const text = "Remember alpha, beta and gamma preferences.", turns = [{ turnId: sha256Hex("synthetic-part"), sourceTurnId: sha256Hex("synthetic-turn"), sourceTurnSha256: sha256Hex(text), sessionId: sha256Hex("synthetic-session"), date: "2024-01-01", role: "user", text, utf8Start: 0, utf8End: Buffer.byteLength(text), sourceUtf8Bytes: Buffer.byteLength(text) }];
  const chunks = [{ chunkId: sha256Hex("synthetic-chunk"), sourceSha256: canonicalSha256(turns), turns }];
  const corpus = validateMem0SelectedCorpus({ protocol: "oh.memory.mem0-selected-corpus.v1", dataset: "longmemeval-s", partition: "development", corpusId: sha256Hex("synthetic-corpus"), sourceReceiptSha256: sha256Hex("synthetic-receipt"), chunks, corpusSha256: canonicalSha256(chunks.map(({chunkId,sourceSha256})=>({chunkId,sourceSha256}))) });
  const llmProfile = { id: "mem0-fake-extract", kind: "llm", model: "openai/fake-extract", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions", maxInputTokens: 100000, maxOutputTokens: 2048, embeddingDimensions: null, timeoutMs: 5000, inputNanodollarsPerToken: 50, outputNanodollarsPerToken: 400 } as const;
  const embeddingProfile = { id: "mem0-fake-embed", kind: "embedding", model: "openai/fake-embed", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/embeddings", maxInputTokens: 8192, maxOutputTokens: 0, embeddingDimensions: 1536, timeoutMs: 5000, inputNanodollarsPerToken: 20, outputNanodollarsPerToken: 0 } as const;
  const policyIdentitySha256 = canonicalSha256({protocol:"oh.memory.mem0-bridge-policy.v1",llmProfile,embeddingProfile});
  const runSha256 = canonicalSha256({protocol:"oh.memory.mem0-parent-run.v1",policyIdentitySha256,corpusSha256:corpus.corpusSha256,sourceReceiptSha256:corpus.sourceReceiptSha256});
  const policy: Mem0BridgePolicy = {protocol:"oh.memory.mem0-bridge-policy.v1",runSha256,namespace:canonicalSha256({protocol:"oh.memory.mem0-parent-namespace.v1",runSha256}),llmProfile,embeddingProfile};
  const facts = ["alpha preference", "beta preference", "gamma preference"], query = "alpha preference";
  const vector = (text: string) => Array.from({length:1536},(_,i)=>i===0?1:i===1?(text.includes("alpha")?0:text.includes("beta")?.25:.5):0);
  const results: Record<string, unknown>[] = [];
  try {
    for (const batchEmbeddings of [false, true]) {
      const state = join(directory, batchEmbeddings ? "batch" : "single"); await mkdir(state, {mode:0o700});
      const pin = async (name:string,value:unknown) => {const path=join(state,name),raw=Buffer.from(JSON.stringify(value));await writeFile(path,raw,{mode:0o600,flag:"wx"});return {path,sha256:sha256Hex(raw)}};
      const history=join(state,"synthetic-history.jsonl");await writeFile(history,"",{mode:0o600});
      const authAuthority=await pin("auth.json",{schema:"oh.gateway-v3-authority.v1",project:"test",scope:"scope",environment:"development"});
      const campaign={protocol:"oh.memory.evolution-campaign.v1",campaignId:"synthetic-batch",storeDirectory:join(state,"unused-store"),approval:"Synthetic no-network fixture",additionalBudgetMicros:100,maximumCalls:10,historicalExposureMicros:0,historicalLedgers:[{path:history,sha256:sha256Hex(""),bytes:0}],authAuthority};
      const campaignPin=await pin("campaign.json",campaign),policyPin=await pin("policy.json",policy),antecedentAccountingPin=await pin("accounting.json",{protocol:"oh.memory.mem0-antecedent-accounting.v1",campaignPin,campaignSha256:canonicalSha256(campaign),historicalExposureMicros:0,completedCampaignExposureMicros:17,cumulativeExposureMicros:17});
      const authority={protocol:"oh.memory.mem0-ledger-authority.v1",ledgerId:"synthetic-batch",directory:join(state,"ledger"),additionalBudgetMicros:1000000,maximumCalls:20,policyPins:[policyPin],antecedentAccountingPin};
      let ledger: Awaited<ReturnType<typeof openMem0Ledger>> | null=await openMem0Ledger(authority),worker: Awaited<ReturnType<typeof startMem0Worker>> | null=null;
      try {
        const workerDirectory=join(state,"worker"),mem0Directory=join(state,"memory");await mkdir(workerDirectory,{mode:0o700});await mkdir(mem0Directory,{mode:0o700});
        await copyFile(join(import.meta.dir,"mem0_bridge_worker.py"),join(workerDirectory,"mem0_bridge_worker.py"));await writeFile(join(workerDirectory,"sitecustomize.py"),"import os,socket\ndef blocked(*a,**kw):os._exit(81)\nsocket.socket.connect=blocked\nsocket.socket.connect_ex=blocked\n",{mode:0o600});
        const b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url"),now=Math.floor(Date.now()/1000),token=`${b64({alg:"RS256"})}.${b64({sub:"owner:scope:project:test:environment:development",aud:"https://vercel.com/scope",iss:"https://oidc.vercel.com/scope",iat:now,exp:now+600})}.synthetic`;
        let llmCalls=0,singleCalls=0,batchCalls=0,batchRpc=0; const embeddedTexts:string[]=[];
        const fetcher: Mem0Fetcher=async(endpoint,init)=>{
          assert.equal(init?.method,"POST");assert.equal(typeof init.body,"string");const body=JSON.parse(init.body as string);assert.deepEqual(body.providerOptions,{gateway:{only:["openai"],order:["openai"]}});
          const selected=String(endpoint).endsWith("/embeddings")?embeddingProfile:llmProfile;assert.equal(String(endpoint),selected.endpoint);assert.equal(body.model,selected.model);
          const gateway={routing:{finalProvider:selected.provider,originalModelId:selected.model,canonicalSlug:selected.model},cost:.000002};
          if(selected.kind==="llm") {llmCalls++;assert(String(body.messages[1].content).includes(`user: [2024-01-01] ${text}`));return new Response(JSON.stringify({model:selected.model,providerMetadata:{gateway},usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3},choices:[{finish_reason:"stop",message:{role:"assistant",content:JSON.stringify({memory:facts.map((text,id)=>({id:String(id),text}))}),refusal:null}}]}));}
          const items=Array.isArray(body.input)?body.input:[body.input]; if(Array.isArray(body.input)){batchCalls++;assert(batchEmbeddings);assert.deepEqual(items,facts)}else singleCalls++;
          for(const text of items){assert.equal(typeof text,"string");embeddedTexts.push(text)}
          // Reverse provider rows deliberately: the typed batch parser must
          // reconstruct the exact original text/vector order before the SDK.
          const data=items.map((text:string,index:number)=>({object:"embedding",index,embedding:vector(text)})).reverse();
          return new Response(JSON.stringify({object:"list",model:selected.model,providerMetadata:{gateway},usage:{prompt_tokens:2,total_tokens:2},data}));
        };
        const base=createMem0RpcDispatcher({policy,corpus,ledger,credential:{token,auth:{method:"project-oidc",project:"test",scope:"scope",environment:"development"}},fetcher,batchEmbeddings});
        const dispatcher={...base,async handle(frame:unknown){if(isPlainRecord(frame)&&frame.kind==="rpc-batch")batchRpc++;return base.handle(frame)}};
        worker=await startMem0Worker({command:[input.python,"-m","mem0_bridge_worker"],workerDirectory,mem0Directory,dispatcher,corpus});
        assert.deepEqual(await worker.prepare(),{prepared:true});assert.deepEqual(await worker.add(chunks[0]!.chunkId),{count:3});
        const found=await worker.search(sha256Hex(query),query);assert(Array.isArray(found.results));assert.equal(found.results.length,3);
        assert.deepEqual(found.results.map(row=>(row as {memory:string}).memory),facts);
        for(const row of found.results){assert(isPlainRecord(row)&&isPlainRecord(row.metadata));assert.deepEqual(row.metadata,{chunkId:chunks[0]!.chunkId,sourceDigest:chunks[0]!.sourceSha256})}
        const custody=await worker.close();worker=null;assert(custody?.graceful);
        const summary=ledger.summary();assert.equal(llmCalls,1);assert.equal(singleCalls,batchEmbeddings?2:5);assert.equal(batchCalls,batchEmbeddings?1:0);assert.equal(batchRpc,batchEmbeddings?1:0);assert.equal(summary.calls,batchEmbeddings?4:6);assert.equal(summary.exposureMicros,summary.calls*2);
        const rawLedger=await readFile(join(authority.directory,"ledger.jsonl")),events=rawLedger.toString().trimEnd().split("\n").map(line=>JSON.parse(line));const requests=events.filter(row=>row.kind==="reserved").map(row=>row.request as Mem0AnyRequest);
        assert.equal(requests.filter(r=>r.protocol==="oh.memory.mem0-call.v2").length,batchEmbeddings?1:0);await ledger.close();ledger=await openMem0Ledger(authority);assert.deepEqual(ledger.summary(),summary);for(const request of requests)assert.equal(ledger.lookup(request).kind,"hit");await ledger.close();ledger=null;
        results.push({batchEmbeddings,llmCalls,singleEmbeddingCalls:singleCalls,batchEmbeddingCalls:batchCalls,batchRpc,physicalFakeCalls:summary.calls,embeddedTextsSha256:canonicalSha256(embeddedTexts),searchResult:found,ledgerSha256:sha256Hex(rawLedger),replayedSettledCalls:requests.length,simulatedExposureMicros:summary.exposureMicros,custody});
      } finally {if(worker!==null)await worker.close();if(ledger!==null)await ledger.close()}
    }
    assert.deepEqual(results[0]!.searchResult,results[1]!.searchResult);assert.equal(results[0]!.embeddedTextsSha256,results[1]!.embeddedTextsSha256);
    const result={protocol:"oh.memory.mem0-real-sdk-batch-fake-qualification.v1",runtime,source:"synthetic-only",sourceChunks:1,extractedFacts:3,results,actualProviderCalls:0,actualCostMicros:0,elapsedMs:performance.now()-started,qualification:"Real pinned SDK with deterministic fake responses; same ordered memory/search result, fewer physical fake requests; no live route or answer-quality claim."};
    await writeFile(input.output,JSON.stringify({...result,receiptSha256:canonicalSha256(result)},null,2)+"\n",{mode:0o600,flag:"wx"});return result;
  } finally {await rm(directory,{recursive:true,force:true})}
}
if(import.meta.main){const args=process.argv.slice(2);assert.equal(args.length,4);assert.equal(args[0],"--python");assert.equal(args[2],"--output");console.log(JSON.stringify(await qualifyMem0FakeBatchParent({python:args[1]!,output:args[3]!})))}
