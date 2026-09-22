/** Fixed two-persona development scoring and authenticated offline reporting. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { cloneMemChoiceCorrect, cloneMemRecallAtK, makeCloneMemChoiceMessages } from "./clonemem-dataset";
import { CLONEMEM_KEYWORD_DEV_ARMS as ARMS, CLONEMEM_KEYWORD_DEV_LIMITS as LIMITS,
  CLONEMEM_KEYWORD_DEV_PERSON_IDS as PEOPLE, readCloneMemKeywordDevSources,
  type CloneMemKeywordDevScorer, type CloneMemKeywordDevRankRow } from "./clonemem-keyword-dev-source";
import { cloneMemKeywordDevCodePins, CLONEMEM_KEYWORD_DEV_TASK_BUDGET } from "./clonemem-keyword-dev-prepare";
import { cloneMemFilePin } from "./clonemem-study";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID, makeEvolutionRequest, parseEvolutionResponse,
  type EvolutionResponse } from "./evolution-model";
import { openImmutableEvolutionPredecessor } from "./evolution-predecessor";
import { parsePairedMemorySource, validatePairedMemoryResult, verifyPairedMemoryPlan,
  type PairedMemoryPlan, type PairedMemoryResult, type PairedMemorySource } from "./paired-memory-study";
import { parsePairedMemoryLaunch } from "./paired-memory-study-run";
import { ROOT, writeNew } from "./io";
import { mean, percentile } from "./metrics";

export { CLONEMEM_KEYWORD_DEV_TASK_BUDGET } from "./clonemem-keyword-dev-prepare";
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const decode = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
function fail(reason: string): never { throw Error(`CloneMem keyword development report: ${reason}.`); }
const dispositions = ["completed", "truncated", "refused", "failed", "unresolved", "unattempted"] as const;
type Answer = Readonly<{ jobKey: string; answer: string | null }>;
type Pair = Readonly<{ questionId: string; personId: string; baseline: number; candidate: number }>;
const persona = (id: string) => `persona-${String(PEOPLE.indexOf(id as typeof PEOPLE[number]) + 1).padStart(2, "0")}`;
function paired(rows: readonly Pair[], divisor: 1 | 3) {
  const baseline = rows.reduce((sum, row) => sum + row.baseline, 0);
  const candidate = rows.reduce((sum, row) => sum + row.candidate, 0);
  return { questions: rows.length, baseline: rows.length ? baseline / (rows.length * divisor) : null,
    candidate: rows.length ? candidate / (rows.length * divisor) : null,
    delta: rows.length ? (candidate - baseline) / (rows.length * divisor) : null,
    wins: rows.filter(row => row.candidate > row.baseline).length,
    losses: rows.filter(row => row.candidate < row.baseline).length, ties: rows.filter(row => row.candidate === row.baseline).length };
}
export function decideCloneMemKeywordDevelopment(input: Readonly<{ readerDelta: number;
  personaReaderDeltas: readonly number[]; recallDelta: number | null; personaRecallDeltas: readonly (number | null)[];
  recallQuestions: number; matrixComplete: boolean; failedLogicalCases: number }>) {
  if (!Number.isFinite(input.readerDelta) || Math.abs(input.readerDelta) > 1 || input.personaReaderDeltas.length !== 2
    || input.personaReaderDeltas.some(n => !Number.isFinite(n) || Math.abs(n) > 1)
    || input.personaRecallDeltas.length !== 2 || [input.recallDelta, ...input.personaRecallDeltas]
      .some(n => n !== null && (!Number.isFinite(n) || Math.abs(n) > 1))
    || !Number.isSafeInteger(input.recallQuestions) || input.recallQuestions < 0 || input.recallQuestions > 146
    || !Number.isSafeInteger(input.failedLogicalCases) || input.failedLogicalCases < 0 || input.failedLogicalCases > 876
    || typeof input.matrixComplete !== "boolean") fail("decision inputs");
  return { minimumReaderDelta: .03, numericalZeroTolerance: 1e-12,
    advanceToSeparateConfirmation: input.matrixComplete && input.failedLogicalCases === 0 && input.recallQuestions === 146
      && input.readerDelta >= .03 - 1e-12 && input.personaReaderDeltas.every(n => n >= -1e-12)
      && input.recallDelta !== null && input.recallDelta > 1e-12
      && input.personaRecallDeltas.every(n => n !== null && n > 1e-12),
    confirmedImprovement: false, externalFrameworkSuperiority: false,
    qualification: "Two previously exposed development personas; remaining seven are reserved for a separate screen, not pristine holdout data" };
}

/** Callers must authenticate native answers and original source/provenance before
 * publication. Missing logical cells throw; explicit unresolved cells remain zero
 * and make advancement false. The public file writer refuses incomplete results. */
