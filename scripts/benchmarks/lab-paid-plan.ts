import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { CLAUDE_JUDGE_SYSTEM } from "./claude-study-plan";
import type { Corpus, Dataset, Turn } from "./datasets";
import { makeGatewayStudyRequest, gatewayStudyTransportInternals, type GatewayStudyRequest } from "./gateway-study-transport-v3";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256, type GatewayStudyV6Result } from "./gateway-study-transport-v6";
import { buildJudgePrompt, loadJudgeProfile, parseJudgeDecision } from "./judge";
import { createLabDiverse } from "./lab-diverse";
import { createLabFusion } from "./lab-fusion";
import { createLabMemory } from "./lab-memory";
import { createLabSession } from "./lab-session";
import { createLabUser } from "./lab-user";
import { createLabUserHybrid } from "./lab-user-hybrid";
import { LAB_SYSTEMS, type LabSystem, type LabVariant } from "./lab";
import { labReaderMessages, type LabReaderPolicy } from "./lab-paid-reader";
import { createRetrievers, SYSTEMS, type Retrieved, type System } from "./retrieval";

const freeze = gatewayStudyTransportInternals.frozen;
export type LabPaidJob = Readonly<{ key: string; ordinal: 0; phase: "reader" | "judge"; request: GatewayStudyRequest }>;
export type LabPaidReaderCase = Readonly<{ ordinal: number; questionId: string; corpusId: string; groupId: string;
  category: string; system: LabSystem; variant: string; contextSha256: string; contextBytes: number;
  requestSha256: string; jobKey: string }>;
export type LabPaidReaderPlan = Readonly<{ namespaceSha256: string;
  variants: readonly LabVariant[]; cases: readonly LabPaidReaderCase[]; jobs: readonly LabPaidJob[];
  casesSha256: string; planSha256: string }> & (
  Readonly<{ profile: "oh.lab-paid-reader-plan.v1" }>
  | Readonly<{ profile: "oh.lab-paid-reader-plan.v2"; readerPolicy: "question-last-v1" }>
);
type JudgeIdentity = Readonly<Pick<LabPaidReaderCase, "ordinal" | "questionId" | "corpusId" | "groupId" | "category" | "system" | "variant"> & {
  readerJobKey: string; readerRequestSha256: string; readerResponseSha256: string }>;
export type LabPaidJudgeCase = JudgeIdentity & (
  | Readonly<{ kind: "model"; jobKey: string; requestSha256: string; ownerOrdinal: number }>
  | Readonly<{ kind: "reader-failure"; status: "terminal-reader-failure"; policySha256: string;
    reason: "output-token-limit"; correct: 0; decisionSource: "reader-failure-policy" }>
);
export type LabPaidJudgePlan = Readonly<{ profile: "oh.lab-paid-judge-plan.v1"; namespaceSha256: string;
  readerPlanSha256: string; judgeProfileSha256: string; policySha256: string;
  variants: readonly LabVariant[]; readerCases: readonly LabPaidReaderCase[];
  cases: readonly LabPaidJudgeCase[]; jobs: readonly LabPaidJob[]; casesSha256: string; planSha256: string }>;
export type LabPaidScoredCase = LabPaidJudgeCase & Readonly<{
  status: "completed" | "terminal-reader-failure"; correct: 0 | 1;
  decisionSource: "model" | "reader-failure-policy"; reusedJudgment?: boolean;
}>;

function fail(reason: string): never { throw new TypeError(`Lab paid plan: ${reason}.`); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function same(a: unknown, b: unknown, reason: string) { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); }
function text(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum) fail("invalid text identity");
  return value;
}
function exact(value: unknown, keys: readonly string[]): boolean { return isPlainRecord(value) && hasExactKeys(value, keys); }
const readerKeys = ["ordinal", "questionId", "corpusId", "groupId", "category", "system", "variant", "contextSha256", "contextBytes", "requestSha256", "jobKey"];
const judgeKeys = ["ordinal", "questionId", "corpusId", "groupId", "category", "system", "variant", "readerJobKey", "readerRequestSha256", "readerResponseSha256"];

