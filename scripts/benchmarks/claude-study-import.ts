/** Read-only bridge for one closed v1 extraction run ending in a completed invalid envelope.
 * A pinned owner attestation establishes complete producer discovery and quiescence; hashes alone cannot.
 * No model dispatch, writable store open, retry, content repair, or source report rewrite occurs here. */
import { constants } from "node:fs";
import { open, lstat, realpath, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, basename } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { parseClaudeCompletion, claudeRequestSha256, CLAUDE_SUBSCRIPTION_PROFILE, type ClaudeInvocation, type ClaudeTokenUsage } from "./claude-subscription";
import { inspectClaudeSubscriptionCapacity, type ClaudeSubscriptionCapacity } from "./claude-qualification";
import { CLAUDE_STUDY_PROFILE, CLAUDE_STUDY_MODEL,
  completeClaudeExtraction, type ClaudeExtractionJob } from "./claude-study-plan";
import { completeClaudeExtractionOutcome } from "./claude-extraction-outcome";
import { extractionMessages } from "./units";
import { loadJudgeProfile } from "./judge";
import { claudeStudyInternals } from "./claude-study";

const M=1024*1024, VERSION="2.1.263 (Claude Code)", STORE="oh.claude-study-store.v1";
export const CLAUDE_STUDY_IMPORT_QUALIFICATION="Outcome-blind terminal extraction-envelope import; original v1 remains incomplete; first responses are never regenerated.";
export type ClaudeStudyImportPin=Readonly<{path:string;sha256:string}>;
export type ClaudeStudyImportBinding=Readonly<{key:string;ordinal:number;requestSha256:string}>;
export type ClaudeStudyImportManifest=Readonly<{schema:"oh.claude-study-import.v2";createdAt:string;studyDirectory:string;sourceDirectory:string;
  freeze:ClaudeStudyImportPin;inventory:ClaudeStudyImportPin;supervisorClosure:ClaudeStudyImportPin;jobs:readonly ClaudeStudyImportBinding[];
  terminalFailedKey:string;validCount:number;invalidCount:1;qualification:typeof CLAUDE_STUDY_IMPORT_QUALIFICATION}>;
type RecordValue=Record<string,unknown>;
type Pin=ClaudeStudyImportPin;
type Read=(path:string,maximum:number)=>Promise<Uint8Array>;
export class ClaudeStudyImportError extends Error { constructor(readonly code:string) {super(`Claude study import rejected: ${code}.`);this.name="ClaudeStudyImportError";} }
function fail(code:string):never {throw new ClaudeStudyImportError(code);}
function need(value:unknown,code:string):asserts value {if(!value)fail(code);}
function record(value:unknown):RecordValue {
  need(isPlainRecord(value),"shape");
  for(const key of Reflect.ownKeys(value)) {need(typeof key==="string","shape");const d=Object.getOwnPropertyDescriptor(value,key);need(d?.enumerable && Object.hasOwn(d,"value"),"shape");}
  return value;
}
function keys(value:RecordValue,names:readonly string[]):void {need(hasExactKeys(value,names),"shape");}
function array(value:unknown,max:number):unknown[] {need(Array.isArray(value)&&value.length<=max,"array-bound");return value;}
function string(value:unknown):string {need(typeof value==="string","string");return value;}
function hash(value:unknown):string {const s=string(value);need(/^[a-f0-9]{64}$/.test(s),"digest");return s;}
function integer(value:unknown,max=Number.MAX_SAFE_INTEGER):number {need(typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0)&&value<=max,"integer");return value;}
function absolute(value:unknown):string {const p=string(value);need(p.length<=4096&&isAbsolute(p)&&resolve(p)===p&&!p.includes("\0"),"absolute-path");return p;}
function rel(value:unknown):string {const p=string(value);need(p.length>0&&p.length<=1024&&!isAbsolute(p)&&!p.includes("\0")&&!p.includes("\\")&&p.split("/").every(s=>s!==""&&s!=="."&&s!==".."),"relative-path");return p;}
function pin(value:unknown):Pin {const p=record(value);keys(p,["path","sha256"]);return {path:absolute(p.path),sha256:hash(p.sha256)};}
function same(a:unknown,b:unknown,code:string):void {need(canonicalSha256(a)===canonicalSha256(b),code);}
function at<T>(values:readonly T[],index:number):T {return values[index]??fail("position");}
function json(raw:Uint8Array):unknown {try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}catch{return fail("json");}}
function time(value:unknown):number {const s=string(value),n=Date.parse(s);need(Number.isFinite(n)&&new Date(n).toISOString()===s,"timestamp");return n;}
function frozen<T>(value:T):T {if(value!==null&&typeof value==="object"){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value;}

async function readBoundedFile(path: string, maximum: number, privateFile = false): Promise<Uint8Array> {
  const p = absolute(path), handle = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= maximum && before.nlink === 1 && before.uid === process.getuid?.(), "file-bound-or-kind");
    if (privateFile) need((before.mode & 0o777) === 0o600 && before.uid === process.getuid?.(), "private-file-mode");
    const raw = new Uint8Array(before.size);
    for (let offset = 0; offset < raw.length;) {
      const got = await handle.read(raw,offset,raw.length-offset,offset); need(got.bytesRead > 0,"short-read"); offset += got.bytesRead;
    }
    const after = await handle.stat(), current = await lstat(p);
    need(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
      && current.dev === before.dev && current.ino === before.ino && current.size === before.size && current.mtimeMs === before.mtimeMs && current.ctimeMs === before.ctimeMs && !current.isSymbolicLink(), "file-mutated");
    return raw;
  } finally { await handle.close(); }
}
async function pinned(p: Pin, max: number): Promise<Uint8Array> { const raw=await readBoundedFile(p.path,max); need(sha256Hex(raw)===p.sha256,"pin-changed"); return raw; }

