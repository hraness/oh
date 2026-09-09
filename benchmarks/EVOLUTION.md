# Memory evolution experiments

The evolution runner prepares source-backed contexts once and reuses them across
reader comparisons. It supports parallel development experiments with explicit
dataset exposure, model identities, shared spending limits, first-response
recovery, and independently replayed scoring.

The completed frozen comparison and reserved reader comparison remain closed.
This runner accepts development selections from a separately declared exposure
manifest. A high development score is not a confirmatory superiority result.

## Experiment sequence

1. Diagnose extraction, retrieval, context packing, temporal/entity, reader and
   grading failures on exposed development examples.
2. Calibrate inexpensive readers across several retrieval controls. Compare
   quality, failure rate, latency, actual usage and stability of variant rankings.
3. Explore source-preserving representations and retrieval policies in parallel.
   Retain measured parents and category specialists, combine compatible modules,
   and test children against their parents with component ablations.
4. Freeze finalists for matched-reader external baselines and an untouched
   confirmation set. Publish official benchmark metrics separately from proxy
   development metrics and from the accuracy–cost–latency comparison.

The adapter includes BM25 window/session controls, Oh keyword search with
separate query-focusing and neighborhood controls, lexical question-facet
packing, and an optional actual Oh semantic/hybrid path.
Semantic experiments require the pinned optional QMD backend. An unavailable,
failed or stale backend is an explicit failure. The initial CLI configuration
does not activate that optional backend; qualify it through the adapter before
adding it to the paid CLI protocol.

Explicit event/state timelines, entity joins, episodic summaries, bounded second
retrieval, external framework adapters and a reflective GEPA integration remain
separate experiments. The population primitives provide typed lineage and
selection; they do not autonomously dispatch model calls or implement GEPA.

## Data and source boundaries

`evolution-dataset.ts` requires an explicit disposition for every family and
optional shared-history identity. It infers neither freshness nor independence.
Shared histories cannot cross partitions. Sealed and closed partitions cannot
be selected by the development runner.

The runner projection copies source turns and current question/date fields and
uses opaque question/corpus identifiers. Answers, evidence labels, task
categories and abstention metadata remain outside retrieval and reader prompts.
Categories may guide evaluation sampling and specialist analysis; a production
router must infer its decisions from allowed question/history inputs.

`evolution-plan.ts` binds each context to its source implementation, manifest,
selection, question and retrieval configuration. Reopening verifies the exact
ordered source rendering and current source digests without rebuilding indexes.
The reader plan reconstructs the complete question × retrieval variant × reader
matrix. Missing cases and request transplants fail validation.

Raw records remain authoritative. Derived representations and indexes must be
rebuildable, retain source traversal and reject stale source identities. Native
Oh digest conflicts are not a natural-language contradiction reasoner.

## Run the development CLI

Use the repository's pinned Bun version:

```sh
bun scripts/benchmarks/evolution.ts --help
```

Each command takes an absolute configuration path and its SHA-256. Configuration
contains the pinned dataset and exposure manifest, selected development limit and
seed, retrieval variants, reader profiles, judge profile, private output
directory, shared campaign store directory and concurrency from 1 through 12.
`parseEvolutionRunConfig` is the authoritative schema. Run/store directories must
be separate. Outputs use new files and cannot overwrite earlier evidence.

| Command | Additional arguments | Behavior |
| --- | --- | --- |
| `prepare` | None | Select development data and write `contexts.json` and preparation timing; no provider calls |
| `readers` | `--context`, `--context-sha256` | Reuse the contexts and write `readers.json` for the configured model matrix |
| `run-reader` | `--plan`, `--plan-sha256`, `--max-usd`, `--max-new-calls`, `--output` | Execute bounded missing reader requests and replay completed requests |
| `judge-plan` | `--reader-plan`, `--reader-plan-sha256`, `--reader-output`, `--reader-output-sha256` | Authenticate reader outputs against captured evidence and create separate gold-bearing judge requests |
| `run-judge` | Same run arguments | Reconstruct and authenticate the complete judge plan before bounded dispatch |
| `report` | Reader/judge plan and output paths, each with a corresponding `-sha256`, plus `--output` | Reparse captured raw responses, reconstruct matrices and emit a compact descriptive report |

For example, after preparing a private configuration:

```sh
bun scripts/benchmarks/evolution.ts prepare \
  --config /absolute/private/run-config.json \
  --config-sha256 <configuration-sha256>
```

