import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { Dataset } from "./datasets";
import type { LabPaidReaderPlan } from "./lab-paid-plan";
import { CLAUDE_JUDGE_SYSTEM } from "./claude-study-plan";
import { buildJudgePrompt, loadJudgeProfile, parseJudgeDecision } from "./judge";
import { makeGatewayStudyRequest } from "./gateway-study-transport-v3";
import { MODELS } from "./model";
import { canonicalReaderJudgeRequest, type FrozenJudgeRequest, type LabReaderJudgeResult } from "./lab-reader-profile-judge";
import { LAB_GPT5_MINI_MEDIUM_MAX_OUTPUT, LAB_GPT5_MINI_MEDIUM_READER_PROFILE, LAB_GPT5_MINI_READER_PROFILE, LAB_GPT5_MINI_MAX_OUTPUT, labGpt5MiniReaderProfile, type LabGpt5MiniReaderProfileSelector, type LabReaderRequest, type LabReaderResult } from "./lab-reader-profile";
import { LAB_READER_PROFILE_VARIANTS, readerProfileForPlan, validateLabReaderProfilePlan, type LabReaderProfileCase, type LabReaderProfilePlan } from "./lab-reader-profile-plan";

function fail(reason: string): never { throw new TypeError(`Lab reader profile scoring: ${reason}.`); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0); }
function exact<T>(value: T, keys: readonly string[]): value is T & Record<string, unknown> { return isPlainRecord(value) && hasExactKeys(value, keys); }
function same(a: unknown, b: unknown, reason: string) { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); }
function frozen<T>(value: T): T { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value; }

/** Separate from the old 512-token policy: accepted GPT-5-mini length need not consume the entire 2048-token cap. */
export const LAB_GPT5_MINI_READER_FAILURE_POLICY = frozen({
  profile: "oh.lab-gpt5-mini-reader-failure-policy.v1", readerProfile: LAB_GPT5_MINI_READER_PROFILE,
  eligibility: { model: "openai/gpt-5-mini", provider: "openai", kind: "terminal", finishReason: "length", reason: "length",
    maximumOutput: LAB_GPT5_MINI_MAX_OUTPUT, outputTokens: "within-reservation", prediction: null,
    response: "verified-through-reader-profile-and-raw-custody" },
  disposition: { status: "terminal-reader-failure", reason: "output-token-limit", correct: 0,
    decisionSource: "reader-failure-policy", judgeRequest: "none", partialPrediction: "never-accepted", denominator: "all-fixed-cases" },
} as const);
export const LAB_GPT5_MINI_READER_FAILURE_POLICY_SHA256 = canonicalSha256(LAB_GPT5_MINI_READER_FAILURE_POLICY);
/** A separate policy prevents an 8192-token medium run from being resealed as the original 2048-token experiment. */
export const LAB_GPT5_MINI_MEDIUM_READER_FAILURE_POLICY = frozen({
  profile: "oh.lab-gpt5-mini-medium-reader-failure-policy.v1", readerProfile: LAB_GPT5_MINI_MEDIUM_READER_PROFILE,
  eligibility: { model: "openai/gpt-5-mini", provider: "openai", kind: "terminal", finishReason: "length", reason: "length",
    maximumOutput: LAB_GPT5_MINI_MEDIUM_MAX_OUTPUT, outputTokens: "within-reservation", prediction: null,
    response: "verified-through-reader-profile-and-raw-custody" },
  disposition: { status: "terminal-reader-failure", reason: "output-token-limit", correct: 0,
    decisionSource: "reader-failure-policy", judgeRequest: "none", partialPrediction: "never-accepted", denominator: "all-fixed-cases" },
} as const);
export const LAB_GPT5_MINI_MEDIUM_READER_FAILURE_POLICY_SHA256 = canonicalSha256(LAB_GPT5_MINI_MEDIUM_READER_FAILURE_POLICY);
function failurePolicy(selector: LabGpt5MiniReaderProfileSelector) {
  return selector === "minimal"
    ? { value: LAB_GPT5_MINI_READER_FAILURE_POLICY, sha256: LAB_GPT5_MINI_READER_FAILURE_POLICY_SHA256 }
    : { value: LAB_GPT5_MINI_MEDIUM_READER_FAILURE_POLICY, sha256: LAB_GPT5_MINI_MEDIUM_READER_FAILURE_POLICY_SHA256 };
}

