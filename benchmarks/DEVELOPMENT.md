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

**`--max-usd` is the total shared amendment cap, not extra spending for this command.** The fixed ancestral amendment exposure is $18.268639, including unresolved reservations. The runner adds the current shared cache exposure once, leaving at most $21.731361 before any new cache charges under the $40 cap. The example narrows that ceiling to $20 total, leaving at most $1.731361 beyond the historical exposure. The original $21.655385 historical ledger remains a separate authenticated anchor. `--max-calls` counts new reader and judge reservations together; cache hits consume none. Eight questions across two variants need at most 32 new calls. A lower call limit can leave an incomplete report.

Concurrency accepts integers 1–12 and defaults to four. Each free slot admits another request after its worst-case cost is reserved durably. Stop or failure closes admission and drains requests already admitted. The measured eight-slot development runs below completed without new transport failures; they do not establish a provider-wide capacity limit.

All runs use `.cache/benchmarks/lab-paid` in this checkout. Preserve that directory and its ledger across plans and output filenames. An exact namespace plus provider-request digest owns one physical response, even when several question/variant cases share it. Changing retrieval without changing the actual request can therefore reuse the response. Reuse is not an independent model repeat. Completed entries authenticate their original raw capture before reuse; occupied incomplete entries fail preflight. Never delete, reset, rename around, or resubmit them to obtain another answer. Resuming an incomplete run requires a new report path and reuses completed requests; an occupied failed request requires a separately reviewed resolution.

Readers use the fixed `openai/gpt-4.1-mini` alias and judges use `openai/gpt-4o`, with the existing bounded request profiles. Provider aliases are not pinned model snapshots. Gold answers enter only the separate judge stage. Exact-policy terminal reader truncations receive zero, retain their cases in the denominator, and generate no judge request. Other transport or validation failures leave the experiment incomplete. Scores are published only for the complete paired matrix, with grouped paired bootstrap summaries; small independent-group counts limit interpretation.

The report records cache hits, phase completion, failures, elapsed time and conservative budget exposure. Its `.started.json` and `.judges.json` sidecars preserve admission and separate judge preparation; all output paths must be new. Keep the plan, reports and raw cache private. After the canary, prepare a new fixed 24-question development plan before considering the full development set. Synthetic implementation tests verify cache, budget, concurrency and scoring behavior; real development measurements are reported below. Development scores guide candidate selection and do not establish held-out superiority.

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

## Paid development measurements

The [paid development report](results/memory-development-paid-canary-v1.json) records nested, fixed LongMemEval samples. The full sample contains 100 questions across 94 families. Readers use `openai/gpt-4.1-mini`; the separate judge uses `openai/gpt-4o`. Both are provider aliases. Windows and sessions use topK20 and a 24 KB ceiling throughout.

| Questions | Reader policy | Window correct | Session correct | New requests | Execution seconds | Accounted USD |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | Legacy | 5/8 | 5/8 | 44 | 26.93 | 0.433496 |
| 8 | Question last | 5/8 | 5/8 | 35 | 20.90 | 0.428605 |
| 24 | Legacy | 17/24 | 17/24 | 58 | 9.11 | 0.091001 |
| 24 | Question last | 17/24 | 18/24 | 46 | 6.96 | 0.085321 |
| 100 | Legacy | 68/100 | 65/100 | 271 | 50.90 | 0.419213 |
| 100 | Question last | 64/100 | 66/100 | 215 | 38.73 | 0.399144 |

The eight-question runs also include unbounded full context, which scored 5/8 under each policy and missed the same three questions. It used about 510 KB per question versus 24 KB for the bounded methods. A replay authenticated all 24 reader responses and 20 distinct judge responses in 0.46 seconds with zero new calls. That replay is the same sample, not an independent repeat.

Choose the optional policy with `--reader-policy question-last-v1` during preparation. It puts memory before the question and date in the fixed two-message request, reinforces the distinction between the archive and current question, and asks the reader to collect distinct entities before counting. The versioned reader plan binds its policy and exact request bytes. Retrieval contexts, question selection, model aliases and output limits remain fixed within each paired policy comparison. Prepare a new plan to choose a policy; never rewrite an old request or reset its cache entry.

The 24-question session gain did not establish a dependable improvement. On all 100 development questions, the policy lost four window answers overall and gained one session answer overall. The window comparison had four wins and eight losses; sessions had eight wins and seven losses. Grouped development bootstrap intervals for the changes were −10.9 to +2.9 percentage points and −6.2 to +8.8 points, respectively. Both system and key-order instructions change together, so this experiment does not isolate key order alone. **The legacy policy remains the default.** Two initially off-topic full-context answers became relevant but incomplete; relevance alone did not improve their scores.

