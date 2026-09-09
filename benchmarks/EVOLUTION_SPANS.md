# Source-span memory retrieval experiment

The source-span experiment adapter packs original conversation excerpts into a bounded reader context. It retrieves the native Oh keyword top100 candidate pool, ranks overlapping source windows, and preserves exact source offsets and canonical record digests. It makes no model calls and generates no facts or summaries.

The benchmark CLI accepts an explicit `oh.memory.evolution-run.v2` configuration when its variant matrix includes `oh-source-spans`. Such runs use the separately versioned `oh.memory.evolution-context-plan.v2` union. Native-only configurations and context plans remain V1. A source-span result is never cast to `EvolutionRetrievalResult` or admitted through its whole-turn validator. The production memory API and native retrieval modes are unchanged.

## Use with a prepared corpus

```ts
import { prepareEvolutionCorpus } from "./scripts/benchmarks/evolution-retrieval";
import {
  createOhSourceSpanPacker,
  OH_SPAN_POOL_VARIANT,
} from "./scripts/benchmarks/evolution-spans";

const native = await prepareEvolutionCorpus(corpus);
const spans = createOhSourceSpanPacker(corpus);
const budget = { contextBytes: 24_000 };
try {
  const pool = await native.retrieve(question, OH_SPAN_POOL_VARIANT);
  const result = spans.pack(question, pool, budget);
  spans.validate(result, pool, question, budget);
  // result.context contains the bounded reader input.
} finally {
  await native.close();
}
```

Supply the source-only corpus selected by the experiment. The packer detaches only recognized source fields; labels and unknown-property getters are not read. One packer can reuse its source-window cache across questions and packing budgets. `prepareOhSourceSpanCorpus` is a convenience facade that owns the native prepared corpus and returns `{ pool, result }`.

The candidate pool has a 4,000,000-byte offline collection cap. Any byte-truncated pool is rejected instead of being presented as the complete top100 pool. This cap is not a proposed reader context budget. Keep the authenticated pool outside the reader input and bind it to the span result by hash.

## Source and budget validation

The `oh.evolution-source-spans.v1` result records the native pool identity, prepared corpus identity, query, policy, context cap, and ordered spans. Each span binds its source turn and session, session occurrence, date, speaker, canonical record key and digest, source-text digest, UTF-8 byte range, focus range, and original text.

Validation requires the current source corpus, the authenticated native pool, the original question, and the expected context cap. The default cap is 24,000 bytes. Pass the intended cap explicitly when validating another budget. Changing and resealing a result's declared cap does not change the caller's expected cap.

The validator reconstructs every span and all rendered context bytes. It rejects stale records, fabricated text or metadata, invalid byte boundaries, overlapping spans from the same turn, references outside the pool, unknown fields, changed identities, and budget overflow. Metadata and separators count toward the byte budget. The validator proves source provenance and rendering; it does not independently repeat the native search or prove that its ranking is optimal.

The fixed tokenizer splits at ASCII sentence punctuation followed by whitespace and at newlines. Sentences longer than 512 bytes are divided at valid UTF-8 boundaries. Each candidate includes two focus units and at most one adjacent unit on either side, capped at 2,048 source bytes. BM25 over these windows provides the ranking; native hit rank and byte offset break ties. Packing skips overlapping selected spans and preserves both speakers. Pool and cache window counts are each bounded at 65,536; results contain at most 128 spans.

These units do not resolve linguistic sentences, abbreviations, coreference, or temporal state. Exact quotation alone does not prove that an excerpt contains the answer.

## Development evidence

A predecessor prototype was screened on 100 development questions from the pinned LongMemEval-S release, using seed 17. The [aggregate observation](results/memory-evolution-spans-offline-v1.json) records source identities, timings, and qualification limits without conversation text or machine paths.

| Reader context | Complete evidence sessions | Mean session recall | Mean context bytes |
| --- | ---: | ---: | ---: |
| Source spans, 24 KB | 91/100 | 0.9380 | 23,183.05 |
| Native whole turns, 24 KB | 87/100 | 0.9052 | 23,955.72 |
| Native whole turns, 96 KB | 96/100 | 0.9700 | 94,451.68 |

The span treatment had four paired complete-session wins and zero losses against the 24 KB control, and zero wins with five losses against the 96 KB control. The screen took 22.49 seconds, made 100 native pool queries, reused 200 source-validated control contexts, and made no provider requests. This is one timing observation and does not establish a general speed improvement.

