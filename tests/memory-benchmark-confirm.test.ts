import {expect,test} from "bun:test";
import {canonicalSha256,sha256Hex} from "../src/canonical";
import {DATASETS} from "../scripts/benchmarks/datasets";
import {confirmStudy} from "../scripts/benchmarks/confirm";
import {REPRESENTATIVE_POLICY,SELECTION_METHOD,SELECTION_PROTOCOL} from "../scripts/benchmarks/selection";

const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
function fixture(exclusions: {sha256:string;groups:number}[]=[]){
  const selected=Array.from({length:3},(_,i)=>({questionId:"q"+i,corpusId:"c"+i,groupId:"g"+i}));
  const source={sha256:DATASETS["longmemeval-s"].sha256}, code={sourceSha256:"1".repeat(64)};
  const systems=["bm25-window","bm25-record-window","oh-fact"];
  const selection={protocol:SELECTION_PROTOCOL,createdAt:"2026-09-06T00:00:00.000Z",dataset:"longmemeval-s",
    source,split:"test",splitSeed:17,excludedReports:exclusions,poolSha256:canonicalSha256(selected),poolSize:3,
    eligibleRepresentatives:selected,sampleSize:3,method:SELECTION_METHOD,representativePolicy:REPRESENTATIVE_POLICY,selected};
  const selectionBytes=bytes(selection), selectionHash=sha256Hex(selectionBytes);
  const prompt="2".repeat(64),schema="3".repeat(64),readerPrompt="4".repeat(64),judgePrompt="5".repeat(64);
  const freeze={protocol:"oh.memory-superiority-freeze.v1",selectionReportSha256:selectionHash,poolSha256:selection.poolSha256,
    poolSize:3,sampleSize:3,systems,candidate:"oh-fact",primaryBaselines:systems.slice(0,2),budget:{topK:20,contextBytes:12000},
    provider:"vercel-gateway",code,decision:{requiredJudgments:9,oneSidedAlphaPerComparison:.025,minimumObservedGain:.05},
    extractor:{model:"openai/gpt-4.1-mini",maximumOutputTokens:8192,promptSha256:prompt,schemaSha256:schema,concurrency:12},
    reader:{model:"openai/gpt-4.1-mini",maximumOutputTokens:512,promptProfile:"oh.benchmark.reader.v2",promptSha256:readerPrompt,
      samplingSeed:null,order:"global-question-rotation.v1"},
    judge:{model:"openai/gpt-4o",maximumOutputTokens:16,profileId:"native-judge",profileSha256:judgePrompt}};
  const common={dataset:"longmemeval-s",source,split:"test",seed:17,code};
  const selectionManifest={...common,selectedQuestions:selected.map(x=>x.questionId),selectedCorpora:selected.map(x=>x.corpusId),
    exclusions:[...exclusions].reverse(),selectionSha256:canonicalSha256(selected.map(x=>x.questionId).sort()),provenance:{reportSha256:selectionHash,
      poolSha256:selection.poolSha256,poolSize:3,sampleSize:3,method:selection.method,representativePolicy:selection.representativePolicy}};
  const units={protocol:"oh.memory-benchmark.v1",status:"completed",manifest:{...selectionManifest,command:"extract"},
    provider:{extractor:freeze.extractor.model,transport:freeze.provider,temperature:0,maximumOutput:8192,responseFormat:"json_schema",
      responseSchemaSha256:schema},extraction:{concurrency:12},
    unitBundle:{datasetSha256:source.sha256,extractor:{reader:freeze.extractor.model,promptSha256:prompt,maximumOutput:8192}}};
  const unitBytes=bytes(units);
  const rows=selected.flatMap(x=>systems.map(system=>({...x,system,status:"completed",prediction:"test"})));
  const reader={protocol:"oh.memory-benchmark.v1",status:"completed",manifest:{...selectionManifest,command:"answer",
    systems,budget:freeze.budget},provider:{reader:freeze.reader.model,transport:freeze.provider,temperature:0,maxCompletionTokens:512,
      promptProfile:freeze.reader.promptProfile,promptSha256:readerPrompt,samplingSeed:null,queryOrder:freeze.reader.order},
    memoryUnits:{reportSha256:sha256Hex(unitBytes),promptSha256:prompt},rows};
  const readerBytes=bytes(reader);
  const judge={protocol:"oh.memory-benchmark.v1",status:"completed",manifest:{...common,command:"judge"},
    provider:{judge:freeze.judge.model,transport:freeze.provider,temperature:0,maxCompletionTokens:16},
    sourceReport:{sha256:sha256Hex(readerBytes),readerSourceSha256:code.sourceSha256,reader:freeze.reader.model,readerTransport:freeze.provider},
    judgeProfile:{sha256:judgePrompt},judgeProtocol:"native-judge",
    rows:rows.map(x=>({...x,correct:x.system==="oh-fact"?1:0}))};
  return {input:{freeze:bytes(freeze),selection:selectionBytes,units:unitBytes,reader:readerBytes,judge:bytes(judge)},freeze,selection,units,reader,judge};
}

test("binds a complete matrix to the frozen artifacts before certification",()=>{
  expect(confirmStudy(fixture().input,"1".repeat(64))).toMatchObject({established:true,status:"completed",sampleSize:3});
});
test("rejects mismatched selection, extraction, answer bytes and source profiles",()=>{
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{f.input.selection=bytes({...f.selection,splitSeed:18});},
    (f:ReturnType<typeof fixture>)=>{f.input.units=bytes({...f.units,status:"incomplete"});},
    (f:ReturnType<typeof fixture>)=>{f.input.reader=bytes({...f.reader,provider:{...f.reader.provider,maxCompletionTokens:1024}});},
    (f:ReturnType<typeof fixture>)=>{f.input.judge=bytes({...f.judge,sourceReport:{...f.judge.sourceReport,sha256:"0".repeat(64)}});},
    (f:ReturnType<typeof fixture>)=>{f.input.judge=bytes({...f.judge,judgeProfile:{sha256:"0".repeat(64)}});},
    (f:ReturnType<typeof fixture>)=>{f.input.freeze=bytes({...f.freeze,systems:[...f.freeze.systems].reverse()});},
    (f:ReturnType<typeof fixture>)=>{f.input.judge=bytes({...f.judge,manifest:{...f.judge.manifest,code:{sourceSha256:"0".repeat(64)}}});},
  ]){const f=fixture();mutate(f);expect(()=>confirmStudy(f.input,"1".repeat(64))).toThrow();}
});
test("missing judgments cannot certify even if report status says completed",()=>{
  const f=fixture();f.input.judge=bytes({...f.judge,rows:f.judge.rows.slice(1)});
  expect(confirmStudy(f.input,"1".repeat(64))).toMatchObject({status:"incomplete",established:false});
});

test("rejects a changed executing scorer",()=>{
  expect(()=>confirmStudy(fixture().input,"9".repeat(64))).toThrow("executing scorer");
});

test("accepts equivalent exclusion flags in a different order",()=>{
  const f=fixture([{sha256:"6".repeat(64),groups:2},{sha256:"7".repeat(64),groups:1}]);
  expect(confirmStudy(f.input,"1".repeat(64))).toMatchObject({established:true,status:"completed"});
});
