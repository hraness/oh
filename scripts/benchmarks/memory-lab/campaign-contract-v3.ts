/** Versioned development campaign contracts. V1 and V2 artifacts and caches are never imported. */
import { isAbsolute } from "node:path";
import { canonicalSha256, isPlainRecord } from "../../../src/canonical";
import { parseApiConfig, type ApiConfig } from "./api-transport";
import { BEAM_RELEASED_CATEGORIES_V1, type BeamReleasedCategoryV1 } from "../beam-released-results-v1";

export const CAMPAIGN_V3 = "oh.memory-lab-campaign.v3" as const;
export function need(value: unknown, reason: string): asserts value { if (!value) throw new Error(`Memory lab campaign: ${reason}.`); }
export function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  need(isPlainRecord(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), "unexpected or missing fields");
  return value;
}
export function text(value: unknown, max = 4096): string {
  need(typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value) <= max && !/\p{Surrogate}/u.test(value), "bounded text required"); return value;
}
export function identifier(value: unknown): string { const s = text(value, 128); need(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(s), "invalid identifier"); return s; }
export function digest(value: unknown): string { const s = text(value, 64); need(/^[a-f0-9]{64}$/u.test(s), "invalid digest"); return s; }
export function integer(value: unknown, min: number, max: number): number { need(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max, "integer outside bound"); return value; }
export function fraction(value: unknown): number { need(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1, "score outside [0, 1]"); return value; }
export function list(value: unknown, min: number, max: number): unknown[] { need(Array.isArray(value) && value.length >= min && value.length <= max, "list outside bound"); return value; }
export function unique(values: readonly string[]): void { need(new Set(values).size === values.length, "duplicate identifiers"); }
export function fileRef(value: unknown): FileRef {
  const r = exact(value, ["path", "sha256"]), path = text(r.path, 4096); need(isAbsolute(path) && !path.includes("\0"), "absolute input path required");
  return { path, sha256: digest(r.sha256) };
}
export type FileRef = { path: string; sha256: string };
export type Task = { id: string; cluster: string; category: BeamReleasedCategoryV1; pool: "screen" | "confirmation" | "control";
  exposure: "exposed-development" | "invented-control"; input: FileRef; maxJudgeCalls: number; expected: 0 | 1 | null };
export type CampaignConfig = { protocol: typeof CAMPAIGN_V3; id: string; owner: string; evidenceMode: "live" | "offline-synthetic"; api: ApiConfig; budget: FileRef;
  templates: FileRef; tasks: Task[]; maxPlans: number; maxProposals: number; maxConfirmationAttempts: number; maxCalls: number;
  expiresAt: string; minimumEffect: number; guardMargin: number; screenAlpha: number; aaMaximumMeanAbsoluteDelta: number;
  sourcePins: FileRef[]; screenCriterion: "cluster-sign" | "development-effect"; contextPolicies: ContextPolicy[]; rankingProfileSha256: string; maximumAnswerJsonBytes: number };
export type ContextPolicy = { id: string; logReserveBytes: number };
export type Treatment = { id: string; instruction: string; contextPolicyId: string; semanticKey: string };
export type Candidate = { treatment: Treatment; parentRevision: number; parentKey: string; author: string; mechanism: string;
  hypothesis: string; evidence: string[]; disconfirmingTest: string; strategy: "exploit" | "explore"; status: "queued" | "pending" | "screened" | "rejected" | "promoted" };
export type Analysis = { screenCriterion: "cluster-sign" | "development-effect"; minimumEffect: number; guardMargin: number; alpha: number; minimumClusters: number; sampleSizeRationale: string };
export type Plan = { protocol: typeof CAMPAIGN_V3; id: string; kind: "controls" | "aa" | "screen" | "confirmation";
  baselineRevision: number; baseline: Treatment; candidate: Treatment; candidateId: string | null; parentScreen: string | null;
  tasks: Task[]; targetIds: string[]; guardIds: string[]; maxCalls: number; analysis: Analysis; confirmationAttempt: number | null;
  executionKey: string; semanticFamilyKey: string; createdAt: string; repeats: number; original: Treatment };