function parseManifest(value:unknown):ClaudeStudyImportManifest {
  const v=record(value);keys(v,["schema","createdAt","studyDirectory","sourceDirectory","freeze","inventory","supervisorClosure","jobs","terminalFailedKey","validCount","invalidCount","qualification"]);
  need(v.schema==="oh.claude-study-import.v2"&&v.qualification===CLAUDE_STUDY_IMPORT_QUALIFICATION&&v.invalidCount===1,"manifest-policy");
  time(v.createdAt);
  const jobs=array(v.jobs,50000).map(value=>{const b=record(value);keys(b,["key","ordinal","requestSha256"]);return {key:hash(b.key),ordinal:integer(b.ordinal,49999),requestSha256:hash(b.requestSha256)};});
  const validCount=integer(v.validCount,49999),terminalFailedKey=hash(v.terminalFailedKey);
  need(jobs.length===validCount+1&&at(jobs,jobs.length-1).key===terminalFailedKey&&new Set(jobs.map(job=>job.key)).size===jobs.length,"manifest-prefix");
  return frozen({schema:"oh.claude-study-import.v2",createdAt:string(v.createdAt),studyDirectory:absolute(v.studyDirectory),sourceDirectory:absolute(v.sourceDirectory),
    freeze:pin(v.freeze),inventory:pin(v.inventory),supervisorClosure:pin(v.supervisorClosure),jobs,terminalFailedKey,validCount,invalidCount:1,qualification:CLAUDE_STUDY_IMPORT_QUALIFICATION});
}
async function sourceIdentity(directory:string) {
  need(await realpath(directory)===directory,"source-canonical");
  const files=["package.json","bun.lock","tsconfig.json","tsconfig.scripts.json","scripts/benchmark-memory.ts"];
  async function visit(dir:string,depth:number):Promise<void> {
    need(depth<=16,"source-depth");
    for(const entry of await readdir(join(directory,dir),{withFileTypes:true})) {
      const path=`${dir}/${entry.name}`;
      if(entry.isDirectory())await visit(path,depth+1);else if(entry.isFile()&&entry.name.endsWith(".ts"))files.push(path);else if(entry.isSymbolicLink())fail("source-symlink");
      need(files.length<=512,"source-file-count");
    }
  }
  await visit("src",0);await visit("scripts/benchmarks",0);
  const entries=[];for(const path of files.sort())entries.push({path,sha256:sha256Hex(await readBoundedFile(join(directory,path),8*M))});
  return {sha256:canonicalSha256(entries),entries};
}
type InventoryFile=Readonly<{path:string;bytes:number;sha256:string}>;
function parseInventory(value:unknown,freezeSha256:string):InventoryFile[] {
  const v=record(value);keys(v,["schema","freezeSha256","files"]);need(v.schema==="oh.claude-final-inventory.v1"&&v.freezeSha256===freezeSha256,"inventory-binding");
  const files=array(v.files,65536).map(value=>{const f=record(value);keys(f,["path","bytes","sha256"]);return {path:rel(f.path),bytes:integer(f.bytes,128*M),sha256:hash(f.sha256)};});
  need(files.every((f,i)=>i===0||at(files,i-1).path<f.path)&&new Set(files.map(f=>f.path)).size===files.length,"inventory-order");
  need(files.reduce((sum,f)=>sum+f.bytes,0)<=8*1024*M,"inventory-total");return files;
}
async function closedFiles(directory:string):Promise<string[]> {
  need(await realpath(directory)===directory,"study-canonical");const files:string[]=[];
  async function visit(path:string,depth:number):Promise<void> {
    const stat=await lstat(path);need(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o700&&stat.uid===process.getuid?.(),"directory-kind-mode");
    need(depth<=2,"directory-depth");const entries=await readdir(path,{withFileTypes:true});
    if(depth===1)need(relative(directory,path)==="jobs"&&entries.length>0,"unexpected-directory");
    if(depth===2) {need(/^jobs\/[a-f0-9]{64}$/.test(relative(directory,path)),"job-directory");same(entries.map(e=>e.name).sort(),["pending.json","result.json","stderr.txt","stdout.jsonl"],"incomplete-job-directory");}
    for(const e of entries) {need(e.name!=="active.lock","active-lock");const p=join(path,e.name);if(e.isDirectory())await visit(p,depth+1);else {need(e.isFile(),"special-file");files.push(rel(relative(directory,p)));}need(files.length<=65536,"file-count");}
  }
  await visit(directory,0);return files.sort();
}
function inventoryReader(directory:string,files:readonly InventoryFile[]):Read {
  const byPath=new Map(files.map(file=>[file.path,file]));return async(path,maximum)=>{
    const entry=byPath.get(rel(path));need(entry&&entry.bytes<=maximum,"missing-or-oversized-artifact");
    const raw=await readBoundedFile(join(directory,path),maximum,true);need(raw.length===entry.bytes&&sha256Hex(raw)===entry.sha256,"inventory-file-changed");return raw;
  };
}
function checkedJobs(input:readonly ClaudeExtractionJob[]):readonly ClaudeExtractionJob[] {
  array(input,50000);need(input.length>0,"empty-job-plan");canonicalSha256(input);
  const jobs=frozen(structuredClone(input));let ordinal=-1;
  for(const job of jobs) {
    need(job.phase==="extract"&&job.ordinal>ordinal&&job.ordinal<=49999,"job-order");ordinal=job.ordinal;
    const messages=extractionMessages(job.chunk);
    same(job.request,{model:CLAUDE_STUDY_MODEL,effort:"low",systemPrompt:at(messages,0).content,prompt:at(messages,1).content,maximumOutputTokens:16384,timeoutMs:300000},"native-extraction-request");
    need(claudeRequestSha256(job.request)===job.requestSha256,"request-hash");
    same(job.key,canonicalSha256({profile:CLAUDE_STUDY_PROFILE,phase:"extract",ordinal:job.ordinal,
      identity:{corpusId:job.corpusId,corpusSha256:job.corpusSha256,chunkId:job.chunk.id,legacyReportSha256:job.legacyReportSha256},requestSha256:job.requestSha256}),"native-job-key");
  }
  need(new Set(jobs.map(job=>job.key)).size===jobs.length,"duplicate-job");return jobs;
}
function binding(job:ClaudeExtractionJob):ClaudeStudyImportBinding {return {key:job.key,ordinal:job.ordinal,requestSha256:job.requestSha256};}
async function readInvocation(read:Read,freezeSha256:string,job:ClaudeExtractionJob):Promise<{invocation:ClaudeInvocation;capacity:ClaudeSubscriptionCapacity}> {
  const base=`jobs/${job.key}`,pending=record(json(await read(`${base}/pending.json`,2048)));
  same(pending,{protocol:STORE,freezeSha256,jobKey:job.key,requestSha256:job.requestSha256},"pending-binding");
  const result=record(json(await read(`${base}/result.json`,4*M)));keys(result,["protocol","freezeSha256","jobKey","requestSha256","invocation"]);
  need(result.protocol===STORE&&result.freezeSha256===freezeSha256&&result.jobKey===job.key&&result.requestSha256===job.requestSha256,"result-binding");
  const saved=record(result.invocation);keys(saved,["protocol","requestSha256","exitCode","timedOut","outputBoundExceeded","stdout","stderr"]);
  need(saved.protocol===CLAUDE_SUBSCRIPTION_PROFILE&&saved.requestSha256===job.requestSha256&&saved.exitCode===0&&saved.timedOut===false&&saved.outputBoundExceeded===false,"incomplete-transport");
  const out=await read(`${base}/stdout.jsonl`,16*M),err=await read(`${base}/stderr.txt`,M);
  const stdout={bytes:out.length,sha256:sha256Hex(out)},stderr={bytes:err.length,sha256:sha256Hex(err)};
  same(saved.stdout,stdout,"stdout-hash");same(saved.stderr,stderr,"stderr-hash");
  return {invocation:frozen({protocol:CLAUDE_SUBSCRIPTION_PROFILE,requestSha256:job.requestSha256,status:"completed",exitCode:0,timedOut:false,outputBoundExceeded:false,
    stdout,stderr,completion:parseClaudeCompletion(out,job.request.model)}),capacity:inspectClaudeSubscriptionCapacity(out)};
}
function zeroUsage():ClaudeTokenUsage {return {inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheCreationInputTokens:0};}
function addUsage(a:ClaudeTokenUsage,b:ClaudeTokenUsage):ClaudeTokenUsage {return {inputTokens:integer(a.inputTokens+b.inputTokens),outputTokens:integer(a.outputTokens+b.outputTokens),cacheReadInputTokens:integer(a.cacheReadInputTokens+b.cacheReadInputTokens),cacheCreationInputTokens:integer(a.cacheCreationInputTokens+b.cacheCreationInputTokens)};}
function immutableMap<K,V>(entries:readonly (readonly [K,V])[]):ReadonlyMap<K,V> {
  const data=new Map(entries);
  const view:ReadonlyMap<K,V>=Object.freeze({get size(){return data.size;},get:(key:K)=>data.get(key),has:(key:K)=>data.has(key),
    entries:()=>data.entries(),keys:()=>data.keys(),values:()=>data.values(),[Symbol.iterator]:()=>data[Symbol.iterator](),
    forEach:(callback:(value:V,key:K,map:ReadonlyMap<K,V>)=>void,thisArg?:unknown)=>{for(const [key,value] of data)callback.call(thisArg,value,key,view);}});
  return view;
}