function variants(input: readonly LabVariant[]): readonly LabVariant[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 3) fail("select two or three variants");
  const result = input.map(v => {
    if (!exact(v, ["id", "system", "budget"]) || !exact(v.budget, ["topK", "contextBytes"])
      || !LAB_SYSTEMS.includes(v.system) || v.system.endsWith("fact") || v.system.endsWith("fact-turns")) fail("invalid variant or unsupported fact arm");
    const { topK, contextBytes } = v.budget;
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100 || !Number.isSafeInteger(contextBytes)
      || contextBytes < 1 || contextBytes > 4_000_000) fail("invalid explicit variant budget");
    return { id: text(v.id), system: v.system, budget: { topK, contextBytes } };
  });
  if (new Set(result.map(v => v.id)).size !== result.length) fail("duplicate variant identity");
  return result;
}

/** Whitelist input fields; answer/evidence getters never enter reader ingestion or identity. */
function selection(dataset: Dataset) {
  if (!Array.isArray(dataset.questions) || dataset.questions.length < 1 || dataset.questions.length > 100
    || !Array.isArray(dataset.corpora) || dataset.corpora.length < 1 || dataset.corpora.length > 100) fail("bounded nonempty development selection required");
  const corpora: Corpus[] = dataset.corpora.map(c => {
    if (!Array.isArray(c.turns) || c.turns.length < 1 || c.turns.length > 8192) fail("raw corpus turn bound");
    return { id: text(c.id), groupId: text(c.groupId), turns: c.turns.map((t: Turn) => ({
    id: t.id, sessionId: t.sessionId, ...(t.sessionIndex === undefined ? {} : { sessionIndex: t.sessionIndex }),
    date: t.date, speaker: t.speaker, text: t.text })) };
  });
  const questions = dataset.questions.map(q => ({ id: text(q.id), corpusId: text(q.corpusId), category: text(q.category),
    question: text(q.question, 16_384), questionDate: q.questionDate }));
  if (new Set(corpora.map(c => c.id)).size !== corpora.length || new Set(questions.map(q => q.id)).size !== questions.length
    || questions.some(q => !corpora.some(c => c.id === q.corpusId) || typeof q.questionDate !== "string" || Buffer.byteLength(q.questionDate) > 256)
    || corpora.some(c => !questions.some(q => q.corpusId === c.id) || c.turns.length < 1 || c.turns.length > 8192
      || new Set(c.turns.map(t => t.id)).size !== c.turns.length)) fail("duplicate, missing or unselected corpus/question");
  return { corpora, questions };
}
function job(namespaceSha256: string, phase: LabPaidJob["phase"], messages: GatewayStudyRequest["body"]["messages"]): LabPaidJob {
  const request = makeGatewayStudyRequest({ phase, messages });
  return { key: canonicalSha256({ namespaceSha256, requestSha256: request.requestSha256 }), ordinal: 0, phase, request };
}
function uniqueJobs(prepared: readonly LabPaidJob[]): readonly LabPaidJob[] {
  return [...new Map(prepared.map(j => [j.key, j])).values()];
}

