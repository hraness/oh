import { expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS } from "../scripts/benchmarks/datasets";
import { EVOLUTION_GATEWAY_ENDPOINT, makeEvolutionRequest, parseEvolutionResponse, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { createEvolutionSeedCandidate } from "../scripts/benchmarks/evolution-population";
import { buildEvolutionProposal, parseEvolutionProposalArgs } from "../scripts/benchmarks/evolution-propose";

const root = "/private/evolution-propose-test", bytes = (value: unknown) => new TextEncoder().encode(canonicalJson(value));
const digest = (label: string) => sha256Hex(`synthetic:${label}`);
const args = (reportSha256: string = digest("external-report")) => [
  "--report", `${root}/report.json`, "--report-sha256", reportSha256,
  "--reader-plan", `${root}/readers.json`, "--reader-output", `${root}/reader-phase.json`,
  "--config", `${root}/authorized-config.json`, "--reader", "gpt5-nano-reader",
  "--parent-limit", "1", "--child-limit", "1", "--maximum-population", "4", "--output", `${root}/proposal.json`,
];
function response(request: EvolutionRequest, finish = "stop") {
  return parseEvolutionResponse(bytes({ model: request.model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: "synthetic answer" } }],
    usage: { prompt_tokens: 100, completion_tokens: 3, total_tokens: 103 },
    ...(request.endpoint === EVOLUTION_GATEWAY_ENDPOINT ? { providerMetadata: { gateway: { routing: { finalProvider: request.provider,
      originalModelId: request.model, canonicalSlug: request.model, resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1) } } } } : {}) }), request);
}
type VariantSpec = Readonly<{ id: string; system: string; topK: number; contextBytes: number }>;
const initialVariants: readonly VariantSpec[] = [
  { id: "bm25-24k", system: "bm25-window", topK: 20, contextBytes: 24_000 },
  { id: "oh-96k", system: "oh-keyword", topK: 100, contextBytes: 96_000 },
  { id: "span-48k", system: "oh-source-spans", topK: 100, contextBytes: 48_000 },
];
function fixture(variantSpecs: readonly VariantSpec[] = initialVariants) {
  const config = { protocol: variantSpecs.some(variant => variant.system === "oh-source-spans") ? "oh.memory.evolution-run.v2" : "oh.memory.evolution-run.v1", dataset: "longmemeval-s", datasetPin: { path: `${root}/dataset.json`, sha256: DATASETS["longmemeval-s"].sha256 },
    manifestPin: { path: `${root}/manifest.json`, sha256: digest("manifest") }, campaignPin: { path: `${root}/campaign.json`, sha256: digest("campaign") }, limit: 100, seed: 1,
    variants: variantSpecs.map(variant => ({ id: variant.id, system: variant.system, budget: { topK: variant.topK, contextBytes: variant.contextBytes } })), readers: ["gpt5-nano-reader"], judge: "gpt4o-gateway-judge", directory: `${root}/run`, storeDirectory: `${root}/store`, concurrency: 1 };
  const configBytes = bytes(config), configSha256 = sha256Hex(configBytes), questions = Array.from({ length: 100 }, (_, index) => `q-${sha256Hex(`question:${index}`)}`);
  const requests: EvolutionRequest[] = [], cases: unknown[] = [];
  for (const variant of config.variants) for (const questionId of questions) {
    const request = makeEvolutionRequest("gpt5-nano-reader", [{ role: "system", content: "Use supplied context." }, { role: "user", content: `${variant.id}:${questionId}` }]);
    requests.push(request); cases.push({ questionId, variantId: variant.id, reader: "gpt5-nano-reader", contextSha256: digest(`context:${variant.id}:${questionId}`), requestSha256: request.requestSha256 });
  }
  const planPayload = { protocol: "oh.memory.evolution-reader-plan.v1", contextPlanSha256: digest("context-plan"), manifestSha256: config.manifestPin.sha256,
    readerProfiles: ["gpt5-nano-reader"], cases, requests };
  const readerPlan = { ...planPayload, planSha256: canonicalSha256(planPayload) };
  const failures = [requests[0]!].map(request => ({ requestSha256: request.requestSha256, profileSha256: request.profileSha256, repeat: 0,
    storeStatus: "captured", reason: "unverifiable-first-response", rawSha256: digest("unverifiable"), rawBytes: 17,
    transport: { httpStatus: null, complete: false, receivedBytes: 17, error: "network" }, serviceMs: 120_000, reservationMicros: request.reservationMicros }));
  const responses = requests.slice(1).map((request, index) => ({ requestSha256: request.requestSha256, response: response(request, index === 0 ? "length" : "stop") }));
  const readerOutputPayload = { protocol: "oh.memory.evolution-phase.v1", phase: "reader", planSha256: readerPlan.planSha256, complete: true,
    configPin: { path: `${root}/authorized-config.json`, sha256: configSha256 }, failures, responses };
  const readerOutputBytes = bytes(readerOutputPayload), readerOutputSha256 = sha256Hex(readerOutputBytes);
  const arm = (variantId: string) => ({ reader: "gpt5-nano-reader", variantId, readerFailures: variantId === config.variants[0]!.id ? 2 : 0,
    metrics: [{ metric: "judge-accuracy", overall: { cases: 100, scored: 100, unscored: 0, mean: 29 / 100 }, byCategory: [
      { id: "category-a", cases: 50, scored: 50, unscored: 0, mean: 15 / 50 }, { id: "category-b", cases: 50, scored: 50, unscored: 0, mean: 14 / 50 },
    ] }], latency: { reader: { attributedPhysicalRequests: 100, unknownDispatches: 0, count: 100, unmeasuredPhysicalRequests: 0, totalMs: 1_200 } } });
  const report = { protocol: "oh.memory.evolution-report.v1", status: "complete", dataset: { partition: "development", selectedQuestions: 100 },
    pins: { manifestSha256: config.manifestPin.sha256, sourceSha256: config.datasetPin.sha256, selectedDatasetSha256: digest("selected"), contextPlanSha256: readerPlan.contextPlanSha256,
      readerPlanSha256: readerPlan.planSha256, readerOutputSha256, judgePlanSha256: digest("judge-plan"), judgeOutputSha256: digest("judge-output"), rubricSha256: digest("rubric") },
    coverage: { completeAttemptCoverage: true, logicalReaderCases: requests.length, logicalJudgeCases: requests.length, expectedQuestionsPerArm: 100 },
    scoring: { judgeProfile: "gpt4o-gateway-judge", judgeRule: "synthetic-exact", judgeReference: "synthetic", failurePolicy: "zero" }, arms: config.variants.map(variant => arm(variant.id)) };
  const reportBytes = bytes(report);
  return { flags: parseEvolutionProposalArgs(args(sha256Hex(reportBytes))), report, reportBytes, reportSha256: sha256Hex(reportBytes), readerPlan, readerPlanBytes: bytes(readerPlan), readerOutput: readerOutputPayload,
    readerOutputBytes, readerOutputSha256, config, configBytes, configSha256, requests };
}
function build(value = fixture()) { return buildEvolutionProposal(value as Parameters<typeof buildEvolutionProposal>[0]); }
function withPrevious<T extends ReturnType<typeof fixture>>(value: T, previous: unknown): T & { previousProposal: Record<string, unknown>; previousProposalBytes: Uint8Array; previousProposalSha256: string } {
  const previousProposalBytes = bytes(previous), previousProposalSha256 = sha256Hex(previousProposalBytes);
  return { ...value, flags: parseEvolutionProposalArgs([...args(value.reportSha256), "--previous-proposal", `${root}/previous-proposal.json`, "--previous-proposal-sha256", previousProposalSha256]),
    previousProposal: previous as Record<string, unknown>, previousProposalBytes, previousProposalSha256 };
}
function resealReport<T extends ReturnType<typeof fixture>>(value: T): T {
  const reportBytes = bytes(value.report), reportSha256 = sha256Hex(reportBytes);
  return { ...value, reportBytes, reportSha256, flags: parseEvolutionProposalArgs(args(reportSha256)) };
}
function resealReaderOutput<T extends ReturnType<typeof fixture>>(value: T): T {
  const readerOutputBytes = bytes(value.readerOutput), readerOutputSha256 = sha256Hex(readerOutputBytes);
  value.report.pins.readerOutputSha256 = readerOutputSha256;
  return resealReport({ ...value, readerOutputBytes, readerOutputSha256 });
}