export type ClaudeStudyImportFreeze=ReturnType<typeof claudeStudyInternals.parseFreeze>;
// Python supervisor uses sorted compact JSON with ensure_ascii=True. Its config has only string/array fields.
function supervisorJson(value:unknown):string {return canonicalJson(value).replace(/[\u007f-\uffff]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,"0")}`);}
function supervisorTime(value:unknown):number {const s=string(value);need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s),"supervisor-timestamp");return time(s.replace(/Z$/,".000Z"));}
async function bindSupervisor(configuration:Pin,statusPin:Pin,manifest:ClaudeStudyImportManifest,maximum:number,exit:number,startAt:number,endAt:number):Promise<void> {
  const configRaw=await pinned(configuration,128*1024),config=record(json(configRaw));keys(config,["argv","cwd","jobDir","requireAbsent"]);
  const jobDir=absolute(config.jobDir),argv=array(config.argv,16).map(string),bun=absolute(at(argv,0));
  need(basename(bun)==="bun"&&configuration.path===join(jobDir,"config.json")&&statusPin.path===join(jobDir,"status.json")
    &&!jobDir.startsWith(manifest.studyDirectory+"/")&&config.cwd===manifest.sourceDirectory,"supervisor-path-binding");
  same(argv,[bun,join(manifest.sourceDirectory,"scripts/benchmarks/claude-study.ts"),"run","--directory",manifest.studyDirectory,
    "--freeze-sha256",manifest.freeze.sha256,"--max-new-calls",String(maximum)],"supervisor-argv");
  const absent=array(config.requireAbsent,64).map(absolute);need(new Set(absent).size===absent.length,"supervisor-absence-shape");
  const canonical=supervisorJson(config);need(sha256Hex(canonical)===configuration.sha256,"supervisor-canonical-config");
  const status=record(json(await pinned(statusPin,128*1024)));
  keys(status,["state","supervisorPid","supervisorStart","bootIdentity","commandSha256","configSha256","startedAt","childPid","childPgid","childStart","exitCode","groupGone","finishedAt"]);
  const supervisor=integer(status.supervisorPid),child=integer(status.childPid),pgid=integer(status.childPgid);
  need(supervisor>0&&child>0&&child===pgid&&supervisor!==child,"supervisor-process-binding");
  for(const v of [status.supervisorStart,status.bootIdentity])need(string(v).length>0&&string(v).length<=512&&!string(v).includes("\0"),"supervisor-identity-shape");
  need(status.childStart===null||(typeof status.childStart==="string"&&status.childStart.length>0&&status.childStart.length<=512&&!status.childStart.includes("\0")),"supervisor-child-start");
  need(status.state==="exited"&&status.groupGone===true&&status.exitCode===exit&&status.configSha256===configuration.sha256
    &&status.commandSha256===sha256Hex(supervisorJson(argv)),"supervisor-status-binding");
  const began=supervisorTime(status.startedAt),ended=supervisorTime(status.finishedAt);
  // Supervisor times are truncated to whole seconds; no inference from bootIdentity's microsecond field.
  need(began<=startAt&&ended>=began&&ended<=time(manifest.createdAt)&&endAt<ended+1000,"supervisor-time-window");
}
type Batch=Readonly<{runId:string;newCalls:number;admitted:boolean;startAt:number;endAt:number;pause:ClaudeSubscriptionCapacity|null;jobKeys:readonly string[]|null;receiptSha256:string}>;
async function history(manifest:ClaudeStudyImportManifest,freeze:ClaudeStudyImportFreeze,files:readonly InventoryFile[],read:Read,closure:RecordValue,allJobCount:number) {
  keys(closure,["schema","freezeSha256","inventorySha256","finalBatchSha256","verification","allProducersClosed","runs"]);
  need(closure.schema==="oh.claude-final-supervisor-closure.v1"&&closure.freezeSha256===manifest.freeze.sha256&&closure.inventorySha256===manifest.inventory.sha256
    &&closure.verification==="owner-verified-complete-producer-inventory"&&closure.allProducersClosed===true,"supervisor-closure");
  const runs=array(closure.runs,4096);need(runs.length>0,"empty-history");
  const batches:Batch[]=[],externalPins:Pin[]=[],expectedFiles=new Set(["freeze.json","preparation.json","store.json"]),seen=new Set<string>();
  let cumulative=0,previousEnd=time(freeze.createdAt);const pauses:ClaudeSubscriptionCapacity[]=[];
  for(const [index,item] of runs.entries()) {
    const run=record(item);keys(run,["runId","admissionSha256","closureSha256","configuration","supervisorStatus","groupGone","runnerExitCode","newTransportInvocations",...(Object.hasOwn(run,"jobKeys")?["jobKeys"]:[])]);
    const runId=string(run.runId);need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId)&&!seen.has(runId),"run-id");seen.add(runId);
    need(run.groupGone===true,"active-producer");const configuration=pin(run.configuration),statusPin=pin(run.supervisorStatus);externalPins.push(configuration,statusPin);
    const name=`batch-${runId}.json`,raw=await read(name,32768);expectedFiles.add(name);
    const receiptSha256=hash(run.closureSha256);need(sha256Hex(raw)===receiptSha256,"closure-pin");const c=record(json(raw));
    keys(c,["protocol","runId","freezeSha256","sourceSha256","start","end","admissionSha256","sourceVerifiedAtClose","cliVerifiedAtClose","storeClosed","comparisonArtifact","qualified","newTransportInvocations","maximumNewCalls","interrupted","capacityPause","failed","result"]);
    const startAt=time(c.start),endAt=time(c.end),max=integer(c.maximumNewCalls,256),newCalls=integer(run.newTransportInvocations,256);
    need(max>0&&newCalls<=max&&startAt>=previousEnd&&endAt>=startAt&&endAt<=time(manifest.createdAt),"batch-time-or-limit");previousEnd=endAt;
    need(c.protocol==="oh.memory-claude-subscription-batch.v1"&&c.runId===runId&&c.freezeSha256===manifest.freeze.sha256&&c.sourceSha256===freeze.sourceSha256
      &&c.newTransportInvocations===newCalls&&c.sourceVerifiedAtClose===true&&c.cliVerifiedAtClose===true&&c.storeClosed===true&&c.comparisonArtifact===null
      &&typeof c.interrupted==="boolean"&&typeof c.failed==="boolean","batch-binding-or-custody");
    const q=record(c.qualified),auth=record(q.auth);keys(q,["version","auth"]);keys(auth,["authMethod","apiProvider","subscriptionType"]);
    need(q.version===VERSION&&auth.authMethod==="claude.ai"&&auth.apiProvider==="firstParty"&&["max","pro","team","enterprise"].includes(string(auth.subscriptionType)),"subscription-route");
    const terminal=index===runs.length-1,admitted=run.admissionSha256!==null,before=cumulative;const exit=integer(run.runnerExitCode,255);
    await bindSupervisor(configuration,statusPin,manifest,max,exit,startAt,endAt);
    if(admitted) {
      const admissionName=`batch-${runId}-started.json`,aRaw=await read(admissionName,32768);expectedFiles.add(admissionName);
      const admissionSha=hash(run.admissionSha256);need(sha256Hex(aRaw)===admissionSha&&c.admissionSha256===admissionSha,"admission-pin");
      same(json(aRaw),{protocol:"oh.memory-claude-subscription-batch-admission.v1",runId,freezeSha256:manifest.freeze.sha256,sourceSha256:freeze.sourceSha256,cliSha256:freeze.cli.sha256,start:c.start,maximumNewCalls:max},"admission-binding");
      need(pauses.every(p=>Object.values(p.unifiedWindows).every(w=>w.utilization<0.7||w.resetsAt<=startAt/1000)),"admission-before-capacity-reset");
      cumulative+=newCalls;need(cumulative<=manifest.jobs.length,"history-overrun");
      if(terminal) {
        need(newCalls>0&&c.failed===true&&exit===1&&c.interrupted===false&&cumulative===manifest.jobs.length&&closure.finalBatchSha256===receiptSha256,"terminal-failure-shape");
        same(c.result,{status:"blocked",phase:"extract",completed:manifest.validCount,cached:before,reason:"Private evidence requires review before accepting this batch."},"terminal-native-frontier");
      } else {
        need(c.failed===false&&exit===0&&cumulative<manifest.jobs.length,"earlier-admitted-failure");
        same(c.result,{status:"paused",phase:"extract",completed:cumulative,required:allJobCount},"prior-native-frontier");
      }
    } else {
      need(!terminal&&newCalls===0&&c.admissionSha256===null&&c.failed===true&&exit===1,"unadmitted-failure");
      same(c.result,{status:"blocked",phase:"extract",completed:0,cached:0,reason:"Private evidence requires review before accepting this batch."},"unadmitted-native-frontier");
    }
    let pause:ClaudeSubscriptionCapacity|null=null;
    if(c.capacityPause!==null) {const rawPause=record(c.capacityPause);pause=inspectClaudeSubscriptionCapacity(new TextEncoder().encode(JSON.stringify({type:"rate_limit_event",rate_limit_info:rawPause})+"\n"));same(pause,rawPause,"pause-shape");pauses.push(pause);}
    const jobKeys=Object.hasOwn(run,"jobKeys")?array(run.jobKeys,256).map(hash):null;
    if(jobKeys!==null) same(jobKeys,manifest.jobs.slice(before,before+newCalls).map(job=>job.key),"independent-roster");
    batches.push({runId,newCalls,admitted,startAt,endAt,pause,jobKeys,receiptSha256});
  }
  need(cumulative===manifest.jobs.length,"history-incomplete");
  for(const job of manifest.jobs)for(const name of ["pending.json","result.json","stdout.jsonl","stderr.txt"])expectedFiles.add(`jobs/${job.key}/${name}`);
  same(files.map(file=>file.path),[...expectedFiles].sort(),"exact-extraction-only-inventory");
  return {batches,externalPins};
}
function verifyCapacity(batches:readonly Batch[],capacities:readonly ClaudeSubscriptionCapacity[]):void {
  let frontier=0;
  for(const batch of batches) {
    const slice=capacities.slice(frontier,frontier+batch.newCalls);frontier+=batch.newCalls;need(slice.length===batch.newCalls,"capacity-count");
    if(batch.pause!==null) {
      need(slice.length>0,"pause-without-new-call");const last=at(slice,slice.length-1);same(last,batch.pause,"pause-raw-mismatch");
      need(Object.values(last.unifiedWindows).some(w=>w.utilization>=0.7&&w.resetsAt>batch.startAt/1000),"pause-never-active");
    }
    for(const [index,capacity] of slice.entries())if(Object.values(capacity.unifiedWindows).some(w=>w.utilization>=0.7&&w.resetsAt>batch.endAt/1000)) {
      need(index===slice.length-1,"call-after-proven-pause");need(batch.pause!==null,"missing-proven-pause");same(batch.pause,capacity,"pause-raw-mismatch");
    }
  }
  need(frontier===capacities.length,"capacity-inventory");
}

/** Caller freshly rebuilds the entire original missing-parent job plan from authenticated native inputs.
 * The manifest is a separately trusted pin, never a claim of v1 completion or authority to dispatch. */
export async function loadClaudeStudyImport(input:Readonly<{manifest:Pin;jobs:readonly ClaudeExtractionJob[]}>) {
  try {
    const args=record(input);keys(args,["manifest","jobs"]);
    const manifestPin=pin(args.manifest),jobs=checkedJobs(input.jobs);
    const manifest=parseManifest(json(await pinned(manifestPin,8*M)));
    need(manifest.freeze.path===join(manifest.studyDirectory,"freeze.json")&&![manifestPin,manifest.inventory,manifest.supervisorClosure].some(p=>p.path.startsWith(manifest.studyDirectory+"/")),"external-manifest-pins");
    same(manifest.jobs,jobs.slice(0,manifest.jobs.length).map(binding),"exact-ordered-prefix");need(manifest.jobs.length<=jobs.length,"prefix-overrun");
    // Inspect the independent closed-owner assertion before opening any study output.
    const closure=record(json(await pinned(manifest.supervisorClosure,8*M)));
    need(closure.allProducersClosed===true&&closure.verification==="owner-verified-complete-producer-inventory"&&array(closure.runs,4096).every(run=>record(run).groupGone===true),"closed-owner-required");
    const files=parseInventory(json(await pinned(manifest.inventory,16*M)),manifest.freeze.sha256);
    same(await closedFiles(manifest.studyDirectory),files.map(file=>file.path),"closed-file-inventory");const read=inventoryReader(manifest.studyDirectory,files);
    const freezeRaw=await read("freeze.json",8*M);need(sha256Hex(freezeRaw)===manifest.freeze.sha256,"freeze-pin");const freeze=frozen(claudeStudyInternals.parseFreeze(json(freezeRaw)));
    const sourceBefore=await sourceIdentity(manifest.sourceDirectory);need(sourceBefore.sha256===freeze.sourceSha256,"source-before");
    await pinned(freeze.cli,512*M);const initialCapacity=inspectClaudeSubscriptionCapacity(await pinned(freeze.capacityEvidence,16*M));
    const prepared=record(json(await read("preparation.json",8*M))),preparedSource=record(prepared.source);
    need(prepared.noModelCalls===true&&preparedSource.sourceSha256===freeze.sourceSha256&&preparedSource.bun==="1.3.14","preparation-source");
    same(preparedSource.files,sourceBefore.entries,"preparation-source-files");same(prepared.capacity,initialCapacity,"preparation-capacity");
    same(json(await read("store.json",1024)),{protocol:STORE,freezeSha256:manifest.freeze.sha256},"store-header");
    const profile=await loadJudgeProfile();same(freeze.procedure,claudeStudyInternals.procedure(profile.sha256),"original-procedure");
    need(freeze.study.originalStatus==="incomplete"&&freeze.study.missingChunks===jobs.length&&freeze.study.extractionOrderSha256===canonicalSha256(jobs.map(binding)),"complete-original-job-plan");
    const prior=record(freeze.study.legacy);
    need(prior.reportSha256===freeze.inputs.legacy.sha256&&prior.sourceSha256===freeze.inputs.originalSourceSha256&&prior.selectionReportSha256===freeze.inputs.selection.sha256
      &&jobs.every(job=>job.legacyReportSha256===freeze.inputs.legacy.sha256),"original-input-bindings");
    const verifiedHistory=await history(manifest,freeze,files,read,closure,jobs.length);
    for(const p of verifiedHistory.externalPins)await pinned(p,8*M);
    const entries:(readonly [string,ClaudeInvocation])[]=[],capacities:ClaudeSubscriptionCapacity[]=[],payloads:{key:string;ordinal:number;payloadSha256:string}[]=[],rawEvidence:RecordValue[]=[];
    const sessions=new Set<string>();let terminalOutcomeSha256:string|null=null,terminalUsage=zeroUsage(),knownUsd=0,unknownUsd=0;const modelUsage:Record<string,ClaudeTokenUsage>={};
    for(const [index,b] of manifest.jobs.entries()) {
      const job=at(jobs,index),{invocation,capacity}=await readInvocation(read,manifest.freeze.sha256,job);const completion=invocation.completion;need(completion,"missing-completion");
      need(!sessions.has(completion.sessionId),"reused-cli-session");sessions.add(completion.sessionId);
      const outcome=completeClaudeExtractionOutcome(job,invocation);
      if(index<manifest.validCount) {
        need(outcome.status==="valid","earlier-invalid-envelope");const native=completeClaudeExtraction(job,invocation);same(outcome.result,native,"native-valid-payload-changed");
        payloads.push({key:job.key,ordinal:job.ordinal,payloadSha256:native.payloadSha256});
      } else {need(outcome.status==="invalid-envelope"&&job.key===manifest.terminalFailedKey,"terminal-is-not-invalid-envelope");terminalOutcomeSha256=canonicalSha256(outcome);}
      entries.push([job.key,invocation]);capacities.push(capacity);terminalUsage=addUsage(terminalUsage,completion.usage);
      for(const [model,usage] of Object.entries(completion.modelUsage))modelUsage[model]=addUsage(modelUsage[model]??zeroUsage(),usage);
      if(completion.listPriceEstimateUsd===null)unknownUsd++;else knownUsd+=completion.listPriceEstimateUsd;need(Number.isFinite(knownUsd),"estimate-overflow");
      rawEvidence.push({key:job.key,requestSha256:job.requestSha256,stdout:invocation.stdout,stderr:invocation.stderr});
    }
    need(payloads.length===manifest.validCount&&terminalOutcomeSha256!==null,"disposition-count");verifyCapacity(verifiedHistory.batches,capacities);
    for(const file of files)await read(file.path,128*M);same(await closedFiles(manifest.studyDirectory),files.map(file=>file.path),"final-inventory");
    for(const p of [manifestPin,manifest.freeze,manifest.inventory,manifest.supervisorClosure,freeze.capacityEvidence,...verifiedHistory.externalPins])await pinned(p,16*M);
    for(const p of [freeze.inputs.selection,freeze.inputs.legacy])await pinned(p,128*M);
    for(const p of freeze.inputs.exclusions)await pinned(p,64*M);
    await pinned(freeze.cli,512*M);same(await sourceIdentity(manifest.sourceDirectory),sourceBefore,"source-after");
    need((await loadJudgeProfile()).sha256===profile.sha256,"profile-after");
    const capacityPauses=frozen(verifiedHistory.batches.flatMap(batch=>batch.pause===null?[]:[batch.pause]));
    const summary=frozen({profile:"oh.claude-study-import.v2",manifestSha256:manifestPin.sha256,freezeSha256:manifest.freeze.sha256,sourceSha256:freeze.sourceSha256,
      inventorySha256:manifest.inventory.sha256,supervisorClosureSha256:manifest.supervisorClosure.sha256,importedTransportInvocations:entries.length,
      validCount:payloads.length,invalidCount:1,terminalFailedKey:manifest.terminalFailedKey,terminalOutcomeSha256,
      orderedJobsSha256:canonicalSha256(manifest.jobs),validPayloadsSha256:canonicalSha256(payloads),invocationEvidenceSha256:canonicalSha256(rawEvidence),
      terminalUsage,modelUsageSeparate:modelUsage,listPriceEstimateUsdKnownSubtotal:knownUsd,unknownListPriceEstimates:unknownUsd,billedUsd:null,physicalModelAttempts:null,
      capacityPausesSha256:canonicalSha256(capacityPauses),batchCount:verifiedHistory.batches.length,batchEvidenceSha256:canonicalSha256(verifiedHistory.batches),
      jobToBatchAttribution:verifiedHistory.batches.every(batch=>batch.jobKeys!==null||batch.newCalls===0)?"independently retained rosters checked against original order":"bounded deterministic partition under complete external custody; standalone producing batch unproven",
      originalV1Status:"incomplete",qualification:manifest.qualification});
    return Object.freeze({invocations:immutableMap(entries),summary,manifest,freeze,capacityPauses});
  } catch(error) {if(error instanceof ClaudeStudyImportError)throw error;return fail("native-or-io-rejection");}
}

/** Read-only primitives reused by separately versioned ancestry validators. V1 acceptance is unchanged. */
export const claudeStudyImportInternals = Object.freeze({
  record, keys, array, string, hash, integer, absolute, rel, pin, same, at, json, time, frozen,
  readBoundedFile, pinned, sourceIdentity, closedFiles, inventoryReader, checkedJobs, binding,
  zeroUsage, addUsage, immutableMap, supervisorJson, supervisorTime, verifyCapacity,
});
