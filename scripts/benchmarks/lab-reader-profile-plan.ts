import { canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import type { Dataset } from "./datasets";
import { validateLabPaidReaderPlan, type LabPaidReaderPlan } from "./lab-paid-plan";
import { makeLabGpt5MiniReaderRequest, type LabReaderRequest, type LabReaderResult } from "./lab-reader-profile";
import { canonicalReaderJudgeRequest, type FrozenJudgeRequest } from "./lab-reader-profile-judge";

export const LAB_READER_PROFILE_VARIANTS = Object.freeze(["bm25-window:k20:b24000", "bm25-user-hybrid:k100:b24000"] as const);
export type LabReaderProfileVariant = typeof LAB_READER_PROFILE_VARIANTS[number];
export type LabReaderProfileCase = Readonly<{ ordinal: number; parentOrdinal: number; questionId: string;
  corpusId: string; groupId: string; category: string; variant: LabReaderProfileVariant;
  contextSha256: string; contextBytes: number; requestSha256: string; jobKey: string }>;
export type LabReaderProfileJob = Readonly<{ key: string; ordinal: 0; request: LabReaderRequest }>;
export type LabReaderProfilePlan = Readonly<{ profile: "oh.lab-reader-profile-plan.v1";
  namespaceSha256: string; parentPlanSha256: string; variants: readonly LabReaderProfileVariant[];
  cases: readonly LabReaderProfileCase[]; jobs: readonly LabReaderProfileJob[];
  casesSha256: string; planSha256: string }>;

const SELECTED_VARIANTS = [
  { id: LAB_READER_PROFILE_VARIANTS[0], system: "bm25-window", budget: { topK: 20, contextBytes: 24_000 } },
  { id: LAB_READER_PROFILE_VARIANTS[1], system: "bm25-user-hybrid", budget: { topK: 100, contextBytes: 24_000 } },
] as const;
const PLAN_KEYS = ["profile", "namespaceSha256", "parentPlanSha256", "variants", "cases", "jobs", "casesSha256", "planSha256"];
function fail(reason: string): never { throw new TypeError(`Lab reader profile plan: ${reason}.`); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function selectedVariant(value: string): value is LabReaderProfileVariant {
  return (LAB_READER_PROFILE_VARIANTS as readonly string[]).includes(value);
}
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** Validates a gold-free parent reader plan, then preserves its selected messages, contexts and order byte for byte. */
export function makeLabReaderProfilePlan(dataset: Dataset, parent: LabPaidReaderPlan, namespaceSha256: string): LabReaderProfilePlan {
  if (!digest(namespaceSha256)) fail("invalid namespace");
  validateLabPaidReaderPlan(dataset, parent);
  const selected = parent.variants.filter(v => selectedVariant(v.id));
  if (canonicalSha256(selected) !== canonicalSha256(SELECTED_VARIANTS)) fail("explicit ordered variant systems and budgets required");

  const source = new Map(parent.jobs.map(job => [job.key, job]));
  const jobs = new Map<string, LabReaderProfileJob>();
  const cases: LabReaderProfileCase[] = [];
  for (const c of parent.cases) {
    if (!selectedVariant(c.variant)) continue;
    const original = source.get(c.jobKey);
    if (original === undefined || original.phase !== "reader") fail("parent reader alias");
    const request = makeLabGpt5MiniReaderRequest(original.request.body.messages);
    const jobKey = canonicalSha256({ namespaceSha256, requestSha256: request.requestSha256 });
    // Equal requests may serve several cases. The first case owns the physical job's position.
    if (!jobs.has(jobKey)) jobs.set(jobKey, { key: jobKey, ordinal: 0, request });
    cases.push({ ordinal: cases.length, parentOrdinal: c.ordinal, questionId: c.questionId,
      corpusId: c.corpusId, groupId: c.groupId, category: c.category, variant: c.variant,
      contextSha256: c.contextSha256, contextBytes: c.contextBytes, requestSha256: request.requestSha256, jobKey });
  }
  if (cases.length !== dataset.questions.length * 2) fail("incomplete selected matrix");
  const payload = { profile: "oh.lab-reader-profile-plan.v1" as const, namespaceSha256,
    parentPlanSha256: parent.planSha256, variants: [...LAB_READER_PROFILE_VARIANTS], cases,
    jobs: [...jobs.values()], casesSha256: canonicalSha256(cases) };
  return frozen({ ...payload, planSha256: canonicalSha256(payload) });
}

/** Rebuilds only the deterministic conversion, never retrieval or gold. Parent binding also rejects rehashed alias/context/order drift. */
export function validateLabReaderProfilePlan(dataset: Dataset, plan: LabReaderProfilePlan, parent: LabPaidReaderPlan): void {
  if (!isPlainRecord(plan) || !hasExactKeys(plan, PLAN_KEYS) || plan.profile !== "oh.lab-reader-profile-plan.v1"
    || !digest(plan.namespaceSha256) || !digest(plan.parentPlanSha256) || !digest(plan.casesSha256) || !digest(plan.planSha256)
    || !Array.isArray(plan.variants) || plan.variants.length !== 2
    || !Array.isArray(plan.cases) || plan.cases.length < 2 || plan.cases.length > 200
    || !Array.isArray(plan.jobs) || plan.jobs.length < 1 || plan.jobs.length > plan.cases.length) fail("plan shape");
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(plan.cases) !== plan.casesSha256 || canonicalSha256(payload) !== planSha256) fail("plan digest");
  const expected = makeLabReaderProfilePlan(dataset, parent, plan.namespaceSha256);
  if (canonicalSha256(plan) !== canonicalSha256(expected)) fail("parent conversion binding");
}

export type LabReaderProfileJudgeRequest = FrozenJudgeRequest;
/** Only canonical frozen judge requests cross this boundary; judge construction remains a separate gold-bearing stage. */
export function canonicalLabReaderProfileJudge(request: FrozenJudgeRequest): LabReaderProfileJudgeRequest {
  const canonical = canonicalReaderJudgeRequest(request);
  if (!("phase" in canonical) || canonical.phase !== "judge") fail("nonjudge bridge request");
  return canonical;
}
export type LabReaderProfileReaderResult = LabReaderResult;
