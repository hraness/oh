/** Offline original-source admission and development reporting. No provider calls. */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { parseLocomoJudgeDecision } from "./evolution-locomo-judge";
import { ROOT, writeNew } from "./io";
import { LOCOMO_ORDER_DEV_ARMS, LOCOMO_ORDER_DEV_GROUPS, LOCOMO_ORDER_DEV_LIMITS, LOCOMO_ORDER_DEV_TASK_BUDGET,
  makeLocomoOrderDevPlan, type LocomoOrderDevArm } from "./locomo-order-dev";
import { authenticateLocomoOrderDevResult, LOCOMO_ORDER_DEV_CODE_FILES } from "./locomo-order-dev-run";
import { buildLocomoOrderDevSources } from "./locomo-order-dev-source";
import { locomoWindowFilePin } from "./locomo-window-report";
import { mean, percentile } from "./metrics";

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function fail(reason: string): never { throw Error(`LoCoMo order development report: ${reason}.`); }
const decode = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
const codePins = () => Promise.all(LOCOMO_ORDER_DEV_CODE_FILES.map(path => locomoWindowFilePin(join(ROOT, path))));
const protocolPin = () => locomoWindowFilePin(join(ROOT, "benchmarks/LOCOMO_ORDER_DEV_V1.md"));
async function writeArtifact(directory: string, name: string, value: unknown, maximum: number) {
  const body = canonicalJson(value) + "\n"; if (Buffer.byteLength(body) > maximum) fail("artifact bound");
  const path = join(directory, name); await writeNew(path, body); return locomoWindowFilePin(path);
}

export async function prepareLocomoOrderDevStudy(input: Readonly<{ campaignPin: EvolutionPin; outputDirectory: string }>) {
  const admitted = buildLocomoOrderDevSources();
  const campaignPin = evolutionPin(input.campaignPin), { campaign } = await verifyEvolutionCampaign(campaignPin);
  if (campaign.additionalBudgetMicros !== 15_000_000 || campaign.maximumCalls !== 3840) fail("fixed campaign");
  const directory = resolve(input.outputDirectory); await mkdir(directory, { mode: 0o700 });
  const sourcePin = await writeArtifact(directory, "source.json", admitted.source, LOCOMO_ORDER_DEV_LIMITS.sourceBytes);
  const scorerPin = await writeArtifact(directory, "scorer.json", admitted.scorer, LOCOMO_ORDER_DEV_LIMITS.sourceBytes);
  const plan = makeLocomoOrderDevPlan({ source: admitted.source, sourcePin, scorerPin, campaignPin, campaign });
  const planPin = await writeArtifact(directory, "plan.json", plan, LOCOMO_ORDER_DEV_LIMITS.planBytes);
  const receipt = { protocol: "oh.locomo-order-dev-prepared.v1", sourcePin, scorerPin, planPin, campaignPin,
    codePins: await codePins(), protocolPin: await protocolPin(), provenance: admitted.provenance,
    taskBudget: LOCOMO_ORDER_DEV_TASK_BUDGET, scoresComputed: false };
  const preparedPin = await writeArtifact(directory, "prepared.json", receipt, 256 * 1024);
  return { preparedPin, sourcePin, scorerPin, planPin, campaignPin, selectedQuestions: plan.questionIds.length,
    maximumReservationMicros: plan.maximumReservationMicros, maximumPhysicalCalls: plan.maximumPhysicalCalls,
    scoresComputed: false };
}

/** Exact original development replay supplements the runner's query-only admission.
 * Call before launching readers and again after the whole study is closed. */
