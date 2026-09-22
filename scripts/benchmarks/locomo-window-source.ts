/** Offline source admission for the frozen LoCoMo window comparison. Historical
 * row hashes are authenticated; evidence labels never enter context selection.
 * This adapter neither chooses a reader sample nor calls a model. */
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, parseLocomo, selectSplit, type Corpus, type Question } from "./datasets";
import { FROZEN_SOURCE, FROZEN_SOURCE_SHA256, frozenWindow } from "./deductive-frozen-control";
import { WINDOW_POLICY, prepareWindowIndex, selectWindowPolicies } from "./deductive-window-probe";
import { EVOLUTION_LOCOMO_J_CATEGORIES } from "./evolution-locomo-judge";
import { evolutionPin, readEvolutionPin, type EvolutionPin } from "./evolution-budget";
import { datasetPath, ROOT } from "./io";
import { LOCOMO_WINDOW_ARMS, LOCOMO_WINDOW_GROUPS, parseLocomoWindowScorer, parseLocomoWindowSource,
  selectLocomoWindowIds, type LocomoWindowQuestion, type LocomoWindowScorer } from "./locomo-window-study";
import { pack } from "./retrieval";

export const LOCOMO_WINDOW_CONFIRMATION = Object.freeze({
  freezeSha256: "0b5e42df17ace0d6fba974f7a1ba53396b01d66a04f3a7f51fb3a6573ce59621",
  resultFileSha256: "1b4a6f036537c052798d9393cbb4552d86cd710a0c4a72e85d2c5da9a4171ad2",
  resultRowsSha256: "df5039f5beb0c4f2041f06846e1fb356155d767edcdcd79f22670e51216b54ad",
  policySha256: "1dcf7411dd601b8793f0f696c3b1f34daba133ebcfa0f042dc9a72c12ffb51b0",
  developmentFileSha256: "8ad9fb354f49028b6acdebaef96d7dd0acd0639f5bba0078f6b52b07d8528c62",
  developmentRowsSha256: "7b27a6c23e98bb77ed08120144e739e7fe70f9e243f3e19ff423df87a930d25c",
  developmentPolicySha256: "b28876c3d0feb90a972f918f1c9579517afeacfaed545553117e9bf54be49e4f",
  priorControlFileSha256: "ff17131477e226f0a9f83ad67a2b2f7a009dd6f80203cb6f416a4951d4273ffc",
  priorControlRowsSha256: "f2032304c4d5cf87e42337353d9d12e67ba2e3ae3da8862dbf83bda431e67c3d",
  publicEvidenceSha256: "dcfe4372f03c26c9afd34f755336bcdb8e031bbbb23f457b9dbf812cb6a0ab39",
  historicalQuestions: 1986, confirmationQuestions: 1586, eligibleQuestions: 1226,
  questionDatePolicy: "original-final-session-timestamp-v1",
} as const);
export const LOCOMO_WINDOW_SOURCE_LIMITS = Object.freeze({ inputBytes: 64 * 1024 * 1024,
  admittedReaderBytes: 40 * 1024 * 1024, projectedSourceBytes: 16 * 1024 * 1024,
  scorerBytes: 2 * 1024 * 1024, provenanceBytes: 128 * 1024, maximumCaptureRows: 29_790 });
export type LocomoWindowConfirmationPins = Readonly<{ datasetPin: EvolutionPin; capturePin: EvolutionPin;
  priorControlPin: EvolutionPin; freezePin: EvolutionPin; confirmationPin: EvolutionPin;
  developmentPin: EvolutionPin; publicEvidencePin: EvolutionPin }>;
export type LocomoWindowContextRow = Readonly<{ questionId: string; corpusId: string; groupId: string;
  arm: string; turnIds: readonly string[]; contextBytes: number; contextSha256: string; failure?: string | null }>;
type NativeScorerQuestion = LocomoWindowScorer["questions"][number];
function fail(reason: string): never { throw new TypeError(`LoCoMo window source: ${reason}.`); }
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function requireEqual(a: unknown, b: unknown, label: string): void { if (!equal(a,b)) fail(label); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function bounded(value: unknown, maximum: number): void { if (Buffer.byteLength(canonicalJson(value)) > maximum) fail("artifact byte limit"); }
function record(value: unknown): Record<string, unknown> { if (!isPlainRecord(value)) fail("artifact object"); return value; }
function rows(value: unknown, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > maximum) fail("artifact row bound"); return value.map(record);
}
const admittedConfirmations = new WeakSet<object>();