Later runs reuse earlier first responses: the 100-question legacy run had 48 reader cache hits and 38 judge cache hits, while the question-last run had 48 and 80. At concurrency eight, these runs made 271 and 215 new requests respectively. Reported execution times exclude host scheduling, context preparation, Vercel CLI authentication and initial source/dataset preflight. Different request counts and context sizes prevent a simple latency comparison between sample sizes.

All paired matrices completed, with no new transport failures or unresolved new reservations. The seven runs, including the zero-cost replay, made 669 new requests and accounted for $1.856780. Shared amendment exposure reached $20.125419 after adding the fixed $18.268639 ancestry once. The two 100-question runs used a stricter $22 total ceiling within the unchanged $40 amendment cap. These are conservative usage estimates, not a billing invoice. Development results guide implementation choices; they do not establish held-out superiority, equivalence or saturation.

## Human-turn retrieval experiment

The opt-in `bm25-user-focused` and `user-context` methods remove only explicit assistant-role turns. Named human speakers remain, including both LoCoMo participants. The focused method ranks the filtered raw turns with BM25. The context method packs those turns in original chronological order under the requested byte ceiling; it is bounded and does not guarantee that all human history fits. Neither method uses question labels, answers or evidence annotations.

This experiment tests whether removing verbose assistant replies makes personal evidence easier to retrieve and read. It can discard facts found only in assistant replies, so it is not a production or default change. Compare focused retrieval at matched byte ceilings, and identify larger chronological contexts separately as a diagnostic.

```sh
bun run bench:lab --dataset longmemeval-s --limit 100 \
  --systems bm25-window,bm25-user-focused,user-context \
  --top-k 20,100 --context-bytes 24000,96000 \
  --output .cache/benchmarks/lab/lme-user-turns.json
```

The [human-turn screen](results/memory-development-user-v1.json) completed 1,000 LongMemEval and 4,000 LoCoMo query/variant evaluations with zero model calls. Total run times were 20.11 and 2.52 seconds, excluding a 422.7-second host queue wait. All questions remain in the reports; complete-evidence recall is defined on 93 and 312 annotated questions respectively.

| Method | LongMemEval all evidence, 24 / 96 KB | LoCoMo all evidence, 24 / 96 KB |
| --- | --- | --- |
| Windows, topK20 | 69/93 / 74/93 | 216/312 / 216/312 |
| Windows, topK100 | 69/93 / 79/93 | 244/312 / 254/312 |
| Human focused, topK20 | 55/93 / 55/93 | 181/312 / 181/312 |
| Human focused, topK100 | 59/93 / 59/93 | 214/312 / 215/312 |
| Human chronological context | 8/93 / 77/93 | 66/312 / 283/312 |

Human-only focused retrieval loses evidence and underfills the available context; at topK20 it averages 7.2 KB on LongMemEval under the 24 KB ceiling. The chronological 96 KB diagnostic averages 74.0 KB and recovers more evidence than the 24 KB window baseline, but it consumes substantially more context and loses assistant-only information. On LoCoMo, named speakers are retained, so this chronological arm is a byte-bounded raw conversation control. These results do not justify promoting human-only retrieval. The paid comparison tests whether the extra chronological evidence helps the reader while retaining the matched 24 KB window baseline.

The paired 100-question reader comparison rejected both human-only candidates under both policies:

| Reader policy | Window 24 KB | Human focused 24 KB | Human chronological 96 KB | New requests | Execution seconds | Accounted USD |
| --- | --- | --- | --- | --- | --- | --- |
| Legacy | 68/100 | 58/100 | 55/100 | 313 | 56.79 | 0.965018 |
| Question last | 64/100 | 55/100 | 54/100 | 284 | 58.74 | 0.958082 |

Each run reused all 100 baseline readers. The legacy chronological arm includes one exact-policy output-limit failure scored zero; its partial response was not accepted or retried. All 300 cases in each run remain in the denominator. The higher chronological retrieval recall did not translate into better answers. No human-only method is promoted. These two runs added $1.923100 of accounted usage, bringing shared amendment exposure to $22.048519. The second used a stricter $24 total ceiling within the $40 authorization.

## Assistant-inclusive hybrid experiment