The returned context file hash supplies the pin for `readers`. Its returned plan
hash supplies the pin for `run-reader`. Preserve every phase output and use a new
output path when resuming. All reader, planner and judge requests in a campaign
must share its store and spending ledger.
Use `--max-new-calls 0` to reconstruct a phase from its existing store without
admitting any new requests. Missing attempts keep that replay incomplete.

Paid execution requires clean committed source, explicit per-invocation call
limits and a spending limit identical to the pinned campaign descriptor.
Historical ledgers are authenticated and reconciled once per phase without
rebuilding historical extraction or reader studies. A campaign cap is an
additional allowance above the declared historical exposure; it is not a
per-worker or per-phase allowance. The campaign authority binds one canonical
store directory; a configuration cannot create another allowance by selecting a
different directory.

Gateway execution uses `VERCEL_OIDC_TOKEN` injected by the official CLI for the
explicitly selected project, scope and environment. Local claim checks qualify
the expected identity and lifetime; Gateway authenticates the credential.
The optional direct OpenAI judge uses an explicitly supplied benchmark-only
`BENCHMARK_OPENAI_API_KEY`. Its account/key scope is an operator qualification
boundary; the runner cannot infer that scope from a nonempty key. Credentials
never belong in manifests, prompts, committed files or result reports.

## Cost and failure accounting

The initial reader profiles are Qwen 3.7 Flash, GPT-5 nano, Gemini 2.5 Flash-Lite
and GPT-5 mini. They pin provider routing, reasoning settings, output allowance,
context bounds and price tiers. A Gateway alias remains an alias even if its
response reports a snapshot. Availability and memory quality require live
qualification; catalog presence alone establishes neither.

The SQLite campaign store commits a conservative reservation before dispatch.
It preserves bounded first-response bytes and settles only independently parsed
usage. Reasoning is already included in output-token billing. Invalid transport
or unverifiable usage retains the complete reservation. No automatic retry,
provider fallback or best-of-many answer selection occurs.

On reopen, the store replays every occupied row once and caches validated totals.
Subsequent writes use immediate transactions and detect external database
mutation. Duplicate requests cannot dispatch concurrently. A valid captured
response can be finalized after interruption without calling the provider again.
Unknown reservations remain occupied. Known occupied failures do not become
cache misses, and later invocations can advance unrelated missing requests.
After admitted work drains, a phase can include separately authenticated failure
receipts for occupied attempts. These retain their full reservations and score
as failed answers. A reservation without a capture is an unknown dispatch
outcome; it does not prove a provider response occurred. Missing attempts and
global source, authority or custody errors still prevent a complete report.

The store reserves response-storage headroom and bounds aggregate stored data at
4 GiB. One owner holds `active.lock`; stale ownership needs explicit diagnosis.
Do not remove a live lock or resubmit an uncertain request to recover progress.
The queue drains admitted calls before closing the store. A phase records an
incomplete receipt when verification fails and preserves its durable evidence.

## Scoring and reporting

LoCoMo answer F1 follows the pinned official release, including its NLTK Porter
stemming behavior, normalization and category-specific rules. It is separate
from binary judge accuracy and retrieval evidence precision/recall/F1. The
default reader does not emit citations, so answer citation quality is reported
as unmeasured.

The direct LongMemEval judge uses the pinned `gpt-4o-2024-08-06` snapshot, a single
user message, ten output tokens, the source-attributed category prompts and the
native `contains yes` decision rule. Gateway grading uses an unpinned GPT-4o
alias, sixteen output tokens and strict yes/no parsing; reports label that
adapted stack separately. Source prompt parity does not establish live provider
qualification.

Reports authenticate captured raw bytes and occupied-attempt failure receipts,
account for each request once and retain failed answers in denominators. Known
usage and unresolved reservations are reported separately; their sum is a
conservative exposure, not an invoice. Reports distinguish
attributed request cost from incremental spending when a run reuses cached
responses. Paired comparisons vary retrieval with reader fixed, or reader with
retrieval fixed. Group/history counts are declared units, not asserted
independent samples. Development reports make no superiority or confidence claim.

## Propose a population from a pinned report

`scripts/benchmarks/evolution-propose.ts` is an offline handoff command. It
does not execute readers, judges, retrieval, or provider requests. Supply the
absolute report path **and an externally recorded SHA-256**; internal report
references do not make a mutable local report trusted. The supplied authorized
configuration must exactly match the reader phase receipt's `configPin` path and
digest. A new proposal output is created with private mode `0600` and is never
overwritten.

