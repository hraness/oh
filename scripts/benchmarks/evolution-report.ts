import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { Dataset } from "./datasets";
import { assertExactEvolutionCoverage, createEvolutionDatasetManifest, EVOLUTION_DATASET_PROTOCOL,
  evolutionRunnerCorpusId, evolutionRunnerQuestionId, projectEvolutionRunnerInput, type EvolutionDatasetManifest } from "./evolution-dataset";
import { EVOLUTION_LME_NATIVE_REFERENCE, makeEvolutionJudgePlan, scoreEvolutionJudgeDecision, validateEvolutionJudgePlan, type EvolutionJudgePlan } from "./evolution-judge";
import { LOCOMO_F1_PROTOCOL, LOCOMO_F1_REFERENCE, scoreLocomoF1, summarizeEvolutionPairs, summarizeEvolutionScores,
  type EvolutionMetric, type EvolutionMetricCase, type EvolutionScore } from "./evolution-metrics";
import { parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { validateEvolutionContextPlanSources, validateEvolutionReaderPlan, type EvolutionAnyContextPlan, type EvolutionReaderPlan } from "./evolution-plan";
import { validateEvolutionAttemptFailure, type EvolutionAttemptFailure } from "./evolution-store";
import { loadJudgeProfile } from "./judge";

function fail(message: string): never { throw new TypeError(`Evolution report: ${message}.`); }
const pair = (q: string, v: string) => JSON.stringify([q, v]);
const triple = (q: string, v: string, r: string) => JSON.stringify([q, v, r]);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const digest = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const bounded = (s: unknown, maximum = 512): s is string => typeof s === "string" && s.length > 0 && Buffer.byteLength(s) <= maximum;
function json(bytes: Uint8Array, maximum: number): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > maximum) fail("JSON byte bound exceeded");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Authenticate selected content against the pinned complete exposure manifest without opening other partitions. */
function selectedManifest(dataset: Dataset, bytes: Uint8Array, expectedSha256: string): EvolutionDatasetManifest {
  if (!digest(expectedSha256) || sha256Hex(bytes) !== expectedSha256) fail("manifest bytes changed");
  const value = json(bytes, 128 * 1024 * 1024);
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "dataset", "revision", "sourceSha256", "datasetSha256", "groups", "corpora", "questions", "qualification"])
    || value.protocol !== EVOLUTION_DATASET_PROTOCOL || !Array.isArray(value.groups) || !Array.isArray(value.corpora)
    || !Array.isArray(value.questions) || [value.groups, value.corpora, value.questions].some(a => a.length > 100_000)
    || !bounded(value.dataset) || !bounded(value.revision) || !digest(value.sourceSha256) || !digest(value.datasetSha256)
    || value.qualification !== "Declared grouping and exposure; no independence or freshness inferred.") fail("invalid exposure manifest");
  const manifest = value as unknown as EvolutionDatasetManifest;
  for (const rows of [manifest.groups, manifest.corpora, manifest.questions]) {
    if (rows.some(row => !isPlainRecord(row))) fail("invalid manifest row");
  }
  assertExactEvolutionCoverage(manifest.groups.map(g => g.groupId), manifest.groups.map(g => g.groupId));
  assertExactEvolutionCoverage(manifest.corpora.map(c => c.id), manifest.corpora.map(c => c.id));
  assertExactEvolutionCoverage(manifest.questions.map(q => q.id), manifest.questions.map(q => q.id));
  for (const g of manifest.groups) if (!hasExactKeys(g, ["groupId", "partition", "exposure", "evidence"])
    || !["development", "search-validation", "sealed", "closed"].includes(g.partition)
    || !["unseen", "development", "evaluated", "unknown"].includes(g.exposure) || !bounded(g.evidence, 4096)
    || (g.partition === "sealed" && g.exposure !== "unseen")) fail("invalid exposure declaration");
  const fullGroups = new Map(manifest.groups.map(g => [g.groupId, g])), fullCorpora = new Map(manifest.corpora.map(c => [c.id, c]));
  const historyPartitions = new Map<string, string>();
  for (const c of manifest.corpora) {
    if (!hasExactKeys(c, ["id", "runnerId", "groupId", "historyId", "contentSha256"]) || !bounded(c.historyId)
      || !digest(c.contentSha256) || c.runnerId !== evolutionRunnerCorpusId(c.id) || !fullGroups.has(c.groupId)) fail("invalid corpus identity");
    const partition = fullGroups.get(c.groupId)!.partition, previous = historyPartitions.get(c.historyId);
    if (previous !== undefined && previous !== partition) fail("shared history crosses partitions");
    historyPartitions.set(c.historyId, partition);
  }
  for (const q of manifest.questions) {
    const c = fullCorpora.get(q.corpusId);
    if (!hasExactKeys(q, ["id", "runnerId", "corpusId", "groupId", "historyId", "category", "partition", "contentSha256"])
      || !bounded(q.category) || !digest(q.contentSha256) || q.runnerId !== evolutionRunnerQuestionId(q.id)
      || c === undefined || q.groupId !== c.groupId || q.historyId !== c.historyId
      || q.partition !== fullGroups.get(c.groupId)!.partition) fail("invalid question metadata");
  }
  if (manifest.datasetSha256 !== sha256Hex(JSON.stringify({ corpora: manifest.corpora, questions: manifest.questions }))) {
    // Manifests can be serialized with canonical object keys. Reconstruct their defined row-key order.
    const corpora = manifest.corpora.map(c => ({ id: c.id, runnerId: c.runnerId, groupId: c.groupId, historyId: c.historyId, contentSha256: c.contentSha256 }));
    const questions = manifest.questions.map(q => ({ id: q.id, runnerId: q.runnerId, corpusId: q.corpusId, groupId: q.groupId,
      historyId: q.historyId, category: q.category, partition: q.partition, contentSha256: q.contentSha256 }));
    if (manifest.datasetSha256 !== sha256Hex(JSON.stringify({ corpora, questions }))) fail("manifest dataset digest changed");
  }
  const groups = new Set(dataset.corpora.map(c => c.groupId)), corpora = new Set(dataset.corpora.map(c => c.id));
  const subset = createEvolutionDatasetManifest(dataset, { dataset: manifest.dataset, revision: manifest.revision,
    sourceSha256: manifest.sourceSha256, groups: manifest.groups.filter(g => groups.has(g.groupId)),
    histories: manifest.corpora.filter(c => corpora.has(c.id)).map(c => ({ corpusId: c.id, historyId: c.historyId })) });
  if (subset.groups.some(g => g.partition !== "development")) fail("only development results are reportable by this campaign");
  const sourceCorpora = new Map(manifest.corpora.map(c => [c.id, c])), sourceQuestions = new Map(manifest.questions.map(q => [q.id, q]));
  if (subset.corpora.some(c => !same(c, sourceCorpora.get(c.id))) || subset.questions.some(q => !same(q, sourceQuestions.get(q.id)))) {
    fail("selected questions, gold or corpus content changed");
  }
  return subset;
}

