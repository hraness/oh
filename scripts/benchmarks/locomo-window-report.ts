/** Offline preparation and authenticated reporting for one frozen window study.
 * This module never invokes a provider. */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { ROOT, writeNew } from "./io";
import { scoreLocomoWindowStudy } from "./locomo-window-score";
import { locomoWindowConfirmationPins, projectLocomoWindowDraw, readLocomoWindowConfirmation,
  type LocomoWindowConfirmationPins } from "./locomo-window-source";
import { LOCOMO_WINDOW_ARMS, LOCOMO_WINDOW_LIMITS, makeLocomoWindowPlan, selectLocomoWindowIds,
  type LocomoWindowOutcome } from "./locomo-window-study";
import { authenticateLocomoWindowResult } from "./locomo-window-study-run";
import { mean, percentile } from "./metrics";

export const LOCOMO_WINDOW_TASK_BUDGET = Object.freeze({ authorizedMicros: 25_000_000,
  priorCompletedMicros: 1_664_274, newCampaignMaximumMicros: 20_000_000,
  maximumTaskMicros: 21_664_274, unallocatedMicros: 3_335_726 });
/** Exact participating source pins supplement the immutable launch checkpoint.
 * Documentation/result changes after a run cannot silently alter its scorer. */
export const LOCOMO_WINDOW_CODE_FILES = Object.freeze([
  "scripts/benchmarks/locomo-window-report.ts", "scripts/benchmarks/locomo-window-source.ts",
  "scripts/benchmarks/locomo-window-study.ts", "scripts/benchmarks/locomo-window-study-run.ts",
  "scripts/benchmarks/locomo-window-score.ts", "scripts/benchmarks/datasets.ts",
  "scripts/benchmarks/deductive-window-probe.ts", "scripts/benchmarks/deductive-frozen-control.ts",
  "scripts/benchmarks/deductive-packing.ts", "scripts/benchmarks/deductive-retrieval.ts",
  "scripts/benchmarks/retrieval.ts", "scripts/benchmarks/metrics.ts", "scripts/benchmarks/model.ts",
  "scripts/benchmarks/evolution-metrics.ts", "scripts/benchmarks/evolution-reader-contracts.ts",
  "scripts/benchmarks/evolution-locomo-judge.ts", "scripts/benchmarks/evolution-model.ts",
  "scripts/benchmarks/evolution-budget.ts", "scripts/benchmarks/evolution-store.ts",
  "scripts/benchmarks/evolution-transport.ts", "scripts/benchmarks/paired-memory-study.ts",
  "scripts/benchmarks/evolution-live-admission.ts", "scripts/benchmarks/gateway-study-v3.ts",
  "scripts/benchmarks/gateway-study-transport-v3.ts", "bun.lock", "package.json",
  "scripts/benchmarks/io.ts", "src/canonical.ts", "benchmarks/profiles/locomo-judge-v1.json",
]);
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function fail(reason: string): never { throw new TypeError(`LoCoMo window report: ${reason}.`); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [...keys])) fail("receipt shape"); return value;
}
const decode = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
export async function locomoWindowFilePin(path: string): Promise<EvolutionPin> {
  const resolved = resolve(path), file = Bun.file(resolved);
  if (file.size > 64 * 1024 * 1024) fail("pin byte limit");
  return evolutionPin({ path: resolved, sha256: sha256Hex(await file.bytes()) });
}
async function writeArtifact(directory: string, name: string, value: unknown, maximum: number) {
  const body = `${canonicalJson(value)}\n`; if (Buffer.byteLength(body) > maximum) fail("output bound");
  const path = join(directory, name); await writeNew(path, body); return locomoWindowFilePin(path);
}
async function codePins() {
  return Promise.all(LOCOMO_WINDOW_CODE_FILES.map(path => locomoWindowFilePin(join(ROOT, path))));
}

/** The first actual sample draw. Frozen IDs precede all new reader outcomes. */
export async function prepareLocomoWindowStudy(input: Readonly<{ confirmationPins: LocomoWindowConfirmationPins;
  campaignPin: EvolutionPin; outputDirectory: string }>) {
  const admitted = await readLocomoWindowConfirmation(input.confirmationPins);
  const selectedIds = selectLocomoWindowIds(admitted.population, 300);
  const { source, scorer } = projectLocomoWindowDraw(admitted, selectedIds);
  const campaignPin = evolutionPin(input.campaignPin), { campaign } = await verifyEvolutionCampaign(campaignPin);
  if (campaign.additionalBudgetMicros !== 20_000_000 || campaign.maximumCalls !== 3600) fail("fixed campaign bound");
  const directory = resolve(input.outputDirectory); await mkdir(directory, { mode: 0o700 });
  const sourcePin = await writeArtifact(directory, "source.json", source, LOCOMO_WINDOW_LIMITS.sourceBytes);
  const scorerPin = await writeArtifact(directory, "scorer.json", scorer, LOCOMO_WINDOW_LIMITS.sourceBytes);
  const plan = makeLocomoWindowPlan({ source, sourcePin, scorerPin, campaignPin, campaign });
  const planPin = await writeArtifact(directory, "plan.json", plan, LOCOMO_WINDOW_LIMITS.planBytes);
  const receipt = { protocol: "oh.locomo-window-prepared.v1", confirmationPins: input.confirmationPins,
    sourcePin, scorerPin, campaignPin, planPin, codePins: await codePins(), provenance: admitted.provenance,
    selectedQuestionIdsSha256: canonicalSha256(plan.questionIds), selection: plan.selection,
    logicalCases: LOCOMO_WINDOW_ARMS.length * plan.questionIds.length * 3,
    taskBudget: LOCOMO_WINDOW_TASK_BUDGET, scoresComputed: false };
  const preparedPin = await writeArtifact(directory, "prepared.json", receipt, 256 * 1024);
  return { preparedPin, sourcePin, scorerPin, campaignPin, planPin, selectedQuestions: plan.questionIds.length,
    selection: plan.selection, maximumReservationMicros: plan.maximumReservationMicros,
    maximumPhysicalCalls: plan.maximumPhysicalCalls, scoresComputed: false };
}

