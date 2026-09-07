# Benchmark memory

Run these commands from the repository root. The checkout includes three separate measurements: typed memory-state
correctness, evidence retrieval from public conversations, and an opt-in
model reader. A retrieval score is not an answer-accuracy score, and passing
state tests does not establish that an agent writes useful memories.

For an installed Claude Code subscription, use the separate [subscription benchmark](CLAUDE_SUBSCRIPTION.md). It keeps its model procedure and checkpoint evidence separate from the paid API experiments below.

Start with the network-free checks:

```sh
bun run test:benchmarks
bun run bench:memory state
bun run bench:memory projection
```

The state benchmark exercises the real working/canonical authority, compares
updates and multi-hop results with an independent replay oracle, and checks
proof provenance, conflicting authorities, canonical pins, idempotency, and
stale-write rejection. Its observations are synthetic typed records, not
LLM-extracted facts. The projection benchmark records repeated wall-clock
measurements and complete result digests; it does not change evaluation bounds.

Fetch a checksum-pinned public dataset explicitly, then measure retrieval:

```sh
bun run bench:memory fetch --dataset longmemeval-s
bun run bench:memory retrieval --dataset longmemeval-s --split dev --limit 24
```

LongMemEval S downloads about 277 MB. `longmemeval-oracle` is a smaller,
evidence-only diagnostic, **not** the S benchmark. `locomo` is also supported;
its download uses `gh` and its data is licensed CC BY-NC 4.0. Review that
noncommercial license for your intended use. The cleaned LongMemEval release
is MIT-licensed. Neither dataset is included in the npm package.

All stores use SQLite `:memory:`. Downloads and reports live in
`.cache/benchmarks/`; no production database, hosted cache, or sync destination
is read or written. Ingestion receives only raw turns, dates, speakers, and
provided image captions. Answers, evidence labels, and supplied summaries stay
outside the memory adapters. Images are not fetched.

The baselines include no memory, recent turns, unbounded full context, raw
SQLite BM25, and Oh's actual keyword API. Focused-query and neighboring-turn
variants are experimental benchmark adapters, not changes to Oh's default
search policy and not implementations of Letta, Mem0, or another competitor.
Retrieval adapters share the same top-K seed count and UTF-8 context-byte
budget; recent context uses the byte budget alone. Full context is explicitly
exempt, and bytes are not reported as tokens. Experimental `oh-anchor-window`
and `bm25-anchor-window` variants reserve room for ranked matches before filling
remaining space with neighboring turns. They do not change production search.
Paired comparisons prefer the matching BM25 variant rather than a smaller
plain-retrieval context.

Reports include source-file hashes, dataset revision and checksum, selected
question IDs, context digests, per-category scores, missing-annotation counts,
latencies, and paired conversation-cluster bootstrap intervals. LoCoMo category
IDs retain the original dataset numbering. Repeated LongMemEval session IDs
receive distinct turn-occurrence IDs without dropping any content; session
recall retains the original labels, and duplicate-session counts are reported.
Evidence protocol `oh.evidence-references.v2` splits unambiguous multi-citation
entries and resolves leading-zero aliases only to existing turn IDs. Reports
retain the raw annotations and normalization audit; ambiguous or genuinely
missing references remain misses. Earlier raw-reference reports are retained
as historical measurements, not silently rewritten.
Development/test splits keep whole conversations or question families together.
Choose an adapter on `--split dev`,
freeze it, and use `--split test` for the final measurement; do not repeatedly
optimize against the held-out answers. A pilot subset is not a full-benchmark run.

For a paid reader comparison, supply a benchmark-only `OPENAI_API_KEY` in the
runner environment, then explicitly authorize both limits:

```sh
bun run bench:memory answer --dataset longmemeval-s --split dev --limit 24 \
  --paid --max-usd 10 --max-calls 96
```

Alternatively, pass an ignored `.env.benchmark` file explicitly with
`bun --env-file=.env.benchmark run bench:memory answer ...`. Direct OpenAI uses
pinned GPT-4.1-family snapshots. Credentials are never included in reports.

An existing Vercel project can instead supply short-lived OIDC authentication
without exporting its secrets to a file. Select your project and team explicitly:

```sh
vercel env run --project YOUR_PROJECT --scope YOUR_TEAM --environment development -- \
  bun run bench:memory answer --provider vercel-gateway \
  --reader openai/gpt-4.1-mini --dataset locomo --split dev --limit 24 \
  --paid --max-usd 10 --max-calls 96
```