export type Review = { reviewer: string; planSha256: string; approved: true; notes: string };
export type Observation = { taskId: string; arm: "baseline" | "candidate" | "original"; repeat: number; status: "scored" | "failed"; score: number | null; reason: string | null };
export type Assessment = { protocol: typeof CAMPAIGN_V3; planSha256: string; status: "PASS" | "REJECT" | "INCOMPLETE";
  planned: number; complete: number; targetDelta: number | null; guardDelta: number | null; guardLowerBound: number | null; guardEstimand: "cluster-median"; pValue: number | null;
  targetClusters: number; informativeClusters: number; wouldPass: boolean; meanAbsoluteDelta: number | null; reasons: string[] };
export type RunRecord = { plan: Plan; planSha256: string; review: Review | null; assessment: Assessment | null; advanced: boolean };
export type CampaignState = { protocol: typeof CAMPAIGN_V3; revision: number; config: CampaignConfig; startingBaseline: Treatment;
  champion: { revision: number; treatment: Treatment }; candidates: Candidate[]; runs: RunRecord[];
  qualifications: { controls: string | null; aa: string | null }; allocatedConfirmationClusters: string[];
  confirmationAttempts: number; stagnation: number; promotions: { runId: string; from: string; to: string; revision: number }[] };

export function parseConfig(value: unknown): CampaignConfig {
  const r = exact(value, ["protocol", "id", "owner", "evidenceMode", "api", "budget", "templates", "tasks", "maxPlans", "maxProposals", "maxConfirmationAttempts", "maxCalls", "expiresAt", "minimumEffect", "guardMargin", "screenAlpha", "aaMaximumMeanAbsoluteDelta", "sourcePins", "contextPolicies", "rankingProfileSha256", "maximumAnswerJsonBytes", "screenCriterion"]);
  need(r.protocol === CAMPAIGN_V3, "v3 config required"); need(r.evidenceMode === "live" || r.evidenceMode === "offline-synthetic", "evidence mode required"); const api = parseApiConfig(r.api), budget = fileRef(r.budget);
  need(api.budgetPath === budget.path, "budget must pin the existing shared authority");
  const tasks = list(r.tasks, 4, 4096).map(value => {
    const t = exact(value, ["id", "cluster", "category", "pool", "exposure", "input", "maxJudgeCalls", "expected"]);
    need((BEAM_RELEASED_CATEGORIES_V1 as readonly unknown[]).includes(t.category), "released category required");
    need(["screen", "confirmation", "control"].includes(String(t.pool)), "development/control pool required");
    need(t.pool === "control" ? t.exposure === "invented-control" && (t.expected === 0 || t.expected === 1)
      : t.exposure === "exposed-development" && t.expected === null, "unexposed/protected tasks prohibited");
    return { id: identifier(t.id), cluster: identifier(t.cluster), category: t.category as Task["category"], pool: t.pool as Task["pool"],
      exposure: t.exposure as Task["exposure"], input: fileRef(t.input), maxJudgeCalls: integer(t.maxJudgeCalls, 1, 256), expected: t.expected as Task["expected"] };
  });
  need(r.screenCriterion === "cluster-sign" || r.screenCriterion === "development-effect", "explicit development screen criterion required");
  const contextPolicies = list(r.contextPolicies, 1, 4).map(value => {
    const p = exact(value, ["id", "logReserveBytes"]);
    return { id: identifier(p.id), logReserveBytes: integer(p.logReserveBytes, 0, 180000) };
  });
  unique(contextPolicies.map(p => p.id));
  need(new Set(contextPolicies.map(p => p.logReserveBytes)).size === contextPolicies.length, "duplicate context policy");
  unique(tasks.map(t => t.id)); need(new Set(tasks.map(t => t.input.sha256)).size === tasks.length, "duplicate semantic input digest; fresh allocations cannot rename reused data");
  // A confirmation cluster is never a screen or control cluster, even under another question ID.
  for (const t of tasks.filter(t => t.pool === "confirmation")) need(!tasks.some(s => s.cluster === t.cluster && s.pool !== "confirmation"), "confirmation cluster appears in another pool");
  const expiresAt = text(r.expiresAt, 64); need(Number.isFinite(Date.parse(expiresAt)), "valid expiry required");
  const minimumEffect = fraction(r.minimumEffect), screenAlpha = fraction(r.screenAlpha);
  need(minimumEffect > 0 && screenAlpha > 0 && screenAlpha <= 0.125, "positive effect and conservative screen threshold required");
  return { protocol: CAMPAIGN_V3, id: identifier(r.id), owner: identifier(r.owner), evidenceMode: r.evidenceMode, api, budget, templates: fileRef(r.templates), tasks,
    maxPlans: integer(r.maxPlans, 2, 128), maxProposals: integer(r.maxProposals, 1, 128), maxConfirmationAttempts: integer(r.maxConfirmationAttempts, 1, 32),
    maxCalls: integer(r.maxCalls, 1, 1000), expiresAt, minimumEffect, guardMargin: fraction(r.guardMargin), screenAlpha,
    aaMaximumMeanAbsoluteDelta: fraction(r.aaMaximumMeanAbsoluteDelta), sourcePins: list(r.sourcePins, 1, 256).map(fileRef), screenCriterion: r.screenCriterion, contextPolicies, rankingProfileSha256: digest(r.rankingProfileSha256), maximumAnswerJsonBytes: integer(r.maximumAnswerJsonBytes, 128, 262144) };
}
export function treatment(config: CampaignConfig, value: unknown): Treatment {
  const r = exact(value, ["id", "instruction", "contextPolicyId"]), instruction = text(r.instruction, 32768), contextPolicyId = identifier(r.contextPolicyId);
  const policy = config.contextPolicies.find(p => p.id === contextPolicyId); need(policy, "unknown context policy");
  // Run IDs, ledgers, deadlines and review text are deliberately absent. Those belong to execution identity.
  const semanticKey = canonicalSha256({ instruction, contextPolicy: policy, rankingProfileSha256: config.rankingProfileSha256, maximumAnswerJsonBytes: config.maximumAnswerJsonBytes, contextProtocol: "oh.memory-lab-reserve-context.v1", reader: config.api.reader, judge: config.api.judge, scorer: config.templates.sha256,
    inputs: config.tasks.map(t => ({ id: t.id, sha256: t.input.sha256 })), scorerProtocol: "oh.beam-released-scorer.v1", readerContract: "task-complete-v10" });
  return { id: identifier(r.id), instruction, contextPolicyId, semanticKey };
}
export function parseCandidate(config: CampaignConfig, value: unknown): Candidate {
  const r = exact(value, ["treatment", "parentRevision", "parentKey", "author", "mechanism", "hypothesis", "evidence", "disconfirmingTest", "strategy"]);
  need(r.strategy === "exploit" || r.strategy === "explore", "candidate strategy required");
  return { treatment: treatment(config, r.treatment), parentRevision: integer(r.parentRevision, 0, 128), parentKey: digest(r.parentKey),
    author: identifier(r.author), mechanism: identifier(r.mechanism), hypothesis: text(r.hypothesis), evidence: list(r.evidence, 1, 16).map(x => text(x)),
    disconfirmingTest: text(r.disconfirmingTest), strategy: r.strategy, status: "queued" };
}
export type TaskInput = { question: string; questionDate: string; contexts: { policyId: string; context: string; sha256: string }[];
  source: FileRef | null; ranking: FileRef | null; rubric: string[]; controlAnswer: string | null };