export function scoreCloneMemKeywordDevelopment(input: Readonly<{ source: PairedMemorySource;
  scorer: CloneMemKeywordDevScorer; rankRows: readonly CloneMemKeywordDevRankRow[];
  plan: PairedMemoryPlan; result: PairedMemoryResult; answers: readonly Answer[] }>) {
  const source = parsePairedMemorySource(input.source), { scorer, rankRows, plan, result, answers } = input;
  if (!same(source.arms, ARMS) || source.questions.length !== 146 || !same(plan.arms, ARMS)
    || plan.readerProfile !== EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID || plan.repeats !== 3
    || plan.sourceSha256 !== canonicalSha256(source) || !same(plan.questionIds, source.questions.map(q => q.id))
    || scorer.protocol !== "oh.clonemem-keyword-dev-scorer.v1" || scorer.sourceSha256 !== canonicalSha256(source)
    || scorer.sourceRevision !== source.datasetRevision || scorer.rows.length !== 146 || rankRows.length !== 146
    || plan.cases.length !== 876 || new Set(plan.jobs.map(job => job.key)).size !== plan.jobs.length) fail("fixed source/plan scope");
  for (const [index, id] of PEOPLE.entries()) if (source.questions.filter(q => q.groupId === id).length !== LIMITS.personaQuestions[index]) fail("persona population");
  validatePairedMemoryResult(plan, result);
  const queries = new Map(source.questions.map(q => [q.id, q]));
  const gold = new Map(scorer.rows.map(row => [row.questionId, row]));
  const ranks = new Map(rankRows.map(row => [row.questionId, row]));
  if (gold.size !== 146 || ranks.size !== 146 || answers.length !== plan.jobs.length
    || new Set(answers.map(answer => answer.jobKey)).size !== answers.length) fail("exact scorer/rank/answer coverage");
  const native = new Map(answers.map(answer => [answer.jobKey, answer.answer]));
  const outcomes = new Map(result.outcomes.map(row => [row.jobKey, row]));
  const jobs = new Map(plan.jobs.map(job => [job.key, job]));
  for (const answer of answers) {
    const outcome = outcomes.get(answer.jobKey);
    if (!outcome || (answer.answer !== null && (typeof answer.answer !== "string" || Buffer.byteLength(answer.answer) > 262144))
      || outcome.answerSha256 !== (answer.answer === null ? null : sha256Hex(answer.answer))
      || outcome.disposition !== "completed" && answer.answer !== null) fail("native answer custody");
  }
  const recallPairs: Pair[] = [];
  for (const q of source.questions) {
    const row = gold.get(q.id), rank = ranks.get(q.id);
    if (!row || !rank || row.personId !== q.groupId || rank.personId !== q.groupId
      || !q.choices.some(choice => choice.id === row.correctChoiceId) || !Array.isArray(row.evidenceGroups)
      || row.evidenceGroups.length > 256 || row.evidenceGroups.some(group => !Array.isArray(group) || group.length > 2000
        || group.some(id => typeof id !== "string" || Buffer.byteLength(id) > 256))
      || rank.arms.length !== 2 || !same(rank.arms.map(arm => arm.armId), ARMS)) fail("scorer or rank identity");
    const recalls = rank.arms.map((arm, index) => {
      if (arm.traceIds.length > 10 || new Set(arm.traceIds).size !== arm.traceIds.length
        || arm.traceIds.some(id => typeof id !== "string" || Buffer.byteLength(id) > 256)
        || arm.contextSha256 !== sha256Hex(q.contexts[index]!.text)
        || arm.contextBytes !== Buffer.byteLength(q.contexts[index]!.text)) fail("rank/context binding");
      return cloneMemRecallAtK(row, arm.traceIds, 10);
    });
    if (recalls[0] !== null && recalls[1] !== null) recallPairs.push({ questionId: q.id, personId: q.groupId,
      baseline: recalls[0]!, candidate: recalls[1]! });
  }
  const seen = new Set<string>(), referenced = new Set<string>();
  const cells = plan.cases.map(cell => {
    const identity = JSON.stringify([cell.questionId, cell.armId, cell.repeat]);
    const q = queries.get(cell.questionId), job = jobs.get(cell.jobKey), outcome = outcomes.get(cell.jobKey);
    if (!q || !job || !outcome || seen.has(identity) || q.groupId !== cell.groupId
      || !(ARMS as readonly string[]).includes(cell.armId) || ![0, 1, 2].includes(cell.repeat) || job.repeat !== cell.repeat) fail("logical case identity");
    const context = q.contexts.find(c => c.armId === cell.armId)!;
    const request = makeEvolutionRequest(EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID, makeCloneMemChoiceMessages(q, context.text));
    if (!same(job.request, request) || cell.contextSha256 !== sha256Hex(context.text)
      || job.key !== `${request.requestSha256}:${cell.repeat}`) fail("native reader request reconstruction");
    seen.add(identity); referenced.add(cell.jobKey);
    return { questionId: q.id, personId: q.groupId, armId: cell.armId, repeat: cell.repeat,
      disposition: outcome.disposition, score: cloneMemChoiceCorrect(gold.get(q.id)!, native.get(cell.jobKey) ?? null) };
  });
  if (referenced.size !== jobs.size) fail("unused native jobs");
  const cellSummary = (subset: typeof cells) => ARMS.map(armId => {
    const selected = subset.filter(row => row.armId === armId), correct = selected.reduce((n, row) => n + row.score, 0);
    return { armId, cases: selected.length, correct, accuracy: correct / selected.length,
      dispositions: Object.fromEntries(dispositions.map(status => [status, selected.filter(row => row.disposition === status).length])) };
  });
  const qaPairs = source.questions.map(q => ({ questionId: q.id, personId: q.groupId,
    baseline: cells.filter(row => row.questionId === q.id && row.armId === ARMS[0]).reduce((n, row) => n + row.score, 0),
    candidate: cells.filter(row => row.questionId === q.id && row.armId === ARMS[1]).reduce((n, row) => n + row.score, 0) }));
  const readerPrimary = paired(qaPairs, 3), recallPrimary = paired(recallPairs, 1);
  const readerPersonas = PEOPLE.map(id => ({ persona: persona(id), ...paired(qaPairs.filter(row => row.personId === id), 3),
    arms: cellSummary(cells.filter(row => row.personId === id)) }));
  const recallPersonas = PEOPLE.map(id => ({ persona: persona(id), ...paired(recallPairs.filter(row => row.personId === id), 1) }));
  const matrixComplete = result.halt === "none" && result.ledger.unresolvedMicros === 0
    && result.outcomes.every(row => !["unresolved", "unattempted"].includes(row.disposition));
  const failedLogicalCases = cells.filter(row => row.disposition !== "completed").length;
  return { publicSummary: { questions: 146, personas: 2, repeats: 3, logicalCases: 876, matrixComplete,
    reader: { arms: cellSummary(cells), primary: readerPrimary, byPersona: readerPersonas,
      byRepeat: [0, 1, 2].map(repeat => ({ repeat, arms: cellSummary(cells.filter(row => row.repeat === repeat)) })) },
    retrieval: { k: 10, evaluableQuestions: recallPairs.length, missingEvidenceQuestions: 146 - recallPairs.length,
      primary: recallPrimary, byPersona: recallPersonas }, failedLogicalCases,
    decision: decideCloneMemKeywordDevelopment({ readerDelta: readerPrimary.delta!, personaReaderDeltas: readerPersonas.map(row => row.delta!),
      recallDelta: recallPrimary.delta, personaRecallDeltas: recallPersonas.map(row => row.delta), recallQuestions: recallPairs.length,
      matrixComplete, failedLogicalCases }) }, privateObservations: { cells, recallPairs } };
}