The Gateway transport reads only `VERCEL_OIDC_TOKEN`, uses a fixed HTTPS
endpoint, restricts upstream routing to OpenAI, and does not configure remote
keys, environment variables, or deployments. Its explicit `openai/gpt-4.1-mini`
and `openai/gpt-4.1` profiles are family aliases, not verified dated snapshots;
reports distinguish those runs from direct OpenAI. Dated profiles still reject
an alias response unless routing metadata proves the requested snapshot.
Gateway does not advertise a sampling seed, so the runner does not send one.

Every adapter in a run uses the same answer prompt and output-token limit.
Reader profile `oh.benchmark.reader.v2` requests short, complete answers without
restatements or citations, with a default 512-token output bound configurable
through `--answer-tokens`. Empty or clipped completions retain their known cost
and remain failed cases while other questions continue. Transport, identity,
authentication, and spending failures stop the run; nothing is silently retried.

Both transports reserve conservative maximum request cost before dispatch and
share one locked spending ledger across runs in this checkout. Unresolved
requests retain their reservation. Usage-based inference accounting includes
Gateway-reported inference cost when available; it is not a consolidated billing
invoice. Runs rotate system order across the entire question sequence, including
one-question corpora, and report an undiscounted `uncachedReaderCostUsd`
estimate alongside observed cache-adjusted accounting. Provider caches can be
shared across similar requests, so cache-discount differences alone do not
establish an algorithmic efficiency gain. Missing cache details are distinguished
from reported zero cache use. The current cumulative ceiling is $62.248769: the existing $12.248769
exposure plus an explicitly authorized $50 follow-up. The
[budget amendment](results/memory-superiority-budget-amendment.json) binds that
opening exposure to the ledger hash and reserves $5 for answering and judging. Each command still requires its own `--max-usd` and `--max-calls`.
Separate checkouts do not share that ledger. Do not remove it to restart a
pilot budget.

The reader's diagnostic `oh-token-f1.v1` metric is **not** MemEval set-F1,
LoCoMo's native scorer, or an LLM judge. Failed and unattempted requests remain
visible in coverage and lower-bound denominators. LongMemEval hypotheses are
also included for separate native evaluation.

Grade an existing reader report without re-running the memory system:

```sh
vercel env run --project YOUR_PROJECT --scope YOUR_TEAM --environment development -- \
  bun run bench:memory judge --provider vercel-gateway \
  --dataset longmemeval-s --split dev --input RUN.json \
  --paid --max-usd 10 --max-calls 96
```

The judge validates the reader report against the pinned dataset, split, seed,
and complete question/system matrix. Only this separate judging step receives
gold references. LongMemEval uses the [attributed native prompt text](profiles/longmemeval-judge-v1.json);
LoCoMo uses a separately labelled semantic-reference diagnostic. The renderer
was checked against all twelve category/abstention combinations of the pinned
upstream function. Verdicts must be an entire yes/no answer, not a substring.
The Gateway GPT-4o alias and its 16-token minimum differ from the native pinned
judge's 10-token setting; these results are not an exact leaderboard reproduction.
Judging shares the same cumulative spending ledger, and failed or missing
answers remain visible in denominators. LLM judging is fallible, and one
conversation cannot produce a meaningful cluster-bootstrap interval.

Identical rendered judge prompts share one verdict and one charge within a
run. Exact LoCoMo abstentions are checked deterministically, and other
responses use the frozen judge. This prevents identical answers from receiving
different labels merely because different systems produced them.

## Question-blind memory units

A separate ingest-time experiment extracts dated, self-contained facts with
verbatim source quotes. It receives only conversation segments: never benchmark
questions, answers, evidence labels, or answer-location annotations. Each
segment stays within one session occurrence and date, and oversized turns are
split losslessly. Invalid individual claims are counted and rejected. Malformed
or clipped batches stop the run without automatic retries.

