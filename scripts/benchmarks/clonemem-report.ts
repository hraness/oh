/** Offline report from the pinned CloneMem source and authenticated native ledger.
 * This command never invokes a provider or changes an occupied request. */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { makeCloneMemChoiceMessages } from "./clonemem-dataset";
import { scoreCloneMemStudy } from "./clonemem-score";
import { cloneMemFilePin, readCloneMemCapture, verifyCloneMemPairedSource, verifyCloneMemReplay } from "./clonemem-study";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { openEvolutionStore } from "./evolution-store";
import { collectPairedMemoryResult, pairedMemoryPublicSummary, verifyPairedMemoryPlan } from "./paired-memory-study";
import { mean, percentile } from "./metrics";
import { ROOT, writeNew } from "./io";

function fail(reason: string): never { throw new TypeError(`CloneMem report: ${reason}.`); }
const decode = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [...keys])) fail("artifact shape"); return value;
}
const distribution = (values: number[]) => ({ count: values.length, mean: mean(values), p50: percentile(values, .5),
  p95: percentile(values, .95), max: Math.max(...values), sum: values.reduce((a, b) => a + b, 0) });

export async function reportCloneMemStudy(input: Readonly<{ preparedPin: EvolutionPin; outputDirectory: string }>) {
  const prepared = object(decode(await readEvolutionPin(input.preparedPin)), ["protocol", "capturePin", "selectionPin", "replayPin",
    "sourcePin", "scorerPin", "promptPin", "campaignPin", "planPin", "mechanismSha256", "selectedQuestions", "preferredSizeFit",
    "maximumReservationMicros", "maximumPhysicalCalls", "logicalCases", "scoresComputed"]);
  if (prepared.protocol !== "oh.clonemem-prepared.v1" || prepared.scoresComputed !== false) fail("preparation protocol");
  const capturePin = evolutionPin(prepared.capturePin), captured = await readCloneMemCapture(capturePin);
  const sourcePin = evolutionPin(prepared.sourcePin), scorerPin = evolutionPin(prepared.scorerPin), promptPin = evolutionPin(prepared.promptPin),
    campaignPin = evolutionPin(prepared.campaignPin), planPin = evolutionPin(prepared.planPin), replayPin = evolutionPin(prepared.replayPin);
  await verifyCloneMemReplay(replayPin, capturePin, captured);
  const source = decode(await readEvolutionPin(sourcePin, 64 * 1024 * 1024));
  if (prepared.selectedQuestions !== 100 && prepared.selectedQuestions !== 300) fail("predeclared reader size");
  verifyCloneMemPairedSource(source, captured, prepared.selectedQuestions);
  const scorer = object(decode(await readEvolutionPin(scorerPin)), ["protocol", "sourceRevision", "capturePin", "selectionPin", "replayPin", "scorerCodePin", "rows"]);
  const scorerCodePin = evolutionPin(scorer.scorerCodePin);
  if (scorer.protocol !== "oh.clonemem-scorer-source.v1" || !equal(scorer.capturePin, capturePin)
    || !equal(scorer.selectionPin, prepared.selectionPin) || !equal(scorer.replayPin, replayPin)
    || !equal(scorer.rows, captured.projections.flatMap(projection => projection.scorer))
    || !equal(scorerCodePin, await cloneMemFilePin(join(ROOT, "scripts/benchmarks/clonemem-score.ts")))
    || !equal(promptPin, await cloneMemFilePin(join(ROOT, "scripts/benchmarks/clonemem-dataset.ts")))) fail("scorer or prompt binding changed");
  const { campaign } = await verifyEvolutionCampaign(campaignPin);
  if (campaign.additionalBudgetMicros !== 20_000_000 || campaign.maximumCalls !== 1800
    || prepared.preferredSizeFit !== (prepared.selectedQuestions === 300)) fail("frozen campaign or selection receipt");
  const plan = verifyPairedMemoryPlan(decode(await readEvolutionPin(planPin, 128 * 1024 * 1024)), {
    source, sourcePin, promptPin, scorerPin, campaignPin, campaign,
    readerProfile: "gpt4o-mini-clonemem-choice-v1-reader", renderMessages: makeCloneMemChoiceMessages });
  if (prepared.mechanismSha256 !== captured.mechanismSha256 || prepared.selectedQuestions !== plan.questionIds.length
    || prepared.maximumReservationMicros !== plan.maximumReservationMicros || prepared.maximumPhysicalCalls !== plan.maximumPhysicalCalls
    || prepared.logicalCases !== plan.cases.length) fail("prepared request accounting changed");
  const store = await openEvolutionStore({ directory: campaign.storeDirectory, campaign });
  try {
    const result = collectPairedMemoryResult(plan, store, "none"), custody = pairedMemoryPublicSummary(plan, result);
    if (!custody.matrixComplete) fail("full matrix required before public scoring; unresolved and unattempted jobs remain");
    const answers = plan.jobs.map(job => {
      const entry = store.lookup(job.request, job.repeat);
      if (entry.kind !== "hit") return fail("authenticated settled answer required");
      return { jobKey: job.key, answer: entry.result.answer };
    });
    const scored = scoreCloneMemStudy({ scorerRows: captured.projections.flatMap(projection => projection.scorer),
      retrieval: [...captured.rows].flatMap(([questionId, row]) => row.arms.map(arm => ({ questionId, armId: arm.arm, traceIds: arm.traceIds }))),
      plan, result, answers });
    const rows = [...captured.rows.values()];
    const timing = Object.fromEntries((["incrementalIndexMs", "hybridWallMs", "sharedSemanticTop30Ms", "keywordWallMs"] as const)
      .map(field => [field, distribution(rows.map(row => row.timing[field]))]));
    const contexts = plan.arms.map(armId => ({ armId,
      allRetrievalQuestions: distribution(rows.map(row => row.arms.find(arm => arm.arm === armId)!.contextBytes)),
      readerQuestions: distribution(plan.questionIds.map(id => captured.rows.get(id)!.arms.find(arm => arm.arm === armId)!.contextBytes)) }));
    const publicLedger = { calls: custody.ledger.calls, exposureMicros: custody.ledger.exposureMicros,
      confirmedMicros: custody.ledger.confirmedMicros, unresolvedMicros: custody.ledger.unresolvedMicros,
      additionalBudgetMicros: custody.ledger.additionalBudgetMicros, maximumCalls: custody.ledger.maximumCalls };
    const report = { protocol: "oh.clonemem-public-result.v1", sourceRevision: captured.manifest.sourceRevision,
      retrievalQuestions: rows.length, personas: captured.projections.length, selectedReaderQuestions: plan.questionIds.length,
      retrievalMechanismSha256: captured.mechanismSha256, captureSha256: capturePin.sha256, replaySha256: replayPin.sha256,
      planFileSha256: planPin.sha256, scorerSourceSha256: scorerPin.sha256, scorerCodeSha256: scorerCodePin.sha256,
      preparationSha256: input.preparedPin.sha256, custody: { ...custody, ledger: publicLedger },
      scores: { ...scored.publicSummary, costs: publicLedger }, timing, contexts,
      embedding: captured.runtime,
      qualifications: { sourceExposure: "nine personas; README example persona excluded before scoring",
        questionTime: "eligible original traces only; naive and Z timestamps normalized to UTC; original future-evidence labels retained",
        reader: "Gateway openai/gpt-4o-mini alias; temperature 0.1; 512 output tokens; native multiple-choice prompt",
        vectorTiming: "shared semantic top-30 call; not independent vector top-10 latency",
        context: "native top-ten whole traces; no byte truncation", comparison: "shipped Oh hybrid versus matched vector retrieval; not a framework leaderboard" } };
    const outputDirectory = resolve(input.outputDirectory); await mkdir(outputDirectory, { mode: 0o700 });
    await writeNew(join(outputDirectory, "public-result.json"), canonicalJson(report) + "\n");
    await writeNew(join(outputDirectory, "private-observations.json"), canonicalJson({ preparedPin: input.preparedPin,
      resultSha256: canonicalSha256(result), observations: scored.privateObservations }) + "\n");
    return { publicResultPath: join(outputDirectory, "public-result.json"), report };
  } finally { await store.close(); }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 3 && args[0] === "score") {
    console.log(JSON.stringify(await reportCloneMemStudy({ preparedPin: await cloneMemFilePin(args[1]!), outputDirectory: args[2]! })));
  } else if (args.length === 1 && args[0] === "--help") console.log("bun run scripts/benchmarks/clonemem-report.ts score PREPARED_RECEIPT NEW_PRIVATE_DIRECTORY\nOffline authenticated full-matrix scoring. Never calls a provider; incomplete matrices stop before publication.");
  else fail("use score or --help");
}
