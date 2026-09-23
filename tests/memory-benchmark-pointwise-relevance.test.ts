import { describe, expect, test } from "bun:test";

import { canonicalJson, canonicalSha256 } from "../src/canonical";
import {
  buildPointwiseRelevancePlanV1,
  POINTWISE_RELEVANCE_LIMITS_V1,
  rankPointwiseRelevanceV1,
  type PointwiseRelevancePlanV1,
} from "../scripts/benchmarks/pointwise-relevance";

const profileSha256 = canonicalSha256("pointwise relevance profile");
const source = (value: string) => canonicalSha256({ value });
const candidates = () => [
  { key: "edition:alpha", text: "Remember to include an exact version.", sourceSha256: source("alpha") },
  { key: "edition:beta", text: "The tool was tested last spring.", sourceSha256: source("beta") },
  { key: "edition:gamma", text: "A garden note mentions tomatoes.", sourceSha256: source("gamma") },
];

function outcomes(plan: PointwiseRelevancePlanV1, scores = [0.2, 0.8, 0.8]) {
  return plan.requests.map((request, index) => ({
    candidateId: request.candidate.id,
    representationSha256: request.candidate.representationSha256,
    requestId: request.requestId,
    score: scores[index]!,
  }));
}

describe("benchmark pointwise relevance plan", () => {
  test("creates one isolated opaque request per source-bound candidate", () => {
    const input = { candidates: candidates(), profileSha256, query: "Which tool should I recommend?" };
    const original = structuredClone(input);
    const plan = buildPointwiseRelevancePlanV1(input);

    expect(input).toEqual(original);
    expect(plan.requests).toHaveLength(3);
    expect(plan.requests.map((request) => request.candidate.id)).toEqual(["c0", "c1", "c2"]);
    expect(plan.requests.every((request) => /^pr_[0-9a-f]{64}$/u.test(request.requestId))).toBe(true);
    expect(new Set(plan.requests.map((request) => request.requestId)).size).toBe(3);
    expect(plan.requests.every((request) => !canonicalJson(request).includes("edition:"))).toBe(true);
    expect(plan.requests.map((request) => request.candidate.text)).toEqual(input.candidates.map((candidate) => candidate.text));
    expect(plan.candidates.map((candidate) => candidate.baselineRank)).toEqual([1, 2, 3]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.requests[0]!.candidate)).toBe(true);
  });

  test("binds exact representation bytes and rejects duplicate identities and oversized inputs", () => {
    const first = candidates()[0]!;
    const plan = buildPointwiseRelevancePlanV1({ candidates: [first], profileSha256, query: "Question" });
    expect(plan.candidates[0]!.representationSha256).toBe(canonicalSha256({
      sourceSha256: first.sourceSha256,
      text: first.text,
    }));
    expect(() => buildPointwiseRelevancePlanV1({ candidates: [first, first], profileSha256, query: "Question" }))
      .toThrow("distinct");
    expect(() => buildPointwiseRelevancePlanV1({ candidates: [
      { ...first, text: "x".repeat(POINTWISE_RELEVANCE_LIMITS_V1.maximumCandidateBytes + 1) },
    ], profileSha256, query: "Question" })).toThrow("candidate text");
    expect(() => buildPointwiseRelevancePlanV1({ candidates: [first], profileSha256, query: " " })).toThrow("query");
  });

  test("rejects accessors, sparse arrays, extra keys, and invalid digests", () => {
    const getter = Object.defineProperty({ candidates: candidates(), profileSha256 }, "query", {
      enumerable: true,
      get() { throw new Error("must not run"); },
    });
    expect(() => buildPointwiseRelevancePlanV1(getter)).toThrow("data fields");
    expect(() => buildPointwiseRelevancePlanV1({ candidates: new Array(2), profileSha256, query: "Question" }))
      .toThrow("dense array");
    expect(() => buildPointwiseRelevancePlanV1({ candidates: candidates(), extra: true, profileSha256, query: "Question" }))
      .toThrow("exact record");
    expect(() => buildPointwiseRelevancePlanV1({ candidates: candidates(), profileSha256: "0".repeat(63), query: "Question" }))
      .toThrow("SHA-256");
  });
});

describe("benchmark pointwise relevance reduction", () => {
  test("requires every score and preserves baseline order for ties", () => {
    const plan = buildPointwiseRelevancePlanV1({ candidates: candidates(), profileSha256, query: "Question" });
    const ranking = rankPointwiseRelevanceV1({ outcomes: outcomes(plan).reverse(), plan });
    expect(ranking.baseline).toEqual(["edition:alpha", "edition:beta", "edition:gamma"]);
    expect(ranking.ranked.map((candidate) => [candidate.key, candidate.score, candidate.baselineRank])).toEqual([
      ["edition:beta", 0.8, 2],
      ["edition:gamma", 0.8, 3],
      ["edition:alpha", 0.2, 1],
    ]);
  });

  test("rejects partial, duplicate, stale, invalid, or drifted outcomes", () => {
    const plan = buildPointwiseRelevancePlanV1({ candidates: candidates(), profileSha256, query: "Question" });
    const complete = outcomes(plan);
    expect(() => rankPointwiseRelevanceV1({ outcomes: complete.slice(1), plan })).toThrow("dense array");
    expect(() => rankPointwiseRelevanceV1({ outcomes: [complete[0], complete[0], complete[2]], plan }))
      .toThrow("distinct request");
    expect(() => rankPointwiseRelevanceV1({ outcomes: complete.map((row, index) => index === 1
      ? { ...row, representationSha256: canonicalSha256("stale") } : row), plan })).toThrow("stale");
    expect(() => rankPointwiseRelevanceV1({ outcomes: complete.map((row, index) => index === 1
      ? { ...row, score: Number.NaN } : row), plan })).toThrow("probability");
    expect(() => rankPointwiseRelevanceV1({ outcomes: complete, plan: { ...plan, querySha256: canonicalSha256("drift") } }))
      .toThrow("reconstruct");
  });

  test("rejects outcomes replayed across a different query or scoring profile", () => {
    const first = buildPointwiseRelevancePlanV1({ candidates: candidates(), profileSha256, query: "First question" });
    const captured = outcomes(first);
    const changedQuery = buildPointwiseRelevancePlanV1({ candidates: candidates(), profileSha256, query: "Second question" });
    const changedProfile = buildPointwiseRelevancePlanV1({
      candidates: candidates(),
      profileSha256: canonicalSha256("different profile"),
      query: "First question",
    });
    expect(() => rankPointwiseRelevanceV1({ outcomes: captured, plan: changedQuery })).toThrow("request identities");
    expect(() => rankPointwiseRelevanceV1({ outcomes: captured, plan: changedProfile })).toThrow("request identities");
  });
});
