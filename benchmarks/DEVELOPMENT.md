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

## Run a bounded paired reader comparison

The paid development CLI prepares retrieval contexts offline, then runs readers and judges through one shared request cache. It supports `locomo` and `longmemeval-s`, fixes the development split and seed 17, and requires two or three explicit variants with at most 100 questions. Start with eight questions. The example compares windows and sessions at topK20 and 24 KB; use the same sample and declared budgets when comparing candidates. Fact arms requiring extracted units are outside this lane.

One coordinator owns all provider execution. Before preparing a plan, that owner supplies a private budget descriptor and its SHA-256. The descriptor pins the approved authority and every existing amendment ledger in order, with exact byte counts, the expected total exposure, and paths whose ledgers must remain absent. It must include the complete Gateway ancestry; the verifier cannot discover an omitted ledger. The original frozen runners and generic paid runner remain paused because their budgets cannot see the new cache ledger.

With already-fetched datasets, run from the repository root. Set `BUDGET_INPUT` to the absolute descriptor path and `BUDGET_SHA256` to its approved digest:

```sh
bun run bench:lab:paid prepare \
  --dataset longmemeval-s --limit 8 \
  --systems bm25-window,bm25-session --top-k 20 --context-bytes 24000 \
  --budget-input "$BUDGET_INPUT" --budget-sha256 "$BUDGET_SHA256" \
  --output .cache/benchmarks/lab/lme-paid8-plan.json
```

Preparation makes zero model calls. It builds each corpus once, closes its stores, and writes the complete ordered case matrix and distinct reader requests. The private plan binds the dataset, question selection, source digest, budgets and request namespace. Keep it private: it contains questions and retrieved conversation text. Use a new output filename; preparation prints the plan's SHA-256.

Set `PLAN_SHA256` to that printed digest. Only the provider owner runs the next command, inside the approved project's scoped OIDC environment. The runner reads `VERCEL_OIDC_TOKEN`, verifies it against the pinned project authority before admission, and has no API-key fallback:

```sh
bun run bench:lab:paid run --paid \
  --plan .cache/benchmarks/lab/lme-paid8-plan.json --plan-sha256 "$PLAN_SHA256" \
  --max-usd 20 --max-calls 32 --concurrency 4 \
  --output .cache/benchmarks/lab/lme-paid8-results.json
```

**`--max-usd` is the total shared amendment cap, not extra spending for this command.** The existing amendment exposure is $18.268639, including unresolved reservations. The runner adds the current shared cache exposure once, leaving at most $21.731361 before any new cache charges under the $40 cap. The example narrows that ceiling to $20 total, leaving at most $1.731361 beyond the historical exposure. The original $21.655385 historical ledger remains a separate authenticated anchor. `--max-calls` counts new reader and judge reservations together; cache hits consume none. Eight questions across two variants need at most 32 new calls. A lower call limit can leave an incomplete report.

Concurrency accepts integers 1–12 and defaults to four. Each free slot admits another request after its worst-case cost is reserved durably. Stop or failure closes admission and drains requests already admitted. These limits describe the implementation; observed provider capacity has not yet been established.

All runs use `.cache/benchmarks/lab-paid` in this checkout. Preserve that directory and its ledger across plans and output filenames. An exact namespace plus provider-request digest owns one physical response, even when several question/variant cases share it. Changing retrieval without changing the actual request can therefore reuse the response. Reuse is not an independent model repeat. Completed entries authenticate their original raw capture before reuse; occupied incomplete entries fail preflight. Never delete, reset, rename around, or resubmit them to obtain another answer. Resuming an incomplete run requires a new report path and reuses completed requests; an occupied failed request requires a separately reviewed resolution.

Readers use the fixed `openai/gpt-4.1-mini` alias and judges use `openai/gpt-4o`, with the existing bounded request profiles. Provider aliases are not pinned model snapshots. Gold answers enter only the separate judge stage. Exact-policy terminal reader truncations receive zero, retain their cases in the denominator, and generate no judge request. Other transport or validation failures leave the experiment incomplete. Scores are published only for the complete paired matrix, with grouped paired bootstrap summaries; small independent-group counts limit interpretation.

The report records cache hits, phase completion, failures, elapsed time and conservative budget exposure. Its `.started.json` and `.judges.json` sidecars preserve admission and separate judge preparation; all output paths must be new. Keep the plan, reports and raw cache private. After the canary, prepare a new fixed 24-question development plan before considering the full development set. Current synthetic implementation tests verify cache, budget, concurrency and scoring behavior; they are not real reader quality scores. Development scores guide candidate selection and do not establish held-out superiority.

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