/** Explicit paths allow private original receipts to remain private and movable.
 * The role digests are immutable; this is not admission of arbitrary new studies. */
export function locomoWindowConfirmationPins(directory: string, developmentPath: string): LocomoWindowConfirmationPins {
  // Existing shared raw-cache aliases become explicit canonical source pins.
  // Missing inputs retain their canonical absolute name and fail at read time;
  // constructing a pin never downloads or creates a dataset.
  const canonicalPath = (path: string): string => {
    try { return realpathSync(resolve(path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(path); throw error; }
  };
  return { datasetPin: { path: canonicalPath(datasetPath("locomo")), sha256: DATASETS.locomo.sha256 },
    capturePin: { path: join(ROOT,FROZEN_SOURCE), sha256: FROZEN_SOURCE_SHA256 },
    priorControlPin: { path: join(ROOT,"benchmarks/results/deductive-frozen-window-control-v1.json"), sha256: LOCOMO_WINDOW_CONFIRMATION.priorControlFileSha256 },
    freezePin: { path: join(resolve(directory),"freeze.json"), sha256: LOCOMO_WINDOW_CONFIRMATION.freezeSha256 },
    confirmationPin: { path: join(resolve(directory),"result.json"), sha256: LOCOMO_WINDOW_CONFIRMATION.resultFileSha256 },
    developmentPin: { path: resolve(developmentPath), sha256: LOCOMO_WINDOW_CONFIRMATION.developmentFileSha256 },
    publicEvidencePin: { path: join(resolve(directory),"public-evidence.json"), sha256: LOCOMO_WINDOW_CONFIRMATION.publicEvidenceSha256 } };
}
function admittedPins(input: LocomoWindowConfirmationPins): LocomoWindowConfirmationPins {
  const expected = { datasetPin: DATASETS.locomo.sha256, capturePin: FROZEN_SOURCE_SHA256,
    priorControlPin: LOCOMO_WINDOW_CONFIRMATION.priorControlFileSha256, freezePin: LOCOMO_WINDOW_CONFIRMATION.freezeSha256,
    confirmationPin: LOCOMO_WINDOW_CONFIRMATION.resultFileSha256, developmentPin: LOCOMO_WINDOW_CONFIRMATION.developmentFileSha256,
    publicEvidencePin: LOCOMO_WINDOW_CONFIRMATION.publicEvidenceSha256 };
  if (!isPlainRecord(input) || !hasExactKeys(input,Object.keys(expected))) fail("explicit source roles");
  for (const [role, hash] of Object.entries(expected)) {
    const pin = evolutionPin(input[role as keyof LocomoWindowConfirmationPins]);
    if (pin.sha256 !== hash) fail("unreviewed source role digest");
  }
  if (new Set(Object.values(input).map(pin => pin.path)).size !== 7) fail("aliased source roles");
  return freeze(structuredClone(input));
}

/** No label fields are accepted. Replays whole original turns in exact order. */
export function replayLocomoWindowContext(corpus: Corpus, question: Pick<Question,"id"|"corpusId"|"question">,
  vector: readonly string[], control: LocomoWindowContextRow, candidate: LocomoWindowContextRow,
  index = prepareWindowIndex(corpus)): LocomoWindowQuestion {
  if (question.corpusId !== corpus.id) fail("question corpus identity");
  const selected = selectWindowPolicies(corpus,index,question.question,vector);
  const contexts = LOCOMO_WINDOW_ARMS.map((armId,armIndex) => {
    const row = armIndex === 0 ? control : candidate, got = selected.get(armId)!;
    if (row.questionId !== question.id || row.corpusId !== corpus.id || row.groupId !== corpus.groupId
      || row.arm !== armId || (row.failure !== undefined && row.failure !== null)) fail("frozen context identity or failure changed");
    requireEqual(got.turnIds,row.turnIds,"frozen turn order changed");
    if (Buffer.byteLength(got.context) !== row.contextBytes || row.contextBytes > 12_000
      || sha256Hex(got.context) !== row.contextSha256) fail("frozen context bytes changed");
    if (armIndex === 0) requireEqual(got,frozenWindow(corpus,vector),"independent vector control changed");
    return { armId,text:got.context,contextSha256:row.contextSha256,turnIds:[...got.turnIds] };
  });
  const questionDate = corpus.turns.at(-1)?.date;
  if (typeof questionDate !== "string" || questionDate.length === 0 || Buffer.byteLength(questionDate) > 512) fail("original final-session timestamp");
  return freeze({ id:question.id,groupId:corpus.groupId,question:question.question,questionDate,contexts });
}

/** Category membership establishes the native J denominator. Missing evidence
 * does not remove a question; answer/evidence fields do not enter this predicate. */
export function isLocomoWindowReaderEligible(question: Pick<Question,"corpusId"|"category"|"unanswerable">): boolean {
  return (LOCOMO_WINDOW_GROUPS as readonly string[]).includes(question.corpusId)
    && (EVOLUTION_LOCOMO_J_CATEGORIES as readonly string[]).includes(question.category) && !question.unanswerable;
}

export async function readLocomoWindowConfirmation(input: LocomoWindowConfirmationPins) {
  const pins = admittedPins(input);
  const read = async (pin: EvolutionPin, maximum: number) => JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await readEvolutionPin(pin,maximum))) as unknown;
  const raw = await readEvolutionPin(pins.datasetPin,DATASETS.locomo.bytes);
  if (raw.length !== DATASETS.locomo.bytes) fail("raw dataset length");
  const dataset = parseLocomo(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw)) as unknown);
  const capture = record(await read(pins.capturePin,32*1024*1024)), prior = record(await read(pins.priorControlPin,4*1024*1024));
  const frozen = record(await read(pins.freezePin,128*1024)), confirmation = record(await read(pins.confirmationPin,4*1024*1024));
  const development = record(await read(pins.developmentPin,4*1024*1024)), publicEvidence = record(await read(pins.publicEvidencePin,128*1024));
  if (canonicalSha256(development.rows) !== LOCOMO_WINDOW_CONFIRMATION.developmentRowsSha256
    || development.resultSha256 !== LOCOMO_WINDOW_CONFIRMATION.developmentRowsSha256 || development.winner !== "anchors-query-4"
    || canonicalSha256(development.policy) !== LOCOMO_WINDOW_CONFIRMATION.developmentPolicySha256
    || canonicalSha256(WINDOW_POLICY) !== LOCOMO_WINDOW_CONFIRMATION.developmentPolicySha256) fail("frozen development selection");
  const policy = record(frozen.policy), integrity = record(confirmation.integrity), verification = record(publicEvidence.verification);
  if (canonicalSha256(policy) !== LOCOMO_WINDOW_CONFIRMATION.policySha256 || frozen.policySha256 !== LOCOMO_WINDOW_CONFIRMATION.policySha256
    || canonicalSha256(frozen.sources) !== frozen.sourceSha256 || confirmation.sourceSha256 !== frozen.sourceSha256
    || confirmation.freezeSha256 !== pins.freezePin.sha256 || confirmation.policySha256 !== frozen.policySha256
    || confirmation.protocol !== "oh.deductive-window-confirm.v1" || confirmation.frozenCandidate !== "anchors-query-4"
    || confirmation.resultSha256 !== LOCOMO_WINDOW_CONFIRMATION.resultRowsSha256
    || canonicalSha256(confirmation.rows) !== LOCOMO_WINDOW_CONFIRMATION.resultRowsSha256
    || frozen.datasetSha256 !== pins.datasetPin.sha256 || frozen.captureSha256 !== pins.capturePin.sha256
    || prior.resultSha256 !== LOCOMO_WINDOW_CONFIRMATION.priorControlRowsSha256
    || canonicalSha256(prior.rows) !== LOCOMO_WINDOW_CONFIRMATION.priorControlRowsSha256) fail("confirmation policy, rows or provenance");
  if (integrity.failures !== 0 || integrity.contextParityQuestions !== 1986 || integrity.metricParityQuestions !== 1586
    || integrity.labelsAfterAllContexts !== true || integrity.sourceBeforeAfterIdentical !== true
    || integrity.modelCalls !== 0 || integrity.providerCalls !== 0 || integrity.nativeCalls !== 0
    || verification.preScoringAdmissionAttemptFailures !== 1 || typeof verification.preScoringAdmissionFailure !== "string") fail("historical admission and failure custody");
  // These functions determine the selected context. Any alteration requires a new
  // reviewed adapter; unrelated benchmark/report additions do not invalidate it.
  for (const path of ["src/canonical.ts","scripts/benchmarks/datasets.ts","scripts/benchmarks/deductive-window-probe.ts",
    "scripts/benchmarks/deductive-frozen-control.ts","scripts/benchmarks/deductive-packing.ts","scripts/benchmarks/deductive-retrieval.ts","scripts/benchmarks/retrieval.ts"]) {
    const old = rows(frozen.sources,512).find(row => row.path === path);
    if (!old || typeof old.sha256 !== "string" || typeof old.bytes !== "number") fail("original selector code pin");
    const bytes = await readEvolutionPin({path:join(ROOT,path),sha256:old.sha256},1024*1024);
    if (bytes.length !== old.bytes) fail("original selector code length");
  }
  const corpora = new Map(dataset.corpora.map(corpus => [corpus.id,corpus]));
  const captureRows = rows(capture.rows,LOCOMO_WINDOW_SOURCE_LIMITS.maximumCaptureRows);
  if (dataset.questions.length !== 1986 || capture.datasetSha256 !== DATASETS.locomo.sha256
    || canonicalSha256(captureRows.map(({turnIds: _ignored,...row}) => row)) !== capture.resultSha256) fail("captured ranking manifest");
  for (const row of rows(capture.corpora,10)) if (typeof row.corpusId !== "string" || canonicalSha256(corpora.get(row.corpusId)) !== row.corpusSha256) fail("captured corpus content");
  const vectors = new Map<string,LocomoWindowContextRow>();
  for (const row of captureRows.filter(row => row.arm === "vector")) {
    if (typeof row.questionId !== "string" || vectors.has(row.questionId) || !Array.isArray(row.turnIds) || row.turnIds.length !== 20
      || new Set(row.turnIds).size !== 20 || row.turnIds.some(id => typeof id !== "string")) fail("complete unique captured top20");
    vectors.set(row.questionId,row as unknown as LocomoWindowContextRow);
  }
  const priorRows = rows(prior.rows,1986), priorById = new Map(priorRows.map(row => [row.questionId,row as unknown as LocomoWindowContextRow]));
  if (vectors.size !== 1986 || priorById.size !== 1986 || priorRows.length !== 1986) fail("historical control coverage");
  for (const question of dataset.questions) {
    const corpus = corpora.get(question.corpusId)!, vector = vectors.get(question.id), old = priorById.get(question.id);
    if (!vector || !old || vector.corpusId !== corpus.id || old.corpusId !== corpus.id) fail("historical question join");
    const byTurn = new Map(corpus.turns.map(turn => [turn.id,turn]));
    const captured = pack(vector.turnIds.map(id => { const turn = byTurn.get(id); if (!turn) fail("unknown vector turn"); return {turn}; }),12000);
    if (!equal(captured.turnIds,vector.turnIds) || sha256Hex(captured.context) !== vector.contextSha256
      || Buffer.byteLength(captured.context) !== vector.contextBytes) fail("captured raw vector replay");
    const control = frozenWindow(corpus,vector.turnIds);
    if (!equal(control.turnIds,old.turnIds) || sha256Hex(control.context) !== old.contextSha256
      || Buffer.byteLength(control.context) !== old.contextBytes) fail("historical independent control replay");
  }
  const test = selectSplit(dataset,"test",17);
  requireEqual(test.corpora.map(corpus => corpus.id).sort(),LOCOMO_WINDOW_GROUPS,"confirmation groups changed");
  requireEqual(test.questions.map(question => question.id).sort(),frozen.questionIds,"confirmation questions changed");
  const confirmedRows = rows(confirmation.rows,3172), byCell = new Map<string,LocomoWindowContextRow>();
  for (const row of confirmedRows) {
    if (typeof row.questionId !== "string" || !(LOCOMO_WINDOW_ARMS as readonly unknown[]).includes(row.arm)) fail("unknown confirmed row");
    const key = `${row.questionId}:${row.arm}`; if (byCell.has(key)) fail("duplicate confirmed cell");
    byCell.set(key,row as unknown as LocomoWindowContextRow);
  }
  if (test.questions.length !== 1586 || byCell.size !== 3172) fail("complete confirmation coverage");
  const contexts = new Map<string,LocomoWindowQuestion>();
  for (const corpus of test.corpora) {
    const index = prepareWindowIndex(corpus);
    for (const question of test.questions.filter(question => question.corpusId === corpus.id)) {
      const control = byCell.get(`${question.id}:vector-window`), candidate = byCell.get(`${question.id}:anchors-query-4`);
      if (!control || !candidate) fail("missing confirmed cell");
      contexts.set(question.id,replayLocomoWindowContext(corpus,{id:question.id,corpusId:question.corpusId,question:question.question},
        vectors.get(question.id)!.turnIds,control,candidate,index));
    }
  }
  // Only now project native reader eligibility and the separately held gold.
  const eligible = test.questions.filter(isLocomoWindowReaderEligible).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (eligible.length !== 1226 || eligible.filter(question => question.evidenceTurnIds.length === 0).length !== 2) fail("native J eligibility denominator");
  const readerQuestions = eligible.map(question => contexts.get(question.id)!);
  bounded(readerQuestions,LOCOMO_WINDOW_SOURCE_LIMITS.admittedReaderBytes);
  const scorerQuestions: NativeScorerQuestion[] = eligible.map(({id,corpusId,category,question,answer,unanswerable}) => ({id,corpusId,category,question,answer,unanswerable}));
  const population = readerQuestions.map(question => ({questionId:question.id,groupId:question.groupId}));
  const corpusIdentities = test.corpora.map(corpus => ({ id:corpus.id,groupId:corpus.groupId,corpusSha256:canonicalSha256(corpus),
    speakers:[...new Set(corpus.turns.map(turn => turn.speaker))],finalSessionDate:corpus.turns.at(-1)!.date }));
  const provenance = { protocol:"oh.locomo-window-source-admission.v1",pins,datasetSha256:pins.datasetPin.sha256,
    confirmationRowsSha256:LOCOMO_WINDOW_CONFIRMATION.resultRowsSha256,selectionPolicySha256:LOCOMO_WINDOW_CONFIRMATION.policySha256,
    historicalControlQuestions:1986,confirmationQuestions:1586,eligibleQuestions:1226,eligibleWithoutEvidence:2,
    contextRows:3172,confirmedFailures:0,questionDatePolicy:LOCOMO_WINDOW_CONFIRMATION.questionDatePolicy,
    corpusIdentitiesSha256:canonicalSha256(corpusIdentities),readerPopulationSha256:canonicalSha256(population),
    readerQuestionsSha256:canonicalSha256(readerQuestions),scorerQuestionsSha256:canonicalSha256(scorerQuestions),
    priorAdmissionFailures:verification.preScoringAdmissionAttemptFailures,priorAdmissionFailure:verification.preScoringAdmissionFailure,
    contextOnlyReplay:true,scoresComputed:false,questionDrawPerformed:false,providerCalls:0 };
  const admitted = freeze({population,readerQuestions,scorerQuestions,corpusIdentities,provenance});
  admittedConfirmations.add(admitted);
  return admitted;
}
export type AdmittedLocomoWindowConfirmation = Awaited<ReturnType<typeof readLocomoWindowConfirmation>>;