/** Reconstruct both the query-only source and the gold artifact from fixed raw
 * inputs. A self-consistent replacement source/plan is insufficient. */
export async function verifyLocomoWindowPreparation(preparedPin: EvolutionPin) {
  const receipt = object(decode(await readEvolutionPin(preparedPin, 256 * 1024)), ["protocol", "confirmationPins",
    "sourcePin", "scorerPin", "campaignPin", "planPin", "codePins", "provenance", "selectedQuestionIdsSha256",
    "selection", "logicalCases", "taskBudget", "scoresComputed"]);
  if (receipt.protocol !== "oh.locomo-window-prepared.v1" || receipt.scoresComputed !== false
    || !equal(receipt.taskBudget, LOCOMO_WINDOW_TASK_BUDGET) || !equal(receipt.codePins, await codePins())) fail("frozen code or task budget changed");
  // The adapter parses unknown pins and admits only its seven fixed role digests.
  const admitted = await readLocomoWindowConfirmation(receipt.confirmationPins as LocomoWindowConfirmationPins);
  const reconstructed = projectLocomoWindowDraw(admitted, selectLocomoWindowIds(admitted.population, 300));
  if (!equal(receipt.provenance, admitted.provenance)) fail("source admission changed");
  const sourcePin = evolutionPin(receipt.sourcePin), scorerPin = evolutionPin(receipt.scorerPin),
    campaignPin = evolutionPin(receipt.campaignPin), planPin = evolutionPin(receipt.planPin);
  if (!equal(decode(await readEvolutionPin(sourcePin, LOCOMO_WINDOW_LIMITS.sourceBytes)), reconstructed.source)
    || !equal(decode(await readEvolutionPin(scorerPin, LOCOMO_WINDOW_LIMITS.sourceBytes)), reconstructed.scorer)) fail("source or gold differs from original data");
  const { campaign } = await verifyEvolutionCampaign(campaignPin);
  if (campaign.additionalBudgetMicros !== 20_000_000 || campaign.maximumCalls !== 3600) fail("fixed campaign bound");
  const plan = makeLocomoWindowPlan({ source: reconstructed.source, sourcePin, scorerPin, campaignPin, campaign });
  if (!equal(decode(await readEvolutionPin(planPin, LOCOMO_WINDOW_LIMITS.planBytes)), plan)
    || receipt.selectedQuestionIdsSha256 !== canonicalSha256(plan.questionIds) || receipt.selection !== plan.selection
    || receipt.logicalCases !== plan.cases.length) fail("fixed selection or plan changed");
  return { receipt, sourcePin, scorerPin, campaignPin, planPin, plan, ...reconstructed };
}

const distribution = (values: number[]) => ({ count: values.length, mean: mean(values), p50: percentile(values, .5),
  p95: percentile(values, .95), maximum: values.length ? Math.max(...values) : null, sum: values.reduce((a, b) => a + b, 0) });
function usage(outcomes: readonly LocomoWindowOutcome[]) {
  const identities = new Map<string, { identity: NonNullable<LocomoWindowOutcome["response"]>["identity"]; calls: number }>();
  for (const row of outcomes) if (row.response) {
    const identity = row.response.identity, key = canonicalJson(identity), previous = identities.get(key);
    identities.set(key, { identity, calls: (previous?.calls ?? 0) + 1 });
  }
  const sum = (field: "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens" | "micros") =>
    outcomes.reduce((total, row) => total + (row.response?.usage[field] ?? 0), 0);
  return { physicalCalls: outcomes.length, inputTokens: sum("inputTokens"), cachedInputTokens: sum("cachedInputTokens"),
    outputTokens: sum("outputTokens"), reasoningTokens: sum("reasoningTokens"), chargedMicros: sum("micros"),
    modelIdentities: [...identities.values()], serviceMs: distribution(outcomes.flatMap(row => row.serviceMs === null ? [] : [row.serviceMs])) };
}

