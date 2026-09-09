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
  selectEvolutionParents, validateEvolutionCandidate, type EvolutionCandidate, type EvolutionDevelopmentFitness, type EvolutionGeneAxis } from "./evolution-population";
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
function jsonRecord(bytes: Uint8Array, label: string): RecordValue {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 256 * 1024 * 1024) fail(`${label} byte bound exceeded`);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(`invalid ${label} JSON`); }
  return record(value, label);
}
function samePinnedRecord(supplied: RecordValue, pinned: RecordValue, label: string): void {
  if (canonicalJson(supplied) !== canonicalJson(pinned)) fail(`${label} object differs from pinned bytes`);
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
  return [jsonRecord(bytes, label), bytes];
}
export function parseEvolutionProposalArgs(args: readonly string[]) {
  const names = new Set(["report", "report-sha256", "reader-plan", "reader-output", "config", "reader", "parent-limit", "child-limit", "maximum-population", "output", "specialists", "previous-proposal", "previous-proposal-sha256"]);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (typeof flag !== "string" || !flag.startsWith("--") || typeof value !== "string" || !names.has(flag.slice(2)) || values.has(flag.slice(2))) fail("exact, unique --flag value pairs required");
    values.set(flag.slice(2), value);
  }
  for (const required of ["report", "report-sha256", "reader-plan", "reader-output", "config", "reader", "parent-limit", "child-limit", "maximum-population", "output"]) if (!values.has(required)) fail(`missing --${required}`);
  digest(values.get("report-sha256"), "report SHA-256");
  if (values.has("previous-proposal") !== values.has("previous-proposal-sha256")) fail("previous proposal path and SHA-256 must be supplied together");
  if (values.has("previous-proposal")) { absolutePath(values.get("previous-proposal"), "previous proposal"); digest(values.get("previous-proposal-sha256"), "previous proposal SHA-256"); }
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
  readerPlan: RecordValue; readerPlanBytes: Uint8Array; readerOutput: RecordValue; readerOutputBytes: Uint8Array; readerOutputSha256: string;
  config: RecordValue; configBytes: Uint8Array; configSha256: string;
  previousProposal?: RecordValue; previousProposalBytes?: Uint8Array; previousProposalSha256?: string }>;
