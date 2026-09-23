/** Offline original-source admission and development reporting. No provider calls. */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { parseLocomoJudgeDecision } from "./evolution-locomo-judge";
import { ROOT, writeNew } from "./io";
import { LOCOMO_COMPOSITION_DEV_ARMS, LOCOMO_COMPOSITION_DEV_GROUPS, LOCOMO_COMPOSITION_DEV_LIMITS, LOCOMO_COMPOSITION_DEV_TASK_BUDGET,
  decideLocomoCompositionDev, makeLocomoCompositionDevPlan, type LocomoCompositionDevArm } from "./locomo-composition-dev";
import { authenticateLocomoCompositionDevResult, LOCOMO_COMPOSITION_DEV_CODE_FILES } from "./locomo-composition-dev-run";
import { buildLocomoCompositionDevSources } from "./locomo-composition-dev-source";
import { locomoWindowFilePin } from "./locomo-window-report";
import { mean, percentile } from "./metrics";

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function fail(reason: string): never { throw Error(`LoCoMo composition development report: ${reason}.`); }
const decode = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
const codePins = () => Promise.all(LOCOMO_COMPOSITION_DEV_CODE_FILES.map(path => locomoWindowFilePin(join(ROOT, path))));
const protocolPin = () => locomoWindowFilePin(join(ROOT, "benchmarks/LOCOMO_COMPOSITION_DEV_V1.md"));
async function writeArtifact(directory: string, name: string, value: unknown, maximum: number) {
  const body = canonicalJson(value) + "\n"; if (Buffer.byteLength(body) > maximum) fail("artifact bound");
  const path = join(directory, name); await writeNew(path, body); return locomoWindowFilePin(path);
}

export async function prepareLocomoCompositionDevStudy(input: Readonly<{ campaignPin: EvolutionPin; outputDirectory: string }>) {
  const admitted = buildLocomoCompositionDevSources();
  const campaignPin = evolutionPin(input.campaignPin), { campaign } = await verifyEvolutionCampaign(campaignPin);
  if (campaign.additionalBudgetMicros !== 8_000_000 || campaign.maximumCalls !== 1920) fail("fixed campaign");
  const directory = resolve(input.outputDirectory); await mkdir(directory, { mode: 0o700 });
  const sourcePin = await writeArtifact(directory, "source.json", admitted.source, LOCOMO_COMPOSITION_DEV_LIMITS.sourceBytes);
  const scorerPin = await writeArtifact(directory, "scorer.json", admitted.scorer, LOCOMO_COMPOSITION_DEV_LIMITS.sourceBytes);
  const plan = makeLocomoCompositionDevPlan({ source: admitted.source, sourcePin, scorerPin, campaignPin, campaign });
  const planPin = await writeArtifact(directory, "plan.json", plan, LOCOMO_COMPOSITION_DEV_LIMITS.planBytes);
  const receipt = { protocol: "oh.locomo-composition-dev-prepared.v1", sourcePin, scorerPin, planPin, campaignPin,
    codePins: await codePins(), protocolPin: await protocolPin(), provenance: admitted.provenance,
    taskBudget: LOCOMO_COMPOSITION_DEV_TASK_BUDGET, scoresComputed: false };
  const preparedPin = await writeArtifact(directory, "prepared.json", receipt, 256 * 1024);
  return { preparedPin, sourcePin, scorerPin, planPin, campaignPin, selectedQuestions: plan.questionIds.length,
    maximumReservationMicros: plan.maximumReservationMicros, maximumPhysicalCalls: plan.maximumPhysicalCalls,
    scoresComputed: false };
}

/** Exact original development replay supplements the runner's query-only admission.
 * Call before launching readers and again after the whole study is closed. */