The opt-in `bm25-user-hybrid` alternates human-only and original BM25 ranks, removes duplicate turn IDs, and packs original source turns under the requested byte ceiling. This preserves a route to assistant-only evidence. It uses no labels, derived facts or semantic embeddings. Each source contributes at most 100 ranked turns, and topK limits the final union before packing. Exact-question rank caching amortizes repeated budget variants; it is not an independent ranking-speed measurement. The experiment owns its filtered index and shares the original index with the surrounding sweep.

```sh
bun run bench:lab --dataset longmemeval-s --limit 100 \
  --systems bm25-window,bm25-user-hybrid --top-k 20,100 \
  --context-bytes 24000,96000 --output .cache/benchmarks/lab/lme-hybrid.json
```

The [hybrid screen](results/memory-development-hybrid-v1.json) evaluated eight variants on all 100 LongMemEval and 400 LoCoMo development questions. It completed 800 and 3,200 query/variant rows in 22.17 and 2.21 seconds, excluding a 1,186.5-second host queue wait. At topK100 and 24 KB, the hybrid recovered complete evidence on 69/93 LongMemEval questions, equal to windows. At 96 KB it reached 74/93 versus windows' 79/93. On LoCoMo the hybrid equals focused BM25, because neither named speaker is an assistant-role turn. No independent hybrid retrieval advantage is established.

The paired reader comparison uses windows at topK20/24 KB as its baseline, the hybrid at topK100/24 KB as a matched-byte candidate, and windows at topK100/96 KB as a larger-context diagnostic. The last arm changes depth and context size together; report both changes and actual context use when comparing its accuracy.

The completed 300-case reader matrix scored **70/100 for the hybrid**, **68/100 for the 24 KB baseline**, and **68/100 for the 96 KB window diagnostic**. The hybrid's paired grouped bootstrap interval is −3.1 to +7.2 percentage points, spanning zero. It is a candidate for further development, not a demonstrated improvement or a new default. The 96 KB arm averages 94.2 KB versus the baseline's 23.9 KB; its additional complete-evidence recall produced no net answer gain.

The run reused 100 baseline readers, made 279 new reader/judge requests in 47.13 seconds at concurrency eight, and accounted for $1.174516. All cases completed without new reader failures or unresolved reservations. Shared amendment exposure reached $23.223035 under the $40 cap; the run's narrower total ceiling was $24. These results motivate a separate reader-model experiment with explicit request, price and failure policies.

## Skip unused authority setup

Raw-only development sweeps now create the Oh authority when a selected method needs it. Window, focused and human-turn BM25 comparisons can reuse their raw indexes without ingesting an unused authority. Oh methods, block/fact indexes and record-window paths still initialize their required authority; direct and frozen runners retain eager initialization by default. Lazy construction copies the raw corpus first, so later caller mutation cannot change the eventual authority.

The [setup comparison](results/memory-development-lazy-authority-v1.json) replays the eight hybrid-screen variants on the same 100 LongMemEval and 400 LoCoMo development questions. All 4,000 context digests, turn lists, byte counts and metrics match exactly after removing only retrieval timing. No model call was made.

| Dataset | Setup before → after | Sweep before → after | Total before → after |
| --- | --- | --- | --- |
| LongMemEval, 800 rows | 21.05 → 1.05 s | 21.36 → 1.29 s | 22.17 → 1.89 s |
| LoCoMo, 3,200 rows | 0.47 → 0.01 s | 2.05 → 1.36 s | 2.21 → 1.50 s |

The sweep includes setup and retrieval; total also includes dataset loading and report preparation. These single ordered measurements show a setup reduction for the tested configurations, with total time reduced by factors of 11.74 and 1.48. Filesystem cache state and host load can affect the ratios. The figures exclude host scheduling; the verification itself waited 1,225.4 seconds for admission. This change does not improve model-call latency or answer accuracy. It makes subsequent raw-retrieval experiments cheaper to prepare without changing their outputs.


## GPT-5 mini reader experiment

The [reader profile comparison](results/memory-development-reader-profile-v1.json)
keeps the same 100 development questions, 94 independent families, and retrieved
messages as the preceding hybrid experiment. It changes the reader to the
`openai/gpt-5-mini` Gateway alias, minimal reasoning, and a 2,048-token output cap.
The GPT-4o judge and reference-answer policy remain unchanged.

| Retrieved memory | Previous GPT-4.1 mini | GPT-5 mini, minimal | Paired wins / losses |
| --- | --- | --- | --- |
| Windows, topK20 / 24 KB | 68/100 | 63/100 | 3 / 8 |
| Hybrid, topK100 / 24 KB | 70/100 | 65/100 | 5 / 10 |