type JudgeIdentity = Readonly<Omit<LabReaderProfileCase, "jobKey" | "requestSha256"> & {
  readerJobKey: string; readerRequestSha256: string; readerResponseSha256: string }>;
export type ProfileJudgeCase = JudgeIdentity & (
  | Readonly<{ kind: "model"; jobKey: string; requestSha256: string; ownerOrdinal: number }>
  | Readonly<{ kind: "reader-failure"; status: "terminal-reader-failure"; policySha256: string;
    reason: "output-token-limit"; correct: 0; decisionSource: "reader-failure-policy" }>
);
export type ProfileJudgeJob = Readonly<{ key: string; ordinal: 0; request: FrozenJudgeRequest }>;
export type ProfileJudgePlan = Readonly<{ profile: "oh.lab-reader-profile-judge-plan.v1"; namespaceSha256: string;
  readerPlanSha256: string; readerPlan: LabReaderProfilePlan; judgeProfileSha256: string; policySha256: string;
  cases: readonly ProfileJudgeCase[]; jobs: readonly ProfileJudgeJob[]; casesSha256: string; planSha256: string }>;
export type ProfileScore = ProfileJudgeCase & Readonly<{ status: "completed" | "terminal-reader-failure";
  correct: 0 | 1; decisionSource: "model" | "reader-failure-policy"; reusedJudgment: boolean }>;