async function closedDatabase(pin: EvolutionPin, campaign: EvolutionCampaign) {
  if (pin.path !== join(campaign.storeDirectory, "campaign.sqlite")) fail("native database role");
  for (const name of ["active.lock", "campaign.sqlite-wal", "campaign.sqlite-shm", "campaign.sqlite-journal"]) {
    try { await lstat(join(campaign.storeDirectory, name)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error;
    } fail("native database must be closed");
  }
  const initial = await lstat(pin.path);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || initial.size > 4 * 1024 ** 3
    || initial.mode & 0o077 || await realpath(pin.path) !== pin.path) fail("private database custody");
  const hash = createHash("sha256"); for await (const chunk of createReadStream(pin.path)) hash.update(chunk);
  const after = await lstat(pin.path);
  if (initial.dev !== after.dev || initial.ino !== after.ino || initial.size !== after.size
    || initial.mtimeMs !== after.mtimeMs || initial.ctimeMs !== after.ctimeMs || hash.digest("hex") !== pin.sha256) fail("native database bytes changed");
}

/** Reparse every settled native response. Opening is explicitly immutable and
 * read-only; full physical coverage and the final paired receipt must agree. */
export async function authenticateCloneMemKeywordDevelopment(plan: PairedMemoryPlan, result: PairedMemoryResult,
  campaign: EvolutionCampaign, databasePin: EvolutionPin) {
  validatePairedMemoryResult(plan, result); await closedDatabase(databasePin, campaign);
  const database = openImmutableEvolutionPredecessor(databasePin.path);
  const native = new Map<string, { answer: string | null; response: EvolutionResponse }>();
  try {
    if (!same(database.query("SELECT key,value FROM metadata").all(), [{ key: "identity", value: canonicalSha256({ protocol: "oh.memory.evolution-store.v1", campaign }) }])
      || database.query<{ n: number }, []>("SELECT count(*) n FROM jobs").get()!.n !== plan.jobs.length
      || database.query<{ n: number }, []>("SELECT count(*) n FROM sqlite_master WHERE type IN ('trigger','view')").get()!.n !== 0) fail("native campaign or full coverage");
    const byPhysicalKey = new Map<string, typeof plan.jobs[number]>(plan.jobs.map(job => [canonicalSha256({ campaignId: campaign.campaignId,
      profileSha256: job.request.profileSha256, requestSha256: job.request.requestSha256, repeat: job.repeat }), job]));
    if (database.query<{ n: number }, []>("SELECT count(*) n FROM jobs WHERE typeof(request)!='text' OR length(CAST(request AS BLOB))>8388608 OR typeof(result)!='text' OR length(CAST(result AS BLOB))>2097152 OR typeof(raw)!='blob' OR length(raw)>1048576 OR typeof(raw_meta)!='text' OR length(CAST(raw_meta AS BLOB))>1024").get()!.n !== 0) fail("native row byte bounds");
    type Row = { key: string; repeat: number; request: string; reservation: number; charge: number; status: string;
      raw: Uint8Array; raw_sha: string; raw_meta: string; result: string };
    for (const row of database.query<Row, []>("SELECT * FROM jobs ORDER BY key").iterate()) {
      const job = byPhysicalKey.get(row.key), outcome = result.outcomes.find(value => value.jobKey === job?.key);
      if (!job || !outcome || native.has(job.key) || row.status !== "settled" || row.repeat !== job.repeat
        || typeof row.request !== "string" || Buffer.byteLength(row.request) > 8 * 1024 ** 2
        || typeof row.result !== "string" || Buffer.byteLength(row.result) > 2 * 1024 ** 2
        || !(row.raw instanceof Uint8Array) || row.raw.length > 1024 ** 2
        || typeof row.raw_meta !== "string" || Buffer.byteLength(row.raw_meta) > 1024
        || !same(JSON.parse(row.request), job.request) || row.reservation !== job.request.reservationMicros
        || row.raw_sha !== sha256Hex(row.raw)) fail("settled native request custody");
      const transport: unknown = JSON.parse(row.raw_meta);
      if (!isPlainRecord(transport) || !hasExactKeys(transport, ["httpStatus", "complete", "receivedBytes", "error", "serviceMs"])
        || transport.httpStatus !== 200 || transport.complete !== true || transport.error !== null || transport.receivedBytes !== row.raw.length
        || typeof transport.serviceMs !== "number" || !Number.isFinite(transport.serviceMs) || transport.serviceMs < 0
        || transport.serviceMs > 86_400_000 || outcome.serviceMs !== transport.serviceMs) fail("complete native transport");
      const response = parseEvolutionResponse(row.raw, job.request);
      if (!same(response, JSON.parse(row.result)) || response.status !== outcome.disposition || response.usage.micros !== row.charge
        || row.charge !== outcome.chargeMicros || outcome.rawSha256 !== response.rawSha256
        || outcome.answerSha256 !== (response.answer === null ? null : sha256Hex(response.answer))) fail("native response or charge mismatch");
      native.set(job.key, { answer: response.answer, response });
    }
  } finally { database.close(); }
  await closedDatabase(databasePin, campaign);
  if (native.size !== plan.jobs.length || result.ledger.calls !== native.size) fail("complete native coverage");
  const charged = [...native.values()].reduce((sum, row) => sum + row.response.usage.micros, 0);
  if (!same(result.ledger, { calls: native.size, exposureMicros: charged, confirmedMicros: charged, unresolvedMicros: 0,
    additionalBudgetMicros: campaign.additionalBudgetMicros, maximumCalls: campaign.maximumCalls,
    historicalExposureMicros: campaign.historicalExposureMicros, combinedExposureMicros: campaign.historicalExposureMicros + charged })) fail("exact campaign accounting");
  return native;
}