/** Source provenance is checked independently of the context's self-authored digest. Ranking is not rerun. */
function authenticateContexts(dataset: Dataset, plan: EvolutionAnyContextPlan, manifestSha256: string): void {
  const projected = projectEvolutionRunnerInput(dataset);
  if (plan.manifestSha256 !== manifestSha256) fail("context selection or input changed");
  validateEvolutionContextPlanSources(plan, projected);
}

export type EvolutionRawResponseLoader = (request: EvolutionRequest, response: EvolutionResponse) => Promise<Uint8Array>;
export type EvolutionServiceMsLoader = (request: EvolutionRequest, response: EvolutionResponse) => Promise<number | null>;
/** The caller derives this projection from the exclusively owned, replay-validated campaign store. */
export type EvolutionAttemptFailureLoader = (request: EvolutionRequest) => Promise<EvolutionAttemptFailure>;
function boundedServiceMs(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0) || value > 86_400_000) fail(`invalid ${label} service duration`);
  return value;
}
function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  return values[Math.ceil(values.length * fraction) - 1]!;
}
function serviceDistribution(requestSha256s: readonly string[], serviceMs: ReadonlyMap<string, number | null>, failures: ReadonlyMap<string, EvolutionAttemptFailure>) {
  const occupied = [...new Set(requestSha256s)], physical = occupied.filter(key => failures.get(key)?.storeStatus !== "reserved");
  const measured = physical.map(key => serviceMs.get(key) ?? null).filter((value): value is number => value !== null).sort((a, b) => a - b);
  return { logicalCases: requestSha256s.length, attributedPhysicalRequests: physical.length, count: measured.length,
    unknownDispatches: occupied.length - physical.length,
    measuredPhysicalRequests: measured.length,
    unmeasuredPhysicalRequests: physical.length - measured.length, totalMs: measured.reduce((sum, value) => sum + value, 0),
    p50Ms: percentile(measured, 0.5), p95Ms: percentile(measured, 0.95) };
}
async function authenticatePhase(input: Readonly<{ bytes: Uint8Array; phase: "reader" | "judge"; planSha256: string;
  requests: readonly EvolutionRequest[]; loadRawResponse: EvolutionRawResponseLoader; loadServiceMs?: EvolutionServiceMsLoader;
  loadAttemptFailure?: EvolutionAttemptFailureLoader }>) {
  const value = json(input.bytes, 256 * 1024 * 1024);
  if (!isPlainRecord(value) || value.protocol !== "oh.memory.evolution-phase.v1" || value.phase !== input.phase
    || value.planSha256 !== input.planSha256 || value.complete !== true || !Array.isArray(value.responses)
    || value.responses.length > 100_000 || value.failures !== undefined && (!Array.isArray(value.failures)
      || value.responses.length + value.failures.length > 100_000)) fail("phase is incomplete or does not match the plan");
  const receipts = value.responses.map(row => {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["requestSha256", "response"]) || typeof row.requestSha256 !== "string"
      || !isPlainRecord(row.response)) fail("invalid response receipt");
    return { requestSha256: row.requestSha256, response: row.response as unknown as EvolutionResponse };
  });
  const failureReceipts = (value.failures ?? []).map((row: unknown) => {
    if (!isPlainRecord(row) || typeof row.requestSha256 !== "string") fail("invalid attempt-failure receipt");
    return row as unknown as EvolutionAttemptFailure;
  });
  assertExactEvolutionCoverage(input.requests.map(r => r.requestSha256), [...receipts.map(r => r.requestSha256), ...failureReceipts.map(r => r.requestSha256)]);
  const byRequest = new Map(receipts.map(r => [r.requestSha256, r.response])), byFailure = new Map(failureReceipts.map(r => [r.requestSha256, r]));
  const authenticated = new Map<string, EvolutionResponse>(), failures = new Map<string, EvolutionAttemptFailure>(), serviceMs = new Map<string, number | null>();
  for (let start = 0; start < input.requests.length; start += 8) {
    const batch = await Promise.all(input.requests.slice(start, start + 8).map(async request => {
      const failure = byFailure.get(request.requestSha256);
      if (failure !== undefined) {
        validateEvolutionAttemptFailure(failure, request);
        if (failure.repeat !== 0 || input.loadAttemptFailure === undefined) fail("authenticated first-attempt failure loader required");
        const authenticatedFailure = validateEvolutionAttemptFailure(await input.loadAttemptFailure(request), request);
        if (!same(failure, authenticatedFailure)) fail("phase failure receipt does not match occupied campaign evidence");
        return { key: request.requestSha256, response: null, failure: authenticatedFailure,
          duration: boundedServiceMs(authenticatedFailure.serviceMs, input.phase) };
      }
      const receipt = byRequest.get(request.requestSha256)!, raw = await input.loadRawResponse(request, receipt);
      const response = parseEvolutionResponse(raw, request);
      if (!same(response, receipt)) fail("phase receipt does not match captured raw response");
      const duration = input.loadServiceMs === undefined ? null : boundedServiceMs(await input.loadServiceMs(request, response), input.phase);
      return { key: request.requestSha256, response, failure: null, duration };
    }));
    for (const { key, response, failure, duration } of batch) {
      if (response !== null) authenticated.set(key, response);
      if (failure !== null) failures.set(key, failure);
      serviceMs.set(key, duration);
    }
  }
  const phaseWallMs = value.wallMs === undefined ? null : boundedServiceMs(value.wallMs, `${input.phase} phase wall`);
  return { responses: authenticated, failures, serviceMs, phaseWallMs };
}

