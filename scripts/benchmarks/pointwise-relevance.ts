import {
  canonicalJson,
  canonicalSha256,
  isPlainRecord,
  parseSha256Hex,
  type Sha256Hex,
  utf8ByteLength,
} from "../../src/canonical";

export const POINTWISE_RELEVANCE_PLAN_PROTOCOL_V1 = "oh.benchmark.pointwise-relevance-plan.v1" as const;
export const POINTWISE_RELEVANCE_RANKING_PROTOCOL_V1 = "oh.benchmark.pointwise-relevance-ranking.v1" as const;
export const POINTWISE_RELEVANCE_LIMITS_V1 = Object.freeze({
  maximumCandidates: 32,
  maximumCandidateBytes: 4_096,
  maximumKeyBytes: 512,
  maximumPlanBytes: 256 * 1_024,
  maximumQueryBytes: 4_096,
});

export type PointwiseRelevanceCandidateV1 = Readonly<{
  baselineRank: number;
  id: string;
  key: string;
  representationSha256: Sha256Hex;
  sourceSha256: Sha256Hex;
  text: string;
}>;

export type PointwiseRelevanceRequestV1 = Readonly<{
  candidate: Readonly<{
    id: string;
    representationSha256: Sha256Hex;
    text: string;
  }>;
  profileSha256: Sha256Hex;
  query: string;
  requestId: string;
}>;

export type PointwiseRelevancePlanV1 = Readonly<{
  candidates: readonly PointwiseRelevanceCandidateV1[];
  profileSha256: Sha256Hex;
  protocol: typeof POINTWISE_RELEVANCE_PLAN_PROTOCOL_V1;
  query: string;
  querySha256: Sha256Hex;
  requests: readonly PointwiseRelevanceRequestV1[];
}>;

export type PointwiseRelevanceRankingV1 = Readonly<{
  baseline: readonly string[];
  profileSha256: Sha256Hex;
  protocol: typeof POINTWISE_RELEVANCE_RANKING_PROTOCOL_V1;
  querySha256: Sha256Hex;
  ranked: readonly Readonly<{
    baselineRank: number;
    key: string;
    representationSha256: Sha256Hex;
    score: number;
  }>[];
}>;

function requestId(
  profileSha256: Sha256Hex,
  querySha256: Sha256Hex,
  candidate: PointwiseRelevanceCandidateV1,
): string {
  return `pr_${canonicalSha256({
    candidateId: candidate.id,
    profileSha256,
    protocol: POINTWISE_RELEVANCE_PLAN_PROTOCOL_V1,
    querySha256,
    representationSha256: candidate.representationSha256,
  })}`;
}

function fail(reason: string): never {
  throw new TypeError(`Pointwise relevance: ${reason}`);
}

function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("plain record required");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    fail("exact record keys required");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      fail("enumerable data fields required");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function denseList(value: unknown, length?: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || (length === undefined ? value.length < 1 || value.length > POINTWISE_RELEVANCE_LIMITS_V1.maximumCandidates
      : value.length !== length)
    || Reflect.ownKeys(value).length !== value.length + 1) fail("bounded dense array required");
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      fail("array data items required");
    }
    return descriptor.value as unknown;
  });
}

function boundedText(value: unknown, maximumBytes: number, label: string, nonblank = false): string {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > maximumBytes
    || /\p{Surrogate}/u.test(value) || (nonblank && value.trim().length === 0)) {
    fail(`${label} must be bounded Unicode text`);
  }
  return value;
}

function sha256(value: unknown, label: string): Sha256Hex {
  const parsed = parseSha256Hex(value);
  if (parsed === null) fail(`${label} must be a SHA-256 digest`);
  return parsed;
}

function probability(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0) || value < 0 || value > 1) {
    fail("score must be a probability");
  }
  return value;
}

/**
 * Builds one isolated, provider-neutral request per already-rendered candidate.
 * The source key stays in the plan and never enters the request. The caller owns
 * candidate generation, representation, prompt/profile bytes, transport, cost,
 * protected matches, and failure fallback.
 */