export async function reportCloneMemKeywordDevelopment(input: Readonly<{ preparedPin: EvolutionPin; launchPin: EvolutionPin;
  resultPin: EvolutionPin; databasePin: EvolutionPin; outputDirectory: string }>) {
  const prepared = decode(await readEvolutionPin(input.preparedPin, 256 * 1024));
  if (!isPlainRecord(prepared) || !hasExactKeys(prepared, ["protocol", "inputPins", "sourcePin", "scorerPin", "promptPin", "campaignPin", "planPin",
    "provenancePin", "codePins", "protocolPin", "selectedQuestions", "logicalCases", "maximumReservationMicros", "maximumPhysicalCalls", "taskBudget", "scoresComputed"])
    || prepared.protocol !== "oh.clonemem-keyword-dev-prepared.v1" || prepared.scoresComputed !== false
    || !same(prepared.taskBudget, CLONEMEM_KEYWORD_DEV_TASK_BUDGET)
    || !same(prepared.codePins, await cloneMemKeywordDevCodePins())
    || !same(prepared.protocolPin, await cloneMemFilePin(join(ROOT, "benchmarks/CLONEMEM_KEYWORD_DEV_V1.md")))) fail("fixed preparation/code/protocol");
  const admitted = await readCloneMemKeywordDevSources(prepared.inputPins as Parameters<typeof readCloneMemKeywordDevSources>[0]);
  const sourcePin = evolutionPin(prepared.sourcePin), scorerPin = evolutionPin(prepared.scorerPin), provenancePin = evolutionPin(prepared.provenancePin),
    promptPin = evolutionPin(prepared.promptPin), campaignPin = evolutionPin(prepared.campaignPin), planPin = evolutionPin(prepared.planPin);
  if (!same(decode(await readEvolutionPin(sourcePin, 64 * 1024 ** 2)), admitted.source)
    || !same(decode(await readEvolutionPin(scorerPin, 8 * 1024 ** 2)), admitted.scorer)
    || !same(decode(await readEvolutionPin(provenancePin, LIMITS.provenanceBytes)), admitted.provenance)
    || !same(promptPin, await cloneMemFilePin(join(ROOT, "scripts/benchmarks/clonemem-dataset.ts")))) fail("original source/scorer/provenance binding");
  const { campaign } = await verifyEvolutionCampaign(campaignPin);
  if (campaign.campaignId !== "oh-clonemem-keyword-dev-20260922-v1" || campaign.additionalBudgetMicros !== 5_000_000
    || campaign.maximumCalls !== 876 || campaign.historicalLedgers.length !== 27
    || campaign.historicalExposureMicros !== 253_259_158) fail("fixed campaign");
  const plan = verifyPairedMemoryPlan(decode(await readEvolutionPin(planPin, 128 * 1024 ** 2)), { source: admitted.source,
    sourcePin, scorerPin, promptPin, campaignPin, campaign, readerProfile: EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID,
    renderMessages: makeCloneMemChoiceMessages });
  const launch = parsePairedMemoryLaunch(decode(await readEvolutionPin(input.launchPin, 64 * 1024)));
  for (const [key, value] of Object.entries({ sourcePin, scorerPin, promptPin, campaignPin, planPin })) if (!same(launch[key as keyof typeof launch], value)) fail("launch roles");
  if (launch.maximumNewSpendMicros !== 5_000_000 || launch.maximumPhysicalCalls !== 876 || prepared.selectedQuestions !== 146
    || prepared.logicalCases !== 876 || prepared.maximumReservationMicros !== plan.maximumReservationMicros
    || prepared.maximumPhysicalCalls !== plan.maximumPhysicalCalls) fail("fixed dispatch plan");
  const result = decode(await readEvolutionPin(input.resultPin, 2 * 1024 ** 2)) as PairedMemoryResult;
  const native = await authenticateCloneMemKeywordDevelopment(plan, result, campaign, evolutionPin(input.databasePin));
  const scored = scoreCloneMemKeywordDevelopment({ ...admitted, rankRows: admitted.provenance.rankRows, plan, result,
    answers: plan.jobs.map(job => ({ jobKey: job.key, answer: native.get(job.key)!.answer })) });
  if (!scored.publicSummary.matrixComplete) fail("complete matrix required before publication");
  const usage = (keys: Set<string>) => {
    const responses = [...keys].map(key => native.get(key)!.response);
    const identities = new Map<string, { identity: EvolutionResponse["identity"]; calls: number }>();
    for (const response of responses) {
      const key = canonicalJson(response.identity), prior = identities.get(key);
      identities.set(key, { identity: response.identity, calls: (prior?.calls ?? 0) + 1 });
    }
    const sum = (key: "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens" | "micros") => responses.reduce((n, row) => n + row.usage[key], 0);
    return { physicalCalls: responses.length, inputTokens: sum("inputTokens"), cachedInputTokens: sum("cachedInputTokens"),
      outputTokens: sum("outputTokens"), reasoningTokens: sum("reasoningTokens"), chargedMicros: sum("micros"),
      modelIdentities: [...identities.values()] };
  };
  const armKeys = ARMS.map(arm => new Set(plan.cases.filter(row => row.armId === arm).map(row => row.jobKey)));
  const report = { protocol: "oh.clonemem-keyword-dev-public-result.v1", benchmarkCheckpoint: launch.checkpoint,
    preparationSha256: input.preparedPin.sha256, launchSha256: input.launchPin.sha256, resultFileSha256: input.resultPin.sha256,
    databaseSha256: input.databasePin.sha256, sourceSha256: canonicalSha256(admitted.source), scorerSha256: canonicalSha256(admitted.scorer),
    provenanceSha256: provenancePin.sha256, planSha256: canonicalSha256(plan), sourceRevision: admitted.source.datasetRevision,
    ...scored.publicSummary, contexts: ARMS.map((armId, index) => {
      const bytes = admitted.source.questions.map(q => Buffer.byteLength(q.contexts[index]!.text));
      return { armId, questions: bytes.length, meanBytes: mean(bytes), p50Bytes: percentile(bytes, .5), p95Bytes: percentile(bytes, .95), maximumBytes: Math.max(...bytes) };
    }), usage: { total: usage(new Set(plan.jobs.map(job => job.key))), byArm: ARMS.map((armId, index) => ({ armId, ...usage(armKeys[index]!) })),
      sharedPhysicalCallsAcrossArms: [...armKeys[0]!].filter(key => armKeys[1]!.has(key)).length,
      qualification: "Per-arm referenced physical usage overlaps when prompts are identical; only the total counts each physical call once" },
    costs: { calls: result.ledger.calls, chargedMicros: result.ledger.exposureMicros, unresolvedMicros: result.ledger.unresolvedMicros,
      priorTaskMicros: 4_300_145, totalTaskMicros: 4_300_145 + result.ledger.exposureMicros,
      remainingTaskMicros: 25_000_000 - 4_300_145 - result.ledger.exposureMicros },
    attribution: "Coding-agent experiment and analysis; native multiple-choice scoring of model answers",
    qualifications: ["All nine personas have project exposure; two development personas only; remaining seven reserved for a separate screen",
      "Gateway GPT-4o mini alias, temperature 0.1, 512 output tokens; not a verified model snapshot; three reader attempts and no model judge",
      "Native recall@10 uses whole traces eligible at question time; no context truncation; identical captured semantic ranks for both arms",
      "No confidence interval for two development personas; no confirmed improvement or external-framework superiority claim"] };
  if (!same(prepared.codePins, await cloneMemKeywordDevCodePins())) fail("code changed during report");
  await closedDatabase(input.databasePin, campaign);
  const directory = resolve(input.outputDirectory); await mkdir(directory, { mode: 0o700 });
  const publicBody = canonicalJson(report) + "\n", privateBody = canonicalJson(scored.privateObservations) + "\n";
  if (Buffer.byteLength(publicBody) > 512 * 1024 || Buffer.byteLength(privateBody) > 4 * 1024 ** 2) fail("report bound");
  await writeNew(join(directory, "public-result.json"), publicBody); await writeNew(join(directory, "private-observations.json"), privateBody);
  return { publicResultPin: await cloneMemFilePin(join(directory, "public-result.json")), report };
}

if (import.meta.main) {
  const [command, prepared, launch, result, database, databaseSha256, output, ...extra] = process.argv.slice(2);
  if (command === "score" && prepared && launch && result && database && databaseSha256 && output && extra.length === 0) {
    const scored = await reportCloneMemKeywordDevelopment({ preparedPin: await cloneMemFilePin(prepared),
      launchPin: await cloneMemFilePin(launch), resultPin: await cloneMemFilePin(result),
      databasePin: evolutionPin({ path: resolve(database), sha256: databaseSha256 }), outputDirectory: output });
    console.log(JSON.stringify({ publicResultPin: scored.publicResultPin }));
  } else if (command === "--help" && !prepared) {
    console.log("score PREPARED_JSON LAUNCH_JSON FINAL_RESULT_JSON CLOSED_DATABASE DATABASE_SHA256 NEW_PRIVATE_DIRECTORY — immutable native authentication and fixed development scoring; no provider calls");
  } else fail("use --help");
}
