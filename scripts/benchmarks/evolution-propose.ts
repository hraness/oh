#!/usr/bin/env bun
/**
 * Offline development proposal builder. Selection uses pinned aggregates and attempt metadata,
 * without using prompt/answer content or opening raw captures. It sends no requests.
 *
 * Usage:
 *   bun scripts/benchmarks/evolution-propose.ts --report REPORT --report-sha256 SHA --reader-plan PLAN --reader-output PHASE --config CONFIG \
 *     --reader PROFILE --parent-limit N --child-limit N --maximum-population N --output PROPOSAL \
 *     [--specialists category-a,category-b]
 */
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../../src/canonical";
import { createEvolutionSeedCandidate, crossoverEvolutionCandidates, mutateEvolutionCandidate, parseEvolutionPopulationPolicy,
  selectEvolutionParents, type EvolutionCandidate, type EvolutionDevelopmentFitness, type EvolutionGeneAxis } from "./evolution-population";
import { evolutionPhaseAttempts, parseEvolutionRunConfig } from "./evolution";
import { validateEvolutionAttemptFailure } from "./evolution-store";
import { validateEvolutionRequest, type EvolutionRequest } from "./evolution-model";

const SHA = /^[a-f0-9]{64}$/;
type RecordValue = Record<string, unknown>;
function fail(message: string): never { throw new TypeError(`Evolution population proposal: ${message}.`); }
function record(value: unknown, label: string): RecordValue { if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`); return value as RecordValue; }
function array(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) fail(`${label} must be an array`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > 4096) fail(`invalid ${label}`); return value; }
function digest(value: unknown, label: string): string { const result = text(value, label); if (!SHA.test(result)) fail(`invalid ${label}`); return result; }
function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum || Object.is(value, -0)) fail(`invalid ${label}`);
  return value;
}
function duration(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0) || value > 86_400_000) fail(`invalid ${label}`);
  return value;
}
function absolutePath(value: unknown, label: string): string {
  const result = text(value, label);
  if (resolve(result) !== result) fail(`${label} must be an absolute canonical path`);
  return result;
}
async function jsonFile(path: string, label: string): Promise<readonly [RecordValue, Uint8Array]> {
  const absolute = absolutePath(path, label), file = await open(absolute, "r");
  let bytes: Uint8Array;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 256 * 1024 * 1024) fail(`${label} byte bound exceeded`);
    bytes = new Uint8Array(stat.size);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) fail(`${label} changed while reading`);
  } finally { await file.close(); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(`invalid ${label} JSON`); }
  return [record(value, label), bytes];
}
export function parseEvolutionProposalArgs(args: readonly string[]) {
  const names = new Set(["report", "report-sha256", "reader-plan", "reader-output", "config", "reader", "parent-limit", "child-limit", "maximum-population", "output", "specialists"]);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (typeof flag !== "string" || !flag.startsWith("--") || typeof value !== "string" || !names.has(flag.slice(2)) || values.has(flag.slice(2))) fail("exact, unique --flag value pairs required");
    values.set(flag.slice(2), value);
  }
  for (const required of ["report", "report-sha256", "reader-plan", "reader-output", "config", "reader", "parent-limit", "child-limit", "maximum-population", "output"]) if (!values.has(required)) fail(`missing --${required}`);
  digest(values.get("report-sha256"), "report SHA-256");
  for (const name of ["report", "reader-plan", "reader-output", "config", "output"]) absolutePath(values.get(name), name);
  for (const name of ["parent-limit", "child-limit", "maximum-population"]) if (!/^(?:0|[1-9]\d*)$/.test(values.get(name)!)) fail(`invalid ${name}`);
  return values;
}
function sameSet(left: readonly string[], right: readonly string[], label: string): void {
  if (left.length !== new Set(left).size || right.length !== new Set(right).size || left.length !== right.length
    || [...left].sort().some((value, index) => value !== [...right].sort()[index])) fail(`${label} is not exact`);
}
function metric(arm: RecordValue) {
  const matches = array(arm.metrics, "arm metrics").map(value => record(value, "metric")).filter(value => value.metric === "judge-accuracy");
  if (matches.length !== 1) fail("one judge-accuracy metric is required per arm");
  const overall = record(matches[0]!.overall, "judge-accuracy overall");
  const cases = integer(overall.cases, "judge-accuracy cases", 1, 20_000);
  if (integer(overall.scored, "judge-accuracy scored", 0, cases) !== cases || integer(overall.unscored, "judge-accuracy unscored", 0, cases) !== 0) fail("complete answer scoring required");
  const mean = overall.mean;
  if (typeof mean !== "number" || !Number.isFinite(mean) || mean < 0 || mean > 1) fail("invalid judge-accuracy mean");
  const correct = Math.round(mean * cases);
  if (!Number.isSafeInteger(correct) || mean !== correct / cases) fail("judge accuracy is not an observed integer score");
  const categories = array(matches[0]!.byCategory, "judge-accuracy categories").map(value => {
    const category = record(value, "judge-accuracy category"), total = integer(category.cases, "category cases", 1, cases);
    if (integer(category.scored, "category scored", 0, total) !== total || integer(category.unscored, "category unscored", 0, total) !== 0) fail("complete category scoring required");
    const correct = typeof category.mean === "number" ? Math.round(category.mean * total) : NaN;
    if (typeof category.mean !== "number" || !Number.isFinite(category.mean) || category.mean < 0 || category.mean > 1
      || !Number.isSafeInteger(correct) || category.mean !== correct / total) fail("category accuracy is not an observed integer score");
    return { id: text(category.id, "category ID"), correct, total };
  });
  if (new Set(categories.map(category => category.id)).size !== categories.length || categories.reduce((total, category) => total + category.total, 0) !== cases
    || categories.reduce((total, category) => total + category.correct, 0) !== correct) fail("incomplete category partition");
  return { correct, total: cases, categories };
}
function latency(arm: RecordValue, expectedPhysical: number, expectedUnknownDispatches: number): { totalMs: number; unmeasured: number } {
  const reader = record(record(arm.latency, "arm latency").reader, "reader latency");
  const unmeasured = integer(reader.unmeasuredPhysicalRequests, "unmeasured reader physical requests", 0, 20_000);
  if (integer(reader.attributedPhysicalRequests, "attributed reader physical requests", 0, 20_000) !== expectedPhysical
    || integer(reader.unknownDispatches ?? 0, "unknown reader dispatches", 0, 20_000) !== expectedUnknownDispatches
    || integer(reader.count, "measured reader physical requests", 0, 20_000) + unmeasured !== expectedPhysical) fail("reader service latency does not match occupied attempts");
  return { totalMs: duration(reader.totalMs, "reader service latency"), unmeasured };
}
function seedFor(value: unknown): number { return Number.parseInt(canonicalSha256(value).slice(0, 8), 16); }
function uniqueGenome(candidate: EvolutionCandidate, seen: Set<string>, output: EvolutionCandidate[]): boolean {
  if (seen.has(candidate.genomeSha256)) return false;
  seen.add(candidate.genomeSha256); output.push(candidate); return true;
}

export type EvolutionProposalBuildInput = Readonly<{ flags: ReadonlyMap<string, string>; report: RecordValue; reportBytes: Uint8Array; reportSha256: string;
  readerPlan: RecordValue; readerOutput: RecordValue; readerOutputSha256: string; config: RecordValue; configSha256: string }>;
/** Builds deterministic candidates from a caller-authenticated report pin; it sends no requests. */
export function buildEvolutionProposal(source: EvolutionProposalBuildInput) {
const input = source.flags, { report, readerPlan, readerOutput, config } = source;
const reportSha256 = digest(source.reportSha256, "externally supplied report SHA-256"), configSha256 = digest(source.configSha256, "config SHA-256"), profile = text(input.get("reader")!, "reader profile");
if (!(source.reportBytes instanceof Uint8Array) || sha256Hex(source.reportBytes) !== reportSha256) fail("report bytes do not match the externally supplied report pin");
const parentLimit = integer(Number(input.get("parent-limit")), "parent limit", 1, 128), childLimit = integer(Number(input.get("child-limit")), "child limit", 0, 128);
const maximumPopulation = integer(Number(input.get("maximum-population")), "maximum population", 1, 128);
if (report.protocol !== "oh.memory.evolution-report.v1" || report.status !== "complete") fail("complete authenticated evolution report required");
const reportDataset = record(report.dataset, "report dataset"), reportPins = record(report.pins, "report pins"), reportCoverage = record(report.coverage, "report coverage"), reportScoring = record(report.scoring, "report scoring");
if (reportDataset.partition !== "development") fail("development-only complete report required");
const pins = { manifestSha256: digest(reportPins.manifestSha256, "report manifest pin"), sourceSha256: digest(reportPins.sourceSha256, "report source pin"),
  selectedDatasetSha256: digest(reportPins.selectedDatasetSha256, "report dataset pin"), contextPlanSha256: digest(reportPins.contextPlanSha256, "report context pin"),
  readerPlanSha256: digest(reportPins.readerPlanSha256, "report reader plan pin"), readerOutputSha256: digest(reportPins.readerOutputSha256, "report reader output pin"),
  judgePlanSha256: digest(reportPins.judgePlanSha256, "report judge plan pin"), judgeOutputSha256: digest(reportPins.judgeOutputSha256, "report judge output pin"), rubricSha256: digest(reportPins.rubricSha256, "report rubric pin") };
if (digest(source.readerOutputSha256, "reader output SHA-256") !== pins.readerOutputSha256) fail("reader output bytes do not match the report pin");
if (readerPlan.planSha256 !== pins.readerPlanSha256 || readerPlan.contextPlanSha256 !== pins.contextPlanSha256 || readerPlan.manifestSha256 !== pins.manifestSha256) fail("reader plan does not match report pins");
const { planSha256: readerPlanSha256, ...readerPlanPayload } = readerPlan;
if (canonicalSha256(readerPlanPayload) !== readerPlanSha256) fail("reader plan identity changed");
if (readerOutput.protocol !== "oh.memory.evolution-phase.v1" || readerOutput.phase !== "reader" || readerOutput.complete !== true || readerOutput.planSha256 !== readerPlanSha256) fail("complete reader phase does not bind the reader plan");
const parsedConfig = parseEvolutionRunConfig(config);
if (parsedConfig.datasetPin.sha256 !== pins.sourceSha256 || parsedConfig.manifestPin.sha256 !== pins.manifestSha256) fail("config does not bind the report source and manifest pins");
const receiptConfigPin = record(readerOutput.configPin, "reader receipt config pin");
if (absolutePath(receiptConfigPin.path, "reader receipt config path") !== absolutePath(input.get("config"), "config")
  || digest(receiptConfigPin.sha256, "reader receipt config sha256") !== configSha256) fail("supplied config does not exactly match the reader receipt pin");
const variants = parsedConfig.variants.map(variant => ({ id: variant.id, system: variant.system, topK: variant.budget.topK, contextBytes: variant.budget.contextBytes }));
const policy = parseEvolutionPopulationPolicy({ protocol: "oh.evolution-population-policy.v1", mode: "fixed-reader-memory", fixedReader: profile,
  allowed: { system: [...new Set(variants.map(variant => variant.system))], topK: [...new Set(variants.map(variant => variant.topK))],
    contextBytes: [...new Set(variants.map(variant => variant.contextBytes))], reader: [profile] }, maximumPopulation });
const planProfiles = array(readerPlan.readerProfiles, "reader profiles").map(value => text(value, "reader profile"));
if (!planProfiles.includes(profile)) fail("fixed reader is absent from pinned reader plan");
const requests = array(readerPlan.requests, "reader requests").map(value => validateEvolutionRequest(record(value, "reader request") as unknown as EvolutionRequest));
const requestBySha = new Map(requests.map(request => [digest(request.requestSha256, "reader request digest"), request]));
if (requestBySha.size !== requests.length) fail("duplicate physical reader request");
const phaseAttempts = evolutionPhaseAttempts(readerOutput, "reader", readerPlanSha256, requests as EvolutionRequest[]);
const phaseBySha = new Map([...phaseAttempts.responses].map(([requestSha256, response]) => [requestSha256, record(response, "phase response")]));
const failuresBySha = new Map([...phaseAttempts.failures].map(([requestSha256, failure]) => [requestSha256, validateEvolutionAttemptFailure(failure, requestBySha.get(requestSha256) as EvolutionRequest)]));
if (reportCoverage.completeAttemptCoverage !== true && failuresBySha.size !== 0) fail("report does not declare complete attempt coverage");
if (reportCoverage.completeAttemptCoverage !== undefined && reportCoverage.completeAttemptCoverage !== true) fail("report attempt coverage is incomplete");
for (const [requestSha256, response] of phaseBySha) {
  if (digest(response.requestSha256, "response request digest") !== requestSha256) fail("response request identity changed");
  const usage = record(response.usage, "response usage"); integer(usage.micros, "captured response micros", 0, 1_000_000_000_000);
}
const readerCases = array(readerPlan.cases, "reader cases").map(value => record(value, "reader case"));
if (integer(reportCoverage.logicalReaderCases, "report logical reader cases", 1, 200_000) !== readerCases.length
  || integer(reportCoverage.logicalJudgeCases, "report logical judge cases", 1, 200_000) !== readerCases.length) fail("report logical phase coverage changed");
const selectedCases = readerCases.filter(value => value.reader === profile).map(value => {
  const questionId = text(value.questionId, "question identity");
  if (!/^q-[a-f0-9]{64}$/.test(questionId)) fail("invalid question identity");
  return { questionId, variantId: text(value.variantId, "case variant"), requestSha256: digest(value.requestSha256, "case request digest") };
});
if (selectedCases.length === 0 || selectedCases.some(value => !requestBySha.has(value.requestSha256))) fail("reader case request is missing");
const selectedQuestions = integer(reportDataset.selectedQuestions, "selected question count", 1, 20_000);
if (integer(reportCoverage.expectedQuestionsPerArm, "report questions per arm", 1, 20_000) !== selectedQuestions) fail("report question coverage changed");
const expectedVariants = variants.map(variant => variant.id), selectedVariantSet = [...new Set(selectedCases.map(value => value.variantId))];
sameSet(expectedVariants, selectedVariantSet, "config and selected reader variants");
for (const variantId of expectedVariants) {
  const questionIds = selectedCases.filter(value => value.variantId === variantId).map(value => value.questionId);
  if (questionIds.length !== selectedQuestions || new Set(questionIds).size !== selectedQuestions) fail("reader cases do not cover each development question exactly once");
}
const pairedQuestionIds = expectedVariants.map(variantId => selectedCases.filter(value => value.variantId === variantId).map(value => value.questionId).sort());
if (pairedQuestionIds.some(questionIds => questionIds.some((value, index) => value !== pairedQuestionIds[0]![index]))) fail("reader variants do not share the exact paired development questions");
const arms = array(report.arms, "report arms").map(value => record(value, "report arm")).filter(value => value.reader === profile);
if (arms.length !== variants.length || new Set(arms.map(value => text(value.variantId, "report variant"))).size !== arms.length) fail("complete paired report arms required for selected reader");
sameSet(arms.map(value => text(value.variantId, "report variant")), expectedVariants, "report and config variants");
const evaluationIdentity = { protocol: "oh.evolution-paired-development.v1" as const, split: "development" as const, design: "paired" as const,
  datasetSha256: pins.selectedDatasetSha256, selectionSha256: canonicalSha256({ contextPlanSha256: pins.contextPlanSha256, readerPlanSha256: pins.readerPlanSha256,
    readerOutputSha256: pins.readerOutputSha256, reader: profile, variants: expectedVariants }),
  judgeProfileSha256: canonicalSha256({ profile: reportScoring.judgeProfile, rule: reportScoring.judgeRule, reference: reportScoring.judgeReference, rubricSha256: pins.rubricSha256 }),
  evaluationProtocolSha256: canonicalSha256({ reportProtocol: report.protocol, judgePlanSha256: pins.judgePlanSha256, judgeOutputSha256: pins.judgeOutputSha256,
    failurePolicy: reportScoring.failurePolicy, judgeRule: reportScoring.judgeRule }), totalQuestions: selectedQuestions };
const candidates: EvolutionCandidate[] = [], fitness: EvolutionDevelopmentFitness[] = [];
for (const variant of variants) {
  const arm = arms.find(value => value.variantId === variant.id)!;
  const observed = metric(arm), physical = [...new Set(selectedCases.filter(value => value.variantId === variant.id).map(value => value.requestSha256))];
  const zeroScoredLogicalCases = selectedCases.filter(value => value.variantId === variant.id
    && (failuresBySha.has(value.requestSha256) || phaseBySha.get(value.requestSha256)?.status !== "completed")).length;
  if (integer(arm.readerFailures, "report reader failures", 0, selectedQuestions) !== zeroScoredLogicalCases
    || observed.correct > observed.total - zeroScoredLogicalCases) fail("reader failures must remain zero-scored");
  const knownPhysical = physical.filter(requestSha256 => failuresBySha.get(requestSha256)?.storeStatus !== "reserved");
  const unknownDispatches = physical.length - knownPhysical.length;
  const costMicros = physical.reduce((sum, requestSha256) => {
    const response = phaseBySha.get(requestSha256), failure = failuresBySha.get(requestSha256);
    if (response !== undefined) return sum + integer(record(response.usage, "response usage").micros, "captured response micros", 0, 1_000_000_000_000);
    if (failure !== undefined) return sum + integer(failure.reservationMicros, "unresolved reservation micros", 0, 1_000_000_000_000);
    fail("attempt coverage changed");
  }, 0);
  const candidate = createEvolutionSeedCandidate({ system: variant.system as never, topK: variant.topK, contextBytes: variant.contextBytes, reader: profile as never }, policy,
    { hypothesis: "Observed declared development configuration; no answer-tuned mutation.", seed: seedFor({ reportSha256, profile, variant: variant.id }) });
  candidates.push(candidate);
  const timing = latency(arm, knownPhysical.length, unknownDispatches);
  if (unknownDispatches !== 0 || timing.unmeasured !== 0) fail("unmeasured reader timing cannot enter parent selection");
  fitness.push({ protocol: "oh.evolution-development-fitness.v1", identity: evaluationIdentity, candidateId: candidate.id, reportSha256,
    correct: observed.correct, total: observed.total, costMicros, latencyMs: timing.totalMs, categories: observed.categories });
}
if (candidates.length + childLimit > maximumPopulation || parentLimit > candidates.length) fail("population or parent bound cannot retain the complete observed frontier");
const specialistCategories = input.has("specialists") && input.get("specialists") !== "" ? input.get("specialists")!.split(",") : [];
if (specialistCategories.some(category => category.length === 0) || new Set(specialistCategories).size !== specialistCategories.length) fail("invalid specialist category list");
const selection = selectEvolutionParents({ policy, candidates, results: fitness, identity: evaluationIdentity, limit: parentLimit,
  ...(specialistCategories.length ? { specialistCategories } : {}) });
const children: EvolutionCandidate[] = [], seen = new Set(candidates.map(candidate => candidate.genomeSha256));
const axes: readonly EvolutionGeneAxis[] = ["system", "topK", "contextBytes"];
for (const parent of [...selection.parents].sort((left, right) => left.id.localeCompare(right.id))) for (const axis of axes) {
  if (children.length >= childLimit) break;
  try { uniqueGenome(mutateEvolutionCandidate(parent, policy, { hypothesis: `Deterministic one-axis ${axis} mutation from pinned development parent.`,
    seed: seedFor({ reportSha256, parent: parent.id, axis }), axis }), seen, children); } catch (error) {
    if (!(error instanceof TypeError) || !error.message.includes("single-axis")) throw error;
  }
}
const parents = [...selection.parents].sort((left, right) => left.id.localeCompare(right.id));
for (let left = 0; left < parents.length && children.length < childLimit; left++) for (let right = left + 1; right < parents.length && children.length < childLimit; right++) {
  uniqueGenome(crossoverEvolutionCandidates(parents[left]!, parents[right]!, policy, { hypothesis: "Deterministic crossover of pinned development parents.",
    seed: seedFor({ reportSha256, left: parents[left]!.id, right: parents[right]!.id }) }), seen, children);
}
const output = { protocol: "oh.memory.evolution-population-proposal.v1", status: "proposal-only", qualification: "Development-only candidate proposal from an externally pinned report produced by the authenticated reporter. This command does not reopen the store. Verified responses use captured usage; authenticated unresolved attempts use their full preserved reservation conservatively and remain zero-scored. No model calls, answer tuning, new fitness, held-out score, or superiority claim.",
  inputs: { report: { path: absolutePath(input.get("report"), "report"), sha256: reportSha256 }, config: { path: absolutePath(input.get("config"), "config"), sha256: configSha256,
      receiptPin: { path: absolutePath(receiptConfigPin!.path, "reader receipt config path"), sha256: digest(receiptConfigPin!.sha256, "reader receipt config sha256") } },
    readerPlan: { path: absolutePath(input.get("reader-plan"), "reader plan"), sha256: pins.readerPlanSha256 }, readerOutput: { path: absolutePath(input.get("reader-output"), "reader output"), sha256: pins.readerOutputSha256 }, fixedReader: profile },
  lineage: { reportSha256, configSha256, readerPlanSha256: pins.readerPlanSha256, readerOutputSha256: pins.readerOutputSha256,
    selectionSha256: selection.selectionSha256 },
  policy, identity: evaluationIdentity, observed: { candidates, fitness, selection }, proposed: { requestedChildren: childLimit, createdChildren: children.length,
    omittedChildren: childLimit - children.length, candidates: children, qualification: "Mutations change one declared retrieval axis; crossovers combine only selected parents and declared system/top-K/context domains." } };
return output;
}

if (import.meta.main) {
  const flags = parseEvolutionProposalArgs(Bun.argv.slice(2));
  const [report, reportBytes] = await jsonFile(flags.get("report")!, "report");
  const reportSha256 = digest(flags.get("report-sha256"), "report SHA-256");
  if (sha256Hex(reportBytes) !== reportSha256) fail("report bytes do not match the externally supplied report pin");
  const [readerPlan] = await jsonFile(flags.get("reader-plan")!, "reader plan");
  const [readerOutput, readerOutputBytes] = await jsonFile(flags.get("reader-output")!, "reader output");
  const [config, configBytes] = await jsonFile(flags.get("config")!, "config");
  const output = buildEvolutionProposal({ flags, report, reportBytes, reportSha256, readerPlan, readerOutput, readerOutputSha256: sha256Hex(readerOutputBytes), config, configSha256: sha256Hex(configBytes) });
  const outputPath = absolutePath(flags.get("output"), "output"), file = await open(outputPath, "wx", 0o600);
  const outputBytes = new TextEncoder().encode(`${canonicalJson(output)}\n`);
  try { await file.writeFile(outputBytes); await file.sync(); }
  finally { await file.close(); }
  console.log(canonicalJson({ status: "proposed", output: outputPath, sha256: sha256Hex(outputBytes), observed: output.observed.candidates.length, parents: output.observed.selection.parentIds.length, children: output.proposed.candidates.length }));
}
