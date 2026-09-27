# Oh-next memory configuration

Written 2026-09-26 before any code in this branch. The goal is to move the
parts of the in-sample LongMemEval-S pipeline (93.07% mean over three runs,
[result](../benchmarks/LONGMEMEVAL_S_500_RESULT_V1.md)) that do not depend on
the benchmark into an opt-in Oh configuration, measure how much of the gain
survives on the exposed development split, and prepare one sealed confirmation
that nothing in the program has scored.

## Outcome

- An opt-in recall rendering, `oh.recall-render.author-log.v1`, that composes
  the complete log of one author's messages with fused retrieval of every
  other record, inside byte budgets, with deterministic date annotations.
- An opt-in decline re-read helper: a label-free decline detector and a
  whole-session view for a second reading.
- A development comparison on LME-S dev100 against Oh semantic and the
  pipeline's first pass, with the package code building every context.
- A proposed sealed holdout with a cost estimate. It is not opened or scored
  in this branch.

## What generalizes

Each mechanism of the pipeline is classified by whether it depends on the
LongMemEval question set, its labels, or its wording.

| Mechanism | Class | Reason |
| --- | --- | --- |
| Complete log of the user's own messages, verbatim, chronological, grouped by session | Keep | Uses only speaker and time. Any assistant history has an author whose statements carry most facts; 425 of 500 LME-S questions have all evidence in user messages, and the same holds for personal-assistant memory generally. |
| Byte budget on the log with a fallback to retrieval-ranked author messages when it overflows | Keep, new | The lab never overflowed (max 131 KB). Real histories and LongMemEval-M/BEAM-1M will, so the fallback must degrade to fused retrieval rather than truncate by position. |
| Keyword and semantic top-100 lists fused by reciprocal rank (k = 60) | Keep | Already Oh recall's fusion rule; nothing dataset-specific. |
| Retrieved part excludes the author's records and names the author message each reply answers | Keep | Avoids duplicating the log; the link is structural (previous author record in the same session). |
| Session headers with the date and distance from the question date | Keep | Already in `oh.recall-render.v1`. |
| Deterministic relative-date annotations per message | Keep, with the frozen V1 grammar | General rule-based resolution. The lab grammar is broader (vague counts such as "a few", "for 3 months now", "last night", "over the weekend"); widening needs a new grammar version and evidence, so the package reuses `oh.recall-date-grammar.v1` unchanged. |
| Note when every session shares one timestamp | Keep | Bulk imports produce exactly this; the reader must then order by stated dates. |
| Answer-format, calibration and "V2" reader paragraphs | Drop | Their examples paraphrase dev questions; the "$270" example was a gold answer. The package ships only a neutral description of the memory layout. |
| Advice re-read (question regex) | Drop | A detector for the single-session-preference type (selects exactly those 30 questions). |
| Assistant-recall re-read (question regex) | Drop | A detector for the single-session-assistant type (55 of 56). |
| Decline re-read with a whole-session view | Needs evidence | Triggered only by the reader's own decline text, so it is label-free. The decline regex is English phrasing; the session choice uses question dates, lexical overlap and fused rank. The lab's US holiday table is dropped as locale-specific. |
| Retrieval-rank marks inside the log, counting re-read, arbiter, model-built ledgers, extracted notes, state re-reads | Drop | Each was tried and lost or tied on dev in the lab. |

## Design

### Author log rendering

`renderOhAuthorLogV1(input, options)` in `src/author-log.ts` is pure and
synchronous.

- Input: `records` (the history, at most 65,536), `ranked` (retrieval order,
  typically `recallOhV1` results), and an `asOf` question instant.
- View: `OhAuthorLogViewV1` returns `{ instant, order, session, speaker,
  text }`. The default view reads `value.observedAt` (or `value.date`),
  `value.sessionId`, `value.sessionIndex` or `value.turnIndex`,
  `value.speaker` or `value.role`, and `value.text`; a record is authored when
  its speaker equals the configured author (default `"user"`). The existing
  `OhRecallRecordViewV1` contract is unchanged.
- Budgets: `budgetBytes` (default 180,000), `retrievedBytes` (default 96,000),
  `logReserveBytes` (default 24,000, kept for retrieval when the log
  overflows). All bounded by the recall maximum of 4,000,000.
- Log: if every authored record fits in `budgetBytes - logReserveBytes`, the
  log is complete (`log.mode: "complete"`). Otherwise authored records are
  admitted in retrieval order, then by recency, until the log budget is full,
  rendered chronologically, and the header says the log is partial with the
  counts (`log.mode: "ranked"`).
- Dates: each authored message with relative expressions gets a
  `Resolved dates` line computed by `resolveRelativeDatesV1(text, anchor)`,
  a new function over the frozen V1 grammar that returns every admitted match
  anchored on the message's own instant (the existing single-window function
  is unchanged).
- Retrieved part: non-authored records in `ranked` order under
  `retrievedBytes` and the remaining total budget, each line naming its date
  and the author message it follows.
- Output: `{ renderer, text, bytes, keys, log: { mode, included, total },
  retrieved: { included, omitted }, sharedTimestamp, v: 1 }`.
- `OH_AUTHOR_LOG_READER_NOTE_V1` is a neutral paragraph that describes this
  layout for a reader prompt. It contains no examples.

### Decline re-read