Extraction requests strict JSON-schema output and runs three requests concurrently by
default; `--extraction-concurrency` accepts 1 through 12. Resume an interrupted
run with `--resume-units PREVIOUS.json` and a new output path. Verified completed
chunks are reused, including later corpora if an earlier missing chunk fails.
The original ingestion cost remains in the report and shared spending ledger.
The provider schema enforces the existing object shape and array limits; local
validation still checks UTF-8 byte bounds and exact source quotes. Reports retain
the schema hash. Non-frozen legacy experiments may reuse earlier prompt-only
or JSON-mode chunks. With `--selection`, a resume requires the same source and
selection hashes, strict JSON schema, and 8,192-token extraction profile. A
format change is recorded before any held-out answers are generated.

```sh
vercel env run --project YOUR_PROJECT --scope YOUR_TEAM --environment development -- \
  bun run bench:memory extract --provider vercel-gateway --dataset locomo --split dev \
  --paid --max-usd 10 --max-calls 100 --output .cache/benchmarks/units.json
bun run bench:memory retrieval --dataset locomo --split dev \
  --systems bm25-window,oh-block,oh-fact-turns,oh-fact --units .cache/benchmarks/units.json
```

The extraction report binds the dataset, split, seed, source-corpus digest,
extractor prompt, units, and source quotes. Loading it checks those bindings.
Retrieval rejoins each support to its current Oh record digest, excluding stale
claims rather than trusting an old index entry.

- `oh-block` and `bm25-block` index small same-session raw blocks without an LLM,
  then return the original turns.
- `oh-fact-turns` and `bm25-fact-turns` use extracted text only as a search index,
  then return the original supporting turns.
- `oh-fact` and `bm25-fact` return compact extracted text. Their citation coverage
  is not raw-turn recall and is reported separately; reader quality is the
  meaningful comparison.

The visible-text BM25 controls use the same units but index their rendered
text. Oh indexes record keys, kinds, object keys and values as well, including
source digests and session metadata. Both rank with SQLite FTS5 BM25. These
controls therefore compare indexed representations; they do not isolate a
different ranking algorithm. A gain from extraction is evidence for a memory
strategy, with its full ingestion cost included. A valid quote proves attribution, not semantic entailment. Ingest-time
LLM tokens and cost remain visible when cached units are reused.
Offline retrieval prepares each requested representation before timing queries
and reports its shared Oh/BM25 index construction under ingestion. Historical
development reports created before this separation include lazy index construction
in the first query; their query latency is unsuitable for paired comparisons.

The explicit-only `bm25-record-fact` and `bm25-record-window` controls copy the
exact committed search-document text into independent FTS5 indexes. Their query
normalization, BM25 ordering, record-key tie breaking, source validation and
context packing match `oh-fact` and `oh-window`. They never call Oh's keyword
search method. Exact context equality is the expected sanity check, not an
answer-quality win. The original visible-text controls remain unchanged.

The additional control indexes are prepared before offline query timing, only
when requested. Their build costs appear under `ingestion[].unitIndexes.recordIndexes`.
These controls depend on Oh's document preparation; a complete standalone cost
must include that work as well as the independent index build. Their copied
index cost alone is not a competing system's ingestion cost.

Use repeated `--exclude-report PRIOR.json` arguments to exclude entire previously
examined question families before selection. The command records exclusion
report hashes and refuses to fall back to used families when none remain.

Read the [source and protocol audit](research.json) for lessons from
Lemmalog, Letta, PropMem, Graphiti, Mem0, Hindsight, and SimpleMem, including
differences that prevent direct leaderboard comparisons.

Use `bun run bench:memory --help` for all options. `--output` and
`--summary-output` accept new report paths and refuse existing files. Use
`summarize --input RUN.json --output SUMMARY.json` to retain a compact report
with the original source identity and the full report's checksum.

## Recorded offline results

The September 5, 2026 runs use 20 retrieval seeds and a 12,000-byte context
budget. These are **evidence-recall measurements**, not reader accuracy or
leaderboard scores:

| Held-out data | Evidence-labelled questions | Oh keyword | Oh window | BM25 window | Focused BM25 |
| --- | ---: | ---: | ---: | ---: | ---: |
| LoCoMo: 8 conversations, 1,586 questions | 1,224 | 61.60% | 78.89% | 78.74% | 64.90% |
| LongMemEval S: 60-question sample | 51 | 70.65% | 76.37% | 72.45% | 78.66% |