test("population proposal arguments require an external report pin and canonical bounded values", () => {
  expect(parseEvolutionProposalArgs(args()).get("report-sha256")).toBe(digest("external-report"));
  expect(parseEvolutionProposalArgs([...args(), "--previous-proposal", `${root}/previous.json`, "--previous-proposal-sha256", "a".repeat(64)]).get("previous-proposal")).toBe(`${root}/previous.json`);
  for (const changed of [args("f".repeat(63)), [...args(), "--unknown", "value"], [...args(), "--previous-proposal", `${root}/previous.json`],
    args().map(value => value === "1" ? "01" : value), args().map(value => value === `${root}/proposal.json` ? `${root}/nested/../proposal.json` : value)]) expect(() => parseEvolutionProposalArgs(changed)).toThrow();
});

test("builds exact 29/100 paired category fitness and retains failure cost without observed offspring fitness", () => {
  const value = fixture(), proposal = build(value), observed = proposal.observed.fitness;
  expect(observed).toHaveLength(3);
  expect(observed.map(fitness => [fitness.correct, fitness.total, fitness.categories])).toEqual([
    [29, 100, [{ id: "category-a", correct: 15, total: 50 }, { id: "category-b", correct: 14, total: 50 }]],
    [29, 100, [{ id: "category-a", correct: 15, total: 50 }, { id: "category-b", correct: 14, total: 50 }]],
    [29, 100, [{ id: "category-a", correct: 15, total: 50 }, { id: "category-b", correct: 14, total: 50 }]],
  ]);
  const firstCost = value.readerOutput.responses.slice(0, 99).reduce((sum: number, row: any) => sum + row.response.usage.micros, value.requests[0]!.reservationMicros);
  expect(observed[0]!.costMicros).toBe(firstCost);
  expect(value.readerOutput.failures[0]!.serviceMs).toBe(120_000);
  expect(value.readerOutput.responses[0]!.response.status).toBe("truncated");
  expect(proposal.observed.candidates.find(candidate => candidate.genome.system === "oh-source-spans")!.genome)
    .toMatchObject({ topK: 100, contextBytes: 48_000 });
  expect(proposal.proposed.candidates.filter(candidate => candidate.genome.system === "oh-source-spans")
    .every(candidate => candidate.genome.topK === 100 && candidate.genome.contextBytes <= 96_000)).toBeTrue();
  expect(proposal.proposed.candidates.length).toBeGreaterThan(0);
  expect(proposal.proposed.candidates.every(candidate => !observed.some(fitness => fitness.candidateId === candidate.id))).toBeTrue();
});