/** No provider calls: all stores close before the immutable gold-free plan is returned. */
export async function makeLabPaidReaderPlan(dataset: Dataset, inputVariants: readonly LabVariant[], namespaceSha256: string, readerPolicy: LabReaderPolicy = "legacy-v1"): Promise<LabPaidReaderPlan> {
  if (!digest(namespaceSha256)) fail("invalid cache namespace");
  if (readerPolicy !== "legacy-v1" && readerPolicy !== "question-last-v1") fail("unknown reader policy");
  const selected = selection(dataset), chosen = variants(inputVariants);
  const cases: LabPaidReaderCase[] = [], prepared: LabPaidJob[] = [];
  for (const corpus of selected.corpora) {
    const shared = createRetrievers(corpus, undefined, { lazyOh: true });
    let native: Awaited<ReturnType<typeof createLabMemory>> | undefined, session: ReturnType<typeof createLabSession> | undefined;
    let user: ReturnType<typeof createLabUser> | undefined;
    let userHybrid: ReturnType<typeof createLabUserHybrid> | undefined;
    try {
      shared.prepare(chosen.flatMap(v => SYSTEMS.includes(v.system as System) ? [v.system as System] : []));
      if (chosen.some(v => v.system === "oh-memory-api")) native = await createLabMemory(corpus);
      if (chosen.some(v => v.system === "bm25-session")) session = createLabSession(corpus);
      if (chosen.some(v => v.system === "bm25-user-focused" || v.system === "user-context")) user = createLabUser(corpus);
      if (chosen.some(v => v.system === "bm25-user-hybrid")) userHybrid = createLabUserHybrid(corpus, shared);
      const fusion = createLabFusion(corpus, shared), diverse = createLabDiverse(corpus, shared);
      for (const [questionIndex, question] of selected.questions.entries()) {
        if (question.corpusId !== corpus.id) continue;
        for (const [variantIndex, variant] of chosen.entries()) {
          const retrieved: Retrieved = variant.system === "oh-memory-api" ? await native!.retrieve(question.question, variant.budget)
            : variant.system === "bm25-session" ? await session!.retrieve(question.question, variant.budget)
            : variant.system === "bm25-fusion" ? await fusion.retrieve(question.question, variant.budget)
            : variant.system === "bm25-diverse-window" ? await diverse.retrieve(question.question, variant.budget)
            : variant.system === "bm25-user-focused" ? await user!.retrieve(question.question, variant.budget, "focused")
            : variant.system === "user-context" ? await user!.retrieve(question.question, variant.budget, "context")
            : variant.system === "bm25-user-hybrid" ? await userHybrid!.retrieve(question.question, variant.budget)
            : await shared.retrieve(variant.system, question.question, variant.budget);
          const physical = job(namespaceSha256, "reader", labReaderMessages(question, retrieved.context, readerPolicy));
          cases.push({ ordinal: questionIndex * chosen.length + variantIndex, questionId: question.id, corpusId: corpus.id,
            groupId: corpus.groupId, category: question.category, system: variant.system, variant: variant.id,
            contextSha256: sha256Hex(retrieved.context), contextBytes: Buffer.byteLength(retrieved.context),
            requestSha256: physical.request.requestSha256, jobKey: physical.key });
          prepared.push(physical);
        }
      }
    } finally { try { await native?.close(); } finally { try { session?.close(); } finally { try { userHybrid?.close(); } finally { try { user?.close(); } finally { shared.close(); } } } } }
  }
  cases.sort((a, b) => a.ordinal - b.ordinal);
  const byKey = new Map(prepared.map(j => [j.key, j]));
  const identity = readerPolicy === "legacy-v1" ? { profile: "oh.lab-paid-reader-plan.v1" as const }
    : { profile: "oh.lab-paid-reader-plan.v2" as const, readerPolicy };
  const payload = { ...identity, namespaceSha256, variants: chosen,
    cases, jobs: uniqueJobs(cases.map(c => byKey.get(c.jobKey)!)), casesSha256: canonicalSha256(cases) };
  return freeze({ ...payload, planSha256: canonicalSha256(payload) });
}