A byte ceiling does not equal actual context use. On LoCoMo, the focused and fusion topK20 variants use about 4 KB, windows about 9.8 KB, and blocks about 21.5 KB under the 24 KB cap. The depth experiment increased candidate lists under the same byte caps to separate underfilled retrieval from context-size effects. Session topK counts sessions; block topK counts blocks; turn topK counts turns, so equal numeric topK is not an equal number of source turns.

The [initial screen](results/memory-development-lab-lme24-v1.json) and [full development report](results/memory-development-full-v1.json) contain aggregate metrics, exact source and private-report checksums, timing and qualifications.

## Candidate-depth experiment

The [depth report](results/memory-development-depth-v1.json) contains the same five retrieval methods at topK40 and topK100 with 12/24 KB caps. The 2,000 LongMemEval evaluations took 31.92 seconds; 8,000 LoCoMo evaluations took 20.98 seconds, excluding scheduler waits. This round omits native API materialization, so these times are not a measured speedup over the first full comparison.

LongMemEval complete-evidence retrieval is identical for every question at topK20, 40 and 100 within each tested method and cap. Deeper candidates do not resolve its current complete-evidence failures. LoCoMo benefits from depth:

| TopK100 method | All evidence, 12 KB | Mean bytes | All evidence, 24 KB | Mean bytes |
| --- | --- | --- | --- | --- |
| Windows | 225/312 (72.12%) | 11,974 | 244/312 (78.21%) | 23,934 |
| Blocks | 235/312 (75.32%) | 11,980 | 260/312 (83.33%) | 23,979 |
| Fusion | 236/312 (75.64%) | 11,966 | 249/312 (79.81%) | 18,683 |

At 12 KB, fusion exceeds blocks by only one question, with opposite differences in the two conversations. Blocks remain ahead at 24 KB; fusion uses less actual context. Keep these matched-depth controls in a reader comparison. These results do not justify a universal fusion win or a statistical superiority claim.

## Session allocation experiment

The lab-only `bm25-diverse-window` policy reserves half the byte allowance for the first fitting raw anchor in each ranked session occurrence, then visits neighboring turns across those occurrences before backfilling unused anchors and neighbors. It uses a fixed top100 focused-BM25 source ranking; requested topK counts anchors and may yield more raw turns after expansion. It never crosses a session occurrence, rewrites dates, reads labels, or creates synthetic evidence. Ranking is cached per question and corpus. The existing `bm25-anchor-window` control places all ranked anchors before neighbors without the session reservation.

This policy was specified before the depth results: test the same complete development sets at topK20 and 12/24 KB, then compare it with the strongest matching-budget depth controls. Its development promotion rule requires better LongMemEval complete-evidence recall without reduced session recall, and no more than one percentage point of LoCoMo regression at the same cap. Category slices are diagnostics, never routing inputs. A failed promotion remains a documented negative experiment, not a change to product defaults.

The [completed allocation report](results/memory-development-diverse-v1.json) contains 1,500 LongMemEval evaluations in 32.62 seconds and 6,000 LoCoMo evaluations in 9.23 seconds, excluding scheduler waits. All rows and old-control outputs were independently checked. The tested allocation policy **failed promotion**:

| TopK20 method | LongMemEval all evidence, 12 / 24 KB | LoCoMo all evidence, 12 / 24 KB |
| --- | --- | --- |
| Windows | 65/93 / 69/93 | 216/312 / 216/312 |
| Anchor-first windows | 65/93 / 67/93 | 216/312 / 216/312 |
| Session-diverse windows | 52/93 / 59/93 | 216/312 / 216/312 |

The half-budget reservation loses complete evidence on LongMemEval and adds no LoCoMo complete-evidence wins. Keep this adapter as an explicit reproducibility experiment; do not promote it or change the default methods. The recorded generation source precedes a cleanup-only change that moves adapter construction inside the shared retriever's `try/finally`; successful retrieval and packing are unchanged.

The next feedback step is a small paired reader/judge experiment, with window/block/fusion controls at matched depth on LoCoMo and window/session at 24 KB on LongMemEval. An unbounded full-context or evidence-session oracle diagnostic should isolate reader limitations. Further changes need an explicit hypothesis and development result; the current evidence does not support spending another round on the same unchanged depth settings.

## Research basis

LongMemEval separates indexing, retrieval and reading, with session/turn granularity, key expansion and time-aware retrieval experiments. Its official implementation also supports oracle evidence and alternative reading methods. Those are useful controls and independent experiment axes, rather than reasons to perform another full extraction for every change. See the [official repository](https://github.com/xiaowu0162/LongMemEval) and [paper](https://arxiv.org/abs/2410.10813).

Vercel documents provider-dependent prompt caching and routing controls. Configure these deliberately for a new development experiment and include them in its identity; do not mutate the frozen comparison. See [provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options) and [prompt caching](https://vercel.com/i/prompt-caching-across-providers).