export async function verifyLocomoOrderDevPreparation(preparedPin: EvolutionPin) {
  const receipt = decode(await readEvolutionPin(preparedPin, 256 * 1024));
  if (!isPlainRecord(receipt) || !hasExactKeys(receipt, ["protocol", "sourcePin", "scorerPin", "planPin", "campaignPin",
    "codePins", "protocolPin", "provenance", "taskBudget", "scoresComputed"])
    || receipt.protocol !== "oh.locomo-order-dev-prepared.v1" || receipt.scoresComputed !== false
    || !same(receipt.taskBudget, LOCOMO_ORDER_DEV_TASK_BUDGET) || !same(receipt.codePins, await codePins())
    || !same(receipt.protocolPin, await protocolPin())) fail("fixed code, protocol or task budget changed");
  const admitted = buildLocomoOrderDevSources();
  if (!same(receipt.provenance, admitted.provenance)) fail("original development admission changed");
  const sourcePin = evolutionPin(receipt.sourcePin), scorerPin = evolutionPin(receipt.scorerPin),
    planPin = evolutionPin(receipt.planPin), campaignPin = evolutionPin(receipt.campaignPin);
  if (!same(decode(await readEvolutionPin(sourcePin, LOCOMO_ORDER_DEV_LIMITS.sourceBytes)), admitted.source)
    || !same(decode(await readEvolutionPin(scorerPin, LOCOMO_ORDER_DEV_LIMITS.sourceBytes)), admitted.scorer)) fail("source or gold differs from original");
  const { campaign } = await verifyEvolutionCampaign(campaignPin);
  const plan = makeLocomoOrderDevPlan({ source: admitted.source, sourcePin, scorerPin, campaignPin, campaign });
  if (!same(decode(await readEvolutionPin(planPin, LOCOMO_ORDER_DEV_LIMITS.planBytes)), plan)) fail("fixed plan changed");
  return { receipt, ...admitted, sourcePin, scorerPin, planPin, campaignPin, plan };
}

export function decideLocomoOrderDev(input: Readonly<{ overallDelta: number;
  groupDeltas: readonly Readonly<{ groupId: string; delta: number }>[];
  matrixComplete: boolean; judgeOnlyFailureCases: number }>) {
  if (!Number.isFinite(input.overallDelta) || Math.abs(input.overallDelta) > 1 || input.groupDeltas.length !== 2
    || input.groupDeltas.some((row, index) => row.groupId !== LOCOMO_ORDER_DEV_GROUPS[index]
      || !Number.isFinite(row.delta) || Math.abs(row.delta) > 1)
    || typeof input.matrixComplete !== "boolean" || !Number.isSafeInteger(input.judgeOnlyFailureCases)
    || input.judgeOnlyFailureCases < 0 || input.judgeOnlyFailureCases > 1920) fail("decision inputs");
  return { contrast: "anchors-query-4-source-order minus anchors-query-4", minimumDelta: 0.02, tolerance: 1e-12,
    advanceToSeparateConfirmation: input.matrixComplete && input.judgeOnlyFailureCases === 0
      && input.overallDelta >= 0.02 - 1e-12 && input.groupDeltas.every(row => row.delta >= -1e-12),
    confirmedImprovement: false, externalFrameworkSuperiority: false,
    qualification: "Two previously exposed development conversations; this decision is not a confirmatory gain" };
}

type Cell = Readonly<{ questionId: string; groupId: string; armId: LocomoOrderDevArm; repeat: number;
  score: 0 | 1; disposition: "correct" | "wrong" | "reader-failure" | "judge-input-bound" | "judge-failure" }>;
const distribution = (values: number[]) => ({ count: values.length, mean: mean(values), p50: percentile(values, .5),
  p95: percentile(values, .95), maximum: values.length ? Math.max(...values) : null });
const summarize = (cells: readonly Cell[]) => LOCOMO_ORDER_DEV_ARMS.map(armId => {
  const rows = cells.filter(cell => cell.armId === armId), correct = rows.reduce((n, row) => n + row.score, 0);
  return { armId, cases: rows.length, correct, accuracy: correct / rows.length,
    dispositions: Object.fromEntries(["correct", "wrong", "reader-failure", "judge-input-bound", "judge-failure"]
      .map(status => [status, rows.filter(row => row.disposition === status).length])) };
});
function contrast(cells: readonly Cell[], candidate: LocomoOrderDevArm, baseline: LocomoOrderDevArm) {
  const average = (values: number[]) => { const value = mean(values); if (value === null) fail("empty contrast"); return value; };
  const questions = [...new Set(cells.map(cell => cell.questionId))];
  const rows = questions.map(questionId => {
    const scores = (armId: LocomoOrderDevArm) => cells.filter(row => row.questionId === questionId && row.armId === armId).map(row => row.score);
    const a = scores(candidate), b = scores(baseline);
    if (a.length !== 3 || b.length !== 3) fail("fixed three-reader denominator");
    return { candidate: average(a), baseline: average(b) };
  });
  return { candidateArm: candidate, baselineArm: baseline, questions: rows.length,
    candidate: average(rows.map(row => row.candidate)), baseline: average(rows.map(row => row.baseline)),
    delta: average(rows.map(row => row.candidate - row.baseline)), wins: rows.filter(row => row.candidate > row.baseline).length,
    losses: rows.filter(row => row.candidate < row.baseline).length, ties: rows.filter(row => row.candidate === row.baseline).length };
}

