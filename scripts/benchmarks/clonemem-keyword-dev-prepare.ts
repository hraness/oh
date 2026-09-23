/** Offline preparation of one fixed development screen; never dispatches requests. */
import { mkdir, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson } from "../../src/canonical";
import { makeCloneMemChoiceMessages } from "./clonemem-dataset";
import { readCloneMemKeywordDevSources, parseCloneMemKeywordDevInputPins,
  type CloneMemKeywordDevInputPins } from "./clonemem-keyword-dev-source";
import { cloneMemFilePin } from "./clonemem-study";
import { verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { ROOT, writeNew } from "./io";
import { makePairedMemoryPlan } from "./paired-memory-study";

export const CLONEMEM_KEYWORD_DEV_TASK_BUDGET = Object.freeze({ authorizedMicros: 25_000_000,
  priorCompletedMicros: 4_300_145, newCampaignMaximumMicros: 5_000_000 });

/** Pin the complete local runtime and benchmark source closure, including the
 * native runner, transport, parsers and grader. The reviewed clean checkpoint
 * also binds tests and repository policy. Historical capture pins stay separate. */
export async function cloneMemKeywordDevCodePins(): Promise<readonly EvolutionPin[]> {
  const paths: string[] = [];
  async function walk(directory: string, json: boolean) {
    for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw Error("Keyword development code alias");
      if (entry.isDirectory()) await walk(path, json);
      else if (entry.isFile() && (entry.name.endsWith(".ts") || (json && entry.name.endsWith(".json")))) paths.push(path);
      if (paths.length > 512) throw Error("Keyword development code inventory bound");
    }
  }
  await walk("src", true); await walk("scripts/benchmarks", false);
  paths.push("package.json", "bun.lock", "benchmarks/profiles/clonemem-source-v1.json");
  return Promise.all(paths.sort().map(path => cloneMemFilePin(join(ROOT, path))));
}

export async function prepareCloneMemKeywordDevelopment(input: Readonly<{
  inputPins: CloneMemKeywordDevInputPins; campaignPin: EvolutionPin; outputDirectory: string;
}>) {
  const pins = parseCloneMemKeywordDevInputPins(input.inputPins);
  const { campaign } = await verifyEvolutionCampaign(input.campaignPin);
  if (campaign.campaignId !== "oh-clonemem-keyword-dev-20260922-v1"
    || campaign.additionalBudgetMicros !== 5_000_000 || campaign.maximumCalls !== 876
    || campaign.historicalLedgers.length !== 27 || campaign.historicalExposureMicros !== 253_259_158) {
    throw Error("Keyword development campaign identity or limits");
  }
  const admitted = await readCloneMemKeywordDevSources(pins);
  const codePins = await cloneMemKeywordDevCodePins();
  const protocolPin = await cloneMemFilePin(join(ROOT, "benchmarks/CLONEMEM_KEYWORD_DEV_V1.md"));
  const output = resolve(input.outputDirectory);
  await mkdir(output, { mode: 0o700 });
  if (await realpath(output) !== output) throw Error("Keyword development output alias");
  async function artifact(name: string, value: unknown, maximum: number) {
    const body = canonicalJson(value) + "\n";
    if (Buffer.byteLength(body) > maximum) throw Error("Keyword development artifact bound");
    const path = join(output, name); await writeNew(path, body);
    return cloneMemFilePin(path, maximum);
  }
  const sourcePin = await artifact("source.json", admitted.source, 64 * 1024 ** 2);
  const scorerPin = await artifact("scorer.json", admitted.scorer, 8 * 1024 ** 2);
  const provenancePin = await artifact("provenance.json", admitted.provenance, 8 * 1024 ** 2);
  const promptPin = await cloneMemFilePin(join(ROOT, "scripts/benchmarks/clonemem-dataset.ts"));
  const plan = makePairedMemoryPlan({ source: admitted.source, sourcePin, scorerPin, promptPin,
    campaignPin: input.campaignPin, campaign, readerProfile: "gpt4o-mini-clonemem-choice-v1-reader",
    renderMessages: makeCloneMemChoiceMessages });
  if (plan.questionIds.length !== 146 || plan.cases.length !== 876 || plan.maximumPhysicalCalls !== 876
    || plan.maximumReservationMicros !== 4_099_656) throw Error("Keyword development complete reservation changed");
  const planPin = await artifact("plan.json", plan, 128 * 1024 ** 2);
  const prepared = { protocol: "oh.clonemem-keyword-dev-prepared.v1", inputPins: pins,
    sourcePin, scorerPin, provenancePin, promptPin, campaignPin: input.campaignPin, planPin, codePins, protocolPin,
    taskBudget: CLONEMEM_KEYWORD_DEV_TASK_BUDGET, selectedQuestions: 146, logicalCases: 876,
    maximumReservationMicros: plan.maximumReservationMicros, maximumPhysicalCalls: plan.maximumPhysicalCalls,
    scoresComputed: false };
  const preparedPin = await artifact("prepared.json", prepared, 256 * 1024);
  return { preparedPin, questions: 146, logicalCases: 876, maximumReservationMicros: plan.maximumReservationMicros,
    maximumPhysicalCalls: plan.maximumPhysicalCalls, codeFiles: codePins.length, scoresComputed: false, providerCalls: 0 };
}

if (import.meta.main) {
  const [command, inputs, campaign, directory, ...extra] = process.argv.slice(2);
  if (command === "prepare" && inputs && campaign && directory && extra.length === 0) {
    const inputPin = await cloneMemFilePin(resolve(inputs));
    const { readEvolutionPin } = await import("./evolution-budget");
    const pins = parseCloneMemKeywordDevInputPins(JSON.parse(new TextDecoder("utf-8", { fatal: true })
      .decode(await readEvolutionPin(inputPin, 64 * 1024))));
    console.log(JSON.stringify(await prepareCloneMemKeywordDevelopment({ inputPins: pins,
      campaignPin: await cloneMemFilePin(resolve(campaign)), outputDirectory: directory })));
  } else if (command === "--help" && !inputs) {
    console.log("prepare INPUT_PINS_JSON CAMPAIGN_JSON NEW_PRIVATE_DIRECTORY — offline reconstruction and exact reservation; no provider calls");
  } else throw Error("Use prepare INPUT_PINS_JSON CAMPAIGN_JSON NEW_PRIVATE_DIRECTORY or --help");
}