type ReportMetric = EvolutionMetric | "evidence-precision" | "evidence-f1";
const baseMetric = (metric: ReportMetric): EvolutionMetric => metric === "evidence-precision" || metric === "evidence-f1" ? "evidence-recall" : metric;
function summarize(cases: readonly EvolutionMetricCase[], scores: readonly EvolutionScore[], metric: ReportMetric) {
  return { ...summarizeEvolutionScores(cases, scores, baseMetric(metric)), metric };
}
function paired(cases: readonly EvolutionMetricCase[], left: readonly EvolutionScore[], right: readonly EvolutionScore[], metric: ReportMetric) {
  const result = summarizeEvolutionPairs(cases, left, right, baseMetric(metric));
  // Arm summaries are already present once in the report; avoid repeating them in every comparison.
  return { metric, paired: result.paired, byCategory: result.byCategory, byGroup: result.byGroup,
    byHistory: result.byHistory, qualification: result.qualification };
}
function evidence(expectedIds: readonly string[], retrievedIds: readonly string[]) {
  const expected = new Set(expectedIds), retrieved = new Set(retrievedIds);
  if (!expected.size) return { precision: null, recall: null, f1: null, all: null };
  const found = [...expected].filter(id => retrieved.has(id)).length;
  return { precision: retrieved.size ? found / retrieved.size : 0, recall: found / expected.size,
    f1: 2 * found / (expected.size + retrieved.size), all: Number(found === expected.size) };
}
function cost(responses: ReadonlyMap<string, EvolutionResponse>, failures: ReadonlyMap<string, EvolutionAttemptFailure>, requests: readonly EvolutionRequest[]) {
  const values = [...responses.values()], failed = [...failures.values()];
  const totals = (rows: readonly EvolutionResponse[], unverified: readonly EvolutionAttemptFailure[]) => ({
    physicalRequests: rows.length + unverified.filter(f => f.storeStatus === "captured").length,
    occupiedRequests: rows.length + unverified.length, unknownDispatches: unverified.filter(f => f.storeStatus === "reserved").length,
    knownUsageMicros: rows.reduce((n, r) => n + r.usage.micros, 0),
    unresolvedReservationMicros: unverified.reduce((n, f) => n + f.reservationMicros, 0),
    accountedMicros: rows.reduce((n, r) => n + r.usage.micros, 0) + unverified.reduce((n, f) => n + f.reservationMicros, 0),
    usageCoverage: { knownRequests: rows.length, unknownRequests: unverified.length },
    tokenRateMicros: rows.reduce((n, r) => n + r.usage.tokenRateMicros, 0),
    gatewayReportedMicros: rows.some(r => r.usage.gatewayReportedMicros !== null)
      ? rows.reduce((n, r) => n + (r.usage.gatewayReportedMicros ?? 0), 0) : null,
    inputTokens: rows.reduce((n, r) => n + r.usage.inputTokens, 0), outputTokens: rows.reduce((n, r) => n + r.usage.outputTokens, 0),
    cachedInputTokens: rows.reduce((n, r) => n + r.usage.cachedInputTokens, 0), reasoningTokens: rows.reduce((n, r) => n + r.usage.reasoningTokens, 0) });
  const requestedModels = new Map(requests.map(r => [r.requestSha256, r.model]));
  return { ...totals(values, failed), byRequestedModel: [...new Set(requests.map(r => r.model))].sort().map(model => ({ model,
    ...totals(values.filter(r => r.identity.requestedModel === model), failed.filter(f => requestedModels.get(f.requestSha256) === model)) })),
    identities: [...new Map(values.map(r => [canonicalSha256(r.identity), r.identity])).values()] };
}

