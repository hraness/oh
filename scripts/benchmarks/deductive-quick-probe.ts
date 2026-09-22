// Purpose: fast conv-49 signal for deductive arm variants vs
// bm25-window/bm25-block. Diagnostic only; writes nothing.
// Usage: bun run scripts/benchmarks/deductive-quick-probe.ts

import { DATASETS, selectSplit, type Dataset } from "./datasets";
import { fetchDataset, loadDataset } from "./io";
import { createRetrievers, type RetrievalBudget } from "./retrieval";
import { evidenceMetrics, mean } from "./metrics";
import { deductiveRetrieve, prepareDeductive } from "./deductive-retrieval";

const BUDGET: RetrievalBudget = { topK: 20, contextBytes: 12_000 };

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
  try {
    retrievers.prepare(["bm25-window", "bm25-block"]);
    const arms = ["bm25-window", "bm25-block", ...Object.keys(VARIANTS)] as const;
    const rows = new Map<string, { recall: number[]; all: number[]; mrr: number[];
      byCat: Map<string, number[]> }>();
    for (const arm of arms) rows.set(arm, { recall: [], all: [], mrr: [], byCat: new Map() });
    for (const question of dataset.questions.filter((q) => q.corpusId === corpus.id)) {
      for (const arm of arms) {
        const retrieved = arm.startsWith("deductive")
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
  }
}

if (import.meta.main) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