test("rejects report pin/config receipt drift and exact response-failure coverage violations", () => {
  const external = fixture();
  expect(() => buildEvolutionProposal({ ...external, reportBytes: bytes({ altered: true }) } as Parameters<typeof buildEvolutionProposal>[0])).toThrow("report bytes");
  const reportObjectDrift = fixture(); reportObjectDrift.report.arms[0]!.metrics[0]!.overall.mean = 1;
  expect(() => build(reportObjectDrift)).toThrow("report object differs");
  const configObjectDrift = fixture(); configObjectDrift.config.variants[0]!.system = "oh-keyword";
  expect(() => build(configObjectDrift)).toThrow("config object differs");
  const configDrift = fixture(); configDrift.readerOutput.configPin.path = `${root}/other-authorized-config.json`;
  expect(() => build(resealReaderOutput(configDrift))).toThrow("supplied config");
  const missing = fixture(); missing.readerOutput.responses.pop(); expect(() => build(resealReaderOutput(missing))).toThrow("coverage");
  const duplicate = fixture(); duplicate.readerOutput.failures[0] = { ...duplicate.readerOutput.failures[0]!, requestSha256: duplicate.readerOutput.responses[0]!.requestSha256,
    profileSha256: duplicate.readerOutput.responses[0]!.response.profileSha256, reservationMicros: duplicate.requests[1]!.reservationMicros }; expect(() => build(resealReaderOutput(duplicate))).toThrow("duplicate");
  const foreign = fixture(); foreign.readerOutput.failures[0]!.requestSha256 = digest("foreign"); expect(() => build(resealReaderOutput(foreign))).toThrow();
  const unmeasured = fixture(); unmeasured.report.arms[0]!.latency.reader = { attributedPhysicalRequests: 100, unknownDispatches: 0, count: 99, unmeasuredPhysicalRequests: 1, totalMs: 1_200 };
  expect(() => build(resealReport(unmeasured))).toThrow("unmeasured reader timing");
});


