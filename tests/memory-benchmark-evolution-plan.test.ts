import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeEvolutionContextPlan, makeEvolutionReaderPlan, validateEvolutionContextPlan,
  validateEvolutionReaderPlan, type EvolutionContextPlan, type EvolutionReaderPlan } from "../scripts/benchmarks/evolution-plan";
import type { EvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import type { EvolutionRetrievalVariant } from "../scripts/benchmarks/evolution-retrieval";
import type { EvolutionProfileId } from "../scripts/benchmarks/evolution-model";

const digest = (name: string) => sha256Hex(`evolution-plan-test:${name}`);
const readers = ["qwen37-flash-reader", "gpt5-nano-reader", "gemini25-flash-lite-reader"] as const satisfies readonly EvolutionProfileId[];
const variants: readonly EvolutionRetrievalVariant[] = [
  { id: "narrow", system: "bm25-window", budget: { topK: 1, contextBytes: 1_024 } },
  { id: "wide", system: "bm25-session", budget: { topK: 2, contextBytes: 4_096 } },
];

/** This is already the label-free runner projection: opaque IDs and no answer/evidence fields. */
const input: EvolutionRunnerInput = {
  corpora: [
    { id: "c-opaque-beta", turns: [{ id: "turn-beta", sessionId: "session-beta", date: "2026-01-02", speaker: "B", text: "B has a blue bicycle." }] },
    { id: "c-opaque-alpha", turns: [{ id: "turn-alpha", sessionId: "session-alpha", date: "2026-01-01", speaker: "A", text: "A has a red kayak." }] },
  ],
  questions: [
    { id: "q-opaque-beta", corpusId: "c-opaque-beta", question: "What color is B's bicycle?", questionDate: "2026-02-01" },
    { id: "q-opaque-alpha", corpusId: "c-opaque-alpha", question: "What color is A's kayak?", questionDate: "2026-02-01" },
  ],
};

async function contextPlan() {
  return (await makeEvolutionContextPlan({ dataset: input, variants, manifestSha256: digest("manifest"), retrievalSourceSha256: digest("source") })).plan;
}
function resealContext(change: (draft: any) => void, plan: EvolutionContextPlan): EvolutionContextPlan {
  const draft = structuredClone(plan) as any; change(draft); delete draft.planSha256;
  return { ...draft, planSha256: canonicalSha256(draft) };
}
function resealReader(change: (draft: any) => void, plan: EvolutionReaderPlan): EvolutionReaderPlan {
  const draft = structuredClone(plan) as any; change(draft); delete draft.planSha256;
  return { ...draft, planSha256: canonicalSha256(draft) };
}

describe("memory evolution plan contracts", () => {
  test("prepares a deterministic gold-free opaque-ID context matrix without model calls", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls++; throw new Error("A plan must not make a model call."); };
    try {
      const left = await contextPlan(), right = await contextPlan();
      expect(fetchCalls).toBe(0);
      expect(left).toEqual(right);
      expect(left.inputSha256).toBe(canonicalSha256(input));
      expect(left.questions.map(question => question.id)).toEqual(["q-opaque-beta", "q-opaque-alpha"]);
      expect(left.cases.map(item => [item.questionId, item.variantId])).toEqual([
        ["q-opaque-beta", "narrow"], ["q-opaque-beta", "wide"],
        ["q-opaque-alpha", "narrow"], ["q-opaque-alpha", "wide"],
      ]);
      const serialized = JSON.stringify(left);
      expect(serialized).not.toContain("answer");
      expect(serialized).not.toContain("evidenceTurnIds");
      expect(serialized).toContain("c-opaque-alpha");
      expect(left.questions.every(question => Object.keys(question).sort().join(",") === "corpusId,id,question,questionDate")).toBe(true);
      expect(validateEvolutionContextPlan(left)).toEqual(left);
    } finally { globalThis.fetch = originalFetch; }
  });

  test("requires exactly one validated context for every question and retrieval variant", async () => {
    const plan = await contextPlan();
    expect(() => validateEvolutionContextPlan(resealContext(draft => { draft.cases.pop(); }, plan))).toThrow("shape or digest");
    expect(() => validateEvolutionContextPlan(resealContext(draft => { draft.cases[1] = draft.cases[0]; }, plan))).toThrow();
    expect(() => validateEvolutionContextPlan(resealContext(draft => {
      draft.cases[0].result.context = "altered context";
    }, plan))).toThrow("context");
  });

  test("expands a full ordered question-by-variant-by-reader matrix while reusing only identical model requests", async () => {
    const context = await contextPlan(), plan = makeEvolutionReaderPlan(context, readers);
    expect(plan.contextPlanSha256).toBe(context.planSha256);
    expect(plan.cases.length).toBe(input.questions.length * variants.length * readers.length);
    expect(plan.cases.map(item => [item.questionId, item.variantId, item.reader])).toEqual([
      ["q-opaque-beta", "narrow", "qwen37-flash-reader"], ["q-opaque-beta", "narrow", "gpt5-nano-reader"], ["q-opaque-beta", "narrow", "gemini25-flash-lite-reader"],
      ["q-opaque-beta", "wide", "qwen37-flash-reader"], ["q-opaque-beta", "wide", "gpt5-nano-reader"], ["q-opaque-beta", "wide", "gemini25-flash-lite-reader"],
      ["q-opaque-alpha", "narrow", "qwen37-flash-reader"], ["q-opaque-alpha", "narrow", "gpt5-nano-reader"], ["q-opaque-alpha", "narrow", "gemini25-flash-lite-reader"],
      ["q-opaque-alpha", "wide", "qwen37-flash-reader"], ["q-opaque-alpha", "wide", "gpt5-nano-reader"], ["q-opaque-alpha", "wide", "gemini25-flash-lite-reader"],
    ]);
    expect(new Set(plan.requests.map(request => request.requestSha256)).size).toBe(plan.requests.length);
    expect(new Set(plan.requests.map(request => request.profileId))).toEqual(new Set(readers));
    expect(plan.requests.every(request => request.body.model.includes("/"))).toBe(true);
    expect(validateEvolutionReaderPlan(plan, context)).toEqual(plan);
  });

  test("keeps a context plan reusable across reader profiles but rejects missing or duplicated reader cases", async () => {
    const context = await contextPlan(), cheap = makeEvolutionReaderPlan(context, readers.slice(0, 2));
    const anchor = makeEvolutionReaderPlan(context, ["gpt5-mini-reader"]);
    expect(context.planSha256).toBe((await contextPlan()).planSha256);
    expect(cheap.contextPlanSha256).toBe(anchor.contextPlanSha256);
    expect(cheap.planSha256).not.toBe(anchor.planSha256);
    expect(cheap.cases.every(item => context.cases.some(contextCase => item.questionId === contextCase.questionId
      && item.variantId === contextCase.variantId && item.contextSha256 === contextCase.result.contextSha256))).toBe(true);
    expect(() => validateEvolutionReaderPlan(resealReader(draft => { draft.cases.pop(); }, cheap), context)).toThrow();
    expect(() => validateEvolutionReaderPlan(resealReader(draft => { draft.cases[1] = draft.cases[0]; }, cheap), context)).toThrow();
    expect(() => validateEvolutionReaderPlan(resealReader(draft => {
      draft.cases[0].requestSha256 = draft.cases[4].requestSha256;
    }, cheap), context)).toThrow();
  });
});