/** The caller supplies its frozen draw. This boundary refuses filtering/reordering
 * and places gold only in the separately returned scorer object. */
export function projectLocomoWindowDraw(admitted: AdmittedLocomoWindowConfirmation, selectedIds: readonly string[]) {
  if (!admittedConfirmations.has(admitted)) fail("fresh authenticated admission required before projection");
  requireEqual(selectedIds,selectLocomoWindowIds(admitted.population,300),"caller draw differs from fixed metadata ordering");
  const readers = new Map(admitted.readerQuestions.map(question => [question.id,question]));
  const gold = new Map(admitted.scorerQuestions.map(question => [question.id,question]));
  const source = parseLocomoWindowSource({protocol:"oh.locomo-window-source.v1",datasetSha256:admitted.provenance.datasetSha256,
    confirmationRowsSha256:admitted.provenance.confirmationRowsSha256,selectionPolicySha256:admitted.provenance.selectionPolicySha256,
    population:admitted.population,questions:selectedIds.map(id => readers.get(id))});
  const scorer = parseLocomoWindowScorer({protocol:"oh.locomo-window-scorer.v1",datasetSha256:source.datasetSha256,
    sourceSha256:canonicalSha256(source),questions:selectedIds.map(id => gold.get(id))},source);
  bounded(scorer,LOCOMO_WINDOW_SOURCE_LIMITS.scorerBytes);
  return {source,scorer};
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") console.log("bun run scripts/benchmarks/locomo-window-source.ts verify CONFIRMATION_DIRECTORY DEVELOPMENT_RESULT\nOffline full-context replay and aggregate admission receipt; no draw, scores, writes, network or provider calls.");
  else if (args.length === 3 && args[0] === "verify") {
    const admitted = await readLocomoWindowConfirmation(locomoWindowConfirmationPins(args[1]!,args[2]!));
    console.log(canonicalJson(admitted.provenance));
  } else fail("use verify or --help");
}