const readerKeys = ["ordinal", "parentOrdinal", "questionId", "corpusId", "groupId", "category", "variant", "contextSha256", "contextBytes", "requestSha256", "jobKey"];
const judgeKeys = ["ordinal", "parentOrdinal", "questionId", "corpusId", "groupId", "category", "variant", "contextSha256", "contextBytes", "readerJobKey", "readerRequestSha256", "readerResponseSha256"];
const resultKeys = ["kind", "requestSha256", "rawSha256", "rawBytes", "usage", "identity", "finishReason", "prediction"];
const usageKeys = ["inputTokens", "cachedInputTokens", "outputTokens", "tokenRateMicros", "gatewayReportedMicros", "micros"];
const identityKeys = ["requestedModel", "reportedModel", "finalProvider", "resolvedProviderApiModelId"];
const physicalKey = (namespaceSha256: string, requestSha256: string) => canonicalSha256({ namespaceSha256, requestSha256 });
function compatibleModel(value: unknown, family: string): value is string {
  if (typeof value !== "string") return false;
  const label = value.replace(/^openai\//, "");
  if (label === family) return true;
  const date = label.slice(family.length + 1);
  return label.startsWith(`${family}-`) && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
/** Custody replay owns raw authenticity. This boundary rejects transplants and malformed normalized data. */
function boundResponse(request: LabReaderRequest | FrozenJudgeRequest, value: unknown): LabReaderJudgeResult {
  const reader = !("phase" in request), terminal = isPlainRecord(value) && value.kind === "terminal";
  if (!exact(value, [...resultKeys, ...(reader ? ["raw"] : []), ...(terminal ? ["reason"] : [])])
    || value.requestSha256 !== request.requestSha256 || !digest(value.rawSha256) || !integer(value.rawBytes)
    || value.rawBytes < 1 || value.rawBytes > 1_048_576) fail("response request/raw binding");
  const identity = value.identity, usage = value.usage, model = reader ? "openai/gpt-5-mini" : "openai/gpt-4o", family = model.slice(7);
  if (!exact(identity, [...identityKeys, ...(reader ? [] : ["resolvedSnapshot", "snapshotPinned", "reportedModelAttemptCount", "reportedProviderAttemptCount", "physicalAttemptCount"])])
    || identity.requestedModel !== model || identity.finalProvider !== "openai" || !compatibleModel(identity.reportedModel, family)
    || identity.resolvedProviderApiModelId !== null && !compatibleModel(identity.resolvedProviderApiModelId, family)) fail("response model identity");
  if (!reader && (identity.snapshotPinned !== false || identity.physicalAttemptCount !== null
    || identity.reportedModelAttemptCount !== null && identity.reportedModelAttemptCount !== 1
    || identity.reportedProviderAttemptCount !== null && identity.reportedProviderAttemptCount !== 1
    || identity.resolvedSnapshot !== (identity.resolvedProviderApiModelId === null
      || (identity.resolvedProviderApiModelId as string).replace(/^openai\//, "") === family ? null
      : (identity.resolvedProviderApiModelId as string).replace(/^openai\//, "")))) fail("judge routing identity");
  if (!exact(usage, [...usageKeys, ...(reader ? [] : ["costBasis", "billedUsd"])])
    || !integer(usage.inputTokens) || usage.inputTokens > request.inputBytes + 2_048
    || !integer(usage.outputTokens) || usage.outputTokens > request.maximumOutput
    || !integer(usage.cachedInputTokens) || usage.cachedInputTokens > usage.inputTokens
    || !integer(usage.tokenRateMicros) || !integer(usage.micros)
    || usage.gatewayReportedMicros !== null && !integer(usage.gatewayReportedMicros)) fail("response usage shape/cap");
  const price = reader ? labGpt5MiniReaderProfile.profile.pricing : MODELS["openai/gpt-4o"];
  if (usage.tokenRateMicros !== Math.ceil((usage.inputTokens - usage.cachedInputTokens) * price.input
    + usage.cachedInputTokens * price.cachedInput + usage.outputTokens * price.output)
    || usage.micros !== Math.max(usage.tokenRateMicros, (usage.gatewayReportedMicros as number | null) ?? 0)
    || usage.micros > Math.ceil((request.inputBytes + 2_048) * price.input + request.maximumOutput * price.output)
    || !reader && (usage.billedUsd !== null || usage.costBasis !== (usage.gatewayReportedMicros === null
      ? "token-rate-estimate" : "maximum-token-rate-and-gateway-reported"))) fail("response usage accounting");
  if (reader && (!exact(value.raw, ["httpStatus", "receivedBytes"]) || !integer(value.raw.httpStatus)
    || value.raw.httpStatus < 200 || value.raw.httpStatus > 299 || value.raw.receivedBytes !== value.rawBytes)) fail("reader raw metadata");
  if (terminal) {
    if (!reader || value.finishReason !== "length" || value.reason !== "length" || value.prediction !== null) fail("terminal reader policy binding");
  } else if (value.kind !== "completed" || value.finishReason !== "stop" || typeof value.prediction !== "string"
    || !value.prediction.trim() || /\p{Surrogate}/u.test(value.prediction)) fail("completion required");
  return value as LabReaderJudgeResult;
}
function completeMap(jobs: readonly { key: string }[], responses: ReadonlyMap<string, unknown>) {
  const keys = new Set(jobs.map(j => j.key));
  if (keys.size !== jobs.length || responses.size !== jobs.length || [...responses.keys()].some(key => !keys.has(key))) fail("missing or extra response keys");
}
/** Binds parent/matrix and every reader result before loading the profile or reading any gold. */
export async function makeLabReaderProfileJudgePlan(dataset: Dataset, readerPlan: LabReaderProfilePlan,
  responses: ReadonlyMap<string, LabReaderResult>, parentReaderPlan: LabPaidReaderPlan): Promise<ProfileJudgePlan> {
  validateLabReaderProfilePlan(dataset, readerPlan, parentReaderPlan);
  const selectedReaderProfile = readerProfileForPlan(readerPlan), policy = failurePolicy(selectedReaderProfile);
  completeMap(readerPlan.jobs, responses);
  const bound = new Map<string, LabReaderResult>();
  for (const job of readerPlan.jobs) bound.set(job.key, structuredClone(boundResponse(job.request, responses.get(job.key))) as LabReaderResult);
  const fixedReader = structuredClone(readerPlan), profile = await loadJudgeProfile();
  const questions = new Map(dataset.questions.map(q => [q.id, q]));
  const jobs = new Map<string, ProfileJudgeJob>(), owners = new Map<string, number>();
  const cases = fixedReader.cases.map((c): ProfileJudgeCase => {
    const response = bound.get(c.jobKey)!;
    const { jobKey: readerJobKey, requestSha256: readerRequestSha256, ...aliases } = c;
    const identity: JudgeIdentity = { ...aliases, readerJobKey, readerRequestSha256, readerResponseSha256: canonicalSha256(response) };
    if (response.kind === "terminal") return { ...identity, kind: "reader-failure", status: "terminal-reader-failure",
      policySha256: policy.sha256, reason: "output-token-limit", correct: 0, decisionSource: "reader-failure-policy" };
    const request = makeGatewayStudyRequest({ phase: "judge", messages: [{ role: "system", content: CLAUDE_JUDGE_SYSTEM },
      { role: "user", content: buildJudgePrompt(questions.get(c.questionId) ?? fail("question alias"), response.prediction, profile) }] }) as FrozenJudgeRequest;
    canonicalReaderJudgeRequest(request);
    const jobKey = physicalKey(fixedReader.namespaceSha256, request.requestSha256);
    if (!owners.has(jobKey)) { owners.set(jobKey, c.ordinal); jobs.set(jobKey, { key: jobKey, ordinal: 0, request }); }
    return { ...identity, kind: "model", jobKey, requestSha256: request.requestSha256, ownerOrdinal: owners.get(jobKey)! };
  });
  const payload = { profile: "oh.lab-reader-profile-judge-plan.v1" as const, namespaceSha256: fixedReader.namespaceSha256,
    readerPlanSha256: fixedReader.planSha256, readerPlan: fixedReader, judgeProfileSha256: profile.sha256,
    policySha256: policy.sha256, cases, jobs: [...jobs.values()], casesSha256: canonicalSha256(cases) };
  return frozen({ ...payload, planSha256: canonicalSha256(payload) });
}
/** Structural revalidation; the builder checked original parent/dataset binding. */
function validateEmbeddedReader(plan: ProfileJudgePlan): LabGpt5MiniReaderProfileSelector {
  const reader = plan.readerPlan;
  if (!exact(reader, ["profile", "namespaceSha256", "parentPlanSha256", "variants", "cases", "jobs", "casesSha256", "planSha256"])
    || reader.profile !== "oh.lab-reader-profile-plan.v1" || reader.namespaceSha256 !== plan.namespaceSha256
    || !digest(reader.parentPlanSha256) || reader.planSha256 !== plan.readerPlanSha256
    || !Array.isArray(reader.cases) || reader.cases.length !== plan.cases.length || !Array.isArray(reader.jobs)) fail("embedded reader shape");
  const { planSha256, ...payload } = reader;
  same(planSha256, canonicalSha256(payload), "embedded reader digest");
  same(reader.casesSha256, canonicalSha256(reader.cases), "embedded reader cases digest");
  same(reader.variants, LAB_READER_PROFILE_VARIANTS, "reader variants");
  const selectedReaderProfile = readerProfileForPlan(reader);
  const jobs = new Map<string, LabReaderRequest>();
  for (const job of reader.jobs) {
    if (!exact(job, ["key", "ordinal", "request"]) || job.ordinal !== 0 || jobs.has(job.key)) fail("reader job shape");
    const request = canonicalReaderJudgeRequest(job.request);
    if ("phase" in request || job.key !== physicalKey(plan.namespaceSha256, request.requestSha256)) fail("reader job binding");
    jobs.set(job.key, request);
  }
  const families = new Set<string>(), owners = new Set<string>(), responseDigests = new Map<string, string>();
  for (const [ordinal, c] of reader.cases.entries()) {
    const first = reader.cases[Math.floor(ordinal / 2) * 2]!;
    if (!exact(c, readerKeys) || c.ordinal !== ordinal || !integer(c.parentOrdinal)
      || ordinal > 0 && c.parentOrdinal <= reader.cases[ordinal - 1]!.parentOrdinal
      || c.variant !== LAB_READER_PROFILE_VARIANTS[ordinal % 2]
      || [c.questionId, c.corpusId, c.groupId, c.category].some(v => typeof v !== "string" || !v.length)
      || !digest(c.contextSha256) || !integer(c.contextBytes) || c.contextBytes > 4_000_000
      || !digest(c.requestSha256) || !digest(c.jobKey)) fail("reader alias matrix identity");
    same([c.questionId, c.corpusId, c.groupId, c.category], [first.questionId, first.corpusId, first.groupId, first.category], "reader question family");
    if (ordinal % 2 === 0) { if (families.has(c.questionId)) fail("duplicate question family"); families.add(c.questionId); }
    const request = jobs.get(c.jobKey) ?? fail("missing reader alias");
    let user: unknown;
    try { user = JSON.parse(request.body.messages[1]!.content); } catch { fail("reader message JSON"); }
    if (!exact(user, ["question", "questionDate", "memory"]) || typeof user.memory !== "string"
      || c.contextSha256 !== sha256Hex(user.memory) || c.contextBytes !== Buffer.byteLength(user.memory)
      || c.requestSha256 !== request.requestSha256) fail("reader context/request binding");
    owners.add(c.jobKey);
    const judged = plan.cases[ordinal]!;
    if (!digest(judged.readerResponseSha256)) fail("reader response digest");
    const previous = responseDigests.get(c.jobKey);
    if (previous !== undefined && previous !== judged.readerResponseSha256) fail("reader response alias digest");
    responseDigests.set(c.jobKey, judged.readerResponseSha256);
  }
  same([...jobs.keys()], [...owners], "unused or unordered reader jobs");
  return selectedReaderProfile;
}
export function scoreLabReaderProfileJudgePlan(plan: ProfileJudgePlan,
  responses: ReadonlyMap<string, LabReaderJudgeResult>): readonly ProfileScore[] {
  if (!exact(plan, ["profile", "namespaceSha256", "readerPlanSha256", "readerPlan", "judgeProfileSha256", "policySha256", "cases", "jobs", "casesSha256", "planSha256"])
    || plan.profile !== "oh.lab-reader-profile-judge-plan.v1" || !digest(plan.namespaceSha256) || !digest(plan.readerPlanSha256)
    || !digest(plan.judgeProfileSha256) || !digest(plan.policySha256)
    || !Array.isArray(plan.cases) || plan.cases.length < 2 || plan.cases.length > 200 || plan.cases.length % 2
    || !Array.isArray(plan.jobs)) fail("complete judge matrix/shape");
  const { planSha256, ...payload } = plan;
  same(planSha256, canonicalSha256(payload), "judge plan digest");
  same(plan.casesSha256, canonicalSha256(plan.cases), "judge cases digest");
  const selectedReaderProfile = validateEmbeddedReader(plan);
  if (plan.policySha256 !== failurePolicy(selectedReaderProfile).sha256) fail("reader failure policy");
  const jobs = new Map<string, ProfileJudgeJob>(), scores = new Map<string, 0 | 1>(), owners = new Map<string, number>();
  for (const job of plan.jobs) {
    if (!exact(job, ["key", "ordinal", "request"]) || job.ordinal !== 0 || jobs.has(job.key)) fail("judge job shape");
    const request = canonicalReaderJudgeRequest(job.request);
    if (!("phase" in request) || request.phase !== "judge" || request.body.messages[0]?.content !== CLAUDE_JUDGE_SYSTEM
      || job.key !== physicalKey(plan.namespaceSha256, request.requestSha256)) fail("frozen judge job binding");
    jobs.set(job.key, job);
  }
  completeMap(plan.jobs, responses);
  for (const job of plan.jobs) {
    const response = boundResponse(job.request, responses.get(job.key));
    if (response.kind !== "completed") fail("judge completion required");
    const score = parseJudgeDecision(response.prediction);
    if (score === null) fail("invalid semantic judge decision");
    scores.set(job.key, score);
  }
  const result = plan.cases.map((c, ordinal): ProfileScore => {
    const { jobKey: readerJobKey, requestSha256: readerRequestSha256, ...aliases } = plan.readerPlan.cases[ordinal]!;
    same(Object.fromEntries(judgeKeys.filter(key => key !== "readerResponseSha256").map(key => [key, c[key as keyof typeof c]])),
      { ...aliases, readerJobKey, readerRequestSha256 }, "judge case reader alias binding");
    if (c.kind === "reader-failure") {
      if (!exact(c, [...judgeKeys, "kind", "status", "policySha256", "reason", "correct", "decisionSource"])
        || c.status !== "terminal-reader-failure" || c.policySha256 !== plan.policySha256 || c.reason !== "output-token-limit"
        || c.correct !== 0 || c.decisionSource !== "reader-failure-policy") fail("failure case binding");
      return { ...c, reusedJudgment: false };
    }
    if (c.kind !== "model" || !exact(c, [...judgeKeys, "kind", "jobKey", "requestSha256", "ownerOrdinal"])) fail("judge case shape");
    const job = jobs.get(c.jobKey) ?? fail("missing judge alias");
    if (!owners.has(c.jobKey)) owners.set(c.jobKey, ordinal);
    if (c.ownerOrdinal !== owners.get(c.jobKey) || c.requestSha256 !== job.request.requestSha256) fail("judge alias ownership");
    return { ...c, status: "completed", correct: scores.get(c.jobKey)!, decisionSource: "model", reusedJudgment: c.ownerOrdinal !== ordinal };
  });
  same([...jobs.keys()], [...owners.keys()], "unused or unordered judge jobs");
  return frozen(result);
}