function validateJobs(jobs: readonly LabPaidJob[], namespaceSha256: string, phase: LabPaidJob["phase"]): Map<string, LabPaidJob> {
  if (!Array.isArray(jobs) || jobs.length > 300) fail("invalid physical jobs");
  const result = new Map<string, LabPaidJob>();
  for (const j of jobs) {
    if (!exact(j, ["key", "ordinal", "phase", "request"]) || j.phase !== phase || j.ordinal !== 0 || result.has(j.key)) fail("physical job shape/phase/duplicate");
    same(j, job(namespaceSha256, phase, j.request.body.messages), "physical request identity drift");
    result.set(j.key, j);
  }
  return result;
}
function responsesFor(jobs: readonly LabPaidJob[], responses: ReadonlyMap<string, GatewayStudyV6Result>) {
  if (responses.size !== jobs.length || [...responses.keys()].some(key => !jobs.some(j => j.key === key))) fail("missing or extra response keys");
}
/** Responses must already have passed cache raw/reservation replay. This checks phase and aliases, not transport authenticity. */
function boundResponse(j: LabPaidJob, response: GatewayStudyV6Result | undefined) {
  if (response === undefined || response.requestSha256 !== j.request.requestSha256
    || response.identity.requestedModel !== j.request.model || response.identity.finalProvider !== "openai"
    || !digest(response.rawSha256) || !Number.isSafeInteger(response.rawBytes) || response.rawBytes < 1 || response.rawBytes > 1_048_576) fail("response request/model/raw identity");
  const base = ["kind", "requestSha256", "rawSha256", "rawBytes", "usage", "identity", "finishReason"];
  if (response.kind === "terminal-reader-failure") {
    if (j.phase !== "reader" || !exact(response, [...base, "reason", "policySha256"])
      || response.policySha256 !== GATEWAY_READER_FAILURE_V6_POLICY_SHA256 || response.reason !== "output-token-limit"
      || response.finishReason !== "length" || response.usage.outputTokens !== 512) fail("terminal reader policy binding");
  } else if (response.kind !== "completed" || !exact(response, [...base, "prediction"])
    || response.finishReason !== "stop" || typeof response.prediction !== "string" || !response.prediction.trim()) fail("nonterminal or wrong-phase response");
  return response;
}
function validateReader(dataset: Dataset, plan: LabPaidReaderPlan) {
  const readerPolicy: LabReaderPolicy = plan.profile === "oh.lab-paid-reader-plan.v1" ? "legacy-v1"
    : plan.profile === "oh.lab-paid-reader-plan.v2" && plan.readerPolicy === "question-last-v1" ? plan.readerPolicy
    : fail("reader plan profile or policy");
  const keys = ["profile", "namespaceSha256", "variants", "cases", "jobs", "casesSha256", "planSha256"];
  if (!exact(plan, readerPolicy === "legacy-v1" ? keys : [...keys, "readerPolicy"])
    || !digest(plan.namespaceSha256)) fail("reader plan shape");
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== planSha256 || canonicalSha256(plan.cases) !== plan.casesSha256) fail("reader plan digest");
  const chosen = variants(plan.variants), selected = selection(dataset);
  if (plan.cases.length !== selected.questions.length * chosen.length) fail("complete ordered reader matrix required");
  const jobs = validateJobs(plan.jobs, plan.namespaceSha256, "reader"), owners: string[] = [];
  for (const [ordinal, c] of plan.cases.entries()) {
    const q = selected.questions[Math.floor(ordinal / chosen.length)]!, v = chosen[ordinal % chosen.length]!;
    const corpus = selected.corpora.find(corpus => corpus.id === q.corpusId)!;
    if (!exact(c, readerKeys) || c.ordinal !== ordinal || c.questionId !== q.id || c.corpusId !== q.corpusId
      || c.groupId !== corpus.groupId || c.category !== q.category || c.system !== v.system || c.variant !== v.id) fail("reader matrix alias drift");
    const j = jobs.get(c.jobKey) ?? fail("missing reader job");
    const user: unknown = JSON.parse(j.request.body.messages[1]!.content);
    if (!exact(user, ["question", "questionDate", "memory"])
      || !isPlainRecord(user) || typeof user.memory !== "string") fail("reader message shape");
    same(j.request, makeGatewayStudyRequest({ phase: "reader", messages: labReaderMessages(q, user.memory, readerPolicy) }), "reader prompt binding");
    if (c.contextSha256 !== sha256Hex(user.memory) || c.contextBytes !== Buffer.byteLength(user.memory)
      || c.requestSha256 !== j.request.requestSha256) fail("reader context/request alias binding");
    if (!owners.includes(j.key)) owners.push(j.key);
  }
  same([...jobs.keys()], owners, "unused or unordered reader jobs");
  return jobs;
}

