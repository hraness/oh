# CloneMem transfer comparison

Completed on 2026-09-22. This comparison did **not establish an improvement**
from hybrid search. The protocol below was fixed before retrieval scores and
reader outcomes. The [result artifact](results/memory-clonemem-transfer-v1.json)
contains the complete aggregates, confidence intervals and provenance.

| Measure | Oh hybrid | Vector | Paired difference (95% interval) |
| --- | ---: | ---: | ---: |
| Evidence Recall@10, 1,007 questions | 14.39% | 14.13% | +0.26 points (−2.59 to +2.68) |
| Choice accuracy, 300 questions × 3 attempts | 66.89% | 68.67% | −1.78 points (−6.17 to +2.88) |

Intervals resample the nine personas. Neither endpoint established a gain;
the frozen combined improvement criterion was not met. This result does not
support a claim that hybrid search improves CloneMem answers or outperforms
another memory framework.

All 1,800 reader calls completed, with no missing, failed or truncated
responses, for **$1.664274** in captured provider usage. Both arms used the
`openai/gpt-4o-mini` Gateway alias; the responses did not identify an immutable
model snapshot. Mean context sizes were 21,780 bytes for hybrid and 26,586
bytes for vector retrieval under the native top-ten whole-document rule.

On an Apple M5 Max with 36 GiB memory, hybrid retrieval averaged 30.51 ms
(48.93 ms p95). Its shared top-30 semantic call averaged 20.73 ms; this is not
an independently timed vector top-ten search. Incremental ingestion and
indexing took 380.30 seconds. Measurements used source checkpoint
`6ffca340365792b71e09ce523a694b67675bc335`; offline replay reproduced all
1,007 rankings and contexts without a model or network access.

Evaluation and analysis were produced by coding agents, with independent
agent checks of the native response ledger, scores and intervals. These are
automated benchmark measurements, not human answer-quality judgments.

This study measures the shipped Oh hybrid search against vector retrieval on
personal histories containing diaries, email and social posts. Both methods
search identical original documents with the same local embedding model.
Multiple-choice answering then measures whether the retrieved evidence helps
the same reader choose the correct answer.

## Source and exposure