```sh
bun scripts/benchmarks/evolution-propose.ts \
  --report /absolute/run/report.json --report-sha256 <recorded-report-sha256> \
  --reader-plan /absolute/run/readers.json --reader-output /absolute/run/readers-complete.json \
  --config /absolute/authorized-config.json --reader gpt5-nano-reader \
  --parent-limit 2 --child-limit 8 --maximum-population 12 \
  --output /absolute/run/population-proposal.json
```

The utility reconstructs complete reader response-or-failure coverage, retains
only one fixed reader, and uses observed development answer scores. Verified
responses contribute captured usage; occupied failures contribute their full
preserved reservation and score zero. Parent selection is Pareto-based with
optional explicit category specialists. Children are untested deterministic
single-axis mutations or crossovers limited to the declared configuration's
systems, top-K values, and context budgets. A configuration domain cannot be
extended by a proposal; add and qualify a new ablation explicitly before it can
appear as a child.

To evaluate one proposal generation against the next paired development matrix, keep
one fixed reader and make the new configuration's variant IDs equal to the exact
candidate IDs selected as parents plus every proposed child. Each variant must
also reproduce that candidate's system, top-K and context budget. Supply the
prior output and its independently recorded file hash:

```sh
bun scripts/benchmarks/evolution-propose.ts \
  --report /absolute/next/report.json --report-sha256 <next-recorded-report-sha256> \
  --reader-plan /absolute/next/readers.json --reader-output /absolute/next/readers-complete.json \
  --config /absolute/next/authorized-config.json --reader gpt5-nano-reader \
  --parent-limit 2 --child-limit 8 --maximum-population 12 \
  --previous-proposal /absolute/previous/population-proposal.json \
  --previous-proposal-sha256 <previous-recorded-file-sha256> \
  --output /absolute/next/population-proposal.json
```

Continuation retains the pinned policy and candidate archive. It re-measures the
prior selected parents and children on the current complete paired matrix before
selection; it does not compare fitness across report matrices or assign fitness
to unevaluated ancestors or new children. A changed candidate ID, phenotype,
reader, policy bound, previous input/lineage pin, or incomplete paired coverage
rejects the handoff. The previous proposal flags are optional, so the seed-mode
command remains valid for a first generation.

For final comparisons, reproduce strong baselines under declared readers,
context/tool budgets, source order and visibility cutoffs. Publish ingestion
cost, amortization, storage and complete latency alongside accuracy. Treat
LongMemEval variants as related families and LoCoMo questions as clustered within
conversations. Use fresh histories or an untouched benchmark for confirmation.

## Validation and takeover

Focused tests are under `tests/memory-benchmark-evolution-*.test.ts` and run in
the repository's normal aggregate gate. Workers own focused checks; the
integration owner owns the final source gate and paid dispatcher.

The initial scoring port was differentially checked against NLTK 3.9.2 on
64,760 stems, 1,298 normalization inputs and 6,000 complete synthetic LoCoMo
scoring cases, with zero mismatches. LongMemEval prompt/verdict parity covers
60 rendered prompts and 11 decisions against the pinned evaluator. These are
offline protocol checks, not measured model performance.

Each experiment should record its hypothesis, parent IDs, exact source and
configuration, dataset exposure and selection, failed cases, stage timings,
physical cost, result and next action. Keep private raw artifacts outside Git;
commit compact aggregate evidence and maintain the PR description as the
takeover record.

The [initial offline sweep](results/memory-evolution-offline-v1.json) prepared
600 contexts for 100 development questions in 24.8 seconds. At 96 KB, native Oh
keyword retrieval included all labeled evidence sessions on 96 questions, and
BM25 window retrieval did so on 91. These adapters differ in both ranking and
neighbor packing, so the comparison does not isolate a search-engine effect.
The lexical facet variant selected the same source-turn sets as BM25 window on
all 100 questions: 90 contexts were identical and ten reordered existing turns.
Neither result measures answer accuracy.

The [completed reader and packing experiments](EVOLUTION_RESULTS.md) report
paired accuracy, cost and dispatch timings. The [source-excerpt adapter](EVOLUTION_SPANS.md)
uses an explicit V2 context plan to keep original byte offsets and source pools
separate from whole-turn contexts. The [proposed confirmation method](EVOLUTION_CONFIRMATION.md)
describes the remaining external baseline and fresh-history qualification.

References: [LoCoMo evaluator](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/task_eval/evaluation.py),
[LongMemEval evaluator](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py),
[GEPA](https://arxiv.org/abs/2507.19457), [development evidence](DEVELOPMENT.md).
