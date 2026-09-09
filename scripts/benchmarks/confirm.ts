import { canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS } from "./datasets";
import { codeIdentity, MAX_REPORT_BYTES, writeJson } from "./io";
import { parseSelectionDocument } from "./selection";
import { assessSuperiority } from "./superiority";

type Inputs = Readonly<{ freeze: Uint8Array; selection: Uint8Array; units: Uint8Array; reader: Uint8Array; judge: Uint8Array }>;
function object(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError("Expected a confirmation object.");
  return value;
}
function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual === undefined || expected === undefined || canonicalSha256(actual) !== canonicalSha256(expected)) {
    throw new Error("Confirmation mismatch: " + label);
  }
}
function decode(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.length < 1 || bytes.length > MAX_REPORT_BYTES) throw new RangeError("Confirmation report size exceeded.");
  return object(JSON.parse(new TextDecoder().decode(bytes)));
}

function normalizeReports(value: unknown) {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError("Invalid exclusions.");
  return value.map(x => {
    const row = object(x);
    if (typeof row.sha256 !== "string" || !Number.isSafeInteger(row.groups)) throw new TypeError("Invalid exclusions.");
    return { sha256: row.sha256, groups: row.groups as number };
  }).sort((a,b) => a.sha256.localeCompare(b.sha256) || a.groups - b.groups);
}