The LoCoMo Oh-window minus BM25-window difference is 0.15 percentage points;
its paired 95% bootstrap interval spans -0.05 to +0.46 points. This does not
establish a win. On the LongMemEval sample, focused BM25 is stronger than either
window variant. Neighbor context can displace useful long turns at a fixed
budget. The frozen retrieval algorithms were replayed only to correct citation
format handling; that scoring correction is not a memory improvement.
Inspect the [LoCoMo report](results/locomo-heldout-v2.json) and
[LongMemEval report](results/longmemeval-s-heldout-v2.json) for
per-category results, exact selections, costs in bytes, and remaining annotation
limitations. Eight conversations and a 60-question sample limit generalization.

The [state validation](results/state-validation-v2.json) passes all
620 generated state, provenance, and authority checks. Separately, reusing
canonical tuple keys during projection sorting reduces local median evaluation
time from 27.6 to 20.7 ms, 230.3 to 155.2 ms, and 903.5 to 592.0 ms for 16-, 32-,
and 48-node chains. Each size has one warmup and five timed runs. Complete
result digests, including proofs and work-unit counts, match the
[before](results/projection-before.json) and
[after](results/projection-after.json) reports. These are local
microbenchmarks, not production latency guarantees.

## Recorded reader results

The initial [direct-key preflight](results/reader-preflight.json)
remains a historical blocked attempt. Vercel project OIDC subsequently enabled
reader and judge runs using only the public datasets. The algorithms, prompts,
and selections were [frozen before the held-out run](results/heldout-reader-freeze.json).

These are **judge-assessed results on small held-out samples**, not full-dataset
or official leaderboard scores:

| System | LoCoMo: 48 questions, 8 conversations | LongMemEval S: 12 questions |
| --- | ---: | ---: |
| No memory | 9/48 (18.8%) | 5/12 (41.7%) |
| Full history | 29/48 (60.4%) | 8/12 (66.7%) |
| BM25 window | 23/48 (47.9%) | 8/12 (66.7%) |
| Oh window | 25/48 (52.1%) | 8/12 (66.7%) |

Oh's LoCoMo difference from BM25 is +4.17 percentage points, with a paired
conversation-bootstrap interval of -4.35 to +16.28 points. That does **not**
establish superiority. LongMemEval's paired outcomes are identical in this
sample, not proven equivalent in the population. Five LongMemEval questions
and nine LoCoMo questions are unanswerable, which matters when interpreting
the no-memory baseline.

Oh-window used 36,982 reader input tokens against full history's 1,460,995 on
the LongMemEval sample, with the same judged score. On LoCoMo it used 142,933
against 1,635,570, but full history scored higher. These are reader-context
trade-offs, not total-system cost savings. Token F1 alone ranked full history
below Oh on LoCoMo even though the semantic judge ranked it higher.

The anchor-first ablation was **not promoted**: on the development samples it
reduced Oh's judged correctness from 9/12 to 8/12 on LongMemEval and from 11/24
to 10/24 on LoCoMo. It remains an explicit experimental adapter, not the default
reader comparison or a production search change. Those outcomes were not used
to tune on the held-out questions.

Inspect the [LoCoMo reader](results/locomo-reader-heldout.json),
[LoCoMo judge](results/locomo-judge-heldout.json),
[LongMemEval reader](results/longmemeval-s-reader-heldout.json), and
[LongMemEval judge](results/longmemeval-s-judge-heldout.json) reports
for selections, category results, input tokens, and source identities.
The [pilot audit](results/reader-audit.json) reconciles all 1,341
request reservations with the ledger: $8.159259 in usage-based accounting plus
$0.016416 retained for four unresolved early requests, or $8.175675 against the
$10 cumulative cap. This is not a consolidated provider invoice.

## Memory representation development results

The September 6 development experiment compared eight adapters on 60 questions
from two LoCoMo conversations. All used the same GPT-4.1-mini Gateway reader,
512-token answer limit, 20 retrieval seeds, and 12,000-byte context budget.
The [reader report](results/locomo-memory-strategy-dev-v1.json) and
[semantic-judge report](results/locomo-memory-strategy-dev-v1-judge.json)
record complete coverage:

| Memory representation | BM25: correct out of 60 | Oh: correct out of 60 |
| --- | ---: | ---: |
| Raw-turn window | 27 | 26 |
| Same-session blocks, returning raw turns | 29 | 30 |
| Extracted facts, returning supporting raw turns | 28 | 27 |
| Compact extracted facts | 34 | 33 |

