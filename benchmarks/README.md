# Memory benchmarks

This directory holds the protocols, results, and audits for Oh’s memory
benchmarks, with compact JSON records in [`results/`](results/). The studies
measure three separate things: whether Oh’s stored memory state stays correct,
whether retrieval puts the labeled evidence in front of a reader, and whether a
model reader answers correctly from that evidence. Datasets and full run files
stay in the ignored `.cache/benchmarks/` directory, and every command on this
page runs from the repository root.

## Results

<!-- LONGMEMEVAL_S_500_RESULT -->

The sections below report the other completed comparisons. The [evaluation
history](#evaluation-history) lists every study, including the ones that failed
or were replaced.

### How to read these results

- **Evidence recall** is the share of labeled evidence turns or sessions that
  retrieval places in the reader’s context. **Answer accuracy** is the share of
  questions the reader answers correctly. A study can raise one and not the
  other.
- The **reader** is the model that answers from the retrieved context. The
  **judge** is a separate model call that compares each answer with the gold
  reference, and it is the only step that sees gold references. CloneMem is
  multiple choice and is scored against its answer key.
- **LongMemEval-S** asks 500 questions, each about one chat history of about 48
  sessions ([Wu et al., ICLR 2025](https://arxiv.org/abs/2410.10813)).
  **LoCoMo** has ten long two-person conversations and 1,986 questions.
  **CloneMem** asks multiple-choice questions about personal histories of
  diaries, email, and social posts. **BEAM** is a long-conversation benchmark
  pinned here for confirmation work; only the small compact-repair study below
  has scored it.
- **BM25 window** ranks source turns with SQLite FTS5 BM25 and packs them into
  a fixed byte budget. **Oh semantic** ranks the same turns with Oh’s local
  semantic search, which runs the EmbeddingGemma model through the optional QMD
  package. **Full history** gives the reader every turn in original order, with
  no retrieval.
- **Development** questions were used to choose settings. **Closed** questions
  were set aside, but their exposure before a study is recorded as unknown, and
  unknown does not mean unseen. From 2026-09-10 all 500 LongMemEval-S questions
  are development or evaluated, and all ten LoCoMo conversations are exposed.
- **Gateway aliases** such as `openai/gpt-5-mini` are Vercel AI Gateway model
  names, not dated model snapshots, so results that use them are not official
  leaderboard reproductions.
- **Jev** is a model (`jev-1.13.0`) that scores how relevant a candidate is to
  a question.
- **Projection** is Oh’s deterministic evaluation of Datalog rules over stored
  records.

No study here measures an agent writing or updating its own memory during work,
or resuming a task from memory.

### LongMemEval-S: single runs with GPT-5 nano and mini

With GPT-5 nano as the reader, BM25 window answered 378/500 (75.6%), Oh semantic
379/500 (75.8%), and full history 355/500 (71.0%); with GPT-5 mini on the same
contexts, Oh semantic answered 449/500 (89.8%) and BM25 window 427/500 (85.4%).
Both retrieval arms returned the top 100 turns within 96,000 bytes, the judge
was the GPT-4o Gateway alias with LongMemEval’s grading prompts and a 16-token
cap, and each reader ran once. These are in-sample scores on an exposed
benchmark, and these runs kept the original session identifiers that the
[identifier audit](LONGMEMEVAL_IDENTIFIER_AUDIT_V1.md) found can carry
answer-label wording, with an unmeasured effect on scores.

Paired on the same questions, Oh semantic and BM25 window split 43 wins, 42
losses, and 415 ties with nano, and 39 wins, 17 losses, and 444 ties with mini.
The labeled evidence sessions were in Oh semantic’s context for 499/500
questions and in BM25 window’s for 473/500. Full history lost to both retrieval
arms with nano (62 to 39 against BM25 window, 66 to 42 against Oh semantic) and
cost about five times as much per answer. The [release
results](EVOLUTION_RELEASE_RESULTS.md) give categories, shards, strata, cost,
and latency.

The three-run [500-question study](LONGMEMEVAL_S_500_RESULT_V1.md#results)
scored Oh semantic 88.87% and BM25 86.13%, mean of three runs. On the measure
fixed before the run, questions answered correctly in at least two of three
runs, Oh leads BM25 by 2.8 points with a 95% interval from 0.0 to 5.6, which
does not rule out a tie.

### LoCoMo: Oh semantic and BM25 window on 1,540 questions

With a 24,000-byte retrieval budget, Oh semantic scored 84.4% with GPT-5 mini
and 81.0% with GPT-5 nano, against 81.6% and 78.1% for BM25 window. The run
covered 1,540 questions from all ten conversations, excluded the 446 adversarial
questions, used the final session date as the question date, and graded answers
with the CORRECT/WRONG judge on a gpt-4o-mini alias at temperature 0 with 512
output tokens; each reader ran once, and all 11,065 calls completed with zero
failures for $11.82. Every conversation was exposed to earlier studies, the
record gives no confidence interval, and ten conversations are ten clusters.

| Arm | Reader | Overall | Single-hop | Multi-hop | Temporal | Open-domain |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Oh semantic, 24 KB | GPT-5 mini | 84.4% | 91.3 | 79.1 | 81.3 | 50.0 |
| Oh semantic, 24 KB | GPT-5 nano | 81.0% | 87.6 | 76.2 | 77.3 | 50.0 |
| BM25 window, 24 KB | GPT-5 mini | 81.6% | 90.1 | 69.1 | 80.4 | 47.9 |
| BM25 window, 24 KB | GPT-5 nano | 78.1% | 87.3 | 63.8 | 76.0 | 46.9 |

Paired on the same questions, Oh semantic won 169 and BM25 window 124 with nano;
with mini the split was 126 to 83. Most of the difference is on multi-hop
questions, 67 to 32 with nano and 50 to 22 with mini. Scores on the 314
development questions and the 1,226 previously evaluated questions differ by
0.43 to 1.48 points. Published LoCoMo judge scores with gpt-4o-mini readers are
Mem0 66.9, Mem0 with graph 68.4, Letta 74.0, and Zep 75.1; the readers and
context budgets differ from this run, so those numbers are not a matched
comparison. The planned follow-up is three repeats with nano under a $20 cap; a
gpt-4o-mini row is declared but unfunded. Details are in the [LoCoMo section of
the release
results](EVOLUTION_RELEASE_RESULTS.md#matched-descriptive-comparison-on-locomo)
and the [record](results/memory-evolution-locomo-sealed-1540-v1.json).

### CloneMem: Oh’s default SDK search

On 2026-09-23, Oh’s default `Oh.search` path with the local reranker answered
353/438 (80.59%) against 306/438 (69.86%) for the same-store semantic search, a
gain of 10.73 points with a 95% bootstrap interval of +4.57 to +16.89. The study
used 146 previously exposed development questions from two personas, three
reader repeats per question, and all 876 cases completed; evidence recall@10
rose from 12.05% to 26.10%, and 1,752 calls cost $1.461086. Historical semantic
scores were replayed rather than recomputed, so the local timings exclude live
semantic inference, and no other memory framework was run.

Both personas improved: persona-01 (114 questions) went from 236 to 268 correct,
+9.36 points, and persona-02 (32 questions) from 70 to 85, +15.63 points. Across
questions the reranker won 25, lost seven, and tied 114. Against ordinary hybrid
search, which scored 281/438 (64.16%), the gain was 16.44 points (+10.27 to
+22.83). The [result](SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md) records the
Metal startup interpretation made before the paid run and the [audit
code](audit/sdk-retrieval-qualification-v1/README.md). The [main
README](../README.md#use-the-best-configured-retrieval) describes how the SDK
chooses retrieval.

### CloneMem: local reranker on seven reserved personas

On 2026-09-23, the local reranker answered 2,010/2,583 (77.82%) against
1,822/2,583 (70.54%) for vector retrieval, +7.28 points with a 95%
persona-cluster bootstrap interval of +4.61 to +10.27. The screen covered all
861 questions from seven personas held back from development, three campaigns,
and 5,166 completed cases; recall@10 rose from 14.48% to 32.80%, contexts were
22.1% smaller, and across questions the reranker improved 106, regressed on 30,
and tied 725. The personas had prior project exposure, and a retry rule was
added after two failed campaign attempts, so the final procedure was not fully
fixed in advance.

The [audit](CLONEMEM_RERANK_CONFIRM_AUDIT_V2.md) reproduced the arithmetic and
kept the failed attempts: counting every missing first-attempt response against
the reranker leaves a +6.16-point gain, counting them in its favor gives
+7.82, and the smallest persona gain is +0.61. The reranker ships as the opt-in
`mode: "rerank"` (`oh/rerank`, `OhQmdRerankBackendV1`).

### Framework pilot: Oh, Supermemory, and BM25

On 2026-09-24, over 60 previously exposed LongMemEval-S questions, Supermemory
answered 45 (75.00%), Oh 43 (71.67%), and BM25 41 (68.33%). The difference Oh −
Supermemory is −3.33 points with a 95% within-type bootstrap interval of −13.33
to +6.67, and Oh − BM25 is +3.33 points (−1.67 to +8.33), so the pilot does not
separate any pair. Every planned cell stayed in its denominator, including three
that failed locally or were never attempted and four Supermemory searches that
returned no candidates.

| Arm | Correct of 60 | Accuracy on judged answers | Search p50 |
| --- | ---: | --- | ---: |
| Supermemory | 45 (75.00%) | 75.00% (60 judged) | 1,003 ms |
| Oh | 43 (71.67%) | 75.44% (57 judged) | 12,524 ms |
| BM25 | 41 (68.33%) | 71.93% (57 judged) | 2.5 ms |

The [result](FRAMEWORK_PILOT_RESULT_V1.md) gives the protocol and the
[record](results/memory-framework-pilot-v1.json) the numbers.

### Comparisons that did not pass

| Study | Candidate | Control | Outcome |
| --- | --- | --- | --- |
| [LoCoMo packing](LOCOMO_WINDOW_QA_V1.md), 300 questions | 77.33% | 78.11% | Recall rose (90.08% versus 88.93%); accuracy did not |
| [LoCoMo conversation order](LOCOMO_ORDER_DEV_RESULT_V1.md) | 73.54% | 74.38% | Failed its rule |
| [LoCoMo answer composition](LOCOMO_COMPOSITION_DEV_RESULT_V1.md), 160 questions | 74.17% | 75.42% | Failed its rule |
| [CloneMem hybrid search](CLONEMEM_TRANSFER_V1.md), 300 questions × 3 | 66.89% | 68.67% | No gain in recall or accuracy |
| [CloneMem keyword queries](CLONEMEM_KEYWORD_DEV_RESULT_V1.md), 146 questions | 67.35% | 68.95% | Recall@10 rose from 12.05% to 15.17%; accuracy failed |
| [Answer audit](ANSWER_AUDIT_V1_RESULTS.md), 100 questions × 3 | 93.33% | 92.67% | Seven improvements, five regressions; not adopted |
| [Compact repair](COMPACT_REPAIR_CONFIRMATION.md), 24 BEAM questions | 79.86 | 73.61 | Interval includes zero; failed its rule |
| [Quote cards](EVOLUTION_RELEASE_RESULTS.md#fact-card-development-experiment), 100 questions | 46 and 45 | 82 | Both arms regressed |
| [Semantic completion](semantic-completion-development.md), 100 questions | 83 | 84 | Three wins, four losses; failed its rule |

## Reproduce the results

### Before you start

Install with Bun 1.3.14 and `bun install --frozen-lockfile --ignore-scripts`.
The Oh semantic and hybrid systems need the optional `@tobilu/qmd` 2.5.3 package
resolvable from the checkout. `bun run bench:memory --help` lists every option.
`--output` and `--summary-output` take new report paths and never overwrite a file. `summarize --input RUN.json --output SUMMARY.json` writes a compact
report with the source identity and the full report’s checksum.

The 500-question pipeline’s log builder, rules, and instructions ran in a
private lab harness that is not published; the [appendix of that
result](LONGMEMEVAL_S_500_RESULT_V1.md#appendix-instructions-and-rules) lists
them in full.

### Run the network-free checks

```sh
bun run test:benchmarks
bun run bench:memory state
bun run bench:memory projection
```

The state benchmark exercises Oh’s working and `canonical` stores, compares
updates and multi-hop results with a separate replay oracle, and tests proof
sources, conflicting store values, `canonical` pins, idempotency, and
stale-write rejection. Its observations are synthetic structured records, not
facts extracted by a model; `--steps` sets the state mutations per seed (default
32). The projection benchmark records repeated wall-clock timings and whole
result digests, and it does not change evaluation limits; `--sizes` (default
`16,32,48`) and `--repeat` (default 5) set the chain sizes and timed runs.

### Offline stress helpers

Four helpers stress correctness and recovery without a network, a provider, or a
dataset download. Each takes the source digest you expect the checkout to have
and an absolute path to a new report file outside the checkout:

```sh
bun run bench:stress:projection --expected-source-sha256 "$OH_STRESS_SOURCE_SHA256" --output "$OH_STRESS_OUTPUT_ROOT/projection.json"
bun run bench:stress:resume --expected-source-sha256 "$OH_STRESS_SOURCE_SHA256" --output "$OH_STRESS_OUTPUT_ROOT/resume.json"
bun run bench:stress:sqlite --expected-source-sha256 "$OH_STRESS_SOURCE_SHA256" --output "$OH_STRESS_OUTPUT_ROOT/sqlite.json"
bun run bench:stress:retrieval --expected-source-sha256 "$OH_STRESS_SOURCE_SHA256" --output "$OH_STRESS_OUTPUT_ROOT/retrieval.json"
```

Set `OH_STRESS_OUTPUT_ROOT` to a directory you own outside the checkout. The
helpers resolve the output parent through symlinks, require it to be outside the
repository, reject any output destination that already exists, including a
symlink, and never create output-parent directories. Review the tree you intend
to measure, read its digest from `io.codeIdentity().sourceSha256`, and pass that
value as `OH_STRESS_SOURCE_SHA256`. Each helper records the source identity
before and after its run and succeeds only when the expected, before, and after
digests are identical, so a successful report names the source it exercised.

The test sets are fixed: 63 projection evaluations (20 graph fixtures in three
input permutations plus three proof-budget cases); nine extraction-resume
scenarios (three concurrency levels by three completion orders, each with three
planned interruptions); 12 SQLite crash cycles of 64 records each; and a
retrieval grid of 9,216 cells and 27,648 grid calls plus 24 stale-source cases.
These counts describe what the helpers run, not a recorded result, and the
helpers need a fresh run against the tree you measure.

The proof-budget cases assert that evaluation caps truncate proofs where the
public limits say they do; a run that exceeds a cap is reported as a failure,
not given a larger budget. The extraction-resume helper drives a synthetic
in-process transport with injected transport, environment, and ledger
dependencies, so it contacts no provider and opens no spending ledger. The
helpers test deterministic correctness, resume accounting, and crash recovery on
synthetic data, and their timings describe one machine.

### Fetch a dataset

Fetch a checksum-pinned public dataset, then measure retrieval:

```sh
bun run bench:memory fetch --dataset longmemeval-s
bun run bench:memory retrieval --dataset longmemeval-s --split dev --limit 24
```

| Dataset | Source | Revision | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| `longmemeval-s` | Hugging Face `xiaowu0162/longmemeval-cleaned` | `98d7416c24c778c2fee6e6f3006e7a073259d48f` | 277,383,467 | `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442` |
| `longmemeval-oracle` | Hugging Face `xiaowu0162/longmemeval-cleaned` | `98d7416c24c778c2fee6e6f3006e7a073259d48f` | 15,388,478 | `821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c` |
| `locomo` | GitHub `snap-research/locomo`, `data/locomo10.json` | `3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376` | 2,805,274 | `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4` |
| `beam` | Hugging Face `Mohammadta/BEAM` | `3205395e897e7318c7b094ef4e6047b9b82dbb03` | 285,187,170 | `8280371b8322fc39af44489a65c698c9e48e7feafddcca012d64ba75d54ff2f4` |

The BEAM total covers three parquet parts: 100K (5,429,768 bytes,
`c0519be25907005ba873c927c50877471d550873039d96c041554d0075a78ace`), 500K
(33,956,263 bytes,
`af05921c979355038e1761b7cde3d2dd713200dd3071b278de0200f6c7f30122`), and 1M
(66,156,374 bytes,
`41b5acbbb55a586b1305514ef9d9fb03365d9b3331b598a1c2dd7603d93ef533`).

LongMemEval-S downloads about 277 MB, and the cleaned release is MIT-licensed.
`longmemeval-oracle` is a smaller diagnostic that contains only the evidence
sessions; it is not the S benchmark. The `locomo` download uses `gh`, and its
data is licensed CC BY-NC 4.0, so review that noncommercial license for your
intended use. BEAM data is CC BY-SA 4.0 and unfunded for confirmation; its fetch
needs `python3` with `pyarrow==21.0.0` to re-encode the three parts, and the
[confirmation method](EVOLUTION_CONFIRMATION.md#beam-offline-preparation)
describes its offline exposure review and family draw (`beam-seal-cli.ts review`
and `draw`). No dataset is included in the npm package.

CloneMem comes from `AvatarMemory/CloneMemBench` at commit
`753d8a97fd78f4ee25af398a0f0c8d981a6be304` under Apache-2.0: ten files and 1,187
questions, of which one persona (180 questions) is excluded, leaving 1,007.
`scripts/benchmarks/clonemem-dataset.ts` has `fetch` and `inspect` subcommands;
run it with `--help` for arguments. The [source
profile](profiles/clonemem-source-v1.json) pins the files and the [license
copy](profiles/CLONEMEM_LICENSE) travels with it.

### What the memory systems see

The state, projection, and retrieval paths use SQLite `:memory:`. The SQLite
crash helper is the one exception: it uses a disposable database file in a
temporary directory that it creates and removes. Downloads and reports live in
`.cache/benchmarks/`, and no production database, hosted cache, or sync
destination is read or written. Ingestion receives raw turns, prepared source
identifiers, dates, speakers, and provided image captions. Answer fields,
evidence labels, and supplied summaries stay outside the memory adapters, and
images are not fetched. LongMemEval session and turn identifiers are replaced
with neutral ones before ingestion, keeping duplicate-session grouping and
evidence denominators intact; the [identifier
audit](LONGMEMEVAL_IDENTIFIER_AUDIT_V1.md) explains why, and artifacts prepared
before that fix must be rebuilt, with historical reproduction using the original
frozen source commit.

The baselines are no memory, recent turns, unlimited full context, raw SQLite
BM25, and Oh’s keyword API. Focused-query and neighboring-turn variants are
experimental benchmark adapters, not changes to Oh’s default search and not
implementations of Letta, Mem0, or another framework. Retrieval adapters share
the same top-K seed count and UTF-8 context-byte budget; recent context uses the
byte budget alone, and full context is exempt. Bytes are not reported as tokens.
The experimental `oh-anchor-window` and `bm25-anchor-window` variants reserve
room for ranked matches before filling the remaining space with neighboring
turns, and they do not change production search. Paired comparisons use the
matching BM25 variant, not a smaller context of ranked turns alone.

### What reports record

Reports include source-file hashes, dataset revision and checksum, selected
question IDs, context digests, per-category scores, missing-annotation counts,
latencies, and paired conversation-cluster bootstrap intervals. LoCoMo category
IDs keep the original dataset numbering. Repeated LongMemEval session IDs
receive distinct turn-occurrence IDs without dropping content; session recall
keeps the original labels, and duplicate-session counts are reported. Evidence
protocol `oh.evidence-references.v2` splits unambiguous multi-citation entries
and resolves leading-zero aliases only to turn IDs that exist. Reports keep the
raw annotations and the normalization audit, ambiguous or missing references
count as misses, and earlier raw-reference reports stay as historical
measurements.

Development and test splits keep whole conversations or question families
together. Choose an adapter on `--split dev`, freeze it, and use `--split test`
for the final measurement, without repeatedly optimizing against the held-out
answers. A pilot subset is not a full-benchmark run.

| `bench:memory` option | Default |
| --- | --- |
| `--dataset` | `locomo` |
| `--split` | `dev` |
| `--seed` | 17 |
| `--top-k` | 20 (maximum 100) |
| `--context-bytes` | 12000 |
| `--extraction-concurrency` | 3 (1–12) |
| `--answer-tokens` | 512 (maximum 4096) |
| `--provider` | `openai` or `vercel-gateway` |

### Run a paid reader comparison

Supply a benchmark-only `OPENAI_API_KEY` in the runner environment, then
authorize both limits:

```sh
bun run bench:memory answer --dataset longmemeval-s --split dev --limit 24 \
  --paid --max-usd 10 --max-calls 96
```

You can instead pass an ignored `.env.benchmark` file with
`bun --env-file=.env.benchmark run bench:memory answer ...`. Direct OpenAI uses
pinned GPT-4.1-family snapshots, and credentials never appear in reports.

A Vercel project can supply short-lived OIDC authentication without exporting
its secrets to a file. Select your project and team by name:

```sh
vercel env run --project YOUR_PROJECT --scope YOUR_TEAM --environment development -- \
  bun run bench:memory answer --provider vercel-gateway \
  --reader openai/gpt-4.1-mini --dataset locomo --split dev --limit 24 \
  --paid --max-usd 10 --max-calls 96
```

The Gateway transport reads only `VERCEL_OIDC_TOKEN`, uses a fixed HTTPS
endpoint, restricts upstream routing to OpenAI, and does not configure remote
keys, environment variables, or deployments. Its `openai/gpt-4.1-mini` and
`openai/gpt-4.1` profiles are family aliases, not dated snapshots, and reports
distinguish those runs from direct OpenAI. Dated profiles reject an alias
response unless its routing metadata proves the requested snapshot. Gateway does
not advertise a sampling seed, so the runner does not send one.

Every adapter in a run uses the same answer prompt and output-token limit.
Reader profile `oh.benchmark.reader.v2` asks for short, complete answers without
restatements or citations, with a default 512-token output limit set by
`--answer-tokens`. Empty or clipped completions keep their known cost and count
as failed cases while the other questions continue. Transport, identity,
authentication, and spending failures stop the run, and nothing is retried
silently.

The reader’s diagnostic `oh-token-f1.v1` metric is not MemEval set-F1, LoCoMo’s
native scorer, or an LLM judge. Failed and unattempted requests stay visible in
coverage and lower-bound denominators. LongMemEval hypotheses are included for
separate native evaluation.

### Spending limits and the shared ledger

Both transports reserve a conservative maximum request cost before dispatch and
share one locked ledger, `.cache/benchmarks/openai-pilot-budget.jsonl` (limited
to 16 MiB), across runs in this checkout. The lock file is
`.cache/benchmarks/openai-pilot.lock`; a normal close releases it, and a stale
lock is never removed automatically, so confirm that no benchmark is running
before you remove one. Separate checkouts do not share the ledger. Do not delete
it to restart a budget.

`--max-usd` must be above zero and at most `PILOT_MAX_USD` (62.248769, in
`scripts/benchmarks/model.ts`), and it caps cumulative ledger exposure including
earlier runs. `--max-calls` accepts 1 to 10000. Unresolved requests keep their
reservation. Usage accounting includes Gateway-reported inference cost when
available and is not a provider invoice. Runs rotate system order across the
whole question sequence, including one-question corpora, and report an
undiscounted `uncachedReaderCostUsd` estimate beside the cache-adjusted cost.
Provider caches can be shared across similar requests, so a cache-discount
difference alone does not show an efficiency gain, and missing cache details are
reported separately from zero cache use.

The original study’s ceiling of $62.248769 was its $12.248769 exposure at the
time plus an authorized $50 follow-up; that history authorizes no new dispatch.
The later [Gateway amendment](GATEWAY_STUDY_V6_TAKEOVER.md#final-budget) used a
separate $40 cap with cross-run ledger accounting, and the [budget
amendment](results/memory-superiority-budget-amendment.json) binds its opening
exposure to the ledger hash and reserves $5 for answering and judging. Every
command needs its own `--max-usd` and `--max-calls`.

### Judge a reader report

Grade a reader report without re-running the memory system:

```sh
vercel env run --project YOUR_PROJECT --scope YOUR_TEAM --environment development -- \
  bun run bench:memory judge --provider vercel-gateway \
  --dataset longmemeval-s --split dev --input RUN.json \
  --paid --max-usd 10 --max-calls 96
```

The judge validates the reader report against the pinned dataset, split, seed,
and whole question-by-system matrix. LongMemEval uses the [attributed native
prompt text](profiles/longmemeval-judge-v1.json), and LoCoMo uses a separately
labeled semantic-reference diagnostic or, for the published comparison, the
[CORRECT/WRONG profile](profiles/locomo-judge-v1.json). The LongMemEval renderer
was tested against all twelve category and abstention combinations of the pinned
upstream function, and a verdict must be a whole yes or no answer, not a
substring. The Gateway GPT-4o alias and its 16-token minimum differ from the
native judge’s 10-token setting, so these results are not an exact leaderboard
reproduction. Judging shares the cumulative spending ledger, failed or missing
answers stay in denominators, LLM judging is fallible, and one conversation
cannot produce a meaningful cluster-bootstrap interval.

Identical rendered judge prompts share one verdict and one charge within a run.
Exact LoCoMo abstentions are scored deterministically, and other responses go to
the frozen judge, so identical answers from different systems get the same
label.

### Extract question-blind memory units

A separate ingest-time experiment extracts dated, self-contained facts with
verbatim source quotes. Its input omits benchmark questions, answer fields,
evidence labels, and answer-location annotations. It keeps prepared turn
identifiers, which are neutral for LongMemEval input from the identifier fix
onward; older extraction artifacts carry the [identifier
limitation](LONGMEMEVAL_IDENTIFIER_AUDIT_V1.md). Each segment stays within one
session occurrence and date, oversized turns are split losslessly, and invalid
claims are counted and rejected. Malformed or clipped batches stop the run
without automatic retries.

Extraction requests strict JSON-schema output and runs three requests at a time
by default; `--extraction-concurrency` accepts 1 through 12. Resume an
interrupted run with `--resume-units PREVIOUS.json` and a new output path.
Verified completed chunks are reused, including later corpora when an earlier
chunk fails, and the original ingestion cost stays in the report and the ledger.
The provider schema enforces the object shape and array limits, and local
validation tests UTF-8 byte limits and exact source quotes. Reports keep the
schema hash. Legacy experiments that were not frozen may reuse earlier
prompt-only or JSON-mode chunks. With `--selection`, a resume requires the same
source and selection hashes, strict JSON schema, and the 8,192-token extraction
profile, and a format change is recorded before any held-out answers are
generated.

```sh
vercel env run --project YOUR_PROJECT --scope YOUR_TEAM --environment development -- \
  bun run bench:memory extract --provider vercel-gateway --dataset locomo --split dev \
  --paid --max-usd 10 --max-calls 100 --output .cache/benchmarks/units.json
bun run bench:memory retrieval --dataset locomo --split dev \
  --systems bm25-window,oh-block,oh-fact-turns,oh-fact --units .cache/benchmarks/units.json
```

The extraction report binds the dataset, split, seed, source-corpus digest,
extractor prompt, units, and source quotes, and loading it verifies those
bindings. Retrieval rejoins each supporting quote to its current Oh record
digest and drops stale claims instead of trusting an old index entry.

- `oh-block` and `bm25-block` index small same-session raw blocks without an
  LLM, then return the original turns.
- `oh-fact-turns` and `bm25-fact-turns` use extracted text only as a search
  index, then return the original supporting turns.
- `oh-fact` and `bm25-fact` return compact extracted text. Their citation
  coverage is not raw-turn recall and is reported separately; reader accuracy is
  the comparison that counts.

The visible-text BM25 controls use the same units but index their rendered text.
Oh also indexes record keys, kinds, object keys, and values, including source
digests and session metadata. Both rank with SQLite FTS5 BM25, so these controls
compare indexed representations, not ranking algorithms. A gain from extraction
is evidence for a memory strategy with its full ingestion cost counted, and
ingest-time model tokens and cost stay visible when cached units are reused. A
valid quote shows attribution, not entailment. Offline retrieval prepares each
requested representation before timing queries and reports shared Oh and BM25
index construction under ingestion. Development reports created before that
separation include lazy index construction in the first query, so their query
latency is unsuitable for paired comparisons.

The `bm25-record-fact` and `bm25-record-window` controls, used only when named,
copy Oh’s committed search-document text into separate FTS5 indexes. Their query
normalization, BM25 ordering, record-key tie breaking, source validation, and
context packing match `oh-fact` and `oh-window`, and they never call Oh’s
keyword search. Identical contexts are the expected sanity result, not an
accuracy win. They are built before offline query timing, only when requested,
and their build costs appear under `ingestion[].unitIndexes.recordIndexes`.
Because they depend on Oh’s document preparation, a standalone cost must include
that work as well as the separate index build; the copied index cost alone is
not a competing system’s ingestion cost.

Repeat `--exclude-report PRIOR.json` to exclude whole question families that
were examined before selection. The command records the hashes of the excluded
reports and refuses to fall back to used families when none remain.

The [source and protocol audit](research.json), reviewed 2026-09-05, records
lessons from Lemmalog, Letta, PropMem, Graphiti, Mem0, Hindsight, and SimpleMem,
including the differences that prevent direct leaderboard comparisons.

### Draw a finite-pool sample

The finite-pool follow-up draws a saved simple random sample of one fixed
representative per LongMemEval-S family: the smallest question ID in code-unit
order. This normally picks the base question when an abstention variant also
exists, so results describe that representative pool, not the dataset’s full
mixture of questions.

Create the sample once, before examining outcomes, and repeat the same
`--exclude-report` arguments when creating and replaying it:

```sh
bun run bench:memory select --dataset longmemeval-s --split test --seed 17 \
  --limit 120 --output .cache/benchmarks/selection.json \
  --exclude-report benchmarks/results/longmemeval-memory-strategy-fresh-v1.json
bun run bench:memory retrieval --dataset longmemeval-s --split test --seed 17 \
  --selection .cache/benchmarks/selection.json --systems bm25-window,bm25-record-window \
  --exclude-report benchmarks/results/longmemeval-memory-strategy-fresh-v1.json
```

This example shows the mechanism; a confirmation run must exclude every family
inspected before, using all applicable reports. `select` uses `crypto.randomInt`
with a partial Fisher–Yates shuffle. The saved IDs, pool mapping, method,
representative policy, source checksum, split seed, and exclusion hashes define
the replay. `--selection` works with extraction, retrieval, and answering, and
cannot be combined with `--limit`. Replaying a changed pool or a mismatched
exclusion set fails instead of drawing replacements.

The [finite-pool analysis](finite-population.md) uses conservative one-sided
bounds with exact arithmetic. The fixed three-arm decision in
`scripts/benchmarks/superiority.ts` requires a whole judgment matrix, positive
simultaneous lower bounds against both raw-window controls, and at least five
percentage points of observed improvement over each; a run that misses that rule
is reported as no established improvement.

Verify the full artifacts before interpreting judgments:

```sh
bun scripts/benchmarks/confirm.ts \
  FULL_FREEZE.json \
  benchmarks/results/longmemeval-superiority-selection-v1.json \
  UNITS.json ANSWERS.json JUDGE.json NEW_RESULT.json
```

The [public protocol](results/memory-superiority-freeze-v2.json) omits only the
deployment identifier and records the hash of the full protocol. Use that full
protocol with the completed full extraction, answer, and judge reports, not
their compact summaries. The scorer binds their bytes, source identity,
selection, prompts, models, and budgets to the frozen protocol, rejects
mismatched artifacts, and cannot certify an incomplete matrix. Run it from the
frozen source tree.

### Score Oh in another harness

To score Oh inside a third-party memory harness that supplies its own reader and
judge, use the retrieval-only command. It reads one normalized conversation
(MemEval’s `session_N` / `session_N_date_time` shape), prepares an Oh corpus,
and prints the packed context for one question, with no model or provider call:

```sh
bun scripts/benchmarks/memeval-cli.ts query --conv /absolute/conversation.json \
  --question "..." --system oh-semantic --top-k 100 --max-bytes 96000 --cache-dir /absolute/cache
```

`--system` accepts any evolution retrieval system; `oh-semantic` and `oh-hybrid`
need the pinned optional QMD package resolvable from the execution tree. The
harness controls the answer prompt, judge, sample, and accounting, so a result
is comparable only within that harness.

### Other runners

| Runner in `scripts/benchmarks/` | Subcommands | Used by |
| --- | --- | --- |
| `evolution.ts` | `prepare`, `rebind`, `readers`, `judge-plan`, `run-reader`, `run-judge`, `report` | [Evolution runner](EVOLUTION.md) |
| `evolution-release-cli.ts` | `scope`, `combine` | [V7 study](EVOLUTION_RELEASE_V7.md) |
| `evolution-full-context-cli.ts` | `check`, `combine` | [Full-context companion](FULL_CONTEXT_COMPANION.md) |
| `evolution-paired-stats-cli.ts` | `rescore`, `declare-strata`, `cost`, `power` | [Analysis plan](ANALYSIS_PLAN.md) |
| `sdk-retrieval-qualification-run.ts` | `prepare`, `freeze`, `capture`, `prepare-paid` | [SDK study](SDK_RETRIEVAL_QUALIFICATION_V1.md) |
| `beam-seal-cli.ts` | `review`, `draw` | [Confirmation method](EVOLUTION_CONFIRMATION.md) |
| `memeval-cli.ts` | `query` | [Score Oh in another harness](#score-oh-in-another-harness) |
| `clonemem-dataset.ts` | `fetch`, `inspect` | [CloneMem transfer](CLONEMEM_TRANSFER_V1.md) |

Package scripts cover the other studies: `bench:lab`, `bench:lab:paid`, and
`bench:lab:profile` for the [development lab](DEVELOPMENT.md); `bench:claude`
and `bench:claude:v2` for the [subscription study](CLAUDE_SUBSCRIPTION.md);
`bench:gateway:v3` through `bench:gateway:v6` for the Gateway amendments;
`bench:deductive`, `bench:deductive:control`, and `bench:deductive:fusion` for
[deductive memory](DEDUCTIVE_MEMORY.md); and `test:benchmarks`, which runs
`bun test ./tests/memory-benchmark*.test.ts`.

The LoCoMo packing study can be replayed from its [published
records](results/locomo-window-confirmation-v1/README.md) with no model calls.
The replay rebuilds all 1,986 control contexts and all 3,172 confirmation
contexts, including whole-turn order and bytes:

```sh
bun run bench:memory fetch --dataset locomo
bun run scripts/benchmarks/locomo-window-source.ts verify \
  benchmarks/results/locomo-window-confirmation-v1 \
  benchmarks/results/memory-locomo-window-development-v1.json
```

## Evaluation history

Each entry gives the date when its document records one, a status, what the
study measured, and the outcome. **Passed** and **failed** refer to the rule
fixed before the study. **Rejected** means a development candidate was dropped.
**Completed** means a study ran to the end without a pass rule. **Stopped**
means a run halted before completion, and **replaced** means a later document
supersedes it. **Procedure**, **plan**, and **prototype** documents describe how
to run a study and hold no result.

### LongMemEval-S

#### 500-question studies

- [LongMemEval-S, all 500 questions](LONGMEMEVAL_S_500_RESULT_V1.md),
  2026-09-26. Completed. Three runs each of a pipeline that reads the user’s
  whole message log, a first pass of that pipeline, Oh semantic, and BM25, all
  with GPT-5 mini: 93.07%, 91.20%, 88.87%, and 86.13%, mean of three runs. The
  pipeline leads BM25 by 6.93 points [4.60, 9.40], Oh semantic by 4.20 [2.47,
  6.00], and the first pass by 1.87 [0.87, 3.00] on the mean of three runs, and
  by 8.6 [5.8, 11.6], 5.8 [3.6, 8.0], and 3.2 [1.8, 4.8] on questions correct in
  at least two of three runs; these intervals exclude zero, but the pipeline’s
  instructions and rules were written after studying all 500 questions, so the
  result is in-sample. On that fixed two-of-three measure, Oh semantic leads
  BM25 by 2.8 points with a 95% interval from 0.0 to 5.6, which does not rule
  out a tie. All model calls cost $121.83
  ([record](results/memory-longmemeval-s-500-v1.json);
  [limits](LONGMEMEVAL_S_500_RESULT_V1.md#limits)).
- [Full 500-question release results](EVOLUTION_RELEASE_RESULTS.md). Completed.
  Single runs with GPT-5 nano (BM25 window 378, Oh semantic 379, full history
  355) and GPT-5 mini (BM25 window 427, Oh semantic 449) on the same frozen
  contexts, plus the LoCoMo comparison, the MemEval harness runs, and published
  results for context. V7 cost $1.627158, the V8 full-context companion
  $3.336887, and the mini study $7.126958 ([nano
  record](results/memory-evolution-full-release-500-v1.json), [mini
  record](results/memory-evolution-full-release-500-mini-v1.json), [full-context
  record](results/memory-evolution-full-context-500-v1.json)).
- [Calibration-only answer instruction on 500
  questions](EVOLUTION_RELEASE_RESULTS.md#second-round-evidence-selection-and-answer-calibration).
  Completed. Rebinding a development winner to the frozen contexts scored BM25
  window 429 and Oh semantic 446 with GPT-5 mini, against 427 and 449 for the
  original instruction; the development gain did not transfer
  ([record](results/memory-evolution-full-release-500-calibration-v1.json)).
- [V7 full-release procedure](EVOLUTION_RELEASE_V7.md). Procedure. Freezes the
  two-arm, five-shard 500-question study with the nano reader and adapted judge;
  reports development and closed strata separately.
- [Full-context companion](FULL_CONTEXT_COMPANION.md). Procedure, completed.
  Adds full history at 355/500 as a third arm over the V7 questions and shards.
- [V9 study protocol](EVOLUTION_RELEASE_V9.md). Procedure. Explicit question
  lists, candidate and control systems, and indexed reader and judge repeats;
  its [rebind smoke](EVOLUTION_RELEASE_V9.md#rebind-existing-contexts-e4a)
  reproduced the five mini context shards with zero API calls, and its [LoCoMo
  section](EVOLUTION_RELEASE_V9.md#locomo-parity-lane) defines the
  published-judge protocol.

#### Audits

- [LongMemEval identifier audit](LONGMEMEVAL_IDENTIFIER_AUDIT_V1.md),
  2026-09-23. Completed. Original session identifiers reached indexes and reader
  context, and a fixed pipeline sample included identifiers with answer-label
  wording; the effect on scores is unmeasured, and new comparisons need neutral
  identifiers and fresh runs.
- [Answer audit plan](ANSWER_AUDIT_V1_PLAN.md), 2026-09-11. Plan. A second
  reader pass over GPT-5 mini drafts on 100 development questions.
- [Answer audit results](ANSWER_AUDIT_V1_RESULTS.md), 2026-09-11. Failed. Mean
  accuracy moved from 92.67% to 93.33% across three repeats (280/300 against
  278/300), with seven improvements and five regressions; the original
  experiment was aborted and the audit was not adopted.

#### Development runs and diagnostics

- [Development lab](DEVELOPMENT.md). Procedure and results. Screens retrieval
  variants on shared indexes without model calls, then spends reader calls on
  promising pairs; its [reserved reader
  pair](DEVELOPMENT.md#locked-reserved-family-comparison) scored 84/100 with 96
  KB against 78/100 with 24 KB
  ([record](results/memory-reserved-reader-profile-v1.json)).
- [Evolution runner](EVOLUTION.md). Procedure. Prepares source-verified
  contexts once and reuses them across reader comparisons with shared spending
  limits and replayed scoring.
- [Evolution development results](EVOLUTION_RESULTS.md). Completed. Reader
  calibration on 24 questions and development comparisons of [source
  packing](EVOLUTION_RESULTS.md#focused-source-packing-mechanisms), [source
  excerpts](EVOLUTION_RESULTS.md#source-excerpt-answer-experiment), [semantic
  and hybrid
  readers](EVOLUTION_RESULTS.md#semantic-and-hybrid-reader-comparison), [answer
  instructions](EVOLUTION_RESULTS.md#answer-contract-comparison), [semantic
  source coverage](EVOLUTION_RESULTS.md#local-semantic-source-coverage), and
  [embedding parallelism](EVOLUTION_RESULTS.md#local-embedding-parallelism);
  development choices, not confirmation.
- [Development reader
  loop](EVOLUTION_RELEASE_RESULTS.md#what-else-was-tried-on-the-development-set),
  2026-09-10. Completed. On 100 development questions, other answer
  instructions, reader effort settings, and reader models scored at or below the
  92/100 GPT-5 mini baseline, and 160 KB and 240 KB budgets scored 93 each; the
  loop spent $11.65
  ([record](results/memory-evolution-reader-loop-dev100-v1.json)).
- [Two-stage evidence selection](EVOLUTION_TWO_STAGE.md), 2026-09-10. Rejected.
  A nano selector followed by the answer scored 86 and 82 by majority of three
  against a 91 baseline, losing evidence the single-call reader used
  ([record](results/memory-evolution-two-stage-dev100-v1.json)).
- [Quote-card
  preregistration](quote-card-development-v1/QUOTE_CARD_PREREGISTRATION.md).
  Failed. Rewriting context into source-quoted cards scored 46/100 and 45/100
  against the 82/100 parent, with 33 extractor outputs failing validation; the
  [result](EVOLUTION_RELEASE_RESULTS.md#fact-card-development-experiment) and
  the [procedure](FACT_CARD_EXPERIMENT.md) give the details.
- [Semantic nano diagnosis](quote-card-development-v1/SEMANTIC_DIAGNOSIS.md).
  Completed. The nano reader’s 18 errors on the 82/100 development selection, 17
  of which had every annotated evidence turn in context.
- [Source spans](EVOLUTION_SPANS.md). Procedure. Packs original conversation
  excerpts from Oh’s top 100 keyword candidates with exact source offsets and no
  model calls.
- [Packing mechanisms and full-history control](EVOLUTION_PACKING_V3.md).
  Procedure. Three fixed source-packing treatments and an untruncated
  full-history control for development runs.
- [Source ID selector](EVOLUTION_SELECTOR.md). Prototype. A cheap model picks
  opaque turn aliases from Oh’s top 100 pool; no benchmark or provider calls
  were made.
- [Source selector experiment](selector-lane-v1.md). Prototype. Compares a
  native top 100 whole-turn control with up to 32 selected turns under a
  48,000-byte limit, with synthetic integration evidence only.
- [Observation extraction](OBSERVE_LANE.md), 2026-09-10. Failed. GPT-5 mini
  passed a synthetic eight-session fixture, but the development pilot failed
  with six truncated and ten unparseable responses; in the extractor comparison
  the control and low-reasoning variant accepted 11 of 12 sessions and the
  structured V2 extractor seven
  ([record](results/observation-development-pilot-20260910-v1.json)).
- [Event calendar plan](EVENT_CALENDAR_V1_PLAN.md), 2026-09-11. Plan. Tests
  whether source-quoted event pointers help GPT-5 mini on 100 development
  questions; paid execution needs separate approval.
- [Mem0 reader context adapter](MEM0_READER_CONTEXT.md). Procedure. Packs Mem0
  search results into a reader context with no provider calls; the MemEval runs
  in the [release
  results](EVOLUTION_RELEASE_RESULTS.md#under-a-third-party-harness) scored Oh
  semantic 61.8% (gpt-4.1) and 60.8% (gpt-4.1-mini), and on the first 30
  questions Oh 18/30 and 20/30 against Mem0’s 13/30
  ([record](results/memory-evolution-memeval-102-v1.json)).
- [Successor campaigns](EVOLUTION_CAMPAIGNS_V2.md). Procedure. Creates a new
  campaign and store with pins to its predecessor, so a new spending allowance
  never changes an occupied campaign.

#### 120-family studies

- [Finite-pool analysis](finite-population.md). Procedure. Conservative
  one-sided bounds for a simple random sample of family representatives.
- [Superiority freeze v1](results/memory-superiority-freeze-v1.json). Replaced
  by [v2](results/memory-superiority-freeze-v2.json) before paid extraction
  began; the [120-family
  selection](results/longmemeval-superiority-selection-v1.json) and
  [preflight](results/memory-superiority-preflight.json) belong to the same
  study.
- [Claude subscription study](CLAUDE_SUBSCRIPTION.md). Stopped. A
  mixed-extractor continuation through Claude Code; the original API study
  stayed incomplete.
- [Gateway amendment v3](GATEWAY_STUDY_V3.md). Stopped when four saved
  responses lacked optional routing fields.
- [Gateway continuation v4](GATEWAY_STUDY_V4.md). Stopped at an extraction
  output limit after sending 4,916 remaining chunks; the four imported responses
  kept their $0.121802 exposure.
- [Gateway continuation v5](GATEWAY_STUDY_V5.md). Stopped. Marked 184 captured
  responses, including truncations, with an `invalid-truncation` rule that
  counts them as zero memory.
- [v5 handover](GATEWAY_STUDY_V5_TAKEOVER.md). Stopped after a reader reached
  its output limit.
- [v6 handover and final comparison](GATEWAY_STUDY_V6_TAKEOVER.md), 2026-09-09.
  Failed. `oh-fact` 81/120, `bm25-window` 78/120, and `bm25-record-window`
  79/120 over 360 cases, short of the fixed rule for the fact arm
  ([record](results/memory-gateway-final-v6.json)).

### LoCoMo

- [LoCoMo comparison on 1,540
  questions](EVOLUTION_RELEASE_RESULTS.md#matched-descriptive-comparison-on-locomo).
  Completed. Oh semantic 84.4% (mini) and 81.0% (nano), BM25 window 81.6% and
  78.1%; the [exposure
  record](EVOLUTION_RELEASE_RESULTS.md#locomo-exposure-and-the-parity-lane)
  lists every conversation as exposed
  ([record](results/memory-evolution-locomo-sealed-1540-v1.json)).
- [Packing: matched answer comparison](LOCOMO_WINDOW_QA_V1.md), 2026-09-22.
  Failed. Query-aware packing raised evidence recall from 88.93% to 90.08%, but
  answer accuracy on 300 questions was 77.33% against 78.11% ([replay
  records](results/locomo-window-confirmation-v1/README.md)).
- [Conversation order protocol](LOCOMO_ORDER_DEV_V1.md) and
  [result](LOCOMO_ORDER_DEV_RESULT_V1.md), 2026-09-22. Failed. Restoring source
  order scored 73.54% against 74.38% for the same evidence in retrieval order.
- [Answer composition protocol](LOCOMO_COMPOSITION_DEV_V1.md) and
  [result](LOCOMO_COMPOSITION_DEV_RESULT_V1.md), 2026-09-22. Failed. A
  composition instruction on 160 exposed questions scored 74.17% against 75.42%
  on identical context.
- [Semantic completion](semantic-completion-development.md). Failed. Adding
  nearby turns recovered all evidence for ten more development questions but
  scored 83/100 against 84/100 (three wins, four losses); source chronology
  scored 76/90 against 74/90.

### CloneMem

- [Transfer comparison](CLONEMEM_TRANSFER_V1.md), 2026-09-22. Failed. Hybrid
  search against vector retrieval: recall@10 14.39% against 14.13% on 1,007
  questions and choice accuracy 66.89% against 68.67%; 1,800 calls cost
  $1.664274 ([record](results/memory-clonemem-transfer-v1.json)).
- [Keyword queries protocol](CLONEMEM_KEYWORD_DEV_V1.md) and
  [result](CLONEMEM_KEYWORD_DEV_RESULT_V1.md), 2026-09-22. Failed. Dropping
  common words scored 67.35% against 68.95% on 146 questions, although recall@10
  rose from 12.05% to 15.17%.
- [Ranking diagnostics](CLONEMEM_RANKING_DIAGNOSTIC_V1.md), 2026-09-22.
  Rejected. Equal fusion weights raised pooled recall but one persona regressed;
  no model calls.
- [Local reranker protocol](CLONEMEM_RERANK_DEV_V1.md) and [development
  result](CLONEMEM_RERANK_DEV_RESULT_V1.md), 2026-09-22. Passed. 78.77% against
  68.72% on 146 exposed questions, recall@10 from 12.05% to 25.66%, and 23.47%
  smaller contexts ([record](results/memory-clonemem-rerank-dev-v1.json)).
- [Reserved-persona protocol](CLONEMEM_RERANK_CONFIRM_V1.md) and
  [result](CLONEMEM_RERANK_CONFIRM_RESULT_V1.md), 2026-09-23. Passed its
  numerical thresholds. 77.82% against 70.54% on 861 questions from seven
  personas, +7.28 points [+4.61, +10.27]; a retry rule was added after two
  failed attempts ([record](results/memory-clonemem-rerank-confirm-v1.json)).
- [Reserved-persona audit](CLONEMEM_RERANK_CONFIRM_AUDIT_V2.md), 2026-09-23.
  Completed. Reproduced the arithmetic; the worst-case treatment of missing
  responses leaves +6.16 points
  ([record](results/memory-clonemem-rerank-confirm-audit-v2.json)).

### Matched framework pilot

- [Shared source preparation](FRAMEWORK_PILOT_SOURCE_V1.md). Procedure.
  Answer-blind, lossless source units and deterministic context packing, tested
  on synthetic data only.
- [Framework adapters](FRAMEWORK_PILOT_ADAPTERS_V1.md). Procedure. Fresh Oh and
  BM25 retrieval, a Supermemory lifecycle with fixed limits, and common reader
  routes.
- [Offline tokenizer](FRAMEWORK_PILOT_TOKENIZER_V1.md). Procedure. Counts whole
  context strings against pinned OpenAI tokenizer files.
- [Pilot source, evidence, and reader rules](FRAMEWORK_PILOT_EVIDENCE_V1.md).
  Procedure. Fixes the 60-question selection and its prior-exposure record and
  enforces the shared context budget
  ([selection](results/framework-pilot-selection-v1.json)).
- [Reader and judge stages](FRAMEWORK_PILOT_PAID_STAGES_V1.md). Procedure.
  Keeps all 180 cells, shares identical first requests, and releases gold
  references only after reader results close.
- [Pilot result](FRAMEWORK_PILOT_RESULT_V1.md), 2026-09-24. Completed.
  Supermemory 75.00%, Oh 71.67%, and BM25 68.33% on 60 questions; both paired
  intervals include zero ([record](results/memory-framework-pilot-v1.json)).

### SDK retrieval

- [SDK study protocol](SDK_RETRIEVAL_QUALIFICATION_V1.md), 2026-09-23.
  Procedure. Freezes 146 exposed questions and captures local reranker inference
  through the default `Oh.search` path and its `recordDocument` format; a failed
  primary comparison cannot be rescued by the secondary one.
- [SDK study result](SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md), 2026-09-23.
  Passed. 80.59% against 69.86% (+10.73 points), 876/876 cases, both personas
  improving, $1.461086
  ([record](results/memory-sdk-retrieval-qualification-v1.json)).
- [SDK arithmetic audit](audit/sdk-retrieval-qualification-v1/README.md),
  2026-09-23. Completed. A standard-library Python auditor and fixture written
  before outcomes were opened; run
  `python3 audit-sdk-qualification.py --self-test` and
  `python3 test-audit-sdk-qualification.py` in that folder. It notes that a
  literal zero-error-log rule would fail on the Metal startup messages.

### State and projection microbenchmarks

- [State validation](results/state-validation-v2.json), 2026-09-05. Passed. All
  620 generated checks of state, proof sources, and store precedence; the
  [earlier run](results/state-validation.json) and
  [baseline](results/state-baseline.json) are replaced by it.
- [Projection timing](results/projection-after.json), 2026-09-05. Completed.
  Reusing each tuple’s encoded key during projection sorting cut local median
  evaluation time from 27.6 to 20.7 ms, 230.3 to 155.2 ms, and 903.5 to 592.0 ms
  for 16-, 32-, and 48-node chains, one warmup and five timed runs each; result
  digests, including proofs and work-unit counts, match the [before
  report](results/projection-before.json). These are local microbenchmarks, not
  production latency guarantees.

### BEAM and authored cases

- [BEAM scorer tests](EVOLUTION_BEAM_SCORER.md), 2026-09-09. Completed. Nine
  offline test groups matched the pinned BEAM scorer on synthetic cases, with no
  BEAM data opened and no accuracy result
  ([record](results/memory-evolution-beam-scorer-qualification-v1.json)).
- [Compact repair confirmation](COMPACT_REPAIR_CONFIRMATION.md). Failed. A
  Jev-assisted repair on 24 history-disjoint BEAM questions (16 instruction,
  four extraction, four temporal) moved the score from 73.61 to 79.86 (+6.25)
  and instruction following from 79.17 to 88.54 (+9.375, interval 0 to +21.875),
  with two wins and 22 ties
  ([record](results/memory-compact-repair-confirmation-v6.json)).
- [Instruction selection](INSTRUCTION_SELECTION.md). Completed. Jev ordering
  raised annotated-directive hit@8 from 1/24 to 11/24 (shared state) and 14/24
  (independent), but giving the reader every directive did not improve
  instruction following and lowered scores on fact and temporal questions.
- [Answer-program probe](ANSWER_PROGRAM_SPIKE.md). Completed. Separates
  semantic field attribution from exact joins and citation rendering on authored
  recommendation cases, which do not represent retrieval quality
  ([record](results/memory-answer-program-v5.json)).
- [Fresh identity test](FRESH_IDENTITY_RESULTS.md). Completed. A frozen
  identity check on 20 new authored cases removed two false semantic matches and
  kept all 45 supported candidates
  ([record](results/memory-answer-program-identity-v7.json)).

### Other studies

- [Deductive memory](DEDUCTIVE_MEMORY.md). Completed; the fusion candidate is
  experimental. Five benchmark-only primitives, all composed in
  `scripts/benchmarks/deductive-memory.ts`: a Datalog engine with proofs ported
  from ALGAL, consistency rule packs, isotonic and Platt calibration,
  split-conformal selection, and budgeted submodular channel packing. On LoCoMo,
  vector retrieval with windows reached 88.71% evidence-turn recall against
  86.67% for deductive-semantic, +2.04 points [0.78, 3.52] and +2.42 [0.99,
  4.07] on the conversations excluded from tuning, while deductive-semantic kept
  a higher reciprocal rank (0.501 against 0.467). Equal-weight fusion scored
  89.09% against 87.85% in development and 89.33% against 88.93% in
  confirmation, +0.39 [−0.67, +1.11], with seven of eight conversations
  improving. Isotonic recalibration cut held-out ECE from 0.155 to 0.019 on
  frozen captures ([record](results/deductive-fusion-confirm-v1.json)).
- [Curation triage](CURATION_TRIAGE.md). Completed. On two external corpora,
  including 0thernet/algal-bio, inter-model disagreement was the only signal
  that found bad stored claims better than random review on both models (1.88×
  and 2.38×, with intervals above 1.0), and both models reproduced 37 of 37
  false claims from a permuted evidence table with confident citations, so a
  citation shows where a claim came from, not whether its source was right.

### Early studies recorded on this page

Their results are recorded only on this page.

#### Recorded offline results

On 2026-09-05 the retrieval runs used 20 seeds and a 12,000-byte context budget.
These are evidence-recall measurements, not reader accuracy or leaderboard
scores:

| Held-out data | Evidence-labeled questions | Oh keyword | Oh window | BM25 window | Focused BM25 |
| --- | ---: | ---: | ---: | ---: | ---: |
| LoCoMo: eight conversations, 1,586 questions | 1,224 | 61.60% | 78.89% | 78.74% | 64.90% |
| LongMemEval-S: 60-question sample | 51 | 70.65% | 76.37% | 72.45% | 78.66% |

On LoCoMo, Oh window minus BM25 window is 0.15 percentage points with a paired
95% bootstrap interval of −0.05 to +0.46, which does not establish a difference.
On the LongMemEval sample, focused BM25 scored above both window variants, since
neighboring context can displace useful long turns at a fixed budget. The frozen
retrieval algorithms were replayed only to correct citation format handling, a
scoring fix, not a memory improvement. Eight conversations and a 60-question
sample limit how far these numbers generalize. The [LoCoMo
report](results/locomo-heldout-v2.json) and [LongMemEval
report](results/longmemeval-s-heldout-v2.json) give per-category results,
selections, byte costs, and annotation limits.

#### Recorded reader results

The first [direct-key preflight](results/reader-preflight.json) was a blocked
attempt; Vercel project OIDC then enabled reader and judge runs on the public
datasets. Algorithms, prompts, and selections were [frozen before the held-out
run](results/heldout-reader-freeze.json). These are judge-assessed results on
small held-out samples, not full-dataset or leaderboard scores:

| System | LoCoMo: 48 questions, eight conversations | LongMemEval-S: 12 questions |
| --- | ---: | ---: |
| No memory | 9/48 (18.8%) | 5/12 (41.7%) |
| Full history | 29/48 (60.4%) | 8/12 (66.7%) |
| BM25 window | 23/48 (47.9%) | 8/12 (66.7%) |
| Oh window | 25/48 (52.1%) | 8/12 (66.7%) |

On LoCoMo, Oh window minus BM25 window is +4.17 percentage points with a paired
conversation-bootstrap interval of −4.35 to +16.28, which includes zero. The
LongMemEval outcomes are identical in this sample, which does not show
equivalence in the population. Five LongMemEval questions and nine LoCoMo
questions are unanswerable, which matters for the no-memory baseline.

Oh window used 36,982 reader input tokens against full history’s 1,460,995 on
the LongMemEval sample with the same judged score. On LoCoMo it used 142,933
against 1,635,570, and full history scored higher. These are reader-context
trade-offs, not total system savings. Token F1 alone ranked full history below
Oh window on LoCoMo, while the judge ranked it higher.

The anchor-first ablation was not adopted: on the development samples it lowered
Oh’s judged correctness from 9/12 to 8/12 on LongMemEval and from 11/24 to 10/24
on LoCoMo. It is an opt-in experimental adapter, not the default comparison or a
production search change, and its outcomes were not used to tune on held-out
questions.

The [LoCoMo reader](results/locomo-reader-heldout.json), [LoCoMo
judge](results/locomo-judge-heldout.json), [LongMemEval
reader](results/longmemeval-s-reader-heldout.json), and [LongMemEval
judge](results/longmemeval-s-judge-heldout.json) reports give selections,
categories, input tokens, and source identities. The [pilot
audit](results/reader-audit.json) reconciles all 1,341 request reservations with
the ledger: $8.159259 in usage accounting plus $0.016416 held for four
unresolved early requests, or $8.175675 against the $10 cumulative cap, which is
not a provider invoice.

#### Memory representation development results

On 2026-09-06, eight adapters were compared on 60 questions from two LoCoMo
conversations, all with the same GPT-4.1-mini Gateway reader, 512-token answer
limit, 20 retrieval seeds, and 12,000-byte context budget. The [reader
report](results/locomo-memory-strategy-dev-v1.json) and [judge
report](results/locomo-memory-strategy-dev-v1-judge.json) cover every case:

| Memory representation | BM25: correct of 60 | Oh: correct of 60 |
| --- | ---: | ---: |
| Raw-turn window | 27 | 26 |
| Same-session blocks, returning raw turns | 29 | 30 |
| Extracted facts, returning supporting raw turns | 28 | 27 |
| Compact extracted facts | 34 | 33 |

Compact facts had the highest scores under both ranking methods. Oh-fact minus
BM25 window was +10 percentage points with a paired conversation-bootstrap
interval of −3.45 to +22.58, supported by only two conversation clusters. These
development results justified testing the representation on untouched families;
they do not show a general quality gain or an advantage for Oh over the
visible-text BM25 control.

The [development extraction](results/locomo-units-development-v1.json) accepted
906 units, rejected nine candidates, and cost $0.134719 across 63 chunks.
Oh-fact used 128,906 reader input tokens against BM25 window’s 181,550, with
reader costs of $0.053064 and $0.074788; with ingestion, the Oh-fact scenario
cost $0.187783 before judging, so this run did not show lower cold-start cost.
Every extracted-memory arm uses the same cached units, so ingestion is
attributed once to each standalone scenario and once overall for the shared
experiment, and judge calls add evaluation cost.

An [offline replay](results/memory-strategy-context-replay.json) matched all 480
original context hashes and byte counts after index preparation was separated
from query timing. It confirms context stability and adds no answer evidence;
the original development latency fields include lazy index builds.

#### Fresh extraction

On 2026-09-06 the [confirmation
freeze](results/memory-strategy-fresh-freeze.json) selected 12 untouched
LongMemEval-S question families after excluding 57 examined families. Extraction
covered all 826 chunks of their conversation histories without seeing the
questions or gold answers. The [completed
extraction](results/longmemeval-fresh-units-v6.json) accepted 9,096 memory units
and rejected 3,584 candidates in local validation. Completion means every chunk
was processed, not that every durable fact was extracted or that accepted claims
are true.

Five interrupted attempts came first, each recorded as incomplete:
[v1](results/longmemeval-fresh-units-v1.json),
[v2](results/longmemeval-fresh-units-v2.json),
[v3](results/longmemeval-fresh-units-v3.json),
[v4](results/longmemeval-fresh-units-v4.json), and
[v5](results/longmemeval-fresh-units-v5.json). The [output-capacity
amendment](results/memory-strategy-capacity-amendment.json) raised the
extraction output limit from 4,096 to 8,192 tokens after clipping. The [resume
amendment](results/memory-strategy-resume-amendment.json) enabled JSON-object
output, kept verified caches across failures, and raised concurrency to 12. The
[schema amendment](results/memory-strategy-schema-amendment.json) then enforced
the object and array limits at the provider after repeated malformed responses.
All three were recorded before any answers or judge labels were generated for
the selected families, and prompts, chunking, ranking, and questions stayed
fixed.

The final attempt reused 397 verified chunks and completed the other 429 with
strict JSON-schema output, so the cache mixes prompt-only and JSON-mode chunks
with schema-constrained ones and is not a uniform strict-schema reproduction.
All chunks pass the same local source-quote and byte-limit validation when
loaded.

Extraction cost $3.233942 for 831 requests, including five failed requests. The
final attempt added $1.559727, and that smaller increment must not replace the
full ingestion cost in a cold-start comparison. Earlier reports and their linked
resume identities keep the failure and spending history. These runs used the $13
cumulative API ceiling in force at the time.

#### Fresh memory representation results

The frozen six-arm comparison completed all 72 answers and judgments on the 12
selected families. The [reader
report](results/longmemeval-memory-strategy-fresh-v1.json), [judge
report](results/longmemeval-memory-strategy-fresh-v1-judge.json), and
[reconciled audit](results/memory-strategy-audit.json) keep the selections,
source identities, paired outcomes, and costs:

| System | Correct of 12 | Reader input tokens | Reader cost | Cold ingestion plus reader |
| --- | ---: | ---: | ---: | ---: |
| BM25 raw-turn window | 7 | 36,059 | $0.014577 | $0.014577 |
| BM25 blocks | 7 | 35,678 | $0.014586 | $0.014586 |
| Oh blocks | 6 | 35,710 | $0.013600 | $0.013600 |
| BM25 compact facts | 6 | 27,345 | $0.011070 | $3.245012 |
| Oh facts returning source turns | 9 | 31,999 | $0.012955 | $3.246897 |
| Oh compact facts | 9 | 27,363 | $0.011160 | $3.245102 |

Oh compact facts improved two answers and regressed none against the raw BM25
window, an observed +16.67 percentage points with a paired 95% family-bootstrap
interval of 0 to +41.67. Against visible-text BM25 facts there were three wins
and no losses, with an interval of 0 to +50. Both intervals include no
improvement, only 12 families were tested, and LongMemEval families can share
conversation content, so the intervals do not measure uncertainty across
independent histories. Ranking and prompts were not tuned on these answers.

Oh compact facts used 24.1% fewer reader input tokens than the raw BM25 window,
which does not recover the $3.233942 ingestion cost in a one-query-per-family
experiment. Table costs exclude judging and describe separate adoption
scenarios; the experiment paid for the shared extraction once. Only the Oh-block
reader received a cache discount, so its cost does not show a ranking efficiency
gain; its undiscounted estimate was $0.014598. Identical judge prompts shared
verdicts, so the 72-row matrix needed 29 judge calls, which added $0.012361.

The final audit reconciles all 3,072 request reservations across 31 paid runs
and verifies 46 compact summaries against their full-report hashes. Usage
accounting totals $12.232353, plus $0.016416 held for four unresolved early
requests, or $12.248769 against the cumulative $13 ceiling; these totals include
the earlier pilot and development work and are not a provider invoice. An
[offline integration
replay](results/memory-strategy-fresh-integration-replay.json) reproduced the
selection and all 72 reader context hashes and byte counts with no model calls.

These experiments compare memory representations and their downstream answers
with isolated adapters. They add no automatic memory-writing policy to Oh, and
no other open-source memory framework was run.

## Protocol documents

- [Protocol card](PROTOCOL_CARD.md), 2026-09-10: fixed settings, strata, and
  statistics for LongMemEval comparisons.
- [Analysis plan](ANALYSIS_PLAN.md), 2026-09-10: pre-registered paired
  statistics and the five-point minimum gain.
- [Confirmation method](EVOLUTION_CONFIRMATION.md), 2026-09-09: proposed Mem0
  and BEAM confirmation work and the BEAM offline preparation.
- [LongMemEval-S 500 protocol](LONGMEMEVAL_S_500_RESULT_V1.md#protocol): the
  frozen design, [cost](LONGMEMEVAL_S_500_RESULT_V1.md#cost), the [leaked
  example and confirmation
  run](LONGMEMEVAL_S_500_RESULT_V1.md#the-leaked-example-and-the-confirmation-run),
  and [evidence](LONGMEMEVAL_S_500_RESULT_V1.md#evidence).
- [LongMemEval judge profile](profiles/longmemeval-judge-v1.json) and [LoCoMo
  judge profile](profiles/locomo-judge-v1.json): the grading prompts.
- [Source and protocol audit](research.json), 2026-09-05: mechanisms and
  evaluation differences of seven other memory systems.