export async function reportLocomoOrderDevStudy(input: Readonly<{ preparedPin: EvolutionPin; launchPin: EvolutionPin;
  resultPin: EvolutionPin; outputDirectory: string }>) {
  const prepared = await verifyLocomoOrderDevPreparation(input.preparedPin);
  const authenticated = await authenticateLocomoOrderDevResult(input), { source, scorer, plan, result, launch } = authenticated;
  if (!same(source, prepared.source) || !same(scorer, prepared.scorer) || !same(plan, prepared.plan)) fail("original sources and native run differ");
  for (const role of ["sourcePin", "scorerPin", "planPin", "campaignPin"] as const) if (!same(launch[role], prepared[role])) fail("launch source role changed");
  if (result.phase !== "judge" || result.halt !== "none" || result.ledger.unresolvedMicros !== 0
    || result.judgeCases.length !== 1920 || result.readerOutcomes.some(row => ["unresolved", "unattempted"].includes(row.disposition))
    || result.judgeOutcomes.some(row => ["unresolved", "unattempted"].includes(row.disposition))) fail("complete matrix required");
  const judges = new Map(result.judgeOutcomes.map(row => [row.jobKey, row]));
  const cells: Cell[] = result.judgeCases.map((cell, index) => {
    const planned = plan.cases[index]!;
    if (cell.questionId !== planned.questionId || cell.armId !== planned.armId || cell.repeat !== planned.repeat) fail("logical judge identity");
    let score: 0 | 1 = 0, disposition: Cell["disposition"] = cell.disposition === "judge-request" ? "judge-failure" : cell.disposition;
    if (cell.judgeJobKey !== null) {
      const response = judges.get(cell.judgeJobKey)?.response;
      const parsed = response?.status === "completed" ? parseLocomoJudgeDecision(response.answer) : null;
      if (parsed !== null) { score = parsed; disposition = parsed === 1 ? "correct" : "wrong"; }
    }
    return { questionId: cell.questionId, groupId: planned.groupId, armId: cell.armId, repeat: cell.repeat, score, disposition };
  });
  const primary = contrast(cells, "anchors-query-4-source-order", "anchors-query-4");
  const byConversation = LOCOMO_ORDER_DEV_GROUPS.map(groupId => {
    const selected = cells.filter(row => row.groupId === groupId);
    return { groupId, questions: 80, arms: summarize(selected), primary: contrast(selected, "anchors-query-4-source-order", "anchors-query-4") };
  });
  const judgeOnlyFailureCases = cells.filter(row => ["judge-input-bound", "judge-failure"].includes(row.disposition)).length;
  const decision = decideLocomoOrderDev({ overallDelta: primary.delta,
    groupDeltas: byConversation.map(row => ({ groupId: row.groupId, delta: row.primary.delta })), matrixComplete: true, judgeOnlyFailureCases });
  const usage = (outcomes: typeof result.readerOutcomes) => {
    const identities = new Map<string, { identity: unknown; calls: number }>();
    for (const row of outcomes) if (row.response) {
      const identity = row.response.identity, key = canonicalJson(identity), prior = identities.get(key);
      identities.set(key, { identity, calls: (prior?.calls ?? 0) + 1 });
    }
    const sum = (key: "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens" | "micros") =>
      outcomes.reduce((n, row) => n + (row.response?.usage[key] ?? 0), 0);
    return { physicalCalls: outcomes.length, dispositions: Object.fromEntries(["completed", "truncated", "refused", "failed"]
      .map(status => [status, outcomes.filter(row => row.disposition === status).length])),
      inputTokens: sum("inputTokens"), cachedInputTokens: sum("cachedInputTokens"), outputTokens: sum("outputTokens"),
      reasoningTokens: sum("reasoningTokens"), chargedMicros: sum("micros"), modelIdentities: [...identities.values()] };
  };
  const report = { protocol: "oh.locomo-order-dev-public-result.v1", benchmarkCheckpoint: launch.checkpoint,
    preparationSha256: input.preparedPin.sha256, launchSha256: input.launchPin.sha256, resultFileSha256: input.resultPin.sha256,
    datasetSha256: source.datasetSha256, captureSha256: source.captureSha256, selectionPolicySha256: source.selectionPolicySha256,
    planSha256: plan.planSha256, sourceSha256: canonicalSha256(source), scorerSha256: canonicalSha256(scorer),
    selectedQuestionIdsSha256: canonicalSha256(plan.questionIds), questions: 160, groups: 2, repeats: 3, logicalCases: 1920,
    matrixComplete: true, arms: summarize(cells), primary, byConversation,
    byRepeat: [0, 1, 2].map(repeat => ({ repeat, arms: summarize(cells.filter(row => row.repeat === repeat)) })),
    secondary: [contrast(cells, "vector-window-source-order", "vector-window"),
      contrast(cells, "anchors-query-4", "vector-window"), contrast(cells, "anchors-query-4-source-order", "vector-window")],
    decision, judgeOnlyFailureCases, contexts: LOCOMO_ORDER_DEV_ARMS.map(armId => ({ armId, bytes: distribution(source.questions.map(q =>
      Buffer.byteLength(q.contexts.find(c => c.armId === armId)!.text))) })),
    usage: { readers: usage(result.readerOutcomes), judges: usage(result.judgeOutcomes) },
    costs: { calls: result.ledger.calls, confirmedMicros: result.ledger.confirmedMicros, exposureMicros: result.ledger.exposureMicros,
      unresolvedMicros: result.ledger.unresolvedMicros },
    taskBudget: { ...LOCOMO_ORDER_DEV_TASK_BUDGET, actualTaskExposureMicros: LOCOMO_ORDER_DEV_TASK_BUDGET.priorCompletedMicros + result.ledger.exposureMicros },
    attribution: "Coding-agent experiment and analysis; model-judged answers, not human validation",
    qualifications: ["Development only on previously exposed conversations49/50; no confirmatory or leaderboard claim",
      "Selection crossed with presentation; source-order pairs preserve exact selected turn text, membership and UTF8 volume",
      "Gateway openai/gpt-4o-mini aliases; three reader attempts; exact identical judge prompts share one physical grade",
      "Hypothesis motivated after the closed eight-conversation study; that result is unchanged"] };
  const directory = resolve(input.outputDirectory); await mkdir(directory, { mode: 0o700 });
  const publicResultPin = await writeArtifact(directory, "public-result.json", report, 512 * 1024);
  await writeArtifact(directory, "private-observations.json", cells, 4 * 1024 * 1024);
  return { publicResultPin, report };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "prepare" && args.length === 3) console.log(JSON.stringify(await prepareLocomoOrderDevStudy({
    campaignPin: await locomoWindowFilePin(args[1]!), outputDirectory: args[2]! })));
  else if (args[0] === "score" && args.length === 5) {
    const { publicResultPin } = await reportLocomoOrderDevStudy({ preparedPin: await locomoWindowFilePin(args[1]!),
      launchPin: await locomoWindowFilePin(args[2]!), resultPin: await locomoWindowFilePin(args[3]!), outputDirectory: args[4]! });
    console.log(JSON.stringify({ publicResultPin }));
  } else if (args[0] === "--help" && args.length === 1) console.log("prepare CAMPAIGN NEW_DIRECTORY | score PREPARED LAUNCH FINAL_JUDGE_RESULT NEW_DIRECTORY; offline only");
  else fail("use --help");
}
