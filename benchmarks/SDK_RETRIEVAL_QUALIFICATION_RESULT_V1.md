# Production SDK retrieval qualification

The configured default SDK route passed the primary development gate against
matched semantic retrieval: **80.59% answer accuracy versus 69.86%, a gain of
10.73 percentage points**. Both personas improved in answer accuracy and evidence
recall. This September 23, 2026 study used the real `Oh.search` route and production
record rendering on 146 questions from two previously exposed development
personas. The native admission interpretation disclosed below applies to the
result.

| Paired comparison | Control correct / cases | Default SDK correct / cases | Answer difference | Completed / planned cases |
| --- | --- | --- | --- | --- |
| Primary: semantic versus default rerank | 306/438 (69.86%) | 353/438 (80.59%) | +10.73 pp | 876/876 |
| Secondary: ordinary hybrid versus default rerank | 281/438 (64.16%) | 353/438 (80.59%) | +16.44 pp | 876/876 |

Each comparison used three reader attempts per arm per question. The two
candidate totals happen to match; their responses, persona totals and repeat
totals differ. They remain separate paired comparisons. The secondary comparison
is descriptive and cannot rescue a failed primary gate. All failed, refused,
truncated, unresolved and unattempted cases remain in the denominator and score
zero; none occurred in either campaign.

| Primary persona | Questions | Semantic correct / cases | Default correct / cases | Answer difference | Recall@10 difference |
| --- | --- | --- | --- | --- | --- |
| persona-01 | 114 | 236/342 | 268/342 | +9.36 pp | +13.60 pp |
| persona-02 | 32 | 70/96 | 85/96 | +15.63 pp | +15.68 pp |

Primary mean evidence recall@10 rose from **12.05% to 26.10%** (+14.06 points).
Across questions, the candidate's mean answer score over its three attempts won
on 25, lost on 7 and tied on 114. Primary answer gains across the three reader
repeats were +12.33, +8.90 and +10.96 points. The secondary recall comparison was
9.13% versus 26.10%, with 29 answer wins, 4 losses and 113 ties.

Every numerical primary condition passed: at least +3 answer points, nonnegative
answer and recall deltas in both personas, positive overall recall@10, all 146
recall questions evaluable, a complete reader matrix, and the native latency and
resource-closure gates. The full [aggregate result](results/memory-sdk-retrieval-qualification-v1.json)
retains each condition, persona, repeat and paired-question summary. Its two
independent reports are also published as exact bytes for
[semantic](results/memory-sdk-retrieval-semantic-qualification-v1.json) and
[hybrid](results/memory-sdk-retrieval-hybrid-qualification-v1.json).

## Production path and measurements

The candidate called `oh.search(query, { limit: 10 })` with both backends
configured and no explicit mode. Each persona had an authoritative in-memory
Oh SQLite store; only original traces dated at or before the question entered
that store, before any search limit. Fresh QMD inference scored the exact
production `recordDocument` bytes. The reader then received at most ten complete
original traces through the unchanged CloneMem prompt renderer, without source
text truncation.

The semantic control replayed authenticated historical QMD results. Ordinary
hybrid used the original lexical query; the default rerank route used its
normalized lexical query. This comparison measures those complete routes and is
not a same-pool reranker ablation.

The shared native capture completed **146/146 queries and 7,834 document pairs**,
with no reranker execution, fallback or cleanup failures. The largest pool held
60 documents; the largest document was 5,855 bytes. One handled initialization
diagnostic is disclosed below. The runtime was Bun 1.3.14, QMD 2.5.3 and
node-llama-cpp 3.18.1, using Qwen3-Reranker-0.6B Q8_0 on an Apple M5 Max with
Metal offloading. Model, executable, dependency and native-binary digest pins
are included in the aggregate artifact.

| Measurement | Value |
| --- | --- |
| Native capture elapsed time | 1,562.94 s |
| First reranker query | 11.438 s |
| All-query reranker p50 / p95 | 10.881 s / 12.343 s |
| Warm reranker p50 / p95, excluding the first query | 10.881 s / 12.343 s |
| Default SDK route p50 / p95 | 10.914 s / 12.370 s |
| Mean semantic / default reader context | 26,049.7 / 20,255.6 bytes |
| Mean hybrid / default reader context | 19,635.4 / 20,255.6 bytes |

These timings exclude historical semantic inference and are not total live
retrieval latency. The shared native capture is counted once. Reader settings
were the Gateway `openai/gpt-4o-mini` alias, temperature 0.1, a 512-token output
ceiling and exact option-ID scoring, with no model judge. All 1,752 responses
reported OpenAI as final provider and that model alias; no immutable model
snapshot was independently resolved.

## Protocol and custody disclosures

The [frozen protocol](SDK_RETRIEVAL_QUALIFICATION_V1.md) and its original wording
remain unchanged as historical artifacts. Before paid dispatch or answer
scoring, a pinned source review led to one explicit admission interpretation.
The sole error-level Metal initialization line came from a handled optional
f16/bf16 capability probe. The source review could not identify which probe
failed or its compiler cause. The interpretation counted that diagnostic
separately from reranker execution and cleanup failures. **Literal
zero-error-log admission would fail.** The numerical quality gates did not
change; the full admission procedure must not be described as unchanged.
Both independent reports bind the interpretation, source review and original
stderr digests.

Separate public service-catalog discovery was followed by an added `.gitignore`
suffix and two catalog cache files outside the 375-file frozen source closure.
Tool causation is inferred from timing and content; the exact mutation time was
not instrumented. The evidence was preserved, only the added suffix was
conditionally restored, and the caches were moved into ignored evidence.
Subsequent owner and independent checks matched all frozen source digests and
found the working tree clean. These are point-in-time checks, not evidence of
continuous cleanliness. The aggregate artifact includes the operational receipt
digests.

Both comparisons were selected before primary answer scores were inspected.
No quality outcomes were opened until both campaigns and their owned processes
closed. The separate standard-library auditor then opened each closed SQLite
ledger in read-only immutable mode and verified its unchanged digest, physical
requests, response/status parsing, costs, all planned cases, source rendering
and native-score ranking. This is independent implementation of the arithmetic,
not a third-party review.

## Costs and interpretation

The two campaigns made 876 provider calls each and cost **$0.777621 and
$0.683465**, totaling **$1.461086** against the additional $25 cap. Unresolved
exposure was zero. Earlier task exposure remains $12.876502, making cumulative
task exposure $14.337588. Native compute and reused historical semantic
inference are excluded from these provider dollar totals.

Per-persona and repeat summaries are the main views of variation. A descriptive
10,000-draw paired-question bootstrap, specified after the protocol but before
answer inspection, gives a primary interval of +4.57 to +16.89 points and a
secondary interval of +10.27 to +22.83 points. These intervals are conditional
on the two exposed personas and treat questions within each as exchangeable;
question dependencies can make them optimistic. They are not population
confidence intervals and do not affect the gate.

This study does not measure memory-writing quality, establish SOTA performance,
or compare Oh with Letta, Supermemory, Mem0 or another external framework.
Repeated reader attempts do not create additional independent questions or
personas. A later matched external study needs its own frozen adapters,
settings, dataset and failure accounting.

The [exact independent auditor and synthetic fixture](audit/sdk-retrieval-qualification-v1/README.md)
are public. Raw source text, gold keys, responses and ledger evidence remain
private in their original pinned layout. Public code and aggregate results
alone do not reproduce the full ledger audit. The benchmark checkpoint is
`de878a521c4830870376b0928a901d3aa4644947`.
