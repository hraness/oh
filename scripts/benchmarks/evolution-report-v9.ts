/** V9 shard report: per-question mean over indexed reader and judge repeats, candidate/control pairing per reader,
 * cost and latency attributed over every physical (request, repeat) job, and ID-only outcome/physical projections
 * for the study reducer. No requests are sent here; responses and occupied failures are authenticated separately. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { Dataset } from "./datasets";
import { assertExactEvolutionCoverage } from "./evolution-dataset";
import { EVOLUTION_LME_NATIVE_REFERENCE, scoreEvolutionJudgeDecision } from "./evolution-judge";
import { evolutionJudgeCaseKeyV9, evolutionJudgeJobsV9, loadEvolutionJudgeRubricV9, makeEvolutionJudgePlanV9, validateEvolutionJudgePlanV9,
  type EvolutionJudgePlanV9 } from "./evolution-judge-v9";
import { EVOLUTION_LOCOMO_CATEGORY_NAMES, EVOLUTION_LOCOMO_JUDGE_PROFILE_ID } from "./evolution-locomo-judge";
import { LOCOMO_F1_PROTOCOL, LOCOMO_F1_REFERENCE, scoreLocomoF1, summarizeEvolutionPairs, summarizeEvolutionScores,
  type EvolutionMetric, type EvolutionMetricCase, type EvolutionScore } from "./evolution-metrics";
import { parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { assertEvolutionContextBindingV9, validateEvolutionContextPlanV9Sources, type EvolutionContextPlanV9 } from "./evolution-plan-v9";
import { evolutionJobKey, evolutionReaderJobsV2, validateEvolutionReaderPlanV2, type EvolutionPhysicalJob, type EvolutionReaderPlanV2 } from "./evolution-reader-plan-v2";
import { evolutionReaderDatePolicySha256, projectEvolutionRunnerInputV9 } from "./evolution-reader-date-policy";
import { selectEvolutionReportManifest } from "./evolution-report";
import { validateEvolutionAttemptFailure, type EvolutionAttemptFailure } from "./evolution-store";
import { evolutionStudyV9Shard, validateEvolutionStudyV9Artifacts } from "./evolution-study-v9";

export const EVOLUTION_REPORT_V9_PROTOCOL = "oh.memory.evolution-report.v9" as const;
export const EVOLUTION_PHASE_V2_PROTOCOL = "oh.memory.evolution-phase.v2" as const;
export const EVOLUTION_REPORT_V9_FAILURE_POLICY = "Every planned question remains in every arm and every declared repeat. A failed reader attempt scores zero for that repeat; a judge failure scores zero for judge metrics only and is counted separately. The per-question judge mean averages every (reader repeat, judge repeat) cell with failures as zero. Authenticated occupied attempts without a verifiable answer retain their full reservations. Never-admitted jobs or unauthenticated missing evidence prevent a complete report." as const;
export type EvolutionReportMetricV9 = EvolutionMetric | "evidence-precision" | "evidence-f1";
export type EvolutionRawResponseLoaderV9 = (request: EvolutionRequest, response: EvolutionResponse, repeat: number) => Promise<Uint8Array>;
export type EvolutionServiceMsLoaderV9 = (request: EvolutionRequest, response: EvolutionResponse, repeat: number) => Promise<number | null>;
export type EvolutionAttemptFailureLoaderV9 = (request: EvolutionRequest, repeat: number) => Promise<EvolutionAttemptFailure>;
export type EvolutionReportInputV9 = Readonly<{ dataset: Dataset; manifestBytes: Uint8Array; manifestSha256: string;
  contextPlan: EvolutionContextPlanV9; readerPlan: EvolutionReaderPlanV2; judgePlan: EvolutionJudgePlanV9;
  readerOutputBytes: Uint8Array; judgeOutputBytes: Uint8Array; judgeOutputSha256: string; loadRawResponse: EvolutionRawResponseLoaderV9;
  loadServiceMs?: EvolutionServiceMsLoaderV9; loadAttemptFailure?: EvolutionAttemptFailureLoaderV9;
  study: Readonly<{ studyBytes: Uint8Array; scopeBytes: Uint8Array; shardId: string; campaignSha256: string }> }>;
export type EvolutionOutcomeV9 = Readonly<{ questionId: string; variantId: string; reader: string; repeat: number; readerFailed: boolean;
  decisions: readonly (0 | 1 | null)[]; judgeMean: number; locomoF1: number | null;
  evidence: Readonly<{ precision: number | null; recall: number | null; f1: number | null; all: number | null }> }>;
export type EvolutionPhysicalV9 = Readonly<{ requestSha256: string; repeat: number; evidenceSha256: string; phase: "reader" | "judge";
  status: "verified" | "captured" | "reserved"; knownUsageMicros: number | null; unresolvedReservationMicros: number; serviceMs: number | null }>;

function fail(message: string): never { throw new TypeError(`Evolution report V9: ${message}.`); }
const pair = (q: string, v: string) => JSON.stringify([q, v]);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const digest = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
function json(bytes: Uint8Array, maximum: number): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > maximum) fail("JSON byte bound exceeded");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function boundedServiceMs(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0) || value > 86_400_000) fail(`invalid ${label} service duration`);
  return value;
}
function percentile(values: readonly number[], fraction: number): number | null {
  return values.length === 0 ? null : values[Math.ceil(values.length * fraction) - 1]!;
}
function serviceDistribution(keys: readonly string[], serviceMs: ReadonlyMap<string, number | null>, failures: ReadonlyMap<string, EvolutionAttemptFailure>) {
  const occupied = [...new Set(keys)], physical = occupied.filter(key => failures.get(key)?.storeStatus !== "reserved");
  const measured = physical.map(key => serviceMs.get(key) ?? null).filter((value): value is number => value !== null).sort((a, b) => a - b);
  return { logicalCases: keys.length, attributedPhysicalRequests: physical.length, count: measured.length, unknownDispatches: occupied.length - physical.length,
    measuredPhysicalRequests: measured.length, unmeasuredPhysicalRequests: physical.length - measured.length,
    totalMs: measured.reduce((sum, value) => sum + value, 0), p50Ms: percentile(measured, 0.5), p95Ms: percentile(measured, 0.95) };
}

/** Phase receipt V2: every planned (request, repeat) job carries exactly one verified response or one occupied failure. */
export function evolutionPhaseAttemptsV9(value: unknown, phase: "reader" | "judge", planSha256: string, jobs: readonly EvolutionPhysicalJob[]) {
  if (!isPlainRecord(value) || value.protocol !== EVOLUTION_PHASE_V2_PROTOCOL || value.phase !== phase || value.planSha256 !== planSha256
    || value.complete !== true || !Array.isArray(value.responses) || value.failures !== undefined && !Array.isArray(value.failures)
    || value.responses.length > 100_000 || ((value.failures ?? []) as unknown[]).length > 100_000) fail("complete matching phase receipt required");
  const expected = new Map(jobs.map(job => [job.key, job]));
  if (expected.size !== jobs.length) fail("duplicate planned jobs");
  const responses = new Map<string, EvolutionResponse>(), failures = new Map<string, EvolutionAttemptFailure>();
  for (const row of value.responses) {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["requestSha256", "repeat", "response"]) || typeof row.requestSha256 !== "string"
      || !Number.isSafeInteger(row.repeat) || !isPlainRecord(row.response) || row.response.requestSha256 !== row.requestSha256) fail("invalid response receipt");
    const key = evolutionJobKey(row.requestSha256, row.repeat as number), job = expected.get(key);
    if (job === undefined || responses.has(key)) fail("duplicate or foreign response identity");
    responses.set(key, row.response as unknown as EvolutionResponse);
  }
  for (const row of (value.failures ?? []) as unknown[]) {
    if (!isPlainRecord(row) || typeof row.requestSha256 !== "string" || !Number.isSafeInteger(row.repeat)) fail("invalid failed-attempt receipt");
    const key = evolutionJobKey(row.requestSha256, row.repeat as number), job = expected.get(key);
    if (job === undefined || responses.has(key) || failures.has(key)) fail("duplicate or foreign failed attempt");
    failures.set(key, validateEvolutionAttemptFailure(row, job.request, job.repeat));
  }
  if (responses.size + failures.size !== jobs.length) fail("incomplete attempted-job coverage");
  const wallMs = value.wallMs === undefined ? null : boundedServiceMs(value.wallMs, `${phase} phase wall`);
  return { responses, failures, wallMs };
}
async function authenticatePhase(input: Readonly<{ bytes: Uint8Array; phase: "reader" | "judge"; planSha256: string; jobs: readonly EvolutionPhysicalJob[];
  loadRawResponse: EvolutionRawResponseLoaderV9; loadServiceMs?: EvolutionServiceMsLoaderV9; loadAttemptFailure?: EvolutionAttemptFailureLoaderV9 }>) {
  const receipts = evolutionPhaseAttemptsV9(json(input.bytes, 256 * 1024 * 1024), input.phase, input.planSha256, input.jobs);
  const authenticated = new Map<string, EvolutionResponse>(), failures = new Map<string, EvolutionAttemptFailure>(), serviceMs = new Map<string, number | null>();
  for (let start = 0; start < input.jobs.length; start += 8) {
    const batch = await Promise.all(input.jobs.slice(start, start + 8).map(async job => {
      const failure = receipts.failures.get(job.key);
      if (failure !== undefined) {
        if (input.loadAttemptFailure === undefined) fail("authenticated attempt failure loader required");
        const authenticatedFailure = validateEvolutionAttemptFailure(await input.loadAttemptFailure(job.request, job.repeat), job.request, job.repeat);
        if (!same(failure, authenticatedFailure)) fail("phase failure receipt does not match occupied campaign evidence");
        return { key: job.key, response: null, failure: authenticatedFailure, duration: boundedServiceMs(authenticatedFailure.serviceMs, input.phase) };
      }
      const receipt = receipts.responses.get(job.key)!, raw = await input.loadRawResponse(job.request, receipt, job.repeat);
      const response = parseEvolutionResponse(raw, job.request);
      if (!same(response, receipt)) fail("phase receipt does not match captured raw response");
      const duration = input.loadServiceMs === undefined ? null : boundedServiceMs(await input.loadServiceMs(job.request, response, job.repeat), input.phase);
      return { key: job.key, response, failure: null, duration };
    }));
    for (const { key, response, failure, duration } of batch) {
      if (response !== null) authenticated.set(key, response);
      if (failure !== null) failures.set(key, failure);
      serviceMs.set(key, duration);
    }
  }
  return { responses: authenticated, failures, serviceMs, phaseWallMs: receipts.wallMs };
}
function cost(responses: ReadonlyMap<string, EvolutionResponse>, failures: ReadonlyMap<string, EvolutionAttemptFailure>, jobs: readonly EvolutionPhysicalJob[]) {
  const values = [...responses.values()], failed = [...failures.values()];
  const totals = (rows: readonly EvolutionResponse[], unverified: readonly EvolutionAttemptFailure[]) => ({
    physicalRequests: rows.length + unverified.filter(f => f.storeStatus === "captured").length,
    occupiedRequests: rows.length + unverified.length, unknownDispatches: unverified.filter(f => f.storeStatus === "reserved").length,
    knownUsageMicros: rows.reduce((n, r) => n + r.usage.micros, 0),
    unresolvedReservationMicros: unverified.reduce((n, f) => n + f.reservationMicros, 0),
    accountedMicros: rows.reduce((n, r) => n + r.usage.micros, 0) + unverified.reduce((n, f) => n + f.reservationMicros, 0),
    usageCoverage: { knownRequests: rows.length, unknownRequests: unverified.length },
    tokenRateMicros: rows.reduce((n, r) => n + r.usage.tokenRateMicros, 0),
    gatewayReportedMicros: rows.some(r => r.usage.gatewayReportedMicros !== null) ? rows.reduce((n, r) => n + (r.usage.gatewayReportedMicros ?? 0), 0) : null,
    inputTokens: rows.reduce((n, r) => n + r.usage.inputTokens, 0), outputTokens: rows.reduce((n, r) => n + r.usage.outputTokens, 0),
    cachedInputTokens: rows.reduce((n, r) => n + r.usage.cachedInputTokens, 0), reasoningTokens: rows.reduce((n, r) => n + r.usage.reasoningTokens, 0) });
  const requestedModels = new Map(jobs.map(j => [j.request.requestSha256, j.request.model]));
  return { ...totals(values, failed), byRequestedModel: [...new Set(jobs.map(j => j.request.model))].sort().map(model => ({ model,
    ...totals(values.filter(r => r.identity.requestedModel === model), failed.filter(f => requestedModels.get(f.requestSha256) === model)) })),
    identities: [...new Map(values.map(r => [canonicalSha256(r.identity), r.identity])).values()] };
}
function evidence(expectedIds: readonly string[], retrievedIds: readonly string[]) {
  const expected = new Set(expectedIds), retrieved = new Set(retrievedIds);
  if (!expected.size) return { precision: null, recall: null, f1: null, all: null };
  const found = [...expected].filter(id => retrieved.has(id)).length;
  return { precision: retrieved.size ? found / retrieved.size : 0, recall: found / expected.size, f1: 2 * found / (expected.size + retrieved.size), all: Number(found === expected.size) };
}
const baseMetric = (metric: EvolutionReportMetricV9): EvolutionMetric => metric === "evidence-precision" || metric === "evidence-f1" ? "evidence-recall" : metric;
function summarize(cases: readonly EvolutionMetricCase[], scores: readonly EvolutionScore[], metric: EvolutionReportMetricV9) {
  return { ...summarizeEvolutionScores(cases, scores, baseMetric(metric)), metric };
}
function paired(cases: readonly EvolutionMetricCase[], left: readonly EvolutionScore[], right: readonly EvolutionScore[], metric: EvolutionReportMetricV9) {
  const result = summarizeEvolutionPairs(cases, left, right, baseMetric(metric));
  return { metric, paired: result.paired, byCategory: result.byCategory, byGroup: result.byGroup, byHistory: result.byHistory, qualification: result.qualification };
}
function judgeQualification(profile: EvolutionJudgePlanV9["profile"]): string {
  if (profile === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID) return "LoCoMo leaderboard-parity judge: the Packer/Mem0/Zep CORRECT-WRONG prompt on the Gateway openai/gpt-4o-mini alias at temperature 0 over categories 1-4 (multi-hop, temporal, open-domain, single-hop). Exactly one of CORRECT or WRONG must appear; both or neither is a judge failure. The alias is not a pinned snapshot, category 5 has no gold and is outside this denominator, and this is a like-for-like protocol in prompt and model family only.";
  if (profile === "gpt4o-official-snapshot-judge") return "Pinned direct GPT-4o-2024-08-06, native LongMemEval prompts and contains-yes grading over an explicit selection; not the official full-set score.";
  if (profile === "gpt4o-gateway-native-rubric-16-judge-v1") return "Gateway GPT-4o alias with native LongMemEval prompts, one user message and contains-yes grading, adapted to 16 output tokens. The requested model is not a pinned snapshot and the output cap differs from the native 10-token evaluator; not an official protocol reproduction or full-set score.";
  return "Gateway GPT-4o alias with native LongMemEval prompts, one user message, 10 output tokens and contains-yes grading; the requested model is not a pinned snapshot.";
}

