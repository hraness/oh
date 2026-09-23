// Purpose: fast conv-49 signal for deductive arm variants vs
// bm25-window/bm25-block. Diagnostic only; writes nothing.
// Usage: bun run scripts/benchmarks/deductive-quick-probe.ts
//        PROBE_SEM=1 bun run scripts/benchmarks/deductive-quick-probe.ts  (adds vector + deductive-semantic)
//        PROBE_CORPUS=conv-50 / PROBE_TAU=0.25 / PROBE_SEMW=1.0 / PROBE_TOPN=24

import { DATASETS, selectSplit, type Dataset } from "./datasets";
import { fetchDataset, loadDataset } from "./io";
import { createRetrievers, pack, type RetrievalBudget } from "./retrieval";
import { evidenceMetrics, mean } from "./metrics";
import { deductiveRetrieve, prepareDeductive, parseQuestion, questionScope,
  questionDigestOf, turnCandidate } from "./deductive-retrieval";
import { createSemanticProducer, type SemanticProducer } from "./deductive-semantic";

const BUDGET: RetrievalBudget = { topK: 20, contextBytes: 12_000 };
const SEM = process.env.PROBE_SEM === "1";
const SEMW = Number(process.env.PROBE_SEMW ?? "1.5");

const VARIANTS: Readonly<Record<string, Readonly<{ windowRadius?: number;
  diverseFill?: boolean; bridgeWeight?: number }>>> = {
  "deductive": {},
  "deductive-b0.6": { bridgeWeight: 0.6 },
  "deductive-b1.0": { bridgeWeight: 1.0 },
  "deductive-b1.6": { bridgeWeight: 1.6 },
};

async function main(): Promise<void> {
  await fetchDataset("locomo");
  const dataset = selectSplit(await loadDataset("locomo"), "dev", 17) as Dataset;
  const corpus = dataset.corpora.find((c) => c.id === (process.env.PROBE_CORPUS ?? "conv-49"))
    ?? dataset.corpora[0]!;
  const retrievers = createRetrievers(corpus);
  const prepared = prepareDeductive(corpus);
  let producer: SemanticProducer | null = null;
  try {
    retrievers.prepare(["bm25-window", "bm25-block"]);
    if (SEM) {
      producer = await createSemanticProducer({
        ...(process.env.PROBE_TAU !== undefined ? { tau: Number(process.env.PROBE_TAU) } : {}),
        ...(process.env.PROBE_TOPN !== undefined ? { topN: Number(process.env.PROBE_TOPN) } : {}) });
      await producer.prepare(corpus);
    }
    const arms = ["bm25-window", "bm25-block", ...Object.keys(VARIANTS),
      ...(SEM ? ["vector", "deductive-semantic"] : [])] as const;
    const rows = new Map<string, { recall: number[]; all: number[]; mrr: number[];
      byCat: Map<string, number[]> }>();
    for (const arm of arms) rows.set(arm, { recall: [], all: [], mrr: [], byCat: new Map() });
    for (const question of dataset.questions.filter((q) => q.corpusId === corpus.id)) {
      let sem: Awaited<ReturnType<SemanticProducer["searchAndFacts"]>> | null = null;
      if (producer !== null) {
        const parsed = parseQuestion(question.question);
        sem = await producer.searchAndFacts(question.question,
          questionDigestOf(parsed, questionScope(prepared, parsed)), BUDGET.topK);
      }
      for (const arm of arms) {
        const retrieved = arm === "vector"
          ? pack(sem!.ranked.flatMap((hit) => {
              const candidate = turnCandidate(prepared, hit.turnId);
              return candidate === undefined ? [] : [candidate];
            }), BUDGET.contextBytes)
          : arm === "deductive-semantic"
            ? deductiveRetrieve(corpus, prepared, "deductive-semantic", question.question,
                BUDGET, { semFacts: sem!.facts, semWeight: SEMW })
            : arm.startsWith("deductive")
              ? deductiveRetrieve(corpus, prepared, "deductive", question.question, BUDGET,
                  VARIANTS[arm]!)
              : await retrievers.retrieve(arm as "bm25-window" | "bm25-block",
                  question.question, BUDGET);
        const m = evidenceMetrics(question, retrieved.turnIds, retrieved.sessionIds);
        const bucket = rows.get(arm)!;
        if (m.turnRecall !== null) {
          bucket.recall.push(m.turnRecall);
          bucket.all.push(m.allTurns ?? 0);
          bucket.mrr.push(m.reciprocalRank ?? 0);
          const list = bucket.byCat.get(question.category) ?? [];
          list.push(m.turnRecall);
          bucket.byCat.set(question.category, list);
        }
      }
    }
    for (const arm of arms) {
      const b = rows.get(arm)!;
      const fmt = (value: number | null) => (value ?? 0).toFixed(3);
      console.log(`=== ${arm}  R=${fmt(mean(b.recall))} all=${fmt(mean(b.all))} MRR=${fmt(mean(b.mrr))} ===`);
      for (const [cat, list] of [...b.byCat.entries()].sort()) {
        console.log(`  ${cat}  R=${fmt(mean(list))} n=${list.length}`);
      }
    }
  } finally {
    retrievers.close();
    prepared.store.close();
    prepared.fts.close();
    if (producer !== null) await producer.close();
  }
}

if (import.meta.main) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
