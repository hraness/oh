/** No-dispatch admission from already exposed, pinned source projections. The
 * raw dataset and its unselected source/labels are never opened by this loader. */
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, type Turn } from "./datasets";
import { evolutionPin, readEvolutionPin, type EvolutionPin } from "./evolution-budget";
import { assertExactEvolutionCoverage, evolutionRunnerCorpusId, evolutionRunnerQuestionId, type EvolutionRunnerInput } from "./evolution-dataset";
import { validateEvolutionAnyContextPlan, validateEvolutionContextPlanSources, type EvolutionAnyContextPlan } from "./evolution-plan";
import { parseEvolutionRunConfig } from "./evolution";
import { loadMem0SelectedCorpusFromFullHistoryContext } from "./mem0-parent";
function fail(reason: string): never { throw new TypeError(`Mem0 qualification: ${reason}.`); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!isPlainRecord(value) || !hasExactKeys(value, keys)) fail("exact object required"); return value; }
function parse(bytes: Uint8Array): unknown { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("pinned JSON"); } }
export function parseMem0QualificationArgs(args: readonly string[]) {
  if (args.length !== 16) fail("exact arguments required"); const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) { const key = args[i], value = args[i + 1]; if (!key?.startsWith("--") || value === undefined || flags.has(key)) fail("duplicate or malformed argument"); flags.set(key, value); }
  const need = ["--config", "--config-sha256", "--context-plan", "--context-plan-sha256", "--source-corpora", "--source-corpora-sha256", "--question-id", "--output"];
  if (need.some(key => !flags.has(key)) || [...flags.keys()].some(key => !need.includes(key))) fail("unknown or missing argument");
  const pin = (key: string) => evolutionPin({ path: flags.get(key), sha256: flags.get(`${key}-sha256`) });
  return Object.freeze({ config: pin("--config"), contextPlan: pin("--context-plan"), sourceCorpora: pin("--source-corpora"), questionId: flags.get("--question-id")!, output: flags.get("--output")! });
}
export async function prepareMem0OneCorpusQualification(input: Readonly<{ config: EvolutionPin; contextPlan: EvolutionPin; sourceCorpora: EvolutionPin; questionId: string; output: string }>) {
  const configPin = evolutionPin(input.config), contextPlan = evolutionPin(input.contextPlan), sourceCorpora = evolutionPin(input.sourceCorpora);
  if (!/^q-[a-f0-9]{64}$/.test(input.questionId) || resolve(input.output) !== input.output || input.output.includes("\0") || input.output.length > 4096
    || [configPin.path, contextPlan.path, sourceCorpora.path].includes(input.output)) fail("noncanonical qualification identity");
  const [configRaw, raw, sourceRaw] = await Promise.all([readEvolutionPin(configPin, 2 * 1024 * 1024), readEvolutionPin(contextPlan, 128 * 1024 * 1024), readEvolutionPin(sourceCorpora, 128 * 1024 * 1024)]);
  const config = parseEvolutionRunConfig(parse(configRaw)), plan = validateEvolutionAnyContextPlan(parse(raw) as EvolutionAnyContextPlan);
  if (plan.protocol !== "oh.memory.evolution-context-plan.v3" || config.protocol !== "oh.memory.evolution-run.v3" || config.dataset !== "longmemeval-s"
    || plan.manifestSha256 !== config.manifestPin.sha256 || canonicalSha256(plan.variants) !== canonicalSha256(config.variants)) fail("selected development plan/configuration mismatch");
  const cache = exact(parse(sourceRaw), ["protocol", "inputSha256", "corpora"]);
  if (cache.protocol !== "oh.memory.selected-source-corpora.v1-private" || cache.inputSha256 !== plan.inputSha256 || !Array.isArray(cache.corpora) || cache.corpora.length < 1 || cache.corpora.length > 2000) fail("source cache identity");
  const corpora = cache.corpora.map(value => {
    const corpus = exact(value, ["id", "groupId", "turns"]);
    if (typeof corpus.id !== "string" || corpus.groupId !== corpus.id || !Array.isArray(corpus.turns) || corpus.turns.length < 1 || corpus.turns.length > 8192) fail("source corpus projection");
    const turns = corpus.turns.map(value => {
      const t = exact(value, isPlainRecord(value) && Object.hasOwn(value, "sessionIndex") ? ["id", "sessionId", "sessionIndex", "date", "speaker", "text"] : ["id", "sessionId", "date", "speaker", "text"]);
      if ([t.id, t.sessionId, t.date, t.speaker, t.text].some(x => typeof x !== "string") || t.sessionIndex !== undefined && (!Number.isSafeInteger(t.sessionIndex) || Number(t.sessionIndex) < 0)) fail("source turn projection");
      return { id: t.id, sessionId: t.sessionId, ...(t.sessionIndex === undefined ? {} : { sessionIndex: t.sessionIndex }), date: t.date, speaker: t.speaker, text: t.text } as Turn;
    }); return { id: corpus.id, turns };
  });
  const selected: EvolutionRunnerInput = { corpora, questions: plan.questions };
  if (canonicalSha256(selected) !== plan.inputSha256) fail("source projection digest");
  const manifest = exact(parse(await readEvolutionPin(config.manifestPin, 2 * 1024 * 1024)), ["protocol", "dataset", "revision", "sourceSha256", "datasetSha256", "groups", "corpora", "questions", "qualification"]);
  if (manifest.protocol !== "oh.memory-evolution.dataset.v1" || manifest.dataset !== config.dataset || manifest.revision !== DATASETS[config.dataset].revision || manifest.sourceSha256 !== config.datasetPin.sha256
    || !Array.isArray(manifest.groups) || !Array.isArray(manifest.corpora) || !Array.isArray(manifest.questions) || [manifest.groups, manifest.corpora, manifest.questions].some(rows => rows.length > 100_000)) fail("dataset exposure manifest mismatch");
  // Manifest metadata can describe closed rows; only selected source content is
  // reconstructed. Question answers and scorer labels are absent throughout.
  const groups = manifest.groups.map(value => exact(value, ["groupId", "partition", "exposure", "evidence"]));
  const metadataCorpora = manifest.corpora.map(value => exact(value, ["id", "runnerId", "groupId", "historyId", "contentSha256"]));
  const metadataQuestions = manifest.questions.map(value => exact(value, ["id", "runnerId", "corpusId", "groupId", "historyId", "category", "partition", "contentSha256"]));
  const development = metadataQuestions.filter(q => q.partition === "development");
  let expected = development;
  if (config.limit < development.length) {
    const categories = [...new Set(development.map(q => String(q.category)))].sort();
    const buckets = categories.map(category => development.filter(q => q.category === category).sort((a, b) => sha256Hex(`${config.seed}:${a.id}`).localeCompare(sha256Hex(`${config.seed}:${b.id}`))));
    expected = []; for (let index = 0; expected.length < config.limit; index++) for (const bucket of buckets) if (bucket[index] !== undefined && expected.length < config.limit) expected.push(bucket[index]!);
  }
  assertExactEvolutionCoverage(expected.map(q => String(q.runnerId)), plan.questions.map(q => q.id));
  for (const q of plan.questions) {
    const matches = metadataQuestions.filter(row => row.runnerId === q.id); if (matches.length !== 1) fail("selected question membership"); const row = matches[0]!;
    const matchingGroups = groups.filter(group => group.groupId === row.groupId);
    if (typeof row.id !== "string" || q.id !== evolutionRunnerQuestionId(row.id) || row.partition !== "development" || matchingGroups.length !== 1 || matchingGroups[0]!.partition !== "development") fail("selected question is not development");
    const matchesCorpus = metadataCorpora.filter(corpus => corpus.id === row.corpusId); if (matchesCorpus.length !== 1) fail("selected source membership"); const meta = matchesCorpus[0]!;
    if (typeof meta.id !== "string" || typeof meta.groupId !== "string" || meta.runnerId !== evolutionRunnerCorpusId(meta.id) || meta.runnerId !== q.corpusId || meta.groupId !== row.groupId || meta.historyId !== row.historyId) fail("selected source binding");
    const source = corpora.find(corpus => corpus.id === q.corpusId); if (!source || sha256Hex(JSON.stringify({ id: meta.id, groupId: meta.groupId, turns: source.turns })) !== meta.contentSha256) fail("selected original source digest");
  }
  if (!plan.questions.some(q => q.id === input.questionId)) fail("question not selected");
  validateEvolutionContextPlanSources(plan, selected);
  const corpus = loadMem0SelectedCorpusFromFullHistoryContext({ contextPlan: plan, questionId: input.questionId, sourceReceiptSha256: sha256Hex(raw) });
  await mkdir(dirname(input.output), { recursive: true, mode: 0o700 }); const handle = await open(input.output, "wx", 0o600);
  const payload = { protocol: "oh.memory.mem0-one-corpus-qualification.v1", status: "prepared-no-dispatch", config: configPin, contextPlan, sourceCorpora, manifest: config.manifestPin, questionId: input.questionId,
    sourceReceiptSha256: sha256Hex(raw), corpus, physicalCalls: 0, qualification: "One exposed development corpus, authenticated against pinned source-cache, V3 context, and manifest source digests; no raw dataset, scorer labels, provider, worker, or ledger operation." };
  const result = { ...payload, receiptSha256: sha256Hex(JSON.stringify(payload)) };
  try { await handle.writeFile(JSON.stringify(result, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
  return Object.freeze(result);
}
if (import.meta.main) { const receipt = await prepareMem0OneCorpusQualification(parseMem0QualificationArgs(process.argv.slice(2))); console.log(JSON.stringify({ status: receipt.status, receiptSha256: receipt.receiptSha256, chunks: receipt.corpus.chunks.length, physicalCalls: 0 })); }