All 200 cases completed with no terminal reader failures. Both cross-model
changes are −5 percentage points; their grouped bootstrap intervals include zero
(−11.9 to +1.0 for windows; −13.1 to +2.1 for hybrid). The result does not support
promoting this reader profile. The earlier reader remains the default.

At concurrency eight, generation took 34.16 seconds and judging 9.84 seconds;
complete execution took 45.28 seconds. The run made 200 reader and 73 judge
requests, reused 66 byte-identical earlier judgments, and accounted for
$0.335119. Every new reservation settled. The cumulative amendment exposure is
$23.558209, below this run's $25 total ceiling and the unchanged $40 amendment.
These times exclude preparation, authentication and initial preflight; accounted
usage is not an invoice.

The independent audit reparsed every new raw response, replayed all 66 old judge
hits, regenerated the complete plans and scores, and checked 1,648 artifact
files. The outgoing reader messages also regenerated exactly from the
checksum-pinned public dataset; no private user memory entered the prompts.

The isolated `lab-reader-profile*.ts` modules preserve canonical request
identities, atomic shared spending admission, bounded response capture,
immutable first responses, and separate gold-bearing judge construction. A new
GPT-5-mini length-failure policy retains the case at zero without accepting a
partial answer. The old 512-token reader policy is unchanged. The recorded run used the separately pinned private coordinator. The reusable
command below preserves its execution rules. These are development tools, not production memory
changes or evidence of benchmark saturation.


## Reproduce a reader-profile comparison

`bun run bench:lab:profile --help` describes the public command. It uses the
fixed 100-question LongMemEval development selection and two explicitly selected parent variants. It accepts a SHA-256-pinned private JSON config with these required fields and two optional closed selectors:

| Field | Meaning |
| --- | --- |
| `budgetPin` | Absolute `path` and `sha256` of the verified cumulative budget descriptor. |
| `parentPin` | Absolute `path` and `sha256` of the previous paid reader plan. |
| `legacyDirectory` | Canonical private directory of the existing `bench:lab:paid` cache. |
| `legacyLedger` | Absolute `path`, `sha256`, and exact `bytes` of that closed cache's ledger. |
| `directory` | New private cache directory for this finite run. |
| `output` | New result JSON path; adjacent started, reader and judge files must also be absent. |
| `planPath` | New prepared-plan JSON path. |
| `maxUsd` | Cumulative amendment ceiling, at most 40; includes all prior exposure. |
| `maxCalls` | Maximum new physical requests for this run, at most 400. |
| `concurrency` | Simultaneous requests, from 1 through 12. |
| `readerProfile` (optional) | `minimal` (default, 2,048 output tokens) or `medium` (8,192 output tokens including reasoning). |
| `variantPair` (optional) | `window-hybrid-24kb` (default), or `window-24kb-96kb` to compare the parent’s 24 KB/topK20 and 96 KB/topK100 windows. |

Use canonical absolute paths. Output parent directories and the legacy cache
must be owned by the current user with mode `0700`; pinned files use private
custody. Preparation requires closed legacy custody and immutable ledger bytes.
The legacy replay adapter is specific to the recorded development-cache
namespace; it cannot import an arbitrary cache under a different identity.

Before another run, include the completed reader-profile ledger exactly once
in a new verified budget descriptor, along with its prior ancestry. Keep all
older producers paused. The result's accounted cost is part of the cumulative
ceiling, not a fresh allowance. Preserve failed or unresolved reservations.
Do not point a new config at occupied output or cache paths.

```sh
bun run bench:lab:profile prepare \
  --config /absolute/private/config.json --config-sha256 CONFIG_SHA256

vercel env run --project SELECTED_PROJECT --scope SELECTED_SCOPE \
  --environment development -- \
  bun run bench:lab:profile run \
  --config /absolute/private/config.json --config-sha256 CONFIG_SHA256 \
  --paid --plan-sha256 PREPARED_PLAN_SHA256 --max-usd 25
```

The final amount must equal the pinned config's `maxUsd` and remain within the
authorized cumulative budget. Project and scope must match the verified
authority; no API-key fallback exists. Preparation makes no model calls. The
plan pins the config, parent, budget ancestry, code, reader modules and native
judge JSON. The run rechecks those inputs, reserves before dispatch, drains
started requests after a failure, and reports scores only for a complete matrix.
A failure never converts an occupied request into a cache miss.