export async function buildEvolutionReportV9(input: EvolutionReportInputV9) {
  const authorization = validateEvolutionStudyV9Artifacts({ studyBytes: input.study.studyBytes, scopeBytes: input.study.scopeBytes, manifestBytes: input.manifestBytes });
  const { study } = authorization, shard = evolutionStudyV9Shard(authorization, input.study.shardId);
  if (!digest(input.study.campaignSha256)) fail("campaign digest required");
  assertEvolutionContextBindingV9(input.contextPlan, authorization, input.study.shardId);
  const manifest = selectEvolutionReportManifest(input.dataset, input.manifestBytes, input.manifestSha256, { questionIds: shard.questionIds });
  if (input.contextPlan.manifestSha256 !== input.manifestSha256) fail("context selection or input changed");
  validateEvolutionContextPlanV9Sources(input.contextPlan, projectEvolutionRunnerInputV9(input.dataset, study.readerDatePolicy));
  const readers = validateEvolutionReaderPlanV2(input.readerPlan, input.contextPlan), judges = validateEvolutionJudgePlanV9(input.judgePlan);
  if (!same(readers.readerProfiles, study.readers) || readers.repeats !== study.repeats || judges.profile !== study.judge
    || judges.rubricSha256 !== study.rubricSha256 || judges.judgeRepeats !== study.judgeRepeats) fail("reader/judge plan differs from the frozen study");
  const readerOutputSha256 = sha256Hex(input.readerOutputBytes);
  if (judges.readerOutputSha256 !== readerOutputSha256 || !digest(input.judgeOutputSha256) || sha256Hex(input.judgeOutputBytes) !== input.judgeOutputSha256) fail("phase bytes changed");
  const readerJobs = evolutionReaderJobsV2(readers), judgeJobs = evolutionJudgeJobsV9(judges);
  const loaders = { loadRawResponse: input.loadRawResponse, ...(input.loadServiceMs === undefined ? {} : { loadServiceMs: input.loadServiceMs }),
    ...(input.loadAttemptFailure === undefined ? {} : { loadAttemptFailure: input.loadAttemptFailure }) };
  const readerPhase = await authenticatePhase({ bytes: input.readerOutputBytes, phase: "reader", planSha256: readers.planSha256, jobs: readerJobs, ...loaders });
  const rubric = await loadEvolutionJudgeRubricV9(judges.profile);
  const rebuilt = makeEvolutionJudgePlanV9({ contextPlan: input.contextPlan, readerPlan: readers, responses: readerPhase.responses, failures: readerPhase.failures,
    dataset: input.dataset, profile: judges.profile, rubric, judgeRepeats: judges.judgeRepeats, readerOutputSha256 });
  if (!same(judges, rebuilt)) fail("judge plan differs from the complete authenticated reader and gold matrix");
  const judgePhase = await authenticatePhase({ bytes: input.judgeOutputBytes, phase: "judge", planSha256: judges.planSha256, jobs: judgeJobs, ...loaders });
  const groupLabels = new Map([...new Set(manifest.questions.map(q => q.groupId))].sort().map((g, i) => [g, `group-${i + 1}`]));
  const historyLabels = new Map([...new Set(manifest.questions.map(q => q.historyId))].sort().map((h, i) => [h, `history-${i + 1}`]));
  const metadata = new Map(manifest.questions.map(q => [q.id, q]));
  const cases: EvolutionMetricCase[] = input.dataset.questions.map(q => { const m = metadata.get(q.id)!;
    return { id: m.runnerId, groupId: groupLabels.get(m.groupId)!, historyId: historyLabels.get(m.historyId)!, category: q.category }; });
  const readerCases = new Map(readers.cases.map(c => [JSON.stringify([c.questionId, c.variantId, c.reader, c.repeat]), c]));
  const judgeCases = new Map(judges.cases.map(c => [evolutionJudgeCaseKeyV9(c), c]));
  const contexts = new Map(input.contextPlan.cases.map(c => [pair(c.questionId, c.variantId), c.result]));
  const locomo = input.dataset.questions.every(q => /^locomo:[1-5]$/.test(q.category));
  if (!locomo && input.dataset.questions.some(q => q.category.startsWith("locomo:"))) fail("mixed LoCoMo and LongMemEval categories");
  const metrics: readonly EvolutionReportMetricV9[] = ["judge-mean", ...(locomo ? ["locomo-f1" as const] : []), "evidence-precision", "evidence-recall", "evidence-f1", "evidence-all"];
  const cells = Array.from({ length: readers.repeats }, (_, repeat) => Array.from({ length: judges.judgeRepeats }, (_, judgeRepeat) => ({ repeat, judgeRepeat }))).flat();
  const rawArms = input.contextPlan.variants.flatMap(variant => readers.readerProfiles.map(reader => {
    let readerFailures = 0, judgeFailures = 0, unanimous = 0;
    const readerKeys: string[] = [], judgeKeys: string[] = [], outcomes: EvolutionOutcomeV9[] = [];
    const scores: Record<EvolutionReportMetricV9, EvolutionScore[]> = { "judge-accuracy": [], "judge-mean": [], "locomo-f1": [], "evidence-precision": [], "evidence-recall": [], "evidence-f1": [], "evidence-all": [] };
    const byCell = cells.map(cell => ({ ...cell, scores: [] as EvolutionScore[] }));
    for (const [index, q] of input.dataset.questions.entries()) {
      const id = cases[index]!.id, context = contexts.get(pair(id, variant.id))!;
      const e = locomo ? evidence(q.evidenceTurnIds, context.turnIds) : evidence(q.evidenceSessionIds, context.sessionIds);
      const decisionsByRepeat: (0 | 1 | null)[][] = [], f1ByRepeat: number[] = [];
      let allFailed = true;
      for (let repeat = 0; repeat < readers.repeats; repeat++) {
        const rc = readerCases.get(JSON.stringify([id, variant.id, reader, repeat]))!, readerKey = evolutionJobKey(rc.requestSha256, repeat);
        readerKeys.push(readerKey);
        const response = readerPhase.responses.get(readerKey), decisions: (0 | 1 | null)[] = [];
        let readerFailed = false;
        for (let judgeRepeat = 0; judgeRepeat < judges.judgeRepeats; judgeRepeat++) {
          const jc = judgeCases.get(evolutionJudgeCaseKeyV9({ questionId: id, variantId: variant.id, reader, stage: "answer", repeat, judgeRepeat }))!;
          readerFailed = jc.readerFailed;
          const judged = jc.requestSha256 === null ? null : judgePhase.responses.get(evolutionJobKey(jc.requestSha256, judgeRepeat));
          if (jc.requestSha256 !== null) judgeKeys.push(evolutionJobKey(jc.requestSha256, judgeRepeat));
          const decision = judged?.status === "completed" ? scoreEvolutionJudgeDecision(judges.profile, judged.answer) : null;
          const judgeFailed = !readerFailed && decision === null;
          judgeFailures += Number(judgeFailed); decisions.push(decision);
          if (!readerFailed && !judgeFailed) allFailed = false;
          byCell[repeat * judges.judgeRepeats + judgeRepeat]!.scores.push({ id, score: decision ?? 0, failed: readerFailed || judgeFailed });
        }
        readerFailures += Number(readerFailed);
        const judgeMean = decisions.reduce((sum: number, d) => sum + (d ?? 0), 0) / decisions.length;
        const locomoF1 = locomo ? readerFailed ? 0 : scoreLocomoF1(q, response!.answer!) : null;
        decisionsByRepeat.push(decisions); if (locomoF1 !== null) f1ByRepeat.push(locomoF1);
        outcomes.push({ questionId: id, variantId: variant.id, reader, repeat, readerFailed, decisions, judgeMean, locomoF1, evidence: e });
      }
      const flat = decisionsByRepeat.flat(), judgeMean = flat.reduce((sum: number, d) => sum + (d ?? 0), 0) / flat.length;
      if (flat.every(d => (d ?? 0) === (flat[0] ?? 0))) unanimous++;
      scores["judge-mean"].push({ id, score: judgeMean, failed: allFailed });
      if (locomo) scores["locomo-f1"].push({ id, score: f1ByRepeat.reduce((sum, v) => sum + v, 0) / f1ByRepeat.length, failed: false });
      for (const [metric, score] of [["evidence-precision", e.precision], ["evidence-recall", e.recall], ["evidence-f1", e.f1], ["evidence-all", e.all]] as const) scores[metric].push({ id, score, failed: false });
    }
    return { variantId: variant.id, reader, readerFailures, judgeFailures, readerKeys, judgeKeys, scores, byCell, outcomes,
      repeatAgreement: { questions: cases.length, unanimous, cells: cells.length } };
  }));
  const byArm = new Map(rawArms.map(arm => [pair(arm.variantId, arm.reader), arm]));
  const control = input.contextPlan.variants[0]!.id;
  const comparisons = rawArms.flatMap(left => {
    const references = [...(left.variantId === control ? [] : [{ kind: "retrieval" as const, variantId: control, reader: left.reader }]),
      ...(left.reader === readers.readerProfiles[0] ? [] : [{ kind: "reader" as const, variantId: left.variantId, reader: readers.readerProfiles[0]! }])];
    return references.map(reference => { const right = byArm.get(pair(reference.variantId, reference.reader))!;
      return { kind: reference.kind, left: { variantId: left.variantId, reader: left.reader }, right: { variantId: right.variantId, reader: right.reader },
        metrics: metrics.map(metric => paired(cases, left.scores[metric], right.scores[metric], metric)),
        byCell: left.byCell.map((cell, i) => ({ repeat: cell.repeat, judgeRepeat: cell.judgeRepeat, ...paired(cases, cell.scores, right.byCell[i]!.scores, "judge-accuracy").paired })) }; });
  });
  const readerCost = cost(readerPhase.responses, readerPhase.failures, readerJobs), judgeCost = cost(judgePhase.responses, judgePhase.failures, judgeJobs);
  const physical: EvolutionPhysicalV9[] = ([["reader", readerJobs, readerPhase], ["judge", judgeJobs, judgePhase]] as const).flatMap(([phase, jobs, result]) => jobs.map(job => {
    const response = result.responses.get(job.key), failure = result.failures.get(job.key);
    return { requestSha256: job.request.requestSha256, repeat: job.repeat, evidenceSha256: canonicalSha256(response ?? failure), phase,
      status: response === undefined ? failure!.storeStatus : "verified" as const, knownUsageMicros: response?.usage.micros ?? null,
      unresolvedReservationMicros: failure?.reservationMicros ?? 0, serviceMs: result.serviceMs.get(job.key) ?? null };
  }));
  assertExactEvolutionCoverage(shard.questionIds, cases.map(c => c.id));
  return { protocol: EVOLUTION_REPORT_V9_PROTOCOL, status: "complete" as const,
    qualification: "Explicit-selection descriptive evidence with the declared exposure strata and indexed repeats; no fresh confirmation, independence, confidence interval or superiority claim. Repeats average reader and judge noise; they do not shrink question-sampling uncertainty.",
    dataset: { name: manifest.dataset, revision: manifest.revision, partition: "explicit-selection-descriptive" as const, selectedQuestions: cases.length,
      selectedCorpora: manifest.corpora.length, declaredGroups: groupLabels.size, declaredHistories: historyLabels.size,
      exposures: ["unseen", "development", "evaluated", "unknown"].map(exposure => ({ exposure, groups: manifest.groups.filter(g => g.exposure === exposure).length })),
      strata: [...new Set(manifest.questions.map(q => JSON.stringify([q.partition, manifest.groups.find(g => g.groupId === q.groupId)!.exposure])))].sort().map(key => {
        const [partition, exposure] = JSON.parse(key) as [string, string];
        return { partition, exposure, questions: manifest.questions.filter(q => q.partition === partition && manifest.groups.find(g => g.groupId === q.groupId)!.exposure === exposure).length }; }),
      categoryNames: locomo ? EVOLUTION_LOCOMO_CATEGORY_NAMES : null, groupingQualification: manifest.qualification },
    pins: { manifestSha256: input.manifestSha256, sourceSha256: manifest.sourceSha256, selectedDatasetSha256: manifest.datasetSha256,
      contextPlanSha256: input.contextPlan.planSha256, readerPlanSha256: readers.planSha256, readerOutputSha256,
      judgePlanSha256: judges.planSha256, judgeOutputSha256: input.judgeOutputSha256, rubricSha256: rubric.sha256 },
    design: { candidateVariantId: input.contextPlan.variants[1]!.id, controlVariantId: control, candidateVariantSha256: input.contextPlan.candidateVariantSha256,
      readers: readers.readerProfiles, repeats: readers.repeats, judgeRepeats: judges.judgeRepeats, readerDatePolicy: study.readerDatePolicy,
      readerDatePolicySha256: evolutionReaderDatePolicySha256(study.readerDatePolicy), derivedRecordsPinSha256: study.derivedRecordsPin?.sha256 ?? null,
      candidatePresentation: study.candidatePresentation, repeatPolicy: study.repeatPolicy, stages: readers.stages },
    scoring: { judgeProfile: judges.profile, judgeRule: judges.scoringRule, judgeReference: judges.profile === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID ? null : EVOLUTION_LME_NATIVE_REFERENCE,
      judgeQualification: judgeQualification(judges.profile),
      officialLocomoF1: locomo ? { protocol: LOCOMO_F1_PROTOCOL, reference: LOCOMO_F1_REFERENCE,
        qualification: "Diagnostic only, reported beside the parity judge. The native abstention regex (no information available|not mentioned) does not match the explicit-abstention reader wording, so this F1 underestimates abstention; no LoCoMo-specific abstention phrase was added, and category 5 is outside this scope." } : null,
      failurePolicy: EVOLUTION_REPORT_V9_FAILURE_POLICY, evidenceUnit: locomo ? "turn" : "session",
      evidenceQualification: "Retrieval evidence is scored independently of answer success and of repeats. No evidence labels means unscored, not perfect; unresolved labels remain in the denominator.",
      answerCitationF1: null, citationQualification: "Not measured: the reader prompt asks for an answer without citations." },
    coverage: { logicalReaderCases: readers.cases.length, logicalJudgeCases: judges.cases.length, expectedQuestionsPerArm: cases.length,
      repeats: readers.repeats, judgeRepeats: judges.judgeRepeats, physicalReaderJobs: readerJobs.length, physicalJudgeJobs: judgeJobs.length,
      completePhysicalResponses: readerPhase.failures.size + judgePhase.failures.size === 0, completeAttemptCoverage: true,
      verifiedPhysicalResponses: readerPhase.responses.size + judgePhase.responses.size,
      capturedUnverifiableAttempts: [...readerPhase.failures.values(), ...judgePhase.failures.values()].filter(f => f.storeStatus === "captured").length,
      unknownDispatches: readerCost.unknownDispatches + judgeCost.unknownDispatches },
    cost: { reader: readerCost, judge: judgeCost, accountedMicros: readerCost.accountedMicros + judgeCost.accountedMicros,
      knownUsageMicros: readerCost.knownUsageMicros + judgeCost.knownUsageMicros, unresolvedReservationMicros: readerCost.unresolvedReservationMicros + judgeCost.unresolvedReservationMicros,
      qualification: "Known captured usage plus full unresolved reservations, counted once per distinct occupied (request, repeat) job in these phases across every reader stage. Accounted cost is conservative exposure, not a provider invoice. Token totals and provider identities cover verified responses only; unknown usage is not zero. Reserved jobs without captures do not prove dispatch. Reasoning tokens are already included in output tokens." },
    latency: { reader: { phaseWallMs: readerPhase.phaseWallMs, physical: serviceDistribution(readerJobs.map(j => j.key), readerPhase.serviceMs, readerPhase.failures) },
      judge: { phaseWallMs: judgePhase.phaseWallMs, physical: serviceDistribution(judgeJobs.map(j => j.key), judgePhase.serviceMs, judgePhase.failures) },
      qualification: "Service time is captured once per attempted physical (request, repeat) job through first-response body completion or failure. Reserved jobs without captures are excluded from physical latency counts because dispatch is unknown. Arm values attribute each captured duration to every arm reusing it. Phase wall time is receipt-reported elapsed time including queueing and concurrency." },
    arms: rawArms.map(arm => ({ variantId: arm.variantId, reader: arm.reader, readerFailures: arm.readerFailures, judgeFailures: arm.judgeFailures,
      repeatAgreement: arm.repeatAgreement,
      latency: { reader: serviceDistribution(arm.readerKeys, readerPhase.serviceMs, readerPhase.failures), judge: serviceDistribution(arm.judgeKeys, judgePhase.serviceMs, judgePhase.failures) },
      metrics: metrics.map(metric => summarize(cases, arm.scores[metric], metric)),
      byCell: arm.byCell.map(cell => ({ repeat: cell.repeat, judgeRepeat: cell.judgeRepeat, ...summarize(cases, cell.scores, "judge-accuracy") })) })),
    comparisonPolicy: "Left minus right on per-question means over repeats. Each non-control variant is paired against the control at a fixed reader; each non-first reader is paired against the first reader at a fixed variant. byCell pairs the binary judge decision of each (reader repeat, judge repeat) cell. No mixed-treatment comparisons.",
    comparisons,
    study: { studySha256: authorization.studySha256, scopeSha256: authorization.scope.scopeSha256, scopeFileSha256: authorization.scopeFileSha256,
      shardId: input.study.shardId, questionIds: shard.questionIds, campaignSha256: input.study.campaignSha256,
      retrievalSourceSha256: input.contextPlan.retrievalSourceSha256, candidatePresentation: study.candidatePresentation,
      outcomes: rawArms.flatMap(arm => arm.outcomes), physical } };
}
export type EvolutionReportV9 = Awaited<ReturnType<typeof buildEvolutionReportV9>>;