/** No requests are sent here. Responses and occupied failures are authenticated separately. */
export async function buildEvolutionReport(input: Readonly<{ dataset: Dataset; manifestBytes: Uint8Array; manifestSha256: string;
  contextPlan: EvolutionAnyContextPlan; readerPlan: EvolutionReaderPlan; judgePlan: EvolutionJudgePlan;
  readerOutputBytes: Uint8Array; judgeOutputBytes: Uint8Array; judgeOutputSha256: string; loadRawResponse: EvolutionRawResponseLoader;
  loadServiceMs?: EvolutionServiceMsLoader; loadAttemptFailure?: EvolutionAttemptFailureLoader }>) {
  const manifest = selectedManifest(input.dataset, input.manifestBytes, input.manifestSha256);
  authenticateContexts(input.dataset, input.contextPlan, input.manifestSha256);
  const readers = validateEvolutionReaderPlan(input.readerPlan, input.contextPlan), judges = validateEvolutionJudgePlan(input.judgePlan);
  const readerOutputSha256 = sha256Hex(input.readerOutputBytes);
  if (judges.readerOutputSha256 !== readerOutputSha256 || !digest(input.judgeOutputSha256)
    || sha256Hex(input.judgeOutputBytes) !== input.judgeOutputSha256) fail("phase bytes changed");
  const readerPhase = await authenticatePhase({ bytes: input.readerOutputBytes, phase: "reader", planSha256: readers.planSha256,
    requests: readers.requests, loadRawResponse: input.loadRawResponse,
    ...(input.loadServiceMs === undefined ? {} : { loadServiceMs: input.loadServiceMs }),
    ...(input.loadAttemptFailure === undefined ? {} : { loadAttemptFailure: input.loadAttemptFailure }) });
  const readerResponses = readerPhase.responses;
  const rubric = await loadJudgeProfile();
  const rebuilt = makeEvolutionJudgePlan({ contextPlan: input.contextPlan, readerPlan: readers, responses: readerResponses,
    failures: readerPhase.failures, dataset: input.dataset, profile: judges.profile, rubric, readerOutputSha256 });
  if (!same(judges, rebuilt)) fail("judge plan differs from the complete authenticated reader and gold matrix");
  const judgePhase = await authenticatePhase({ bytes: input.judgeOutputBytes, phase: "judge", planSha256: judges.planSha256,
    requests: judges.requests, loadRawResponse: input.loadRawResponse,
    ...(input.loadServiceMs === undefined ? {} : { loadServiceMs: input.loadServiceMs }),
    ...(input.loadAttemptFailure === undefined ? {} : { loadAttemptFailure: input.loadAttemptFailure }) });
  const judgeResponses = judgePhase.responses;
  const groupLabels = new Map([...new Set(manifest.questions.map(q => q.groupId))].sort().map((g, i) => [g, `group-${i + 1}`]));
  const historyLabels = new Map([...new Set(manifest.questions.map(q => q.historyId))].sort().map((h, i) => [h, `history-${i + 1}`]));
  const metadata = new Map(manifest.questions.map(q => [q.id, q]));
  const cases: EvolutionMetricCase[] = input.dataset.questions.map(q => { const m = metadata.get(q.id)!;
    return { id: m.runnerId, groupId: groupLabels.get(m.groupId)!, historyId: historyLabels.get(m.historyId)!, category: q.category }; });
  const readerCases = new Map(readers.cases.map(c => [triple(c.questionId, c.variantId, c.reader), c]));
  const judgeCases = new Map(judges.cases.map(c => [triple(c.questionId, c.variantId, c.reader), c]));
  const contexts = new Map(input.contextPlan.cases.map(c => [pair(c.questionId, c.variantId), c.result]));
  const locomo = input.dataset.questions.every(q => /^locomo:[1-5]$/.test(q.category));
  if (!locomo && input.dataset.questions.some(q => q.category.startsWith("locomo:"))) fail("mixed LoCoMo and LongMemEval categories");
  const metrics: readonly ReportMetric[] = ["judge-accuracy", ...(locomo ? ["locomo-f1" as const] : []), "evidence-precision", "evidence-recall", "evidence-f1", "evidence-all"];
  const rawArms = input.contextPlan.variants.flatMap(variant => readers.readerProfiles.map(reader => {
    let readerFailures = 0, judgeFailures = 0;
    const readerRequestSha256s: string[] = [], judgeRequestSha256s: string[] = [];
    const scores: Record<ReportMetric, EvolutionScore[]> = { "judge-accuracy": [], "locomo-f1": [], "evidence-precision": [],
      "evidence-recall": [], "evidence-f1": [], "evidence-all": [] };
    for (const [index, q] of input.dataset.questions.entries()) {
      const id = cases[index]!.id, key = triple(id, variant.id, reader), rc = readerCases.get(key)!, jc = judgeCases.get(key)!;
      readerRequestSha256s.push(rc.requestSha256);
      if (jc.requestSha256 !== null) judgeRequestSha256s.push(jc.requestSha256);
      const response = readerResponses.get(rc.requestSha256)!, readerFailed = jc.readerFailed;
      const judged = jc.requestSha256 === null ? null : judgeResponses.get(jc.requestSha256)!;
      const decision = judged?.status === "completed" ? scoreEvolutionJudgeDecision(judges.profile, judged.answer) : null;
      const judgeFailed = !readerFailed && decision === null;
      readerFailures += Number(readerFailed); judgeFailures += Number(judgeFailed);
      scores["judge-accuracy"].push({ id, score: decision ?? 0, failed: readerFailed || judgeFailed });
      if (locomo) scores["locomo-f1"].push({ id, score: readerFailed ? 0 : scoreLocomoF1(q, response!.answer!), failed: readerFailed });
      const context = contexts.get(pair(id, variant.id))!;
      // LoCoMo labels turns; LongMemEval labels sessions. Unresolved LoCoMo labels stay in the denominator.
      const e = locomo ? evidence(q.evidenceTurnIds, context.turnIds) : evidence(q.evidenceSessionIds, context.sessionIds);
      for (const [metric, score] of [["evidence-precision", e.precision], ["evidence-recall", e.recall], ["evidence-f1", e.f1], ["evidence-all", e.all]] as const) {
        scores[metric].push({ id, score, failed: false });
      }
    }
    return { variantId: variant.id, reader, readerFailures, judgeFailures, readerRequestSha256s, judgeRequestSha256s, scores };
  }));
  const byArm = new Map(rawArms.map(arm => [pair(arm.variantId, arm.reader), arm]));
  const comparisons = rawArms.flatMap(left => {
    const references = [
      ...(left.variantId === input.contextPlan.variants[0]!.id ? [] : [{ kind: "retrieval" as const, variantId: input.contextPlan.variants[0]!.id, reader: left.reader }]),
      ...(left.reader === readers.readerProfiles[0] ? [] : [{ kind: "reader" as const, variantId: left.variantId, reader: readers.readerProfiles[0]! }]),
    ];
    return references.map(reference => { const right = byArm.get(pair(reference.variantId, reference.reader))!;
      return { kind: reference.kind, left: { variantId: left.variantId, reader: left.reader }, right: { variantId: right.variantId, reader: right.reader },
        metrics: metrics.map(metric => paired(cases, left.scores[metric], right.scores[metric], metric)) }; });
  });
  const readerCost = cost(readerResponses, readerPhase.failures, readers.requests), judgeCost = cost(judgeResponses, judgePhase.failures, judges.requests);
  const direct = judges.profile === "gpt4o-official-snapshot-judge";
  return { protocol: "oh.memory.evolution-report.v1" as const, status: "complete" as const,
    qualification: "Development-only descriptive evidence; no superiority claim, independent-sample count, or confidence interval.",
    dataset: { name: manifest.dataset, revision: manifest.revision, partition: "development" as const, selectedQuestions: cases.length,
      selectedCorpora: manifest.corpora.length, declaredGroups: groupLabels.size, declaredHistories: historyLabels.size,
      exposures: ["unseen", "development", "evaluated", "unknown"].map(exposure => ({ exposure, groups: manifest.groups.filter(g => g.exposure === exposure).length })),
      groupingQualification: manifest.qualification },
    pins: { manifestSha256: input.manifestSha256, sourceSha256: manifest.sourceSha256, selectedDatasetSha256: manifest.datasetSha256,
      contextPlanSha256: input.contextPlan.planSha256, readerPlanSha256: readers.planSha256, readerOutputSha256,
      judgePlanSha256: judges.planSha256, judgeOutputSha256: input.judgeOutputSha256, rubricSha256: rubric.sha256 },
    scoring: { judgeProfile: judges.profile, judgeRule: judges.scoringRule, judgeReference: EVOLUTION_LME_NATIVE_REFERENCE,
      judgeQualification: locomo ? "Separate semantic diagnostic; the official LoCoMo QA score is F1."
        : direct ? "Pinned direct GPT-4o-2024-08-06, native LongMemEval prompts and contains-yes grading; this development selection is not the official full-set score."
        : judges.profile === "gpt4o-gateway-native-rubric-judge-v1"
          ? "Gateway GPT-4o alias with native LongMemEval prompts, one user message, 10 output tokens and contains-yes grading; provider is restricted to OpenAI, but the requested model is not a pinned snapshot. This development selection is not the official full-set score."
          : "Gateway GPT-4o alias proxy with a system message, 16 output tokens and strict yes/no parsing; not the official snapshot protocol.",
      officialLocomoF1: locomo ? { protocol: LOCOMO_F1_PROTOCOL, reference: LOCOMO_F1_REFERENCE } : null,
      failurePolicy: "Every eligible question remains in answer-score denominators. Reader failures score zero; judge failures score zero only for judge accuracy and are counted separately. Authenticated occupied attempts without a verifiable answer score zero and retain their full reservations. Never-admitted requests or unauthenticated missing evidence prevent a complete report.",
      evidenceUnit: locomo ? "turn" : "session", evidenceQualification: "Retrieval evidence is scored independently of answer success. No evidence labels means unscored, not perfect; unresolved labels remain in the denominator.",
      answerCitationF1: null, citationQualification: "Not measured: the reader prompt asks for an answer without citations." },
    coverage: { logicalReaderCases: readers.cases.length, logicalJudgeCases: judges.cases.length,
      expectedQuestionsPerArm: cases.length, completePhysicalResponses: readerPhase.failures.size + judgePhase.failures.size === 0,
      completeAttemptCoverage: true, verifiedPhysicalResponses: readerResponses.size + judgeResponses.size,
      capturedUnverifiableAttempts: [...readerPhase.failures.values(), ...judgePhase.failures.values()].filter(f => f.storeStatus === "captured").length,
      unknownDispatches: readerCost.unknownDispatches + judgeCost.unknownDispatches },
    cost: { reader: readerCost, judge: judgeCost, accountedMicros: readerCost.accountedMicros + judgeCost.accountedMicros,
      knownUsageMicros: readerCost.knownUsageMicros + judgeCost.knownUsageMicros,
      unresolvedReservationMicros: readerCost.unresolvedReservationMicros + judgeCost.unresolvedReservationMicros,
      qualification: "Known captured usage plus full unresolved reservations, counted once per distinct occupied request in these phases. Accounted cost is conservative exposure, not a provider invoice or incremental spend for a cache-reusing invocation. Token totals and provider identities cover verified responses only; unknown usage is not zero. Reserved requests without captures do not prove dispatch. Reasoning tokens are already included in output tokens." },
    latency: { reader: { phaseWallMs: readerPhase.phaseWallMs, physical: serviceDistribution(readers.requests.map(request => request.requestSha256), readerPhase.serviceMs, readerPhase.failures) },
      judge: { phaseWallMs: judgePhase.phaseWallMs, physical: serviceDistribution(judges.requests.map(request => request.requestSha256), judgePhase.serviceMs, judgePhase.failures) },
      qualification: "Service time is captured once per attempted physical request through first-response body completion or failure. Reserved requests without captures are excluded from physical latency counts because dispatch is unknown. Arm values attribute each captured duration to every arm reusing it; they do not measure a cache-hit invocation. Phase wall time is receipt-reported elapsed time including queueing and concurrency." },
    arms: rawArms.map(arm => ({ variantId: arm.variantId, reader: arm.reader, readerFailures: arm.readerFailures, judgeFailures: arm.judgeFailures,
      latency: { reader: serviceDistribution(arm.readerRequestSha256s, readerPhase.serviceMs, readerPhase.failures), judge: serviceDistribution(arm.judgeRequestSha256s, judgePhase.serviceMs, judgePhase.failures) },
      metrics: metrics.map(metric => summarize(cases, arm.scores[metric], metric)) })),
    comparisonPolicy: "Left minus right. Each non-first variant is paired against the first variant at a fixed reader; each non-first reader is paired against the first reader at a fixed variant. No mixed-treatment comparisons.",
    comparisons };
}