Session recall cannot establish that an answer-bearing span within a retrieved session survived compression. No reader or judge was run, so these results do not establish answer accuracy or superiority. The checked-in module includes an additional expected-budget validation guard; the 100-question observation was not rerun on this publication port. The [source manifest](results/memory-evolution-spans-source-v1.json) distinguishes its files from the measured prototype.

## Mixed reader and memory experiments

Use `oh-source-spans` only with `topK: 100` and a context cap between 1 and 96,000 bytes. The topK gene denotes the fixed native source candidate pool, not the number of packed spans. The example below shows the changed fields of an otherwise fully pinned run configuration:

```json
{
  "protocol": "oh.memory.evolution-run.v2",
  "variants": [
    { "id": "whole24", "system": "oh-keyword", "budget": { "topK": 100, "contextBytes": 24000 } },
    { "id": "whole48", "system": "oh-keyword", "budget": { "topK": 100, "contextBytes": 48000 } },
    { "id": "whole96", "system": "oh-keyword", "budget": { "topK": 100, "contextBytes": 96000 } },
    { "id": "span24", "system": "oh-source-spans", "budget": { "topK": 100, "contextBytes": 24000 } },
    { "id": "span48", "system": "oh-source-spans", "budget": { "topK": 100, "contextBytes": 48000 } },
    { "id": "span96", "system": "oh-source-spans", "budget": { "topK": 100, "contextBytes": 96000 } }
  ],
  "readers": ["gpt5-nano-reader", "gpt5-mini-reader"]
}
```

The existing `prepare`, `readers`, `run-reader`, judge and report commands and campaign budget/credential gates still apply. This excerpt is not a complete configuration or spending authorization. Preparation is source-only and makes zero provider calls. The new plan builder prepares one native corpus index and one bounded source-window cache per corpus. It collects one Oh keyword top100 pool per question and packs every span budget from that pool. Whole-turn variants reuse the same prepared corpus. Pool text appears once per question in the context plan and is never copied into a reader request. Reader profiles do not duplicate pools. Serialized context plans exceeding 128 MiB are rejected before publication; use a smaller explicit selection or fewer treatments if necessary.

V2 cases have `kind: "whole-turn"` with `oh.evolution-retrieval.v1`, or `kind: "source-spans"` with `oh.evolution-source-spans.v1`. Each span case binds its query, full prepared corpus digest, policy, expected cap, and native pool result digest. The plan's `pools` array has exactly one entry per selected question. Unknown fields, duplicate/missing rows, mismatched result kinds, and changed source metadata fail validation. `validateEvolutionContextPlanSources` validates the full source projection, current record digests and exact whole-turn or span rendering without rerunning native search. The CLI invokes it before reader admission and judge preparation; the report invokes it independently. An externally pinned plan is still required to attest which source-valid candidate pool the native search originally returned; source validation alone cannot certify search ranking.

The retrieval source manifest includes both `evolution-spans.ts` and `evolution-variants.ts`, alongside the existing adapter, plan, dataset, production source, lockfile and Bun identities. Source-bound contexts must be regenerated after integrating this code. Preserve earlier published configurations, artifacts, source pins and reports as historical evidence; do not rewrite their pins to make them pass a new runtime identity. Native-only calls to the old V1 builder and the new dispatcher produce identical V1 plan bytes for the same declared identities.

Reader request and receipt identities remain byte-exact: identical provider request fields reuse existing campaign-store responses regardless of plan version or candidate lineage. A changed context produces a different request. The same reader/judge/report matrix handles both case kinds, and shared physical requests are charged once. Reporting uses distinct source session IDs for both; span session recall still cannot show that answer-bearing text survived compression.

The population domain includes the new span system separately from native search modes. Span genotypes require topK 100 and caps at most 96 KB. Single-axis mutation skips incompatible choices. Crossover uses only parental gene values and chooses a deterministic compatible combination; when no valid mixed combination exists it may inherit a parent's genome while retaining both lineage IDs. Fixed-reader memory mode keeps the reader fixed, and system-frontier mode must be explicit. Population generation does not dispatch providers or turn retrieval recall into answer fitness.

A fixed-reader paired evaluation is required before claiming an answer-quality improvement. The historical 100-question observation above is not a measured result for this V2 integration; the integration has only synthetic focused validation at publication time.

Focused validation:

```sh
bun test tests/memory-benchmark-evolution-spans.test.ts tests/memory-benchmark-evolution-span-plan.test.ts
```