The [source pin](profiles/clonemem-source-v1.json) fixes the English release of
[CloneMem](https://github.com/AvatarMemory/CloneMemBench) at commit
`753d8a97fd78f4ee25af398a0f0c8d981a6be304`, including every file's byte count
and SHA-256. The repository licenses the release under Apache-2.0.

The actual release contains 1,187 questions across ten personas. The schema
README includes an illustrative question and answer from one persona. That
entire persona is excluded before measuring performance, leaving **nine
personas and 1,007 questions** in the primary comparison. English and Chinese
translations are never split across groups; only English is used here. A
bounded search found no prior CloneMem use in this repository. This describes
project exposure, not a guarantee about a model's training data.

The adapter follows the released files: questions live in `qa_items`, and
evidence groups use `digital_trace_ids`. The released scoring function calls
the latter `related_media_id`; the normalization preserves the complete set of
references. Ingestion and retrieval receive only document fields and the query.
Answer keys and evidence labels are projected into a separate scorer artifact.
Reader options are supplied only after retrieval, never used as retrieval cues.

## Frozen retrieval methods

- **Oh hybrid:** the shipped `Oh.search` implementation, limit 10. Its current
  weighted reciprocal-rank fusion combines lexical weight 2 and semantic
  weight 1 with constant 60. Its candidate requests remain unchanged.
- **Vector:** the first ten document hits from the exact semantic request
  made by that hybrid search. Both arms therefore share one model execution
  and the same source identities, rather than separately recomputed rankings.
- **Keyword diagnostic:** the shipped keyword-only search, limit 10. This is
  a declared secondary retrieval result, not a substitute primary control.

Each digital trace becomes one Oh record, eligible only when its `event_date`
is at or before the current question's `question_time`, matching the upstream
chronological ingestion loop. Both lexical and semantic candidate sets obey
that cutoff before ranking or limiting results. Filtering a full-history
top-30 result afterward is insufficient and is not admitted. Queries run in
timestamp order so the store and semantic index can add eligible records
without revealing future documents to earlier questions. Date parsing and
source eligibility receive separate regression checks.

The release mixes naive ISO timestamps with six `Z`-suffixed question
timestamps. The adapter interprets both as UTC and validates calendar fields;
this normalization is explicit because the upstream Python comparison of
naive and aware datetimes would otherwise fail on the mixed cases. Three
questions reference at least one document dated after the question. Their
original labels and full denominators remain intact; future documents stay
ineligible. No gold-corrected score is produced. If fewer than ten documents
are available, the ranking contains the available documents only.

Internal QMD chunking remains its
shipped behavior; rankings and returned memory are joined back to whole trace
identities and current record digests. Model bytes, runtime, profile, source
records and captured rankings are pinned. An unknown or stale result stops
admission. There is no new query decomposition, classifier, extraction model,
graph fact generation, or fitting on CloneMem outcomes.

The earlier LoCoMo packing experiment concerns conversation neighbors. Its
development result does not select a document-neighborhood policy here.
CloneMem documents retain their own task definition.

Native flat **Recall@10** is the fraction of unique reference trace IDs found
in the first ten ranked trace IDs, averaged over questions with references.
References come from the union of the evidence groups, not the separate
question-level trace list. The nine pinned personas have no unknown evidence
references. Every query's two primary rankings are fixed before scoring.

## Paired multiple-choice answers

The first planned draw contains **300 questions**, selected without labels by
a seed-17 SHA-256 ordering within persona and round-robin allocation across
personas. A persona's available questions may be exhausted. The reader draw
is fixed before retrieval performance is inspected. The first 100 questions
of that same ordering are the only permitted smaller draw, selected solely
if the complete 300-question reservation cannot fit the spending limit.
The selected size and full identity digest are frozen before the first call.

Both arms use the upstream sequential top-ten whole-trace renderer and
multiple-choice prompt. Whole documents are not cut to a byte budget or
replaced by conversation windows. Context sizes are reported. A context that
exceeds the adapter or model's declared bounds is a preflight failure; the
operator cannot silently remove a question, truncate a document, or choose a
different sample after seeing a result.

The reader is the `openai/gpt-4o-mini` Gateway alias at temperature 0.1, the
upstream default model family and choice temperature. A dedicated profile
caps output at 512 tokens and accepts the native single user message. This
finite output bound and Gateway alias are stated protocol qualifications;
they are not a verified model snapshot or a replication of an unpublished
provider configuration. All arms receive identical model settings and prompts.

Pricing was checked on 2026-09-22 against the
[provider](https://developers.openai.com/api/docs/models/gpt-4o-mini) and
[Gateway](https://vercel.com/ai-gateway/models/gpt-4o-mini) model pages:
$0.15 per million input tokens, $0.075 per million cached input tokens, and
$0.60 per million output tokens. Reservations assume uncached input; settlement
uses captured provider usage. These prices do not identify an immutable model.

There are three separately indexed first attempts per question and arm.
Byte-identical physical requests in the same repeat may share one response;
the report records that reuse and all logical cells. Exactly unchanged
requests across different repeats still require distinct indexed attempts.
Predictions are compared by trimming whitespace and uppercasing the complete
response, as in the native choice scorer. An explanation instead of an option
ID is incorrect. Missing, truncated or failed responses count as zero in the
fixed denominator, rather than being skipped as in the upstream aggregator.

The primary answer statistic is each question's mean correctness over three
repeats, averaged over all selected questions. Individual repeat scores and
their range, wins/losses/ties and per-persona aggregates are reported. The
retrospective majority score is diagnostic and is never substituted for the
primary statistic. No paid judge is required for this task.

## Accounting and execution

The user authorized **$25 total** for this improvement program's new paid
reader and judge work, including unresolved or failed-call reservations.
The initial comparison has a maximum **$20 campaign exposure**, with $5
unallocated. A complete conservative reservation plan must fit before launch;
smaller actual invoices do not retroactively authorize a larger matrix.
Earlier campaigns and their limits remain separate and unchanged.

One native campaign ledger owns all new physical jobs. Source, scorer,
prompt, request plan, profile, code checkpoint, authority and campaign receive
content pins after focused tests and independent review. Only the selected
development project's existing OIDC authority may authenticate dispatch.
The first two selected questions, across both arms and all three repeats,
form a structural canary included in the final matrix. Its gate checks
completion, identity, bounds and accounting, never answer correctness.

There are no automatic retries. An unresolved transport or occupied request
halts new admissions while owned in-flight calls drain. Captured results are
reconciled before continuation; an uncertain request is not sent again.
At most eight explicit local attempts may resume the same pinned launch.
Each preserves immutable receipts and reuses authenticated first responses;
only requests that were never reserved may be newly dispatched. An occupied
unknown response blocks continuation. Interrupts close admission and drain
owned calls before the native ledger is released.
No failed run or repeat may be dropped, replaced or added after outcomes are
seen. Scorer data is not loaded by the reader dispatcher.

## Decision and public claims

This is a frozen transfer comparison of two retrieval methods, not a search
for the best CloneMem configuration. No weights, query transformations,
reader prompts or sample membership change after transfer scores are read.

Recall and multiple-choice correctness are co-primary endpoints. Report paired
persona-cluster bootstrap intervals with 10,000 resamples and seed 17. A
combined quality-improvement claim requires both lower 95% interval bounds
above zero and an observed answer-accuracy gain of at least **five percentage
points**. An isolated endpoint result is reported by name with its uncertainty,
not promoted into a general memory-quality or answer-quality claim. Nine
personas give limited precision even with many questions.
Answer intervals resample integer correct counts before dividing by three.
Interval values within `1e-12` of zero are normalized to zero to prevent
floating-point cancellation from qualifying an exactly zero bound. The
five-point threshold is tested with integer correct counts.

Public answer scoring requires the complete frozen matrix, with zero
unattempted or unresolved requests. Authenticated failed or truncated responses
remain in that complete matrix and score zero.

Record actual hybrid wall time, its shared semantic service time, keyword
time and indexing time separately. A shared top-30 semantic call is not an
independent measurement of top-ten vector latency. Replay overhead is not
model latency. Every published result includes context size, model identity,
failure counts, physical calls and accounted cost.

README and site copy may report exact supported results and link their
artifacts. Neither provider-reported scores under different settings nor this
two-method comparison establishes superiority over another memory framework.
A framework comparison requires running its pinned implementation with the
same sources, reader, scoring and resource accounting.