export function parseTaskInput(value: unknown, task: Task): TaskInput {
  const r = exact(value, ["question", "questionDate", "contexts", "source", "ranking", "rubric", "controlAnswer"]);
  need(task.pool === "control" ? typeof r.controlAnswer === "string" : r.controlAnswer === null, "control answer separation");
  const contexts = list(r.contexts, 1, 4).map(value => { const c = exact(value, ["policyId", "context", "sha256"]);
    return { policyId: identifier(c.policyId), context: text(c.context, 180000), sha256: digest(c.sha256) }; });
  unique(contexts.map(c => c.policyId));
  need(task.pool === "control" ? r.source === null && r.ranking === null : r.source !== null && r.ranking !== null, "source/ranking separation");
  return { question: text(r.question, 16384), questionDate: text(r.questionDate, 128), contexts,
    source: r.source === null ? null : fileRef(r.source), ranking: r.ranking === null ? null : fileRef(r.ranking),
    rubric: list(r.rubric, 1, 64).map(x => text(x, 4096)), controlAnswer: r.controlAnswer === null ? null : text(r.controlAnswer, 262144) };
}
export const sha = (value: unknown): string => canonicalSha256(value);
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

/** Confirmation after a promotion retains a contemporaneous original-baseline arm. */
export function planArms(plan: Plan): Observation["arm"][] {
  return plan.kind === "controls" ? ["candidate"] : plan.kind === "confirmation" && plan.original.semanticKey !== plan.baseline.semanticKey
    ? ["baseline", "candidate", "original"] : ["baseline", "candidate"];
}
