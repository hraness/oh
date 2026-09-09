# Fast memory development

The development loop screens many ideas cheaply, spends reader/judge tokens only on promising paired comparisons, and uses a reserved evaluation after choosing an implementation. The interrupted Gateway comparison remains preserved; its recovery is not a prerequisite for development experiments.

## What the existing comparison measures

The current `oh-fact` arm uses the real SQLite authority and `searchOhV1` keyword query over benchmark-created records and extracted facts. It does not exercise the complete memory-agent API or its semantic, memory-page, temporal and conflict behavior. Improvements to that adapter alone are not evidence that all product memory behavior improved.

The frozen comparison uses 120 selected LongMemEval families and three arms. Its fixed prompts, models, budget and cases remain unchanged. It must be reported with its amendments and failures if completed. Do not tune against its answers or use it as an iterative development set.

## Run an inexpensive screen

```sh
bun run bench:lab --dataset longmemeval-s --limit 8 --output .cache/benchmarks/lab/lme-smoke.json
bun run bench:lab --dataset longmemeval-s --limit 24 --output .cache/benchmarks/lab/lme-development.json
bun run bench:lab --dataset locomo --limit 400 --output .cache/benchmarks/lab/locomo-development.json
```

Use a new output filename each time. Datasets must already be fetched with `bench:memory fetch`; the lab itself makes no network or model calls. The CLI fixes the development split and seed 17. LongMemEval has 100 development questions across 94 families; LoCoMo has 400 questions from two development conversations. The latter is useful for debugging but supplies only two independent groups.

Add `--systems bm25-window,oh-window,bm25-block,oh-block,bm25-session,oh-memory-api,full-context` to include the parallel session and native API experiments (55 variants). The native adapter materializes an actual V2 record projection, verifies every source digest, and then uses host raw-text BM25 for ranking. It is a source/projection integration control; it does not implement native semantic ranking or temporal understanding. Native setup time and page-query count are recorded once per corpus.

The lab-only `bm25-fusion` experiment combines focused-turn and block rankings with fixed reciprocal-rank fusion. It takes at most 100 raw turns from each source, ranks their union, and packs original turns under the requested budget. Source rankings are cached per exact question within a corpus. Its per-variant latency mixes first-query computation with cache reuse; compare total sweep time rather than interpreting cached percentiles as a ranking speedup.

The default sweep evaluates four retrieval systems at three top-k values and three context budgets, plus a single unbounded full-context control: 37 variants. Every variant sees the same questions. The dataset loads once, each corpus index builds once, and query order rotates across variants. Output includes category results, complete-evidence recall, context bytes, empty contexts, query latency and setup time. Derived facts have separate support-citation coverage; that is not raw-turn evidence recall or answer accuracy.

Use `--systems`, `--top-k` and `--context-bytes` to run an ablation. Reuse the full verified development extraction report with `--units` when testing fact representations; compact committed summaries do not contain the unit bundle. Never re-extract unchanged conversations just to change retrieval or reader prompts.

## Parallel experiments

Run three independent workers with one integration owner. Give each worker an explicit hypothesis, separate source files, the same fixed development sample, a time limit, and an output artifact. Workers own focused checks; the integrator runs the required aggregate gates once after the changes converge.

| Track | Hypothesis | First evidence |
| --- | --- | --- |
| Retain source evidence | Compact facts lose details; source turns or a hybrid can recover them | Fact support coverage, raw evidence recall, then paired answer accuracy |
| Retrieval and context | Session/chunk granularity, larger context or diversification can recover multi-session evidence | All-evidence recall by category at matched context budgets |
| Product memory | The real memory API has capabilities and failure modes absent from the keyword adapter | API adapter coverage and source provenance, followed by the same development questions |

Keep a full-context reader control and an evidence-session oracle control in the small paid diagnostic stage. They answer different questions: whether retrieval is limiting accuracy and whether the reader can solve the task when given the right evidence. Oracle evidence is a diagnostic only and must never enter ordinary ingestion or candidate retrieval.

Promote at most two candidates from a screening round. Reject candidates that win only by using more context without disclosing that cost, silently drop failures, change the sample, or lose source grounding. Record negative results so another worker does not repeat the same idea.

## Paid feedback and promotion

The next reader lane should use a single long-lived bounded dispatcher, durable request caching and an explicit total budget. Separate pure preparation from model execution: one prepared context can serve several readers without rebuilding extraction or replaying every historical study.

Use a work-conserving queue rather than a barrier after every four requests: admit a new job when a slot becomes available, reserve its worst-case cost before sending it, record the first response immediately, and drain active jobs on stop. Start at a modest concurrency and measure throughput, errors and provider limits before increasing it. Do not promise a provider concurrency limit that has not been observed. Rate-limit failures should reduce new admission; unknown outcomes must not be silently retried.

Cache by the exact dataset/corpus, implementation, extraction or retrieval configuration, prompt, model and generation parameters. Separate extraction, retrieval contexts, reader responses and judge results so changing one stage invalidates only its dependents. A model-family alias is not a pinned provider snapshot. Cache reuse is an efficiency measure, not an independent repeat for confidence intervals. Provider prompt caching may reduce repeated-prefix costs, but is distinct from skipping a repeated request with a local result cache.

