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
The [V3 fixed experiments](EVOLUTION_PACKING_V3.md) add focused source spans,
contiguous continuation, source diversity and an untruncated full-history control.
Semantic experiments require the pinned optional QMD backend. An unavailable,
failed or stale backend is an explicit failure. The initial CLI configuration
does not activate that optional backend; qualify it through the adapter before
adding it to the paid CLI protocol.

V1 context plans authenticate semantic and hybrid results against the pinned
semantic preparation identity. Mixed native/semantic plans retain separate
prepared corpora, and each result must match its declared retrieval mode.
Supplying an unused semantic cache leaves native-only plan bytes unchanged.
This qualification does not enable semantic preparation in the V3 CLI builder.

Explicit event/state timelines, entity joins, episodic summaries, bounded second
retrieval, external framework adapters and a reflective GEPA integration remain
separate experiments. The population primitives provide typed lineage and
selection; they do not autonomously dispatch model calls or implement GEPA.

The original `gpt5-nano-reader` uses low reasoning. The separate
`gpt5-nano-medium-reader` and `gpt5-nano-high-reader` profiles change only requested
reasoning effort. They preserve the answer prompt, model/provider routing,
8,192-token output cap and price schedule. They work with retrieval and full
history. Each has a distinct profile and request digest; earlier low-effort
answers remain separate. Reasoning tokens count toward the output limit and
actual measured cost. Availability is documented by
[Vercel](https://vercel.com/ai-gateway/models/gpt-5-nano); this does not establish
live acceptance or an accuracy improvement for either new treatment. Compare
memory variants with the reader fixed and report reader-effort comparisons
separately.

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
directory, shared campaign store directory and explicit concurrency. Run V1–V3
accept 1 through 12; V4 and V5 accept 24 or 32.
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

LongMemEval judge profiles are explicit and keep separate request identities:

| Judge profile | Route and requested model | Messages and output limit | Decision rule |
| --- | --- | --- | --- |
| `gpt4o-official-snapshot-judge` | Direct OpenAI `gpt-4o-2024-08-06` | One user message, 10 tokens | Native `contains yes` |
| `gpt4o-gateway-native-rubric-16-judge-v1` | Gateway `openai/gpt-4o`, OpenAI provider only | One user message, 16 tokens | Native `contains yes` |
| `gpt4o-gateway-native-rubric-judge-v1` | Gateway `openai/gpt-4o`, OpenAI provider only | One user message, 10 tokens | Native `contains yes` |
| `gpt4o-gateway-judge` | Gateway `openai/gpt-4o`, OpenAI provider only | System and user messages, 16 tokens | Strict yes/no |

All native-rubric profiles require the parity-qualified, source-attributed
category prompt file and temperature zero. The native rule deliberately grades
any completed response containing `yes` case-insensitively as correct; other
completed responses score zero. This preserves the released evaluator's rule,
including strings such as `not yes`. Transport, refusal and truncation failures
remain separate failed attempts under the campaign's fixed-denominator policy.

The versioned Gateway native-rubric profile is still an alias. Even a response
reporting the official snapshot does not pin the requested model. Reports state
that limitation explicitly; source prompt parity does not establish live
provider qualification or an official full-set score. LoCoMo semantic judging
remains a separate diagnostic from its official F1.

The `gpt4o-gateway-native-rubric-16-judge-v1` profile adapts only the output limit
from 10 to 16 tokens for Gateway compatibility. It keeps the native prompt and
contains-yes rule, but its cap and alias route prevent an official protocol
reproduction claim. The earlier 10-token profile remains a distinct identity;
its rejected first attempts and full unresolved reservations are preserved.
Changing the limit requires new requests, not a retry or relabeling of those
captures. Qualify any new provider/profile combination with one bounded request
before expanding; stop on a deterministic provider configuration rejection.

Run configuration V1, V2 and V3 may explicitly select either Gateway native-rubric ID; those
versions still describe treatment/context shapes. The model request remains V1
with a new profile digest and request digest. Existing profile IDs, V1/V2 reader
requests, proxy judgments and stored replay identities retain their original
meaning. Never relabel earlier captures or reparse proxy decisions under the new
rule. To regrade completed predictions, use a new configuration/output directory
with an exact copy of the pinned context plan and the original reader plan and
completed receipt. Keep the same canonical campaign store, build a fresh
`judge-plan`, and budget only its missing native-rubric judge requests. The runner
authenticates the original reader evidence before planning and dispatch.

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

In V1 proposal records, `inputs.readerPlan.sha256` and
`lineage.readerPlanSha256` identify the canonical plan payload, not the serialized
plan file. The authenticated reader receipt's `planPin.sha256` separately binds
exact file bytes. Report, configuration and reader-output pins name file-byte
hashes. Preserve this distinction when checking or projecting historical records.

For final comparisons, reproduce strong baselines under declared readers,
context/tool budgets, source order and visibility cutoffs. Publish ingestion
cost, amortization, storage and complete latency alongside accuracy. Treat
LongMemEval variants as related families and LoCoMo questions as clustered within
conversations. Use fresh histories or an untouched benchmark for confirmation.

## Reader answer-contract experiments

Answer contracts can be varied independently of the reader model, reasoning effort
and retrieved context. The closed contract catalog provides a small factorial:

| Contract | Unsupported questions | Answer composition |
| --- | --- | --- |
| `legacy-v1` | Existing literal `None` instruction | Existing instructions |
| `explicit-abstention-v1` | Explicit statement that information is missing | Existing instructions |
| `composition-v1` | Existing literal `None` instruction | Event deduplication, date/state resolution, arithmetic and remembered preferences |
| `explicit-abstention-composition-v1` | Explicit statement that information is missing | Both changes together |

`evolutionReaderProfileId(baseReader, contract)` returns an immutable ID accepted
in the existing configuration's `readers` list. For example,
`evolutionReaderProfileId("gpt5-nano-reader", "explicit-abstention-v1")` returns
`gpt5-nano-explicit-abstention-v1-reader`. The same contracts are available for
each of the six existing reader model/effort choices. Calling the helper with
`legacy-v1` returns the original reader ID.

New profiles record the base reader, contract ID and instruction digest. They
inherit that reader's provider, model, prices, settings and output cap. Full-history
eligibility and financial reservation follow the base reader; tokenizer fit remains
unknown until the provider accepts the input. Existing profile objects, prompts,
request bytes and replay identities remain unchanged. A new contract creates
separate requests and cannot relabel or reuse a different contract's response.

Preparation keeps question, question date and memory bytes fixed and changes only
the system instruction according to the declared contract. Exact reader-plan
validation rebuilds that prompt before paid dispatch and reporting. Gold labels,
benchmark examples and scorer prompts are not inputs to the contract renderer.
The catalog is a generic experimental instruction set with offline validation;
its presence does not establish live provider qualification or improved accuracy.
Compare complete paired questions under the same context and judge, report failures
in the full denominator, and keep development optimization separate from confirmation.

The [completed 1,600-case comparison](EVOLUTION_RESULTS.md#answer-contract-comparison)
records the four contracts with nano and mini under matched BM25 and Oh retrieval,
including fresh legacy controls and native-rubric 16-token grading.

## Opening-message completion experiment

`oh-focused-window-opening` keeps the existing focused native Oh top-K ranking
and its preceding/following turns. For each session occurrence represented in the
retained candidates, it also attempts to include that occurrence's first explicit
`user` message. Conversations with named speakers use their first source turn.
Repeated session IDs remain distinct through their occurrence index.

The opening message and its introducing retained candidate must fit together in
the existing whole-turn UTF-8 context budget. If they do not fit, the candidate
keeps its original admission opportunity and the opening message is omitted.
An admitted opening can displace later candidates; the offline screen records
both recovered and lost annotated turns across the entire development sample.
No source text is synthesized, truncated or labeled using reference answers.
The previous retrieval systems and their request identities remain unchanged.

This opt-in treatment tests whether the beginning of a conversation supplies
facts missed by isolated keyword matches and their immediate neighbors. The
comparison holds top-K, context allowance, reader contract and judge fixed.
Source coverage is a diagnostic, and reader accuracy still requires a paid
comparison. It is not a selected production default or a benchmark victory.

## Protected source completion

Run V5 (`oh.memory.evolution-run.v5`) compares lexical and local semantic
completion while preserving an existing focused-window context byte-for-byte.
Each arm keeps the original context of at most 96,000 UTF-8 bytes and appends at
most 24,000 bytes, including separators. The total cannot exceed 120,000 bytes.
This tests additional retrieval coverage without evicting existing evidence.
It has a separate context V4 wire and remains outside genetic parent selection.

Both arms use the same packing rule. In cached hit order, try the occurrence's
opening user turn, the hit and its immediate neighbors from that same occurrence.
Deduplicate turns already present. Admit each missing bundle only when it fits
in full; otherwise record the omission and try the next hit. All appended text
comes from current source turns with their original dates and speakers.
Repeated session IDs remain distinct when their occurrence indices differ.

Start with a valid development configuration and use these V5 fields:

```json
{
  "protocol": "oh.memory.evolution-run.v5",
  "limit": 100,
  "seed": 17,
  "concurrency": 24,
  "readers": ["gpt5-nano-explicit-abstention-composition-v1-reader"],
  "variants": [
    {
      "id": "oh-focused-prefix-lexical-completion-120k-v1",
      "system": "oh-source-completion",
      "mode": "lexical",
      "prefixBytes": 96000,
      "completionBytes": 24000
    },
    {
      "id": "oh-focused-prefix-semantic-completion-120k-v1",
      "system": "oh-source-completion",
      "mode": "semantic",
      "prefixBytes": 96000,
      "completionBytes": 24000
    }
  ],
  "completionParents": {
    "prefix": {
      "pin": { "path": "/absolute/private/focused-contexts.json", "sha256": "<file-sha256>" },
      "variantId": "oh-focused-window-96k"
    },
    "lexical": {
      "pin": { "path": "/absolute/private/lexical-contexts.json", "sha256": "<file-sha256>" },
      "variantId": "oh-focused-96k"
    },
    "semantic": {
      "pin": { "path": "/absolute/private/semantic-contexts.json", "sha256": "<file-sha256>" },
      "variantId": "oh-semantic-top100-96k-v1"
    }
  }
}
```

Retain the dataset, manifest, campaign, judge and directory fields from the
configuration. Replace each placeholder with the original file's SHA-256 and
select its actual variant ID. The two completion treatment IDs, modes, budgets
and ordering are fixed. V5 admits at most 100 development questions and two
reader profiles; every parent must describe the exact same selected question
set and manifest.

Parents are authenticated original V1 context plans: `oh-focused-window` for
the prefix, `oh-focused` for the lexical pool and `oh-semantic` for the semantic
pool, each with top-K 100 and a 96,000-byte allowance. Semantic parents must
come from the qualified optional backend. A keyword result cannot be relabeled
as semantic. Retained pool omissions remain explicit; these finite cached pools
need not contain every search hit. Parent files must be outside the new output
and campaign-store directories.

Use the existing `prepare`, `readers`, `run-reader`, `judge-plan`, `run-judge`
and `report` commands. Preparation builds no index and makes no provider calls.
Every context reload checks the original parent file pins, selection, source
record digests and deterministic packing. The reader, shared spending ledger,
first-response recovery and judge contracts remain unchanged. Equal final
prompt bytes reuse the same request identity. Keep historical source pins intact
and prepare the new V4 contexts from the reviewed execution source; never rewrite
an old plan to claim the new protocol. Source preservation alone establishes no
answer-quality gain.

## Canonical source-order control

Run V6 (`oh.memory.evolution-run.v6`) prepares context-plan V5 from one pinned
original semantic top-100/96,000-byte result per question. It presents the exact
retained turns in canonical corpus order. LongMemEval's parser supplies a stable
chronological order; equal-date turns retain their source order. Every whole-turn
rendering and separator remains unchanged, so the source multiset and total UTF-8
context bytes equal the parent. This control adds no retrieval, context, headings
or generated facts.

Use these fields in an otherwise complete private run configuration:

```json
{
  "protocol": "oh.memory.evolution-run.v6",
  "limit": 100,
  "seed": 17,
  "concurrency": 24,
  "readers": ["gpt5-nano-explicit-abstention-composition-v1-reader"],
  "judge": "gpt4o-gateway-native-rubric-16-judge-v1",
  "variants": [{
    "id": "oh-semantic-source-order-96k-v1",
    "system": "oh-source-order",
    "budget": { "topK": 100, "contextBytes": 96000 }
  }],
  "sourceOrderParent": {
    "pin": { "path": "/absolute/private/semantic-contexts.json", "sha256": "<file-sha256>" },
    "variantId": "oh-semantic-top100-96k-v1"
  }
}
```

Retain the dataset, manifest, campaign and output-directory fields; remove the
V5-only `completionParents` field. Replace the parent path, digest and variant ID
with the original authenticated V1 semantic artifact. Its manifest, selected
questions and source corpus bytes must match the new run exactly. V6 admits at
most 100 development questions, the single treatment above and the fixed reader
and judge. It remains outside the genetic population domain.

Use the existing `prepare`, `readers`, `run-reader`, `judge-plan`, `run-judge`
and `report` commands. Every reload authenticates the original parent file and
reconstructs the result against current source records. Preparation builds no
index and makes no provider calls. The shared campaign, first-response custody,
reader request and judge contracts remain unchanged. If the parent was already
in corpus order, its exact reader request can be reused. Reordered contexts have
the same byte reservation; their token usage and answer quality must be measured.
Keep historical execution pins intact and generate new contexts from the reviewed
source version. A repeated development comparison does not establish confirmation
or an ordering benefit before its results exist.

## Explicit concurrency experiments

Run configurations V1–V3 and the original paid queue remain limited to one through
12 concurrent requests. Run V4 (`oh.memory.evolution-run.v4`) explicitly selects
24 or 32 concurrent requests. It accepts the existing retrieval treatment types;
the prepared context plan still uses the version required by those treatments.
No existing model profile, request body, request digest or reservation changes.

V4 uses the separate `oh.memory.evolution-paid-queue.v2` entrypoint. The phase
receipt records its protocol and actual configured capacity alongside the exact
configuration pin. Each request still reserves against the same canonical campaign
before dispatch, captures its first response durably, authenticates usage and
retains uncertain charges. An observed thrown execution failure or external stop
halts new starts, and every admitted sibling drains before the receipt is written.
The explicit phase call bound, credential/provider checks, occupied-request guard
and complete failure denominator remain in effect.

The higher capacities are experiments, not evidence of provider rate-limit
headroom or linear speedup. Qualify a fixed small workload at 24 before selecting
32; declare the call and shared financial caps in advance, stop on systematic
provider rejection, and compare measured new-request service time and phase wall
time separately from reused cached work. Do not repeat occupied requests to
manufacture a matched timing sample. Archive the qualification receipt and retain
the capacity in every run configuration.

## Recall systems and the V2 result protocol

Three development systems score the product recall surface documented in
[`spec/v1/recall.md`](../spec/v1/recall.md): `oh-recall` (one semantic query,
dated chronological rendering), `oh-recall-mq` (the question, its focused
term form, and up to four lexical clauses fused by reciprocal rank), and
`oh-recall-mq-dw` (the same plus the frozen relative-date window lane). Every
query keeps the 1 through 100 search limit; the fused pool is cut to `topK`
before rendering under the byte budget. Retrieval mode is semantic, matching
the promoted `oh-semantic` configuration, so `oh-recall` differs from it only
by presentation.

Recall results use `oh.evolution-retrieval.v2`. `turnIds`, `sessionIds`, and
`sources` still describe raw turns, so evidence scoring is unchanged; the
result adds `asOf` (the question instant parsed by
`scripts/benchmarks/evolution-dates.ts`, strict and fail-closed over the
LongMemEval and LoCoMo timestamp grammars, `null` when the dataset supplies no
question date), `renderer`, `queries`, `window`, and an empty `derived` list
reserved for derived records. The source validator dispatches by protocol:
V1 results re-render exactly as before, and V2 results re-render through
`renderOhRecallV1` with the question, its date, and the recall system, so the
re-derived queries, window, and dated bytes must all match. Protocols defined
over V1 whole-turn results (completion, source order, release rebind, fact
cards) refuse a recall result instead of misreading it. `evolution-dates.ts`
is part of the retrieval identity.

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

Successor allowances use the [campaign V2 lineage contract](EVOLUTION_CAMPAIGNS_V2.md).
The [ID selector prototype](EVOLUTION_SELECTOR.md) retains exact source turns in a separate experiment protocol.

### Explicit full-release descriptive scope

[Run V7](EVOLUTION_RELEASE_V7.md) adds a separately pinned full500 LongMemEval study: five exact100-question shards, fixed96KB BM25/Oh semantic pair, combined-contract nano and native16 Gateway judge. It preserves original development and closed/unknown exposure declarations, retains all failures, and combines reportV2 shards into an aggregate-only public projection. Existing runV1–V6 paths remain development-only. This scope does not claim fresh confirmation or official-protocol reproduction.

Both studies have completed; [the results page](EVOLUTION_RELEASE_RESULTS.md)
reports BM25 window 378/500, Oh semantic 379/500 and full history 355/500 with
zero failures, the paired and category breakdowns, cost and the fact-card outcome.

[Run V8's full-context companion](FULL_CONTEXT_COMPANION.md) adds a separately
accounted complete-source control over those same500 IDs with the same reader
and judge. V7 keeps its original two arms. V8 performs no retrieval or QMD
indexing, uses the existing full-history renderer and profile-window accounting,
and combines five parent and five companion shard reports without reclassifying
unknown exposure as fresh evidence. Capacity and spending approval remain
separate from metadata admission.