The six public-command integration tests use synthetic benchmark data and
a mocked transport. They exercise a complete 200-case matrix through real
request capture and scoring, call-limit admission, immutable outputs and
changed-config rejection, plus separate complete medium-profile and wide-context matrices. Live model qualification comes from the separately
audited comparison above; the mocked tests do not measure answer quality.

The medium profile is a separate experiment using the same GPT-5 mini alias,
OpenAI routing and pricing, with medium reasoning and a larger output allowance
for reasoning tokens. It preserves parent messages, contexts and question order.
Requests, reservations and terminal-failure policy have distinct profile digests;
a matrix cannot mix profiles. Existing minimal request and failure-policy bytes
remain unchanged. More reasoning may improve abstention, arithmetic or counting
errors, but the larger allowance also changes cost and latency. The real medium-profile result is recorded below. Neither profile changes the
production reader default.


## Medium reasoning and remaining retrieval misses

The same 100-question/200-case public command completed with medium reasoning,
an 8,192-token output allowance, and unchanged messages, 24 KB contexts and
native judge. [Compact evidence](results/memory-development-reader-profile-medium-v1.json)
records every paired comparison and its qualifications.

| Retrieved memory | GPT-4.1 mini | GPT-5 mini minimal | GPT-5 mini medium |
| --- | ---: | ---: | ---: |
| Window, topK20 / 24 KB | 68/100 | 63/100 | 72/100 |
| Hybrid, topK100 / 24 KB | 70/100 | 65/100 | 70/100 |

Medium versus minimal gained nine window points (12 wins, three losses;
grouped development interval +2.02 to +16.33 points). Against the existing
GPT-4.1 mini window it gained four points (nine wins, five losses; interval
−3.09 to +11.22). The hybrid tied the existing reader. These intervals come
from a repeatedly used development sample and are not adjusted for all trials;
they do not establish held-out superiority.

The run completed in 175.46 seconds: reader phase 166.05 seconds, judge phase
8.05 seconds, at concurrency eight. All 263 new calls settled: 200 readers and
63 new judges, with 64 authenticated old judge hits across 127 distinct judge
requests. No reader failed. Accounted usage was $0.521840; cumulative amendment
exposure became $24.080049, within the run’s $26 cumulative ceiling and unchanged
$40 amendment cap. Native usage reported 99,925 output tokens, including 91,392
reasoning tokens, across the 200 reader calls. The independent audit reparsed
every local raw response, replayed old judge hits and regenerated all 200 scores,
phase counts, bootstrap and accounting.

A diagnostic of the window’s 28 misses found six with every annotated turn ID
in context, ten with some, seven with none, and five without annotations. On
these same misses, the existing 96 KB parent contexts include every annotated ID
for 14 questions, improving eight. Their mean used context rises from 23,936 to
93,715 bytes. ID presence is a diagnostic proxy; it does not guarantee complete
answer evidence or a correct answer. Annotations were inspected after scoring
and never supplied to retrieval or the reader.

The following experiment compared the existing 24 KB and 96 KB parent windows using
the same medium reader, full fixed sample and native judge. It used the optional
closed `variantPair` selector without relabeling contexts or selecting only the
misses. Both reader arms generated fresh responses. Top-k and the context
allowance changed together.


## Wider context with medium reasoning

The full pair completed at **72/100 for 24 KB/topK20 and 79/100 for
96 KB/topK100**. The wider arm won eight questions, lost one and tied 91;
the grouped development difference was +7 points, with an interval of +1.98
to +13.00 points. This is a promising development candidate with a larger
retrieval allowance. It has not passed reserved-family validation, and the
exploratory interval is not adjusted for the preceding trials.

The run took 177.50 seconds at concurrency eight, with 167.48 seconds for readers
and 8.20 seconds for judging. It made 200 fresh reader calls and 64 new judge
calls; 64 historical judge hits supplied the other half of 128 distinct judge
requests. All 264 reservations settled, every one of the 200 cases was scored,
and there were no reader failures. Accounted usage was $0.770547, bringing
cumulative amendment exposure to $24.850596 under this run’s $27 ceiling and the
unchanged $40 cap. Independent replay verified 1,593 files, raw responses,
complete score/phase matrices, paired bootstrap and the full spending ancestry.

The same 96 KB contexts previously scored 68/100 with GPT-4.1 mini; the new
reader/profile scored 79/100, with 14 wins and three losses. That historical
comparison changes the reader/profile and is separate from the fresh
same-reader 24 KB/96 KB comparison. The repeat 24 KB arm again scored 72/100;
it is still the same set of questions, not 100 new independent observations.
[The compact report](results/memory-development-reader-profile-wide-v1.json)
contains usage, context sizes, comparisons, audit digests and timing limits.