type ArchivedCandidate = Readonly<{ status: "observed" | "proposed"; candidate: EvolutionCandidate }>;
function priorProposal(source: EvolutionProposalBuildInput, profile: string) {
  if (source.previousProposal === undefined && source.previousProposalBytes === undefined && source.previousProposalSha256 === undefined) return null;
  if (source.previousProposal === undefined || source.previousProposalBytes === undefined || source.previousProposalSha256 === undefined) fail("incomplete previous proposal input");
  const proposalSha256 = digest(source.previousProposalSha256, "previous proposal SHA-256");
  if (!(source.previousProposalBytes instanceof Uint8Array) || sha256Hex(source.previousProposalBytes) !== proposalSha256) fail("previous proposal bytes do not match the supplied pin");
  const value = jsonRecord(source.previousProposalBytes, "previous proposal");
  samePinnedRecord(source.previousProposal, value, "previous proposal");
  if (value.protocol !== "oh.memory.evolution-population-proposal.v1" || value.status !== "proposal-only") fail("previous proposal is not a proposal-only record");
  const priorInputs = record(value.inputs, "previous proposal inputs"), priorLineage = record(value.lineage, "previous proposal lineage");
  if (text(priorInputs.fixedReader, "previous fixed reader") !== profile) fail("previous proposal reader changed");
  const priorInputPins = {
    reportSha256: digest(record(priorInputs.report, "previous report input").sha256, "previous report input pin"),
    configSha256: digest(record(priorInputs.config, "previous config input").sha256, "previous config input pin"),
    readerPlanSha256: digest(record(priorInputs.readerPlan, "previous reader plan input").sha256, "previous reader plan input pin"),
    readerOutputSha256: digest(record(priorInputs.readerOutput, "previous reader output input").sha256, "previous reader output input pin"),
  };
  for (const [name, pin] of Object.entries(priorInputPins)) if (pin !== digest(priorLineage[name], `previous ${name} lineage pin`)) fail("previous proposal input and lineage pins differ");
  const priorPolicyValue = record(value.policy, "previous proposal policy"), { policySha256, ...policyPayload } = priorPolicyValue;
  const policy = parseEvolutionPopulationPolicy(policyPayload);
  if (digest(policySha256, "previous policy SHA-256") !== policy.policySha256 || policy.fixedReader !== profile) fail("previous policy changed");
  const observed = record(value.observed, "previous observed candidates"), proposed = record(value.proposed, "previous proposed candidates");
  const observedCandidates = array(observed.candidates, "previous observed candidates").map(candidate => {
    try { return validateEvolutionCandidate(record(candidate, "previous observed candidate") as unknown as EvolutionCandidate, policy); } catch { fail("invalid previous observed candidate"); }
  });
  const proposedCandidates = array(proposed.candidates, "previous proposed candidates").map(candidate => {
    try { return validateEvolutionCandidate(record(candidate, "previous proposed candidate") as unknown as EvolutionCandidate, policy); } catch { fail("invalid previous proposed candidate"); }
  });
  const byId = new Map(observedCandidates.map(candidate => [candidate.id, candidate]));
  if (byId.size !== observedCandidates.length || new Set(proposedCandidates.map(candidate => candidate.id)).size !== proposedCandidates.length
    || proposedCandidates.some(candidate => byId.has(candidate.id))) fail("previous candidate identity is duplicate");
  const selection = record(observed.selection, "previous selection"), parentIds = array(selection.parentIds, "previous selected parent IDs").map(value => digest(value, "previous selected parent ID"));
  const fitness = array(observed.fitness, "previous observed fitness").map(value => record(value, "previous observed fitness"));
  const fitnessByCandidateId = new Map(fitness.map(value => [digest(value.candidateId, "previous fitness candidate ID"), value]));
  if (parentIds.length < 1 || parentIds.length !== new Set(parentIds).size || parentIds.some(id => !byId.has(id) || !fitnessByCandidateId.has(id))
    || fitnessByCandidateId.size !== observedCandidates.length || fitness.some(value => digest(value.reportSha256, "previous fitness report pin") !== priorInputPins.reportSha256)) fail("previous selected parents are not completely observed");
  const historicalIdentity = record(value.identity, "previous evaluation identity");
  const historicalLimit = integer(selection.requestedLimit, "previous selection limit", 1, observedCandidates.length);
  const historicalSpecialists = array(selection.specialistCategories, "previous selection specialists").map(value => text(value, "previous selection specialist"));
  let replayedSelection: ReturnType<typeof selectEvolutionParents>;
  try {
    replayedSelection = selectEvolutionParents({ policy, candidates: observedCandidates, results: fitness as unknown as EvolutionDevelopmentFitness[],
      identity: historicalIdentity as never, limit: historicalLimit, ...(historicalSpecialists.length ? { specialistCategories: historicalSpecialists } : {}) });
  } catch { return fail("previous observed fitness or selection is not reproducible"); }
  if (canonicalJson(selection) !== canonicalJson(replayedSelection)
    || digest(priorLineage.selectionSha256, "previous selection lineage pin") !== replayedSelection.selectionSha256) fail("previous selection does not match pinned fitness and identity");
  const historyValue = value.history === undefined ? [] : array(record(value.history, "previous history").archive, "previous archive");
  const archive = historyValue.map(value => {
    const row = record(value, "previous archive row");
    if (row.status !== "observed" && row.status !== "proposed") fail("invalid previous archive status");
    try { return { status: row.status, candidate: validateEvolutionCandidate(record(row.candidate, "previous archive candidate") as unknown as EvolutionCandidate, policy) } as ArchivedCandidate; }
    catch { return fail("invalid previous archived candidate"); }
  });
  const all = [...archive, ...observedCandidates.map(candidate => ({ status: "observed" as const, candidate })), ...proposedCandidates.map(candidate => ({ status: "proposed" as const, candidate }))];
  const seen = new Map<string, ArchivedCandidate>();
  for (const row of all) {
    const prior = seen.get(row.candidate.id);
    if (prior !== undefined && prior.candidate.genomeSha256 !== row.candidate.genomeSha256) fail("previous archive candidate identity changed");
    seen.set(row.candidate.id, row);
  }
  for (const row of seen.values()) {
    const candidate = row.candidate, parents = candidate.parentIds.map(parentId => seen.get(parentId)?.candidate);
    if (candidate.origin === "seed") continue;
    if (parents.some(parent => parent === undefined) || candidate.generation !== Math.max(...parents.map(parent => parent!.generation)) + 1) fail("previous candidate lineage is not preserved");
    let rebuilt: EvolutionCandidate;
    try {
      rebuilt = candidate.origin === "mutation"
        ? mutateEvolutionCandidate(parents[0]!, policy, { hypothesis: candidate.hypothesis, seed: candidate.seed, axis: candidate.mutationAxis as EvolutionGeneAxis })
        : crossoverEvolutionCandidates(parents[0]!, parents[1]!, policy, { hypothesis: candidate.hypothesis, seed: candidate.seed });
    } catch { return fail("previous candidate lineage is not reproducible"); }
    if (canonicalJson(candidate) !== canonicalJson(rebuilt)) fail("previous candidate lineage is not reproducible");
  }
  const requestedChildren = integer(proposed.requestedChildren, "previous requested children", 0, 128);
  if (integer(proposed.createdChildren, "previous created children", 0, requestedChildren) !== proposedCandidates.length
    || integer(proposed.omittedChildren, "previous omitted children", 0, requestedChildren) !== requestedChildren - proposedCandidates.length
    || observedCandidates.length + requestedChildren > policy.maximumPopulation) fail("previous child bounds changed");
  const expectedChildren: EvolutionCandidate[] = [], priorGenomes = new Set(archive.map(row => row.candidate.genomeSha256));
  for (const candidate of observedCandidates) priorGenomes.add(candidate.genomeSha256);
  const axes: readonly EvolutionGeneAxis[] = ["system", "topK", "contextBytes"];
  for (const parent of [...replayedSelection.parents].sort((left, right) => left.id.localeCompare(right.id))) for (const axis of axes) {
    if (expectedChildren.length >= requestedChildren) break;
    try { uniqueGenome(mutateEvolutionCandidate(parent, policy, { hypothesis: `Deterministic one-axis ${axis} mutation from pinned development parent.`,
      seed: seedFor({ reportSha256: priorInputPins.reportSha256, parent: parent.id, axis }), axis }), priorGenomes, expectedChildren); } catch (error) {
      if (!(error instanceof TypeError) || !error.message.includes("single-axis")) throw error;
    }
  }
  const historicalParents = [...replayedSelection.parents].sort((left, right) => left.id.localeCompare(right.id));
  for (let left = 0; left < historicalParents.length && expectedChildren.length < requestedChildren; left++) for (let right = left + 1; right < historicalParents.length && expectedChildren.length < requestedChildren; right++) {
    uniqueGenome(crossoverEvolutionCandidates(historicalParents[left]!, historicalParents[right]!, policy, { hypothesis: "Deterministic crossover of pinned development parents.",
      seed: seedFor({ reportSha256: priorInputPins.reportSha256, left: historicalParents[left]!.id, right: historicalParents[right]!.id }) }), priorGenomes, expectedChildren);
  }
  if (canonicalJson(proposedCandidates) !== canonicalJson(expectedChildren)) fail("previous proposed children do not match pinned parent provenance");
  return { proposalSha256, policy, observedCandidates, proposedCandidates, selectedParents: [...replayedSelection.parents], archive: [...seen.values()] };
}
/** Builds deterministic candidates from a caller-authenticated report pin; it sends no requests. */
export function buildEvolutionProposal(source: EvolutionProposalBuildInput) {
const input = source.flags;
const reportSha256 = digest(source.reportSha256, "externally supplied report SHA-256"), configSha256 = digest(source.configSha256, "config SHA-256"), profile = text(input.get("reader")!, "reader profile");
if (!(source.reportBytes instanceof Uint8Array) || sha256Hex(source.reportBytes) !== reportSha256) fail("report bytes do not match the externally supplied report pin");
const report = jsonRecord(source.reportBytes, "report");
samePinnedRecord(source.report, report, "report");
if (!(source.configBytes instanceof Uint8Array) || sha256Hex(source.configBytes) !== configSha256) fail("config bytes do not match the supplied pin");
const config = jsonRecord(source.configBytes, "config");
samePinnedRecord(source.config, config, "config");
const readerPlan = jsonRecord(source.readerPlanBytes, "reader plan");
samePinnedRecord(source.readerPlan, readerPlan, "reader plan");
if (!(source.readerOutputBytes instanceof Uint8Array) || sha256Hex(source.readerOutputBytes) !== digest(source.readerOutputSha256, "reader output SHA-256")) fail("reader output bytes do not match the supplied pin");
const readerOutput = jsonRecord(source.readerOutputBytes, "reader output");
samePinnedRecord(source.readerOutput, readerOutput, "reader output");
const hasPriorFlags = input.has("previous-proposal") || input.has("previous-proposal-sha256");
const hasPriorPayload = source.previousProposal !== undefined || source.previousProposalBytes !== undefined || source.previousProposalSha256 !== undefined;
if (hasPriorFlags !== hasPriorPayload) fail("previous proposal flags and payload must be supplied together");
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
const prior = priorProposal(source, profile);
if (prior !== null && digest(input.get("previous-proposal-sha256"), "previous proposal CLI SHA-256") !== prior.proposalSha256) fail("previous proposal CLI pin does not match supplied bytes");
const policy = prior?.policy ?? parseEvolutionPopulationPolicy({ protocol: "oh.evolution-population-policy.v1", mode: "fixed-reader-memory", fixedReader: profile,
  allowed: { system: [...new Set(variants.map(variant => variant.system))], topK: [...new Set(variants.map(variant => variant.topK))],
    contextBytes: [...new Set(variants.map(variant => variant.contextBytes))], reader: [profile] }, maximumPopulation });
if (prior !== null && maximumPopulation !== policy.maximumPopulation) fail("continuation maximum population differs from the pinned policy");
const continuationCandidates = prior === null ? null : [...prior.selectedParents, ...prior.proposedCandidates];
if (continuationCandidates !== null) {
  const byId = new Map(continuationCandidates.map(candidate => [candidate.id, candidate]));
  if (byId.size !== continuationCandidates.length) fail("previous selected and proposed candidate identity is duplicate");
  sameSet(variants.map(variant => variant.id), continuationCandidates.map(candidate => candidate.id), "next configuration and previous candidate IDs");
  for (const variant of variants) {
    const candidate = byId.get(variant.id)!;
    if (candidate.genome.system !== variant.system || candidate.genome.topK !== variant.topK || candidate.genome.contextBytes !== variant.contextBytes
      || candidate.genome.reader !== profile) fail("next configuration does not exactly express the pinned candidate phenotype");
  }
}
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
  const candidate = continuationCandidates === null
    ? createEvolutionSeedCandidate({ system: variant.system as never, topK: variant.topK, contextBytes: variant.contextBytes, reader: profile as never }, policy,
      { hypothesis: "Observed declared development configuration; no answer-tuned mutation.", seed: seedFor({ reportSha256, profile, variant: variant.id }) })
    : continuationCandidates.find(candidate => candidate.id === variant.id)!;
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
const archive: ArchivedCandidate[] = prior === null ? [] : [...prior.archive];
const seen = new Set(archive.map(row => row.candidate.genomeSha256));
for (const candidate of candidates) seen.add(candidate.genomeSha256);
const children: EvolutionCandidate[] = [];
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
    readerPlan: { path: absolutePath(input.get("reader-plan"), "reader plan"), sha256: pins.readerPlanSha256 }, readerOutput: { path: absolutePath(input.get("reader-output"), "reader output"), sha256: pins.readerOutputSha256 }, fixedReader: profile,
    ...(prior === null ? {} : { previousProposal: { path: absolutePath(input.get("previous-proposal"), "previous proposal"), sha256: prior.proposalSha256 } }) },
  lineage: { reportSha256, configSha256, readerPlanSha256: pins.readerPlanSha256, readerOutputSha256: pins.readerOutputSha256,
    ...(prior === null ? {} : { previousProposalSha256: prior.proposalSha256 }), selectionSha256: selection.selectionSha256 },
  policy, identity: evaluationIdentity, history: { archive }, observed: { candidates, fitness, selection }, proposed: { requestedChildren: childLimit, createdChildren: children.length,
    omittedChildren: childLimit - children.length, candidates: children, qualification: "Mutations change one declared retrieval axis; crossovers combine only selected parents and declared system/top-K/context domains. Proposed children are untested and have no observed fitness." } };