Every small reader experiment must use a complete paired matrix, report failures in the denominator, keep gold answers exclusive to judging, and record accuracy alongside dollars and latency. Use a fixed 8-question canary, then 24 development questions, then the whole development set. Tune on development results. Choose the implementation before evaluating reserved families; a test result used for further tuning becomes development evidence.

**Budget limitation:** the old generic paid CLI's ledger does not include the Gateway continuation's descendant exposure. Do not reopen it at its default maximum or treat `--max-usd` as an additional per-run allowance. A paid lab must account for the existing $18.268639 amendment exposure and all unresolved reservations under the same $40 total cap before admission. The current offline lab cannot spend money.

## Deliver work without delaying every experiment

Development runs record the actual source digest and may use a dirty development checkout. They do not require a new frozen study, a new supervisor protocol, a PR round trip or full historical audit per variant. Reject a run if its source changes while it is running. Preserve one immutable final evaluation, and run the repository's normal required checks and independent review before each task-owned commit/push or delivery. Never weaken the repository gates to hide a failure.

Track time to the first useful metric, variants screened per hour, paired answer evaluations per dollar, retrieval coverage, answer accuracy, failures, context size and latency. A faster harness is useful only if it speeds up decisions about implementation quality. No current accuracy result supports a saturation or superiority claim.

## Initial measurements

On the first 24-question LongMemEval development sweep, 55 variants completed in 18.95 seconds with zero model calls. The run prepared 24 corpora and evaluated 1,320 query/variant pairs; it did not measure the runtime of 1,320 separate corpus preparations. At topK20 and a 12 KB ceiling, native-API-plus-host-BM25 recovered all annotated evidence on 18/24 questions, windows on 17/24, sessions on 16/24, and blocks on 15/24. Sessions reached 19/24 at 24 KB. These are development retrieval metrics with a small sample, not answer accuracy or evidence of a storage-engine advantage.

A separate synthetic before/after test of bounded ingestion reduced median setup-and-retrieval time from 1.249 to 0.985 seconds at 2,048 turns, and 0.202 to 0.176 seconds at 512 turns. Three alternating samples at each size returned identical contexts, turn/support IDs and digests across all 76 retrieval outputs. This isolates ingestion batching; it is not a provider-throughput measurement.

## Full development comparison

Run matched candidate-list and byte-budget comparisons with:

```sh
bun run bench:lab --dataset longmemeval-s --limit 100 \
  --systems bm25-focused,bm25-window,bm25-block,bm25-session,bm25-fusion,oh-memory-api,full-context \
  --top-k 20 --context-bytes 12000,24000 --output .cache/benchmarks/lab/lme-full.json
bun run bench:lab --dataset locomo --limit 400 \
  --systems bm25-focused,bm25-window,bm25-block,bm25-session,bm25-fusion,oh-memory-api,full-context \
  --top-k 20 --context-bytes 12000,24000 --output .cache/benchmarks/lab/locomo-full.json
```

The first full-development round completed 1,300 LongMemEval query/variant evaluations in 77.12 seconds and 5,200 LoCoMo evaluations in 9.37 seconds, excluding host scheduler waits. All planned rows are present, including unannotated questions. Evidence recall uses 93 annotated LongMemEval questions and 312 annotated LoCoMo questions; it is undefined for the others. No model calls were made.

| Retrieval at topK20 | LongMemEval all evidence, 12 KB | LongMemEval all evidence, 24 KB | LoCoMo all evidence, 12 KB | LoCoMo all evidence, 24 KB |
| --- | --- | --- | --- | --- |
| Focused / native API control | 64/93 | 65/93 | 181/312 | 181/312 |
| Windows | 65/93 | 69/93 | 216/312 | 216/312 |
| Blocks | 59/93 | 66/93 | 235/312 | 260/312 |
| Sessions | 54/93 | 71/93 | 209/312 | 243/312 |
| Fusion | 65/93 | 68/93 | 184/312 | 184/312 |

The native API control matches focused BM25 throughout the full development results. Its 24-question result was not evidence of an independent retrieval advantage. The first fusion configuration does not beat windows. Sessions are promising for LongMemEval at 24 KB; blocks are promising for LoCoMo. These patterns are candidate-selection signals, not reader scores or statistical superiority.

A byte ceiling does not equal actual context use. On LoCoMo, the focused and fusion topK20 variants use about 4 KB, windows about 9.8 KB, and blocks about 21.5 KB under the 24 KB cap. The next experiment increases candidate lists under the same byte caps to separate underfilled retrieval from context-size effects. Session topK counts sessions; block topK counts blocks; turn topK counts turns, so equal numeric topK is not an equal number of source turns.

The [initial screen](results/memory-development-lab-lme24-v1.json) and [full development report](results/memory-development-full-v1.json) contain aggregate metrics, exact source and private-report checksums, timing and qualifications.

## Research basis

LongMemEval separates indexing, retrieval and reading, with session/turn granularity, key expansion and time-aware retrieval experiments. Its official implementation also supports oracle evidence and alternative reading methods. Those are useful controls and independent experiment axes, rather than reasons to perform another full extraction for every change. See the [official repository](https://github.com/xiaowu0162/LongMemEval) and [paper](https://arxiv.org/abs/2410.10813).

Vercel documents provider-dependent prompt caching and routing controls. Configure these deliberately for a new development experiment and include them in its identity; do not mutate the frozen comparison. See [provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options) and [prompt caching](https://vercel.com/i/prompt-caching-across-providers).