export async function verifyLocomoCompositionDevPreparation(preparedPin: EvolutionPin) {
  const receipt = decode(await readEvolutionPin(preparedPin, 256 * 1024));
  if (!isPlainRecord(receipt) || !hasExactKeys(receipt, ["protocol", "sourcePin", "scorerPin", "planPin", "campaignPin",
    "codePins", "protocolPin", "provenance", "taskBudget", "scoresComputed"])
    || receipt.protocol !== "oh.locomo-composition-dev-prepared.v1" || receipt.scoresComputed !== false
    || !same(receipt.taskBudget, LOCOMO_COMPOSITION_DEV_TASK_BUDGET) || !same(receipt.codePins, await codePins())
    || !same(receipt.protocolPin, await protocolPin())) fail("fixed code, protocol or task budget changed");
  const admitted = buildLocomoCompositionDevSources();
  if (!same(receipt.provenance, admitted.provenance)) fail("original development admission changed");
  const sourcePin = evolutionPin(receipt.sourcePin), scorerPin = evolutionPin(receipt.scorerPin),
    planPin = evolutionPin(receipt.planPin), campaignPin = evolutionPin(receipt.campaignPin);
  if (!same(decode(await readEvolutionPin(sourcePin, LOCOMO_COMPOSITION_DEV_LIMITS.sourceBytes)), admitted.source)
    || !same(decode(await readEvolutionPin(scorerPin, LOCOMO_COMPOSITION_DEV_LIMITS.sourceBytes)), admitted.scorer)) fail("source or gold differs from original");
  const { campaign } = await verifyEvolutionCampaign(campaignPin);
  const plan = makeLocomoCompositionDevPlan({ source: admitted.source, sourcePin, scorerPin, campaignPin, campaign });
  if (!same(decode(await readEvolutionPin(planPin, LOCOMO_COMPOSITION_DEV_LIMITS.planBytes)), plan)) fail("fixed plan changed");
  return { receipt, ...admitted, sourcePin, scorerPin, planPin, campaignPin, plan };
}

export type LocomoCompositionDevCell = Readonly<{ questionId: string; groupId: string; armId: LocomoCompositionDevArm; repeat: number;
  category: string; score: 0 | 1; disposition: "correct" | "wrong" | "reader-failure" | "judge-input-bound" | "judge-failure" }>;
const distribution = (values: number[]) => ({ count: values.length, mean: mean(values), p50: percentile(values, .5),
  p95: percentile(values, .95), maximum: values.length ? Math.max(...values) : null });
const summarize = (cells: readonly LocomoCompositionDevCell[]) => LOCOMO_COMPOSITION_DEV_ARMS.map(armId => {
  const rows = cells.filter(cell => cell.armId === armId), correct = rows.reduce((n, row) => n + row.score, 0);
  return { armId, cases: rows.length, correct, accuracy: rows.length ? correct / rows.length : null,
    dispositions: Object.fromEntries(["correct", "wrong", "reader-failure", "judge-input-bound", "judge-failure"]
      .map(status => [status, rows.filter(row => row.disposition === status).length])) };
});
function contrast(cells: readonly LocomoCompositionDevCell[]) {
  const questions = [...new Set(cells.map(cell => cell.questionId))];
  const rows = questions.map(questionId => {
    const counts = LOCOMO_COMPOSITION_DEV_ARMS.map(armId => {
      const scores = cells.filter(row => row.questionId === questionId && row.armId === armId);
      if (scores.length !== 3) fail("fixed three-reader denominator");
      return scores.reduce((total, row) => total + row.score, 0);
    });
    return { candidate: counts[1]!, baseline: counts[0]! };
  });
  const baselineCorrect = rows.reduce((sum, row) => sum + row.baseline, 0);
  const candidateCorrect = rows.reduce((sum, row) => sum + row.candidate, 0);
  return { candidateArm: LOCOMO_COMPOSITION_DEV_ARMS[1], baselineArm: LOCOMO_COMPOSITION_DEV_ARMS[0],
    questions: rows.length, candidateCorrect, baselineCorrect,
    candidate: rows.length ? candidateCorrect / (3 * rows.length) : null,
    baseline: rows.length ? baselineCorrect / (3 * rows.length) : null,
    delta: rows.length ? (candidateCorrect - baselineCorrect) / (3 * rows.length) : null,
    wins: rows.filter(row => row.candidate > row.baseline).length,
    losses: rows.filter(row => row.candidate < row.baseline).length, ties: rows.filter(row => row.candidate === row.baseline).length };
}