Compact facts had the highest observed scores under both ranking methods.
Oh-fact's difference from BM25-window was +10 percentage points, with a paired
conversation-bootstrap interval of -3.45 to +22.58 points. Only two conversation
clusters support that interval. These development results justified testing
the representation on untouched families; they do not establish a general
quality improvement or an advantage of Oh over the visible-text BM25 control.

The [development extraction](results/locomo-units-development-v1.json) accepted
906 units, rejected nine individual candidates, and cost $0.134719 across 63
chunks. Oh-fact used 128,906 reader input tokens versus BM25-window's 181,550,
with reader costs of $0.053064 and $0.074788. Including ingestion, the Oh-fact
scenario cost $0.187783 before judging, so this run did not demonstrate lower
cold-start inference cost. Each extracted-memory arm uses the same cached
units: attribute ingestion once to each standalone scenario, and once overall
when accounting for the shared experiment. Judge calls add evaluation cost.

An [offline replay](results/memory-strategy-context-replay.json) subsequently
matched all 480 original context hashes and byte counts after index preparation
was separated from query timing and current runtime changes were integrated.
That replay validates context stability; it supplies no new model-answer
evidence. The original development latency fields include lazy index builds.

## Fresh extraction provenance

The [confirmation freeze](results/memory-strategy-fresh-freeze.json) selected
12 untouched LongMemEval S question families after excluding 57 previously
examined families. Extraction covered all 826 chunks of their complete
conversation histories without receiving the questions or gold answers.
The [completed extraction](results/longmemeval-fresh-units-v6.json) accepted
9,096 memory units and rejected 3,584 individual candidates during local
validation. Completion means every chunk was processed; it does not mean that
every durable fact was extracted or that accepted claims are semantically true.

Five interrupted attempts preceded completion. The
[output-capacity amendment](results/memory-strategy-capacity-amendment.json)
raised the extraction output bound from 4,096 to 8,192 tokens after clipping.
The [resume amendment](results/memory-strategy-resume-amendment.json) enabled
JSON-object output, preserved verified caches across failures, and raised
concurrency to 12. The
[schema amendment](results/memory-strategy-schema-amendment.json) then enforced
the existing object and array limits at the provider after repeated malformed
envelopes. These changes were recorded before any answers or judge labels were
generated for the selected families; prompts, chunking, retrieval ranking, and
the selected questions stayed fixed.

The final attempt reused 397 verified chunks and completed the remaining 429
with strict JSON-schema output. The resulting cache therefore mixes earlier
prompt-only and JSON-mode chunks with schema-constrained chunks. It is not a
homogeneous strict-schema extraction reproduction. All chunks pass the same
local source-quote and byte-limit validation when loaded.

Total extraction accounting is $3.233942 for 831 requests, including the five
failed requests. The final attempt added $1.559727; its smaller incremental cost
must not replace the full ingestion cost in a cold-start comparison. Earlier
reports and their linked resume identities retain the failure and spending
history. These runs used the then-current $13 cumulative API ceiling.

## Fresh memory representation results

The frozen six-arm comparison completed all 72 answers and judgments on the
12 selected LongMemEval S families. The [reader report](results/longmemeval-memory-strategy-fresh-v1.json),
[judge report](results/longmemeval-memory-strategy-fresh-v1-judge.json), and
[reconciled audit](results/memory-strategy-audit.json) retain the selections,
source identities, paired outcomes, and costs:

| System | Correct out of 12 | Reader input tokens | Reader cost | Cold ingestion plus reader |
| --- | ---: | ---: | ---: | ---: |
| BM25 raw-turn window | 7 | 36,059 | $0.014577 | $0.014577 |
| BM25 blocks | 7 | 35,678 | $0.014586 | $0.014586 |
| Oh blocks | 6 | 35,710 | $0.013600 | $0.013600 |
| BM25 compact facts | 6 | 27,345 | $0.011070 | $3.245012 |
| Oh facts returning source turns | 9 | 31,999 | $0.012955 | $3.246897 |
| Oh compact facts | 9 | 27,363 | $0.011160 | $3.245102 |

Oh compact facts improved two answers and regressed none relative to the raw
BM25 window, for an observed +16.67 percentage points. The paired 95%
family-bootstrap interval is 0 to +41.67 points. Against visible-text BM25 facts,
there were three wins and no losses, with an interval of 0 to +50 points.
These intervals include no improvement and only 12 nominal families were
tested. LongMemEval families can share conversation content, so those
family-bootstrap intervals do not establish independent-history uncertainty. This is a promising sample result, not established superiority or an
official leaderboard score. Neither ranking nor prompts were tuned on these
answers.

