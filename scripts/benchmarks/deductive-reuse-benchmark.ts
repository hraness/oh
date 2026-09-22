// Paired latency measurement, with exact-context parity as the admission gate.
import { join } from "node:path";
import { canonicalJson, canonicalSha256 } from "../../src/canonical";
import { selectSplit } from "./datasets";
import { loadDataset, ROOT, writeNew } from "./io";
import { CONTROL_BUDGET } from "./deductive-frozen-control";
import { createDeductiveDerivation, deductiveRetrieve, prepareDeductive } from "./deductive-retrieval";
import { mean } from "./metrics";

async function main() {
  const dataset = selectSplit(await loadDataset("locomo"), "dev", 17);
  const corpus = dataset.corpora.find((corpus) => corpus.id === "conv-49")!;
  const questions = dataset.questions.filter((question) => question.corpusId === corpus.id).slice(0, 8);
  const prepared = prepareDeductive(corpus);
  const samples: { questionId: string; order: string; baselineMs: number; sharedMs: number; contextSha256: string }[] = [];
  try {
    for (const [index, question] of questions.entries()) {
      const baseline = () => ["deductive", "deductive-union"] as const;
      const run = (reuse: boolean) => {
        const start = performance.now();
        const derivation = reuse ? createDeductiveDerivation(prepared, question.question) : undefined;
        const outputs = baseline().map((arm) => deductiveRetrieve(corpus, prepared, arm,
          question.question, CONTROL_BUDGET, derivation === undefined ? {} : { derivation }));
        return { ms: performance.now() - start, hash: canonicalSha256(outputs) };
      };
      // Alternate order across queries to reduce consistent warm-cache bias.
      const first = run(index % 2 === 0);
      const second = run(index % 2 !== 0);
      if (first.hash !== second.hash) throw new Error("Shared derivation changed retrieved bytes.");
      const shared = index % 2 === 0 ? first : second;
      const fresh = index % 2 === 0 ? second : first;
      samples.push({ questionId: question.id, order: index % 2 === 0 ? "shared-first" : "baseline-first",
        baselineMs: fresh.ms, sharedMs: shared.ms, contextSha256: first.hash });
    }
  } finally { prepared.store.close(); prepared.fts.close(); }
  const baselineMs = mean(samples.map((row) => row.baselineMs))!;
  const sharedMs = mean(samples.map((row) => row.sharedMs))!;
  const result = { protocol: "oh.deductive-reuse-latency.v1", bun: Bun.version,
    platform: process.platform, arch: process.arch, corpusSha256: canonicalSha256(corpus),
    questions: questions.map((question) => question.id), budget: CONTROL_BUDGET,
    meanBaselineMs: baselineMs, meanSharedMs: sharedMs, speedup: baselineMs / sharedMs,
    samples, qualifications: ["Eight fixed development queries; paired order alternates; setup excluded.",
      "Both mechanical arms retain full proof replay; exact retrieval output hashes must match.",
      "Local wall time depends on load and hardware; this is not a model-inference or production latency claim."] };
  await writeNew(join(ROOT, ".cache/benchmarks/deductive-reuse-latency-v1.json"), canonicalJson(result));
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) await main();