- `isOhDeclineAnswerV1(answer)`: the lab's decline pattern, unchanged.
- `renderOhSessionZoomV1(input, options)`: whole sessions, chronological,
  default 100,000 bytes, each message capped at 12,000 characters. Sessions are
  chosen from up to four sessions within three days of a single resolved
  question window (`resolveRelativeDateWindowV1`), then the three sessions
  with the most question content words scaled by 1/sqrt(messages + 1), then
  sessions in fused-rank order.
- `OH_SESSION_ZOOM_READER_NOTE_V1`: a neutral layout description.
- The application calls the reader once; when the answer declines, it renders
  the zoom view and reads once more. The package makes no model calls.

### SDK and CLI

- `Oh.authorLog(question, { asOf, author, budgetBytes, retrievedBytes, limit,
  mode })` runs `recallOhV1` with the question as the single query (limit 100,
  hybrid when a semantic backend exists), scans the current records, and
  returns the rendering.
- `oh recall QUERY --as-of T --author-log NAME` prints the same rendering in
  place of the V1 rendering. (The CLI parser takes only valued options, so the
  author name is the flag's value.)
- Specs: `spec/v1/recall.md` gains an author-log section; no contract entry
  and no grammar change.

## Development evaluation

All runs use LME-S dev100 (seed 17), exposed data only, GPT-5 mini reader,
the GPT-4o native-rubric judge alias, three repeats, first attempt only, and
the lab ledger. Retrieval reuses the cached keyword and EmbeddingGemma
top-lists that built the first pass, so the comparison isolates composition
and reader guidance. The package code builds every new context.

| Run | Context | Reader instruction | Estimated cost |
| --- | --- | --- | --- |
| `dev100-ohnext-v1` | author log | base contract + `OH_AUTHOR_LOG_READER_NOTE_V1` | about $3 |
| `dev100-ohnext-tuned-v1` | author log | the first pass's tuned contract (`eac-userlog-v2n`) | about $3 |
| `dev100-ohnext-decline-v1` | re-read of declined cells of `dev100-ohnext-v1` | base contract + `OH_SESSION_ZOOM_READER_NOTE_V1` | under $1 |

Comparisons: `dev100-semantic-eac-v1` (Oh semantic), `dev100-confirm-v1-s1`
(first pass) and `dev100-confirm-v1-recall` (full pipeline). Dev100 saturates
near 94 to 95 questions correct in two or three runs, so a difference of about
three questions is noise. The second run separates the effect of the
composition from the effect of the tuned prompt.

### Results (2026-09-27)

Correct answers per repeat out of 100, GPT-4o rubric judge. Costs are from
`ledger.jsonl` (reader plus judge).

| Run | Repeats | Mean | Cost |
| --- | --- | --- | --- |
| `dev100-semantic-eac-v1` (Oh semantic) | 90, 89, 91 | 90.0 | earlier |
| `dev100-confirm-v1-s1` (first pass, tuned prompt) | 91, 93, 92 | 92.0 | earlier |
| `dev100-confirm-v1-recall` (full pipeline) | 94, 95, 94 | 94.3 | earlier |
| `dev100-ohnext-v1` (package log, neutral note) | 93, 94, 93 | 93.3 | $2.38 |
| `dev100-ohnext-decline-v1` (plus decline re-read) | 92, 94, 94 | 93.3 | $0.15 |
| `dev100-ohnext-tuned-v1` (package log, tuned prompt) | incomplete | | $1.62 |

Oh-next against the first pass: 2 wins, 1 loss, 97 ties. The decline re-read
selected 27 cells in 10 questions and did not change the mean, so it stays
"needs evidence" and off by default. The tuned-prompt run stopped at 197 of 300
cells when the AI Gateway balance ran out (HTTP 402); the held cells were
released and it can resume after a top-up.

## Sealed holdout proposal

Every candidate already in the program was checked.

| Candidate | Status |
| --- | --- |
| LongMemEval-S (500) | All questions development or evaluated since 2026-09-10; 41 inspected. Not a holdout. |
| LongMemEval-M | The same 500 questions as S with larger haystacks (2.74 GB file). Useful to stress the log fallback; not a holdout. |
| LoCoMo (10 conversations, 1,540 QA) | All ten conversations scored in the V9 comparison. Not a holdout. |
| CloneMem reserved personas | Used for the reranker confirmation. Not fresh. |
| BEAM, revision `3205395e` | No reader or judge call and no outcome read. Downloaded and pinned offline; seal code exists (`beam-seal-cli.ts review` and `draw`). One known partial exposure: a search preview showed part of one history's profile scaffold, which must be declared and its family closed before the seal. |

Proposal: BEAM as the sealed confirmation, with the 100K-token partition
(20 histories, about 400 questions) as the primary set and a family-drawn
sample of the 500K partition as the log-overflow stress set, both frozen by
the seal review before any arm runs. Oh-next, BM25 and Supermemory (per
session, following its published ingestion) run with the same reader, judge
and accounting.

Estimated cost for the 400-question primary set, three repeats:

| Item | Estimate |
| --- | --- |
| Oh-next reader (up to 180 KB context) | $10 to $13 |
| BM25 reader (96 KB) | about $6 |
| Supermemory reader (96 KB) | about $6, plus ingestion of about 2M tokens inside the existing plan credits |
| Judge, binary GPT-4o rubric (3,600 cells) | about $2.5 |
| Judge, BEAM nugget scorer | about $40 to $60 (per-nugget calls) |

With the binary judge the study is about $25 to $30, split into one campaign
per arm so each stays under the $20 experiment cap. The official nugget scorer
raises it to about $65 to $90 and needs a budget decision, because BEAM was
recorded as unfunded under the current policy.