Compact Oh facts used 24.1% fewer reader input tokens than the raw BM25 window.
That reduction does not recover the $3.233942 ingestion cost in this one-query-
per-family experiment. Table costs exclude judging and describe separate
adoption scenarios; the experiment paid for the shared extraction only once.
Only the Oh-block reader received a cache discount, so its observed cost does
not establish a ranking-efficiency gain. Its undiscounted reader estimate was
$0.014598. Identical judge prompts shared verdicts, requiring 29 model calls
for the 72-row matrix; grading added $0.012361.

The final audit reconciles all 3,072 request reservations across 31 paid runs
and verifies 46 compact summaries against their full-report hashes. Total
usage accounting is $12.232353, plus $0.016416 retained for four unresolved
early requests, or $12.248769 against the cumulative $13 ceiling. Those totals
include the earlier pilot and development work; they are not a provider invoice.

After integrating the final CLI and public-release updates from main, an
[offline integration replay](results/memory-strategy-fresh-integration-replay.json)
reproduced the exact selection and all 72 reader context hashes and byte counts.
It made no model calls and does not add new answer-quality evidence.

These experiments measure memory representations and downstream answers with
isolated adapters. They do not add an automatic memory-writing policy to Oh.
Real-agent writing, updating, and successful task resumption remain unmeasured,
and no competing OSS implementation was run to establish superiority.

## Frozen finite-pool confirmation

The follow-up uses a saved simple random sample of one fixed representative
per LongMemEval S family. The representative is the smallest question ID in
code-unit order. This normally selects the base question when an abstention
variant also exists; results describe that representative pool, not the
dataset's full mixture of questions.

Create the sample once, before examining outcomes. Repeat the same
`--exclude-report` arguments when creating and replaying it:

```sh
bun run bench:memory select --dataset longmemeval-s --split test --seed 17 \
  --limit 120 --output .cache/benchmarks/selection.json \
  --exclude-report benchmarks/results/longmemeval-memory-strategy-fresh-v1.json
bun run bench:memory retrieval --dataset longmemeval-s --split test --seed 17 \
  --selection .cache/benchmarks/selection.json --systems bm25-window,bm25-record-window \
  --exclude-report benchmarks/results/longmemeval-memory-strategy-fresh-v1.json
```

This example shows the mechanism; a confirmatory run must exclude every
previously inspected family, using all applicable reports. `select` uses
`crypto.randomInt` with a partial Fisher–Yates shuffle. The saved IDs, pool
mapping, method, representative policy, source checksum, split seed and
exclusion hashes are the replay authority. `--selection` works with extraction,
retrieval and answering, and cannot be combined with `--limit`. Replaying a
changed pool or mismatched exclusion set fails rather than drawing replacements.

The [finite-pool analysis](finite-population.md) uses conservative one-sided
bounds with exact arithmetic. The fixed three-arm decision in
`scripts/benchmarks/superiority.ts` requires a complete judgment matrix,
positive simultaneous lower bounds against both raw-window controls, and at
least five percentage points of observed improvement over each. A failure to
meet that rule is reported as no established improvement on this run.


The [saved 120-family selection](results/longmemeval-superiority-selection-v1.json)
and [public protocol](results/memory-superiority-freeze-v2.json) define this
follow-up. The original v1 draft is retained; v2 superseded it before paid
extraction began. Seed 17 fixes the split. Sampling uses cryptographic
randomness; the saved draw order and rotating system order fix execution
order. Gateway model sampling remains unseeded.

Verify the full artifacts before interpreting judgments:

```sh
bun scripts/benchmarks/confirm.ts \
  FULL_FREEZE.json \
  benchmarks/results/longmemeval-superiority-selection-v1.json \
  UNITS.json ANSWERS.json JUDGE.json NEW_RESULT.json
```

The public protocol omits only the deployment identifier and records the hash
of the unchanged full protocol. Use that retained full protocol with the
completed full extraction, answer and judge reports, not their compact
summaries. The scorer binds their bytes, source identity, selection, prompts,
models and budgets to the frozen protocol. It rejects mismatched artifacts and
cannot certify an incomplete matrix. Run it from the frozen source tree.