/** Bind exact artifacts to the predeclared study before interpreting any outcomes. */
export function confirmStudy(input: Inputs, scorerSourceSha256: string) {
  const freeze = decode(input.freeze);
  equal(freeze.protocol, "oh.memory-superiority-freeze.v1", "freeze protocol");
  equal(sha256Hex(input.selection), freeze.selectionReportSha256, "selection bytes");
  const selection = parseSelectionDocument(decode(input.selection));
  equal(selection.source.sha256, DATASETS["longmemeval-s"].sha256, "pinned dataset");
  equal(selection.poolSha256, freeze.poolSha256, "pool hash");
  equal(selection.poolSize, freeze.poolSize, "pool size");
  equal(selection.sampleSize, freeze.sampleSize, "sample size");
  equal(freeze.systems, ["bm25-window", "bm25-record-window", "oh-fact"], "system order");
  equal(freeze.primaryBaselines, ["bm25-window", "bm25-record-window"], "primary controls");
  equal(freeze.candidate, "oh-fact", "candidate");
  equal(freeze.budget, {topK:20,contextBytes:12000}, "retrieval budget");
  const decision = object(freeze.decision);
  equal(decision.requiredJudgments, selection.sampleSize * 3, "matrix size");
  equal(decision.oneSidedAlphaPerComparison, 0.025, "alpha");
  equal(decision.minimumObservedGain, 0.05, "gain threshold");
  const code = object(freeze.code);
  equal(scorerSourceSha256,code.sourceSha256,"executing scorer code");
  const units = decode(input.units), reader = decode(input.reader), judge = decode(input.judge);
  const manifests = [units,reader,judge].map((report,index) => {
    equal(report.protocol, "oh.memory-benchmark.v1", "report protocol");
    equal(report.status, "completed", "completed report");
    const m=object(report.manifest);
    equal(m.command, ["extract","answer","judge"][index], "stage");
    equal(m.dataset, selection.dataset, "dataset");
    equal(object(m.source).sha256, selection.source.sha256, "dataset checksum");
    equal(m.split, selection.split, "split");
    equal(m.seed, selection.splitSeed, "split seed");
    equal(object(m.code).sourceSha256, code.sourceSha256, "executed code");
    return m;
  });
  const [unitManifest,readerManifest]=manifests;
  const selectedQuestions=selection.selected.map(x=>x.questionId), selectedCorpora=selection.selected.map(x=>x.corpusId);
  for(const manifest of [unitManifest!,readerManifest!]){
    equal(manifest.selectedQuestions, selectedQuestions, "selected question order");
    equal(manifest.selectedCorpora, selectedCorpora, "selected corpus order");
    equal(normalizeReports(manifest.exclusions), normalizeReports(selection.excludedReports), "exclusions");
    const p=object(manifest.provenance);
    equal(p.reportSha256, freeze.selectionReportSha256, "selection provenance");
    equal(p.poolSha256, selection.poolSha256, "pool provenance");
    equal(p.poolSize, selection.poolSize, "pool count");
    equal(p.sampleSize, selection.sampleSize, "sample count");
    equal(p.method, selection.method, "sampling method");
    equal(p.representativePolicy, selection.representativePolicy, "representative policy");
    equal(manifest.selectionSha256, canonicalSha256([...selectedQuestions].sort()), "question set hash");
  }
  equal(readerManifest!.systems, freeze.systems, "reader system order");
  equal(readerManifest!.budget, freeze.budget, "reader retrieval budget");
  const extractor=object(freeze.extractor), readerProfile=object(freeze.reader), judgeProfile=object(freeze.judge);
  const up=object(units.provider), rp=object(reader.provider), jp=object(judge.provider);
  for(const p of [up,rp,jp]){equal(p.transport,freeze.provider,"transport");equal(p.temperature,0,"temperature");}
  equal(object(units.extraction).concurrency,extractor.concurrency,"extraction concurrency");
  equal(up.extractor,extractor.model,"extractor model");equal(up.maximumOutput,extractor.maximumOutputTokens,"extractor tokens");
  equal(up.responseSchemaSha256,extractor.schemaSha256,"extraction schema");
  equal(up.responseFormat,"json_schema","extraction response format");
  const bundle=object(units.unitBundle), be=object(bundle.extractor);
  equal(bundle.datasetSha256,selection.source.sha256,"unit dataset");
  equal(be.reader,extractor.model,"unit model");equal(be.promptSha256,extractor.promptSha256,"unit prompt");
  equal(be.maximumOutput,extractor.maximumOutputTokens,"unit output tokens");
  equal(object(reader.memoryUnits).reportSha256,sha256Hex(input.units),"unit report bytes");
  equal(object(reader.memoryUnits).promptSha256,extractor.promptSha256,"reader unit prompt");
  equal(rp.reader,readerProfile.model,"reader model");equal(rp.maxCompletionTokens,readerProfile.maximumOutputTokens,"reader tokens");
  equal(rp.promptProfile,readerProfile.promptProfile,"reader profile");equal(rp.promptSha256,readerProfile.promptSha256,"reader prompt");
  equal(rp.samplingSeed,readerProfile.samplingSeed,"reader sampling seed");
  equal(rp.queryOrder,readerProfile.order,"query order");
  const source=object(judge.sourceReport);
  equal(source.sha256,sha256Hex(input.reader),"judge source bytes");
  equal(source.readerSourceSha256,code.sourceSha256,"judge reader code");
  equal(source.reader,readerProfile.model,"judge reader model");equal(source.readerTransport,freeze.provider,"judge reader transport");
  equal(jp.judge,judgeProfile.model,"judge model");equal(jp.maxCompletionTokens,judgeProfile.maximumOutputTokens,"judge tokens");
  equal(object(judge.judgeProfile).sha256,judgeProfile.profileSha256,"judge profile hash");
  equal(judge.judgeProtocol,judgeProfile.profileId,"judge profile");
  if(!Array.isArray(reader.rows)||!Array.isArray(judge.rows))throw new TypeError("Missing confirmation rows.");
  // The reader must also contain exactly the same complete matrix, without accepting its diagnostic scores as judgments.
  assessSuperiority(selection.poolSize,selection.selected,reader.rows.map(raw=>{
    const row=object(raw);
    if(row.status!=="completed"||typeof row.prediction!=="string"||row.prediction.trim()==="")throw new Error("Incomplete reader case.");
    return {...row,correct:0};
  }));
  if(reader.rows.length!==selection.sampleSize*3)throw new Error("Incomplete reader matrix.");
  const result=assessSuperiority(selection.poolSize,selection.selected,judge.rows);
  return {protocol:"oh.memory-superiority-result.v1",...result,scorerSourceSha256,artifacts:Object.fromEntries(
    Object.entries(input).map(([name,bytes])=>[name,sha256Hex(bytes)])),poolSize:selection.poolSize,sampleSize:selection.sampleSize};
}

if(import.meta.main){
  const [freeze,selection,units,reader,judge,output,...extra]=process.argv.slice(2);
  if(!freeze||!selection||!units||!reader||!judge||!output||extra.length)throw new TypeError(
    "Usage: bun scripts/benchmarks/confirm.ts FREEZE SELECTION UNITS ANSWERS JUDGE NEW_OUTPUT");
  const paths={freeze,selection,units,reader,judge};
  const inputs=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>{
    const file=Bun.file(path);if(!await file.exists()||file.size>MAX_REPORT_BYTES)throw new RangeError("Invalid report file.");
    return [key,await file.bytes()];
  }))) as Inputs;
  const currentCode=await codeIdentity();
  const result=confirmStudy(inputs,currentCode.sourceSha256);
  await writeJson(output,result);
  console.log(JSON.stringify(result,null,2));
}