export async function reportLocomoWindowStudy(input: Readonly<{ preparedPin: EvolutionPin; launchPin: EvolutionPin;
  resultPin: EvolutionPin; outputDirectory: string }>) {
  const prepared = await verifyLocomoWindowPreparation(input.preparedPin);
  const authenticated = await authenticateLocomoWindowResult({ launchPin: input.launchPin, resultPin: input.resultPin });
  const { launch, plan, source, result } = authenticated;
  if (!equal(launch.sourcePin, prepared.sourcePin) || !equal(launch.scorerPin, prepared.scorerPin)
    || !equal(launch.campaignPin, prepared.campaignPin) || !equal(launch.planPin, prepared.planPin)
    || !equal(plan, prepared.plan) || !equal(source, prepared.source) || !equal(authenticated.scorer, prepared.scorer)) fail("launch and preparation disagree");
  const scored = scoreLocomoWindowStudy(authenticated);
  if (!scored.publicSummary.matrixComplete) fail("complete matrix required for public scoring");
  const ledger = result.ledger;
  const publicLedger = { calls: ledger.calls, confirmedMicros: ledger.confirmedMicros, exposureMicros: ledger.exposureMicros,
    unresolvedMicros: ledger.unresolvedMicros, additionalBudgetMicros: ledger.additionalBudgetMicros, maximumCalls: ledger.maximumCalls };
  const selected = new Set(plan.questionIds), questions = source.questions.filter(row => selected.has(row.id));
  const report = { protocol: "oh.locomo-window-public-result.v1", benchmarkCheckpoint: launch.checkpoint,
    preparationSha256: input.preparedPin.sha256, launchSha256: input.launchPin.sha256, resultFileSha256: input.resultPin.sha256,
    datasetSha256: source.datasetSha256, confirmationRowsSha256: source.confirmationRowsSha256,
    selectionPolicySha256: source.selectionPolicySha256, selection: plan.selection,
    selectedQuestionIdsSha256: canonicalSha256(plan.questionIds),
    scores: { ...scored.publicSummary, costs: publicLedger },
    contexts: LOCOMO_WINDOW_ARMS.map(armId => ({ armId, bytes: distribution(questions.map(question =>
      Buffer.byteLength(question.contexts.find(context => context.armId === armId)!.text))) })),
    usage: { readers: usage(result.readerOutcomes), judges: usage(result.judgeOutcomes),
      serviceQualification: "Captured client HTTP duration; descriptive, not isolated model performance" },
    taskBudget: { ...LOCOMO_WINDOW_TASK_BUDGET, actualTaskExposureMicros: LOCOMO_WINDOW_TASK_BUDGET.priorCompletedMicros + ledger.exposureMicros },
    attribution: "Coding-agent evaluation and analysis; model-judged answers, not human answer-quality judgments",
    qualifications: { comparison: "frozen benchmark context-selection policies, not SDK defaults or a framework leaderboard",
      sourceExposure: "eight conversations excluded from this policy's development; previously evaluated by the broader project",
      followup: "answer comparison selected after retrieval confirmation", context: "whole original turns; equal 12000-byte ceiling, not equal realized bytes",
      reader: "Gateway openai/gpt-4o-mini alias; temperature 0; 2048 output tokens; three separate reader attempts",
      judge: "adapted LoCoMo-J; same alias at temperature 0, 512 output tokens; exact identical prompts share one judgment across arms and repeats",
      sample: "conversation-balanced sample of the 1226 eligible category 1-4 questions; not full-population evaluation" } };
  const directory = resolve(input.outputDirectory); await mkdir(directory, { mode: 0o700 });
  const publicResultPin = await writeArtifact(directory, "public-result.json", report, 512 * 1024);
  await writeArtifact(directory, "private-observations.json", scored.privateObservations, 4 * 1024 * 1024);
  return { publicResultPin, report };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 5 && args[0] === "prepare") {
    console.log(JSON.stringify(await prepareLocomoWindowStudy({ confirmationPins: locomoWindowConfirmationPins(args[1]!, args[2]!),
      campaignPin: await locomoWindowFilePin(args[3]!), outputDirectory: args[4]! })));
  } else if (args.length === 5 && args[0] === "score") {
    const { publicResultPin } = await reportLocomoWindowStudy({ preparedPin: await locomoWindowFilePin(args[1]!),
      launchPin: await locomoWindowFilePin(args[2]!), resultPin: await locomoWindowFilePin(args[3]!), outputDirectory: args[4]! });
    console.log(JSON.stringify({ publicResultPin }));
  } else if (args.length === 1 && args[0] === "--help") {
    console.log("bun run scripts/benchmarks/locomo-window-report.ts prepare CONFIRMATION_DIRECTORY DEVELOPMENT_RESULT CAMPAIGN NEW_PRIVATE_DIRECTORY\nbun run scripts/benchmarks/locomo-window-report.ts score PREPARED_RECEIPT LAUNCH FINAL_JUDGE_RESULT NEW_PRIVATE_DIRECTORY\nOffline fixed-source preparation or authenticated full-matrix scoring. No provider calls.");
  } else fail("use prepare, score, or --help");
}