/** Pure aggregate projection of a complete source-bound matrix. Native response
 * authentication is mandatory in the public reporter below, before calling this. */
export function summarizeLocomoCompositionDevCells(cells: readonly LocomoCompositionDevCell[]) {
  if (cells.length !== 960) fail("complete logical matrix required");
  const questionRows = new Map<string, { groupId: string; category: string }>(), identities = new Set<string>();
  for (const row of cells) {
    const identity = `${row.questionId}:${row.armId}:${row.repeat}`, prior = questionRows.get(row.questionId);
    if (identities.has(identity) || typeof row.questionId !== "string" || !row.questionId.length
      || !(LOCOMO_COMPOSITION_DEV_ARMS as readonly string[]).includes(row.armId)
      || !(LOCOMO_COMPOSITION_DEV_GROUPS as readonly string[]).includes(row.groupId)
      || !["locomo:1", "locomo:2", "locomo:3", "locomo:4"].includes(row.category)
      || ![0, 1, 2].includes(row.repeat) || ![0, 1].includes(row.score)
      || !["correct", "wrong", "reader-failure", "judge-input-bound", "judge-failure"].includes(row.disposition)
      || row.score !== (row.disposition === "correct" ? 1 : 0)
      || prior && (prior.groupId !== row.groupId || prior.category !== row.category)) fail("logical cell identity or score");
    identities.add(identity); questionRows.set(row.questionId, { groupId: row.groupId, category: row.category });
  }
  if (questionRows.size !== 160 || LOCOMO_COMPOSITION_DEV_GROUPS.some(group =>
    [...questionRows.values()].filter(row => row.groupId === group).length !== 80)) fail("balanced fixed denominator");
  const primary = contrast(cells);
  const byConversation = LOCOMO_COMPOSITION_DEV_GROUPS.map(groupId => {
    const selected = cells.filter(row => row.groupId === groupId);
    return { groupId, questions: 80, arms: summarize(selected), primary: contrast(selected) };
  });
  const byCategory = ["locomo:1", "locomo:2", "locomo:3", "locomo:4"].map(category => {
    const selected = cells.filter(row => row.category === category);
    return { category, questions: new Set(selected.map(row => row.questionId)).size,
      role: category === "locomo:2" ? "prespecified-temporal-gate" : "secondary-descriptive",
      arms: summarize(selected), contrast: contrast(selected) };
  });
  const temporal = byCategory[1]!;
  if (primary.delta === null || temporal.contrast.delta === null) fail("nonempty primary and temporal population required");
  const judgeOnlyFailureCases = cells.filter(row => ["judge-input-bound", "judge-failure"].includes(row.disposition)).length;
  const readerFailureCases = cells.filter(row => row.disposition === "reader-failure").length;
  const decision = decideLocomoCompositionDev({ overallDelta: primary.delta,
    groupDeltas: byConversation.map(row => ({ groupId: row.groupId, delta: row.primary.delta! })),
    temporalDelta: temporal.contrast.delta, temporalQuestions: temporal.questions,
    matrixComplete: true, judgeOnlyFailureCases, readerFailureCases });
  return { questions: 160, groups: 2, repeats: 3, logicalCases: 960, matrixComplete: true,
    arms: summarize(cells), primary, byConversation, byCategory,
    byRepeat: [0, 1, 2].map(repeat => ({ repeat, arms: summarize(cells.filter(row => row.repeat === repeat)) })),
    decision, judgeOnlyFailureCases, readerFailureCases };
}

