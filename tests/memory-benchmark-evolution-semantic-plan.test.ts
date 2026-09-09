import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import { makeEvolutionContextPlan, makeEvolutionReaderPlan, validateEvolutionContextPlanSources,
  validateEvolutionReaderPlan, type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { prepareEvolutionCorpus, type EvolutionRetrievalVariant } from "../scripts/benchmarks/evolution-retrieval";

const corpus = { id: "synthetic-semantic-plan", turns: [
  { id: "bicycle", sessionId: "one", date: "2026-01-01", speaker: "user", text: "My bicycle lock is in the garage." },
  { id: "fruit", sessionId: "two", date: "2026-01-02", speaker: "user", text: "I bought apples at the market." },
] };
const question = { id: "question", corpusId: corpus.id, question: "Where is the bicycle lock?", questionDate: "2026-02-01" };
const input = { corpora: [corpus], questions: [question] };
const variants: EvolutionRetrievalVariant[] = ["oh-keyword", "oh-semantic", "oh-hybrid"].map(system => ({
  id: system, system: system as EvolutionRetrievalVariant["system"], budget: { topK: 2, contextBytes: 4096 },
}));
const manifestSha256 = sha256Hex("synthetic-manifest"), retrievalSourceSha256 = sha256Hex("synthetic-source");

async function mixedPlan(): Promise<EvolutionContextPlan> {
  let records: readonly KnowledgeGraphRecordV1[] = [], builds = 0, searches = 0, closes = 0;
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(value) { records = value; builds++; return { indexed: value.length, v: 1 }; },
    async search(_query, _limit, authority) { searches++; const record = records[0]!;
      expect(authority.get(record.key)?.recordSha256).toBe(record.recordSha256);
      return [{ key: record.key, recordSha256: record.recordSha256, score: 0.9, v: 1 }]; },
    async close() { closes++; } };
  const native = await prepareEvolutionCorpus({ ...corpus, groupId: corpus.id });
  const semantic = await prepareEvolutionCorpus({ ...corpus, groupId: corpus.id }, { semanticBackend: backend });
  const cases = [];
  try {
    for (const variant of variants) cases.push({ questionId: question.id, variantId: variant.id,
      result: await (variant.system === "oh-keyword" ? native : semantic).retrieve(question.question, variant) });
    expect(native.identity.semanticProfileSha256).toBeNull();
    expect(semantic.identity.semanticProfileSha256).toBe(canonicalSha256(OH_EMBEDDING_PROFILE_V1));
  } finally { await Promise.all([native.close(), semantic.close()]); }
  expect([builds, searches, closes]).toEqual([1, 2, 1]);
  const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256,
    retrievalSourceSha256, inputSha256: canonicalSha256(input), variants, questions: input.questions, cases };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
function reseal(plan: EvolutionContextPlan, change: (draft: any) => void): EvolutionContextPlan {
  const draft = structuredClone(plan); change(draft);
  for (const c of draft.cases) { const { resultSha256: _, ...payload } = c.result; (c as any).result = { ...payload, resultSha256: canonicalSha256(payload) }; }
  const { planSha256: _, ...payload } = draft;
  return { ...payload, planSha256: canonicalSha256(payload) };
}

describe("semantic context-plan source authentication", () => {
  test("admits real prepared native, semantic and hybrid identities in one reader matrix", async () => {
    const plan = await mixedPlan();
    expect(() => validateEvolutionContextPlanSources(plan, input)).not.toThrow();
    const readers = makeEvolutionReaderPlan(plan, ["gpt5-nano-reader"]);
    expect(readers.cases).toHaveLength(3);
    expect(() => validateEvolutionReaderPlan(readers, plan)).not.toThrow();
  });

  test("rejects resealed cross-mode prepared identities in both directions", async () => {
    const plan = await mixedPlan(), native = plan.cases[0]!, semantic = plan.cases[1]!;
    for (const target of [1, 2]) {
      const changed = reseal(plan, draft => { draft.cases[target].result.preparedSha256 = native.result.preparedSha256; });
      expect(() => validateEvolutionContextPlanSources(changed, input)).toThrow("source identity");
    }
    const changed = reseal(plan, draft => { draft.cases[0].result.preparedSha256 = semantic.result.preparedSha256; });
    expect(() => validateEvolutionContextPlanSources(changed, input)).toThrow("source identity");
  });

  test("rejects resealed source records and system labels", async () => {
    const plan = await mixedPlan();
    const badSource = reseal(plan, draft => { draft.cases[1].result.sources[0].recordSha256 = sha256Hex("foreign source"); });
    expect(() => validateEvolutionContextPlanSources(badSource, input)).toThrow("source identity");
    const badMode = reseal(plan, draft => {
      draft.variants[1].system = "oh-keyword";
      draft.cases[1].result.variantSha256 = canonicalSha256(draft.variants[1]);
    });
    expect(() => validateEvolutionContextPlanSources(badMode, input)).toThrow("source identity");
  });

  test("unused semantic cache configuration preserves exact keyword plan bytes", async () => {
    const args = { dataset: input, variants: [variants[0]!], manifestSha256, retrievalSourceSha256 };
    const plain = (await makeEvolutionContextPlan(args)).plan;
    const optional = (await makeEvolutionContextPlan({ ...args, semanticCacheDirectory: "/unused-semantic-cache-must-not-open" })).plan;
    expect(optional).toEqual(plain);
    expect(() => validateEvolutionContextPlanSources(optional, input)).not.toThrow();
  });
});