/** Validate a pinned reader plan before opening the paid cache; no retrieval or model calls. */
export function validateLabPaidReaderPlan(dataset: Dataset, plan: LabPaidReaderPlan): void {
  validateReader(dataset, plan);
}

/** Gold is read only in this separate stage, and never for terminal reader policy failures. */
export async function makeLabPaidJudgePlan(dataset: Dataset, readerPlan: LabPaidReaderPlan,
  responses: ReadonlyMap<string, GatewayStudyV6Result>): Promise<LabPaidJudgePlan> {
  const readers = validateReader(dataset, readerPlan);
  responsesFor(readerPlan.jobs, responses);
  const profile = await loadJudgeProfile(), questions = new Map(dataset.questions.map(q => [q.id, q]));
  const cases: LabPaidJudgeCase[] = [], prepared: LabPaidJob[] = [], owners = new Map<string, number>();
  for (const c of readerPlan.cases) {
    const response = boundResponse(readers.get(c.jobKey)!, responses.get(c.jobKey));
    const identity: JudgeIdentity = { ordinal: c.ordinal, questionId: c.questionId, corpusId: c.corpusId,
      groupId: c.groupId, category: c.category, system: c.system, variant: c.variant,
      readerJobKey: c.jobKey, readerRequestSha256: c.requestSha256, readerResponseSha256: canonicalSha256(response) };
    if (response.kind === "terminal-reader-failure") {
      cases.push({ ...identity, kind: "reader-failure", status: "terminal-reader-failure", policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256,
        reason: "output-token-limit", correct: 0, decisionSource: "reader-failure-policy" });
    } else {
      const prompt = buildJudgePrompt(questions.get(c.questionId)!, response.prediction, profile);
      const j = job(readerPlan.namespaceSha256, "judge", [{ role: "system", content: CLAUDE_JUDGE_SYSTEM }, { role: "user", content: prompt }]);
      if (!owners.has(j.key)) { owners.set(j.key, c.ordinal); prepared.push(j); }
      cases.push({ ...identity, kind: "model", jobKey: j.key, requestSha256: j.request.requestSha256, ownerOrdinal: owners.get(j.key)! });
    }
  }
  const payload = { profile: "oh.lab-paid-judge-plan.v1" as const, namespaceSha256: readerPlan.namespaceSha256,
    readerPlanSha256: readerPlan.planSha256, judgeProfileSha256: profile.sha256, policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256,
    variants: readerPlan.variants.map(v => ({ id: v.id, system: v.system, budget: { ...v.budget } })),
    readerCases: readerPlan.cases.map(c => ({ ...c })),
    cases, jobs: prepared, casesSha256: canonicalSha256(cases) };
  return freeze({ ...payload, planSha256: canonicalSha256(payload) });
}