export function buildPointwiseRelevancePlanV1(input: unknown): PointwiseRelevancePlanV1 {
  const value = dataRecord(input, ["query", "profileSha256", "candidates"]);
  const query = boundedText(value.query, POINTWISE_RELEVANCE_LIMITS_V1.maximumQueryBytes, "query", true);
  const profileSha256 = sha256(value.profileSha256, "profileSha256");
  const candidates = denseList(value.candidates).map((item, index): PointwiseRelevanceCandidateV1 => {
    const candidate = dataRecord(item, ["key", "text", "sourceSha256"]);
    const key = boundedText(candidate.key, POINTWISE_RELEVANCE_LIMITS_V1.maximumKeyBytes, "candidate key");
    const text = boundedText(candidate.text, POINTWISE_RELEVANCE_LIMITS_V1.maximumCandidateBytes, "candidate text");
    const sourceSha256 = sha256(candidate.sourceSha256, "sourceSha256");
    return Object.freeze({
      baselineRank: index + 1,
      id: `c${index}`,
      key,
      representationSha256: canonicalSha256({ sourceSha256, text }),
      sourceSha256,
      text,
    });
  });
  if (new Set(candidates.map((candidate) => candidate.key)).size !== candidates.length) {
    fail("candidate keys must be distinct");
  }
  const querySha256 = canonicalSha256(query);
  const requests = candidates.map((candidate): PointwiseRelevanceRequestV1 => Object.freeze({
    candidate: Object.freeze({
      id: candidate.id,
      representationSha256: candidate.representationSha256,
      text: candidate.text,
    }),
    profileSha256,
    query,
    requestId: requestId(profileSha256, querySha256, candidate),
  }));
  const plan: PointwiseRelevancePlanV1 = Object.freeze({
    candidates: Object.freeze(candidates),
    profileSha256,
    protocol: POINTWISE_RELEVANCE_PLAN_PROTOCOL_V1,
    query,
    querySha256,
    requests: Object.freeze(requests),
  });
  if (utf8ByteLength(canonicalJson(plan)) > POINTWISE_RELEVANCE_LIMITS_V1.maximumPlanBytes) {
    fail("plan exceeds its byte limit");
  }
  return plan;
}

function rebuildPlan(value: unknown): PointwiseRelevancePlanV1 {
  const plan = dataRecord(value, ["candidates", "profileSha256", "protocol", "query", "querySha256", "requests"]);
  if (plan.protocol !== POINTWISE_RELEVANCE_PLAN_PROTOCOL_V1) fail("unknown plan protocol");
  const candidates = denseList(plan.candidates).map((item, index) => {
    const candidate = dataRecord(item,
      ["baselineRank", "id", "key", "representationSha256", "sourceSha256", "text"]);
    if (candidate.id !== `c${index}` || candidate.baselineRank !== index + 1) fail("candidate identity drift");
    return { key: candidate.key, text: candidate.text, sourceSha256: candidate.sourceSha256 };
  });
  const rebuilt = buildPointwiseRelevancePlanV1({
    candidates,
    profileSha256: plan.profileSha256,
    query: plan.query,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) fail("plan bytes do not reconstruct");
  return rebuilt;
}

/**
 * Admits only a complete set of source-bound pointwise scores. Missing,
 * duplicate, stale, or malformed outcomes fail the entire reduction. Equal
 * scores retain baseline order.
 */
export function rankPointwiseRelevanceV1(input: unknown): PointwiseRelevanceRankingV1 {
  const value = dataRecord(input, ["plan", "outcomes"]);
  const plan = rebuildPlan(value.plan);
  const outcomes = denseList(value.outcomes, plan.candidates.length);
  const expected = new Map(plan.candidates.map((candidate) => [candidate.id, candidate]));
  const expectedRequests = new Map(plan.requests.map((request) => [request.candidate.id, request.requestId]));
  const seen = new Set<string>();
  const scores = new Map<string, number>();
  for (const item of outcomes) {
    const outcome = dataRecord(item, ["requestId", "candidateId", "representationSha256", "score"]);
    const requestId = boundedText(outcome.requestId, 128, "requestId");
    const candidateId = boundedText(outcome.candidateId, 128, "candidateId");
    if (requestId !== expectedRequests.get(candidateId) || seen.has(candidateId)) {
      fail("complete distinct request identities required");
    }
    const candidate = expected.get(candidateId);
    if (candidate === undefined) fail("unknown candidate identity");
    if (sha256(outcome.representationSha256, "representationSha256") !== candidate.representationSha256) {
      fail("stale candidate representation");
    }
    seen.add(candidateId);
    scores.set(candidateId, probability(outcome.score));
  }
  if (seen.size !== plan.candidates.length) fail("complete outcome set required");
  const ranked = plan.candidates.map((candidate) => Object.freeze({
    baselineRank: candidate.baselineRank,
    key: candidate.key,
    representationSha256: candidate.representationSha256,
    score: scores.get(candidate.id) as number,
  })).sort((left, right) => right.score - left.score || left.baselineRank - right.baselineRank);
  return Object.freeze({
    baseline: Object.freeze(plan.candidates.map((candidate) => candidate.key)),
    profileSha256: plan.profileSha256,
    protocol: POINTWISE_RELEVANCE_RANKING_PROTOCOL_V1,
    querySha256: plan.querySha256,
    ranked: Object.freeze(ranked),
  });
}