type SourceRoles = Readonly<{ sourcePin: EvolutionPin; scorerPin: EvolutionPin; planPin: EvolutionPin; campaignPin: EvolutionPin }>;
/** Original-data admission and native authentication are separate prerequisites.
 * This join refuses a self-consistent replacement source or swapped file roles. */
export function assertLocomoCompositionDevRunBinding(
  prepared: SourceRoles & Readonly<{ source: unknown; scorer: unknown; plan: unknown }>,
  authenticated: Readonly<{ source: unknown; scorer: unknown; plan: unknown; launch: SourceRoles }>) {
  for (const role of ["source", "scorer", "plan"] as const) {
    if (!same(authenticated[role], prepared[role])) fail("original sources and native run differ");
  }
  for (const role of ["sourcePin", "scorerPin", "planPin", "campaignPin"] as const) {
    if (!same(authenticated.launch[role], prepared[role])) fail("launch source role changed");
  }
}

export async function reportLocomoCompositionDevStudy(input: Readonly<{ preparedPin: EvolutionPin; launchPin: EvolutionPin;
  resultPin: EvolutionPin; outputDirectory: string }>) {
  const prepared = await verifyLocomoCompositionDevPreparation(input.preparedPin);
  const authenticated = await authenticateLocomoCompositionDevResult(input), { source, scorer, plan, result, launch } = authenticated;
  assertLocomoCompositionDevRunBinding(prepared, authenticated);
  if (result.phase !== "judge" || result.halt !== "none" || result.ledger.unresolvedMicros !== 0
    || result.judgeCases.length !== 960 || result.readerOutcomes.some(row => ["unresolved", "unattempted"].includes(row.disposition))
    || result.judgeOutcomes.some(row => ["unresolved", "unattempted"].includes(row.disposition))) fail("complete matrix required");
  const judges = new Map(result.judgeOutcomes.map(row => [row.jobKey, row]));
  const categories = new Map(scorer.questions.map(question => [question.id, question.category]));
  const cells: LocomoCompositionDevCell[] = result.judgeCases.map((cell, index) => {
    const planned = plan.cases[index]!;
    if (cell.questionId !== planned.questionId || cell.armId !== planned.armId || cell.repeat !== planned.repeat) fail("logical judge identity");
    let score: 0 | 1 = 0, disposition: LocomoCompositionDevCell["disposition"] = cell.disposition === "judge-request" ? "judge-failure" : cell.disposition;
    if (cell.judgeJobKey !== null) {
      const response = judges.get(cell.judgeJobKey)?.response;
      const parsed = response?.status === "completed" ? parseLocomoJudgeDecision(response.answer) : null;
      if (parsed !== null) { score = parsed; disposition = parsed === 1 ? "correct" : "wrong"; }
    }
    return { questionId: cell.questionId, groupId: planned.groupId, armId: cell.armId, repeat: cell.repeat, category: categories.get(cell.questionId)!, score, disposition };
  });
  const aggregated = summarizeLocomoCompositionDevCells(cells);
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
      reasoningTokens: sum("reasoningTokens"), knownUsageMicros: sum("micros"),
      chargedMicros: outcomes.reduce((sum, row) => sum + row.chargeMicros, 0), modelIdentities: [...identities.values()] };
  };
  const readerKeysByArm = LOCOMO_COMPOSITION_DEV_ARMS.map(armId => new Set(plan.cases
    .filter(row => row.armId === armId).map(row => row.readerJobKey)));
  const sharedReaderCalls = [...readerKeysByArm[0]!].filter(key => readerKeysByArm[1]!.has(key)).length;
  const report = { protocol: "oh.locomo-composition-dev-public-result.v1", benchmarkCheckpoint: launch.checkpoint,
    preparationSha256: input.preparedPin.sha256, launchSha256: input.launchPin.sha256, resultFileSha256: input.resultPin.sha256,
    datasetSha256: source.datasetSha256, captureSha256: source.captureSha256, selectionPolicySha256: source.selectionPolicySha256,
    planSha256: plan.planSha256, sourceSha256: canonicalSha256(source), scorerSha256: canonicalSha256(scorer),
    selectedQuestionIdsSha256: canonicalSha256(plan.questionIds), ...aggregated,
    readerProfiles: plan.readerProfiles,
    contexts: LOCOMO_COMPOSITION_DEV_ARMS.map(armId => ({ armId, bytes: distribution(source.questions.map(q =>
      Buffer.byteLength(q.contexts.find(c => c.armId === armId)!.text))) })),
    usage: { readers: usage(result.readerOutcomes), readersByArm: LOCOMO_COMPOSITION_DEV_ARMS.map((armId, index) => {
      const keys = readerKeysByArm[index]!, logicalCases = plan.cases.filter(row => row.armId === armId).length;
      return { armId, logicalCases, reusedLogicalCases: logicalCases - keys.size,
        ...usage(result.readerOutcomes.filter(row => keys.has(row.jobKey))) };
    }), readerAttribution: { sharedPhysicalCallsAcrossArms: sharedReaderCalls,
      qualification: "Per-arm usage includes each referenced physical call; it is nonadditive if a call is shared across arms. The readers total counts each physical call once." },
    judges: usage(result.judgeOutcomes) },
    costs: { calls: result.ledger.calls, confirmedMicros: result.ledger.confirmedMicros, exposureMicros: result.ledger.exposureMicros,
      unresolvedMicros: result.ledger.unresolvedMicros },
    taskBudget: { ...LOCOMO_COMPOSITION_DEV_TASK_BUDGET, actualTaskExposureMicros: LOCOMO_COMPOSITION_DEV_TASK_BUDGET.priorCompletedMicros + result.ledger.exposureMicros },
    attribution: "Coding-agent experiment and analysis; model-judged answers, not human validation",
    qualifications: ["Development only on previously exposed conversations49/50; no confirmatory or leaderboard claim",
      "Same vector-window text, ordered turn identifiers and 12000-byte ceiling; only the system answer contract changes",
      "Gateway openai/gpt-4o-mini aliases; three reader attempts; exact identical judge prompts share one physical grade",
      "Same reader model, decoding settings and output cap; the composition instruction adds input tokens and its actual cost is reported",
      "Existing composition-v1 prompt; prior instruction development showed mixed or negative effects with other readers",
      "Native temporal category2 is a prespecified gate; other category slices cannot select a new candidate",
      "Prior closed eight-conversation QA informed hypothesis development; only conversations49/50 enter this screen",
      "An instruction-only effect cannot establish Oh retrieval superiority; matched frameworks would need the same answer contract"] };
  const directory = resolve(input.outputDirectory); await mkdir(directory, { mode: 0o700 });
  const publicResultPin = await writeArtifact(directory, "public-result.json", report, 512 * 1024);
  await writeArtifact(directory, "private-observations.json", cells, 4 * 1024 * 1024);
  return { publicResultPin, report };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "prepare" && args.length === 3) console.log(JSON.stringify(await prepareLocomoCompositionDevStudy({
    campaignPin: await locomoWindowFilePin(args[1]!), outputDirectory: args[2]! })));
  else if (args[0] === "score" && args.length === 5) {
    const { publicResultPin } = await reportLocomoCompositionDevStudy({ preparedPin: await locomoWindowFilePin(args[1]!),
      launchPin: await locomoWindowFilePin(args[2]!), resultPin: await locomoWindowFilePin(args[3]!), outputDirectory: args[4]! });
    console.log(JSON.stringify({ publicResultPin }));
  } else if (args[0] === "--help" && args.length === 1) console.log("prepare CAMPAIGN NEW_DIRECTORY | score PREPARED LAUNCH FINAL_JUDGE_RESULT NEW_DIRECTORY; offline only");
  else fail("use --help");
}