export function scoreLabPaidJudgePlan(plan: LabPaidJudgePlan, responses: ReadonlyMap<string, GatewayStudyV6Result>): readonly LabPaidScoredCase[] {
  if (!exact(plan, ["profile", "namespaceSha256", "readerPlanSha256", "judgeProfileSha256", "policySha256", "variants", "readerCases", "cases", "jobs", "casesSha256", "planSha256"])
    || plan.profile !== "oh.lab-paid-judge-plan.v1" || !digest(plan.namespaceSha256) || !digest(plan.readerPlanSha256)
    || !digest(plan.judgeProfileSha256) || plan.policySha256 !== GATEWAY_READER_FAILURE_V6_POLICY_SHA256
    || !Array.isArray(plan.cases) || plan.cases.length < 2 || plan.cases.length > 300) fail("judge plan shape");
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== planSha256 || canonicalSha256(plan.cases) !== plan.casesSha256) fail("judge plan digest");
  const chosen = variants(plan.variants);
  if (!Array.isArray(plan.readerCases) || plan.readerCases.length !== plan.cases.length
    || plan.cases.length % chosen.length !== 0) fail("complete judge matrix required");
  const jobs = validateJobs(plan.jobs, plan.namespaceSha256, "judge"), owners = new Map<string, number>();
  responsesFor(plan.jobs, responses);
  const scores = new Map<string, 0 | 1>();
  for (const j of plan.jobs) {
    if (j.request.body.messages[0]?.content !== CLAUDE_JUDGE_SYSTEM) fail("judge system prompt drift");
    const response = boundResponse(j, responses.get(j.key));
    if (response.kind !== "completed") fail("judge completion required");
    const correct = parseJudgeDecision(response.prediction);
    if (correct === null) fail("invalid semantic judge decision");
    scores.set(j.key, correct);
  }
  const seen = new Set<string>();
  const families = new Set<string>();
  const result = plan.cases.map((c, ordinal): LabPaidScoredCase => {
    const reader = plan.readerCases[ordinal]!, first = plan.readerCases[Math.floor(ordinal / chosen.length) * chosen.length]!;
    const v = chosen[ordinal % chosen.length]!;
    if (!exact(reader, readerKeys) || reader.ordinal !== ordinal || reader.questionId !== first.questionId
      || reader.corpusId !== first.corpusId || reader.groupId !== first.groupId || reader.category !== first.category
      || reader.variant !== v.id || reader.system !== v.system || !digest(reader.contextSha256)
      || !Number.isSafeInteger(reader.contextBytes) || reader.contextBytes < 0 || reader.contextBytes > 4_000_000
      || !digest(reader.requestSha256) || reader.jobKey !== canonicalSha256({ namespaceSha256: plan.namespaceSha256,
        requestSha256: reader.requestSha256 })) fail("reader alias matrix identity");
    if (ordinal % chosen.length === 0) {
      if (families.has(reader.questionId)) fail("duplicate question family");
      families.add(reader.questionId);
    }
    same([c.questionId, c.corpusId, c.groupId, c.category, c.system, c.variant, c.readerJobKey, c.readerRequestSha256],
      [reader.questionId, reader.corpusId, reader.groupId, reader.category, reader.system, reader.variant, reader.jobKey, reader.requestSha256],
      "judge case reader alias binding");
    if (c.ordinal !== ordinal || !digest(c.readerJobKey) || !digest(c.readerRequestSha256) || !digest(c.readerResponseSha256)
      || [c.questionId, c.corpusId, c.groupId, c.category, c.variant].some(v => typeof v !== "string" || !v.length)
      || !LAB_SYSTEMS.includes(c.system) || seen.has(canonicalSha256([c.questionId, c.variant]))) fail("judge case identity/order");
    seen.add(canonicalSha256([c.questionId, c.variant]));
    if (c.kind === "reader-failure") {
      if (!exact(c, [...judgeKeys, "kind", "status", "policySha256", "reason", "correct", "decisionSource"])
        || c.policySha256 !== plan.policySha256 || c.reason !== "output-token-limit" || c.correct !== 0
        || c.status !== "terminal-reader-failure" || c.decisionSource !== "reader-failure-policy") fail("failure case binding");
      return { ...c };
    }
    if (c.kind !== "model" || !exact(c, [...judgeKeys, "kind", "jobKey", "requestSha256", "ownerOrdinal"])) fail("judge case shape");
    const j = jobs.get(c.jobKey) ?? fail("missing judge alias");
    if (!owners.has(c.jobKey)) owners.set(c.jobKey, ordinal);
    if (c.ownerOrdinal !== owners.get(c.jobKey) || c.requestSha256 !== j.request.requestSha256) fail("judge alias ownership");
    return { ...c, status: "completed", correct: scores.get(c.jobKey)!, decisionSource: "model", reusedJudgment: c.ownerOrdinal !== ordinal };
  });
  same([...jobs.keys()], [...owners.keys()], "unused or unordered judge jobs");
  return freeze(result);
}