test("continues with only prior selected parents and proposed children, re-evaluating their exact paired development matrix", () => {
  const first = build(fixture());
  const priorCandidates = [...first.observed.selection.parents, ...first.proposed.candidates];
  const continuationVariants = priorCandidates.map(candidate => ({ id: candidate.id, system: candidate.genome.system, topK: candidate.genome.topK, contextBytes: candidate.genome.contextBytes }));
  const next = build(withPrevious(fixture(continuationVariants), first));
  expect(next.inputs.previousProposal!.sha256).toBe(sha256Hex(bytes(first)));
  expect(next.observed.candidates.map(candidate => candidate.id).sort()).toEqual(priorCandidates.map(candidate => candidate.id).sort());
  expect(next.observed.fitness.every(fitness => fitness.reportSha256 === next.lineage.reportSha256)).toBeTrue();
  expect(next.history.archive.map(row => row.candidate.id).sort()).toEqual([...first.observed.candidates, ...first.proposed.candidates].map(candidate => candidate.id).sort());
  expect(next.proposed.candidates.every(candidate => candidate.generation > Math.max(...next.observed.candidates.map(parent => parent.generation))
    && !next.history.archive.some(row => row.candidate.genomeSha256 === candidate.genomeSha256))).toBeTrue();
  expect(next.identity.split).toBe("development");
  expect(Object.hasOwn(next, "heldout")).toBeFalse();
});

test("continuation rejects a changed next candidate/configuration and invalid pinned previous candidate identity", () => {
  const first = build(fixture());
  const priorCandidates = [...first.observed.selection.parents, ...first.proposed.candidates];
  const nextVariants = priorCandidates.map(candidate => ({ id: candidate.id, system: candidate.genome.system, topK: candidate.genome.topK, contextBytes: candidate.genome.contextBytes }));
  const changedConfig = fixture([{ ...nextVariants[0]!, id: "changed-candidate" }, ...nextVariants.slice(1)]);
  expect(() => build(withPrevious(changedConfig, first))).toThrow("previous candidate IDs");
  const changedPrior: any = structuredClone(first);
  changedPrior.proposed.candidates[0]!.genome = { ...changedPrior.proposed.candidates[0]!.genome, contextBytes: 1 };
  expect(() => build(withPrevious(fixture(nextVariants), changedPrior))).toThrow("invalid previous proposed candidate");
  const cliPinMismatch = withPrevious(fixture(nextVariants), first);
  cliPinMismatch.flags = parseEvolutionProposalArgs([...args(cliPinMismatch.reportSha256), "--previous-proposal", `${root}/previous-proposal.json`, "--previous-proposal-sha256", "b".repeat(64)]);
  expect(() => build(cliPinMismatch)).toThrow("previous proposal CLI pin");
  const objectBypass = withPrevious(fixture(nextVariants), first);
  objectBypass.previousProposal = structuredClone(first) as Record<string, unknown>;
  (objectBypass.previousProposal as any).proposed.candidates[0].generation = 8;
  expect(() => build(objectBypass)).toThrow("previous proposal object differs");
  const selectionDrift: any = structuredClone(first);
  selectionDrift.observed.selection.parentIds = [selectionDrift.observed.candidates.find((candidate: any) => !first.observed.selection.parentIds.includes(candidate.id))!.id];
  expect(() => build(withPrevious(fixture(nextVariants), selectionDrift))).toThrow("previous selection does not match");
  const selectionLineageDrift: any = structuredClone(first);
  selectionLineageDrift.lineage.selectionSha256 = "a".repeat(64);
  expect(() => build(withPrevious(fixture(nextVariants), selectionLineageDrift))).toThrow("previous selection does not match");
  const provenanceDrift: any = structuredClone(first);
  provenanceDrift.proposed.candidates[0] = createEvolutionSeedCandidate(first.observed.candidates[0]!.genome, first.policy,
    { hypothesis: "forged proposed seed", seed: 2 });
  expect(() => build(withPrevious(fixture(nextVariants), provenanceDrift))).toThrow("previous proposed children");
  const archivedGenerationSkip: any = structuredClone(first);
  const skipped: any = structuredClone(first.proposed.candidates[0]!);
  skipped.generation = 8; const { id: ignored, ...skippedPayload } = skipped; skipped.id = canonicalSha256(skippedPayload);
  archivedGenerationSkip.history.archive.push({ status: "proposed", candidate: skipped });
  expect(() => build(withPrevious(fixture(nextVariants), archivedGenerationSkip))).toThrow("previous candidate lineage");
});
