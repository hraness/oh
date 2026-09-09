import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, selectQuestions, selectSplit, type Dataset } from "../scripts/benchmarks/datasets";
import { makeLabPaidReaderPlan } from "../scripts/benchmarks/lab-paid-plan";
import { writeGatewayStudyJson } from "../scripts/benchmarks/gateway-study-store-v3";
import { LEGACY_LAB_PAID_NAMESPACE } from "../scripts/benchmarks/lab-reader-profile-legacy-judge";
import { createLabReaderProfileRunner, parseLabReaderProfileRunArgs, parseLabReaderProfileRunConfig } from "../scripts/benchmarks/lab-reader-profile-run";

const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
const auth = { method: "project-oidc", project: "fixture", scope: "fixture", environment: "development" } as const;
function token() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({alg:"RS256"})}.${encode({sub:"owner:fixture:project:fixture:environment:development",aud:"https://vercel.com/fixture",iss:"https://oidc.vercel.com/fixture",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.fixture`;
}
async function fixture(maxCalls = 400, maxUsd = 1, readerProfile?: "minimal" | "medium") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lab-profile-run-"))); roots.push(root);
  const legacyDirectory = join(root,"legacy"); await mkdir(legacyDirectory,{mode:0o700}); await mkdir(join(legacyDirectory,"jobs"),{mode:0o700});
  await writeGatewayStudyJson(join(legacyDirectory,"store.json"),{protocol:"oh.memory-gateway-lab-cache.v1",freezeSha256:LEGACY_LAB_PAID_NAMESPACE});
  const ledgerPath=join(legacyDirectory,"ledger.jsonl"); await writeFile(ledgerPath,"",{mode:0o600});
  const corpora = Array.from({length:5},(_,i)=>({id:`c${i}`,groupId:`g${i}`,turns:[{id:`t${i}`,sessionId:`s${i}`,date:"2026-01-01",speaker:"user",text:"My bicycle is red."}]}));
  const dataset: Dataset = {corpora,questions:corpora.flatMap(c=>Array.from({length:100},(_,i)=>({id:`${c.id}-q${i}`,corpusId:c.id,category:"single-session-user",question:`What is my bicycle color (question ${i})?`,questionDate:"2026-01-02",answer:"red",unanswerable:false,evidenceTurnIds:[c.turns[0]!.id],evidenceSessionIds:[c.turns[0]!.sessionId]})))};
  const selected=selectQuestions(selectSplit(dataset,"dev",17),100,17);
  const reader=await makeLabPaidReaderPlan(selected,[{id:"bm25-window:k20:b24000",system:"bm25-window",budget:{topK:20,contextBytes:24000}},{id:"bm25-user-hybrid:k100:b24000",system:"bm25-user-hybrid",budget:{topK:100,contextBytes:24000}}],"a".repeat(64));
  const parentPin=await writeGatewayStudyJson(join(root,"parent.json"),{dataset:"longmemeval-s",datasetSha256:DATASETS["longmemeval-s"].sha256,split:"dev",seed:17,limit:100,selectionSha256:canonicalSha256(selected.questions.map(q=>q.id)),reader});
  const budgetPin=await writeGatewayStudyJson(join(root,"budget.json"),{synthetic:true});
  const config={budgetPin,parentPin,legacyDirectory,legacyLedger:{path:ledgerPath,sha256:sha256Hex(""),bytes:0},directory:join(root,"run"),output:join(root,"output.json"),planPath:join(root,"plan.json"),maxUsd,maxCalls,concurrency:8,...(readerProfile === undefined ? {} : {readerProfile})};
  const configPin=await writeGatewayStudyJson(join(root,"config.json"),config);
  const runner=createLabReaderProfileRunner({loadDataset:async()=>dataset,verifyBudget:async pin=>{expect(pin).toEqual(budgetPin);return {auth,priorExposureMicros:0,fingerprint:"f".repeat(64),recheck:async()=>{if(sha256Hex(await readFile(pin.path))!==pin.sha256)throw Error("Fixture ancestry changed");}};}});
  const prepared=await runner.prepare(configPin);
  const command={mode:"run" as const,paid:true as const,configPin,planSha256:prepared.planSha256,maxUsd};
  let calls=0,active=0,peak=0;
  const fetcher=async (_url:string,init:RequestInit)=>{
    calls++;active++;peak=Math.max(peak,active);const body=JSON.parse(init.body as string);
    await new Promise(resolve=>setTimeout(resolve,1));active--;
    const model=body.model;
    if (model === "openai/gpt-5-mini") { expect(body.reasoning.effort).toBe(readerProfile ?? "minimal"); expect(body.max_tokens).toBe(readerProfile === "medium" ? 8192 : 2048); }
    return Response.json({model,choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content:model==="openai/gpt-4o"?"Yes.":"red"}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12},providerMetadata:{gateway:{routing:{finalProvider:"openai",originalModelId:model,canonicalSlug:model,resolvedProviderApiModelId:model}}}});
  };
  return {root,config,configPin,runner,prepared,command,fetcher,get calls(){return calls;},get active(){return active;},get peak(){return peak;}};
}
test("config and CLI reject unbounded, duplicated, overlapping or unconfirmed execution",()=>{
  const p=(name:string)=>({path:`/fixture/${name}`,sha256:"a".repeat(64)});
  const config={budgetPin:p("budget"),parentPin:p("parent"),legacyDirectory:"/fixture/legacy",legacyLedger:{...p("legacy/ledger.jsonl"),bytes:0},directory:"/fixture/run",output:"/fixture/out",planPath:"/fixture/plan",maxUsd:25,maxCalls:400,concurrency:8};
  expect(parseLabReaderProfileRunConfig(config)).toEqual(config);
  for(const change of [{readerProfile:"high"},{readerProfile:null},{maxUsd:41},{maxCalls:401},{concurrency:13},{output:"/fixture/run/out"},{planPath:"/fixture/out"},{directory:"/fixture/legacy/run"},{endpoint:"https://example.invalid"}]) expect(()=>parseLabReaderProfileRunConfig({...config,...change})).toThrow();
  const base=["--config","/fixture/config","--config-sha256","a".repeat(64)];
  expect(parseLabReaderProfileRunArgs(["prepare",...base]).mode).toBe("prepare");
  expect(()=>parseLabReaderProfileRunArgs(["run",...base,"--plan-sha256","a".repeat(64),"--max-usd","25"])).toThrow();
  expect(()=>parseLabReaderProfileRunArgs(["prepare",...base,"--paid"])).toThrow();
  expect(()=>parseLabReaderProfileRunArgs(["prepare",...base,...base])).toThrow();
});
test("public coordinator completes real custody/scoring over mocked transport and never reopens occupied output",async()=>{
  const f=await fixture(); const result=await f.runner.run(f.command,{oidcToken:token(),fetcher:f.fetcher});
  expect(result.status).toBe("completed");expect(result.cases).toBe(200);expect(result.newCalls).toBe(200);expect(result.settledCalls).toBe(200);expect(f.calls).toBe(200);expect(f.active).toBe(0);expect(f.peak).toBeLessThanOrEqual(8);
  const report=JSON.parse(await readFile(f.config.output,"utf8"));expect(report.scores).toHaveLength(200);expect(report.scores.every((s:{correct:number})=>s.correct===1)).toBe(true);
  await expect(f.runner.run(f.command,{oidcToken:token(),fetcher:f.fetcher})).rejects.toThrow("occupied");expect(f.calls).toBe(200);
},20000);
test("call cap stops before a second physical admission and preserves incomplete denominator",async()=>{
  const f=await fixture(1);const result=await f.runner.run(f.command,{oidcToken:token(),fetcher:f.fetcher});
  expect(result.status).toBe("incomplete");expect(result.newCalls).toBe(1);expect(result.settledCalls).toBe(1);expect(f.calls).toBeLessThanOrEqual(1);expect(f.active).toBe(0);
  expect(JSON.parse(await readFile(f.config.output,"utf8")).scores).toBeNull();
},20000);
test("changed pinned config or explicit cap rejects before dispatch",async()=>{
  const f=await fixture();await expect(f.runner.run({...f.command,maxUsd:2},{oidcToken:token(),fetcher:f.fetcher})).rejects.toThrow("max-usd");
  await writeFile(f.configPin.path,JSON.stringify({...f.config,concurrency:9}));await expect(f.runner.run(f.command,{oidcToken:token(),fetcher:f.fetcher})).rejects.toThrow("pinned input");expect(f.calls).toBe(0);
},20000);

test("medium coordinator binds its profile end to end without altering parent messages or frozen judge", async () => {
  const f = await fixture(400, 3, "medium");
  const plan = JSON.parse(await readFile(f.config.planPath, "utf8"));
  expect(plan.qualification).toContain("medium reasoning and 8192");
  expect(plan.reader.jobs.every((j: {request: {maximumOutput: number}}) => j.request.maximumOutput === 8192)).toBe(true);
  const result = await f.runner.run(f.command, {oidcToken: token(), fetcher: f.fetcher});
  expect(result.status).toBe("completed"); expect(result.cases).toBe(200); expect(result.newCalls).toBe(200);
  const report = JSON.parse(await readFile(f.config.output, "utf8"));
  expect(report.qualification).toContain("medium reasoning and 8192"); expect(report.scores.every((s: {correct: number}) => s.correct === 1)).toBe(true);
}, 20000);