All original minimal, medium and wide first responses and ledgers remain
immutable. Before another paid run, carry the 264-call wider-context ledger
exactly once alongside every earlier ledger. No production default was changed
from these development results.


## Rejected three-source rank-fusion screen

A separate candidate fused raw-focused, block and whole-session BM25 ranks,
then packed raw turns without the failed allocation policy’s half-budget session
reservation. Its full fixed development screen used topK20 and a 24 KB ceiling.
It recovered every annotated ID for **60/93 LongMemEval questions**, below
windows’ 69/93 and sessions’ 71/93. On LoCoMo it reached **183/312**, below
windows’ 216/312 and sessions’ 243/312. It also underfilled LoCoMo contexts:
4,139 mean bytes versus windows’ 9,777. The candidate is rejected; no paid
comparison or runtime integration followed.

Three focused tests passed. The five-adapter, 500-question offline screen took
42.64 seconds under the host compute scheduler, with no observed queue delay
and zero provider calls. [The compact negative result](results/memory-development-trifusion-v1.json)
retains measurements and private experiment hashes. Annotation-ID coverage is
an offline diagnostic, not answer accuracy. This adds 2,500 query/variant rows
to the development screens without using reserved-family questions.


### Locked reserved-family comparison

The development candidate is evaluated once on 100 representatives selected from the
188 eligible test families outside the prior frozen 120. The public selection file
pins the original 308-family pool and its prior exclusions. The selector verifies
the 94 development groups are disjoint, removes the frozen 120, ranks by
`sha256("oh.reserved-reader-v1:" + groupId)`, and takes the first 100. The locked
representative digest is
`7d13988b7c6d76cf665cd26d1858b95f269586df42c69db19b7da6ea5984f993`.
Selection uses identity metadata only; the actual test representatives and development
group commitment are recomputed from the checksum-pinned public dataset.

Prepare the gold-free parent with zero model calls:

```sh
bun scripts/benchmarks/lab-reserved-evaluation.ts --output /absolute/private/new-parent.json
```

Use its returned file pin as `parentPin` in the normal reader-profile config. Add
`"evaluation": "reserved-100-v1"`, `"readerProfile": "medium"`, and
`"variantPair": "window-24kb-96kb"`. This closed evaluation requires `maxCalls: 400`
and `maxUsd: 27` (cumulative, including every previous ledger). The remaining config
and `bench:lab:profile prepare` / `run` commands are unchanged. Both reader arms
are fresh; the reserved path skips all historical judge replay and deduplicates
only requests within this run. Keep the existing legacy directory and ledger pin
for ancestry verification even though reserved judgments are not imported.

Keep all 200 planned cases in the denominator. Terminal reader length failures
score zero. Invalid reader or judge responses and custody/accounting failures make
the comparison incomplete; never retry an occupied call or replace a sample.
After the complete fixed matrix, stop and report the reserved outcome without
further tuning on it. The output has `pairedReservedOutcomes` (wins, losses, ties,
percentage-point difference) and a null `pairedDevelopmentBootstrap`. Report only
accuracy and paired outcomes for this deterministic locked set; it does not justify
a random-sample confidence interval, population superiority or leaderboard claim.
No production default changes follow automatically from this experiment.


The locked run completed and passed independent raw-response, ledger, plan and
score replay. The **96 KB arm scored 84/100 versus 78/100 for 24 KB**, with six
wins, zero losses and 94 ties. It used 198 distinct reader requests for 200 cases
(two pairs had identical canonical prompts), plus 122 new native judge requests.
All 320 new reservations settled; neither arm had a reader failure and no
historical judgments were reused. Execution took **210.73 seconds** and accounted
for **$0.893499**. Cumulative amendment exposure reached **$25.744095** under the
unchanged $40 cap. These timings exclude preparation, authentication, initial
preflight and host queues; usage accounting is not an invoice.

[The reserved report](results/memory-reserved-reader-profile-v1.json) records the
fixed paired outcome, context usage, native token accounting and immutable evidence
digests. The result supports the wider-context improvement on this locked set.
The reserved experiment is complete: do not use its outcomes for further tuning or
replacement sampling. No population-superiority, saturation or production-default
promotion is claimed. The older frozen 120-family comparison remains a separate,
incomplete study requiring its preserved launcher-custody recovery.
