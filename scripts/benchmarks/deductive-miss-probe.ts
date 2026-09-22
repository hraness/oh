// Purpose: classify every missed evidence turn for the deductive arms —
// never-derived (no rule fired), derived-but-unpicked (not a seed, not a
// window neighbor, not session fill), or packed-out (candidate dropped by
// the byte budget). Diagnostic only; writes nothing.
// Usage: bun run scripts/benchmarks/deductive-miss-probe.ts

import { DATASETS, selectSplit, type Dataset } from "./datasets";
import { fetchDataset, loadDataset } from "./io";
import { pack, queryTerms, type RetrievalBudget } from "./retrieval";
import { evidenceMetrics } from "./metrics";
import { deductivePlan, prepareDeductive, DEDUCTIVE_SYSTEMS } from "./deductive-retrieval";

const BUDGET: RetrievalBudget = { topK: 20, contextBytes: 12_000 };

async function main(): Promise<void> {
  await fetchDataset("locomo");
  const dataset = selectSplit(await loadDataset("locomo"), "dev", 17) as Dataset;
  for (const corpus of [...dataset.corpora].sort((a, b) => a.id.localeCompare(b.id))) {
    const prepared = prepareDeductive(corpus);
    try {
      const classes = new Map<string, Map<string, number>>();
      const misses: { question: string; category: string; turnId: string; cls: string;
        score: number | null; text: string }[] = [];
      for (const question of dataset.questions.filter((q) => q.corpusId === corpus.id)) {
        if (question.evidenceTurnIds.length === 0) continue;
        for (const system of DEDUCTIVE_SYSTEMS) {
          const plan = deductivePlan(corpus, prepared, system, question.question, BUDGET);
          const packed = pack(plan.candidates, BUDGET.contextBytes);
          const packedIds = new Set(packed.turnIds);
          const candidateIds = new Set(plan.candidates.map((c) => c.turn.id));
          const derivedIds = new Map(plan.derived.map((row) => [row.turnId, row]));
          const terms = new Set(queryTerms(question.question, true));
          for (const turnId of question.evidenceTurnIds) {
            if (packedIds.has(turnId)) continue;
            const row = derivedIds.get(turnId);
            const cls = !row ? "never-derived"
              : !candidateIds.has(turnId) ? "derived-unpicked" : "packed-out";
            const bucket = classes.get(system) ?? new Map<string, number>();
            bucket.set(cls, (bucket.get(cls) ?? 0) + 1);
            classes.set(system, bucket);
            const turn = corpus.turns.find((t) => t.id === turnId)!;
            const shared = [...terms].filter((t) => turn.text.toLowerCase().includes(t));
            misses.push({ question: question.question, category: question.category, turnId, cls,
              score: row ? (row.terms.size + (row.speaker ? 1 : 0) + (row.scoped ? 1 : 0)) : null,
              text: `${turn.speaker}: ${turn.text.slice(0, 90)} | sharedTerms=[${shared.join(",")}]` });
          }
        }
      }
      console.log(`=== ${corpus.id} ===`);
      for (const [system, bucket] of classes) {
        console.log(`  ${system}: ${JSON.stringify(Object.fromEntries(bucket))}`);
      }
      for (const m of misses.filter((x) => x.cls !== "packed-out").slice(0, 25)) {
        console.log(`  [${m.category}] ${m.cls} :: ${m.question.slice(0, 70)}`);
        console.log(`      -> ${m.text}`);
      }
    } finally { prepared.store.close(); prepared.fts.close(); }
  }
}

if (import.meta.main) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