return output;
}

if (import.meta.main) {
  const flags = parseEvolutionProposalArgs(Bun.argv.slice(2));
  const [report, reportBytes] = await jsonFile(flags.get("report")!, "report");
  const reportSha256 = digest(flags.get("report-sha256"), "report SHA-256");
  if (sha256Hex(reportBytes) !== reportSha256) fail("report bytes do not match the externally supplied report pin");
  const [readerPlan, readerPlanBytes] = await jsonFile(flags.get("reader-plan")!, "reader plan");
  const [readerOutput, readerOutputBytes] = await jsonFile(flags.get("reader-output")!, "reader output");
  const [config, configBytes] = await jsonFile(flags.get("config")!, "config");
  const previous = flags.has("previous-proposal") ? await jsonFile(flags.get("previous-proposal")!, "previous proposal") : null;
  const output = buildEvolutionProposal({ flags, report, reportBytes, reportSha256, readerPlan, readerPlanBytes, readerOutput, readerOutputBytes, readerOutputSha256: sha256Hex(readerOutputBytes), config, configBytes, configSha256: sha256Hex(configBytes),
    ...(previous === null ? {} : { previousProposal: previous[0], previousProposalBytes: previous[1], previousProposalSha256: flags.get("previous-proposal-sha256")! }) });
  const outputPath = absolutePath(flags.get("output"), "output"), file = await open(outputPath, "wx", 0o600);
  const outputBytes = new TextEncoder().encode(`${canonicalJson(output)}\n`);
  try { await file.writeFile(outputBytes); await file.sync(); }
  finally { await file.close(); }
  console.log(canonicalJson({ status: "proposed", output: outputPath, sha256: sha256Hex(outputBytes), observed: output.observed.candidates.length, parents: output.observed.selection.parentIds.length, children: output.proposed.candidates.length }));
}
