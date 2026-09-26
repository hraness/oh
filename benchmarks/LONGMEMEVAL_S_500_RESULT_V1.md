# LongMemEval-S, all 500 questions: reading the user’s whole log

Completed 2026-09-26. LongMemEval-S asks 500 questions, each about one long
chat history between a user and an assistant
([Wu et al., ICLR 2025](https://arxiv.org/abs/2410.10813)). A pipeline that
gives the reader every message the user wrote, plus the assistant replies that
retrieval ranks highest, answered 93.07% of them correctly, averaged over three
runs. With the same reader, GPT-5 mini, and the same judge, GPT-4o with
LongMemEval’s own grading prompts, Oh semantic retrieval alone scored 88.87%
and BM25 retrieval 86.13%. This is an in-sample result: the pipeline’s added
instructions and question rules were written after studying all 500
questions, and the final run, a from-scratch repeat of the frozen design,
cannot remove that fit.

## The idea

A LongMemEval-S history holds about 48 sessions and 490 KB of text, and the
assistant wrote 87% of it. The user’s own messages average 61.5 KB. In 425 of
the 500 questions, every message the benchmark marks as evidence was written
by the user.

The pipeline gives the reader the user’s side of the conversation in full:
every user message, verbatim, in date order, grouped by session, with relative
dates such as “last weekend” resolved to calendar days. Retrieval fills the
rest of the memory with the assistant replies that best match the question.
One reading pass over that memory scored 91.20%. Four re-reads, each triggered
by a rule on the question text or on the current answer, raised the score to
93.07%.

The log also sets the approach’s range, because it grows with everything the
user writes. In LongMemEval-S it averages 75 KB with its headings and date
lines and never exceeds 131 KB, so it always fit inside the pipeline’s
180,000-byte memory. A history with ten times as many sessions would need a
different design or a much larger budget, and this pipeline has not been
tested on one.

## Results

| System | Mean of three runs | Questions correct in two or three runs | Correct in runs 1, 2 and 3 | Memory per question (mean) |
| --- | ---: | ---: | --- | --- |
| Oh reading pipeline | 93.07% | 474 | 459, 469, 468 | 168 KB; 99 KB in whole-session re-reads |
| First pass only | 91.20% | 458 | 450, 459, 459 | 168 KB |
| Oh semantic retrieval | 88.87% | 445 | 445, 442, 446 | 83 KB of a 96 KB cap |
| BM25 retrieval | 86.13% | 431 | 429, 433, 430 | 92 KB of a 96 KB cap |

Each system answered every question three times. The mean counts correct
answers across all 1,500; the second column counts questions answered
correctly in at least two of their three runs. Every reader and judge call
completed on its first attempt, and no answer was empty or cut off by the
output limit.

Accuracy by question type, mean of three runs:

| Question type | Questions | Pipeline | First pass | Oh semantic | BM25 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Knowledge update | 78 | 93.16% | 92.74% | 91.03% | 92.74% |
| Multi-session | 133 | 86.72% | 85.71% | 84.21% | 74.94% |
| Single-session assistant | 56 | 97.62% | 95.24% | 95.24% | 94.64% |
| Single-session preference | 30 | 92.22% | 70.00% | 63.33% | 65.56% |
| Single-session user | 70 | 96.67% | 96.19% | 95.24% | 97.62% |
| Temporal reasoning | 133 | 95.74% | 96.24% | 91.98% | 88.47% |
| Abstention, across types | 30 | 88.89% | 90.00% | 91.11% | 90.00% |

Against BM25, the largest gain came on preference questions, which ask for
advice fitted to what the user has said about themselves: 65.56% to 92.22%,
almost all of it from the advice re-read. Multi-session questions, which ask
the reader to count or combine facts from different sessions, rose from 74.94%
to 86.72%, and temporal-reasoning questions from 88.47% to 95.74%.
Single-session user questions, whose answer sits in one user message, gained
nothing: BM25 scored 97.62% on them and the pipeline 96.67%. On the 30
abstention questions, whose correct answer is that the history does not say,
the re-reads lowered the score from 90.00% to 88.89%, one answer in 90.

Paired differences on the same 500 questions, in percentage points, with 95%
intervals from 10,000 bootstrap resamples of questions within each type. On
the mean of three runs:

| Comparison | Difference | 95% interval | Questions with more / fewer correct runs |
| --- | ---: | --- | --- |
| Pipeline over BM25 | +6.93 | 4.60 to 9.40 | 70 / 26 |
| Pipeline over Oh semantic | +4.20 | 2.47 to 6.00 | 49 / 20 |
| Pipeline over first pass | +1.87 | 0.87 to 3.00 | 21 / 7 |
| First pass over BM25 | +5.07 | 2.80 to 7.40 | 58 / 29 |
| First pass over Oh semantic | +2.33 | 0.80 to 3.93 | 42 / 21 |
| Oh semantic over BM25 | +2.73 | 0.53 to 5.07 | 47 / 37 |

The freeze records named a different primary measure, questions correct in
two or three runs;
[the confirmation run](#the-leaked-example-and-the-confirmation-run) explains
why this page leads with the mean. On that measure:

| Comparison | Difference | 95% interval | Questions gained / lost |
| --- | ---: | --- | --- |
| Pipeline over BM25 | +8.6 | 5.8 to 11.6 | 51 / 8 |
| Pipeline over Oh semantic | +5.8 | 3.6 to 8.0 | 33 / 4 |
| Pipeline over first pass | +3.2 | 1.8 to 4.8 | 16 / 0 |
| First pass over BM25 | +5.4 | 2.6 to 8.2 | 39 / 12 |
| First pass over Oh semantic | +2.6 | 0.6 to 4.6 | 20 / 7 |
| Oh semantic over BM25 | +2.8 | 0.0 to 5.6 | 31 / 17 |

Every interval excludes zero except one. On the frozen measure, Oh semantic
retrieval leads BM25 by 2.8 points with an interval from 0.0 to 5.6, which
does not rule out a tie. It is the narrowest margin on the mean as well,
where 47 questions gained correct runs and 37 lost them. The re-reads moved
16 questions to two or three correct runs and moved none the other way.

## What the reader sees

### First pass

The reader receives the question, the question date and one memory text. The
memory has three parts.

1. A header with the question date. In 94 of the 500 histories every session
   is dated the same calendar day; for those, the header says so and tells the
   reader to date events from what the messages themselves say.
2. The complete log of the user’s messages. Sessions appear in date order,
   each under a heading with its date and its distance from the question date.
   After each message that uses a relative time expression, a “Resolved dates”
   line gives the calendar dates that a small rule set, with no model involved,
   computed from the session date. On average the log holds 245 messages from
   48 sessions and 24 resolved-date lines.
3. Retrieved assistant replies. BM25 and Oh semantic retrieval each rank the
   history’s turns for the question. The two top-100 lists are merged by
   reciprocal rank fusion (k = 60), user messages are dropped because the log
   already holds them, and replies are added in fused order until they reach
   96,000 bytes or the whole memory reaches 180,000 bytes. On average 50
   replies fit, 93 KB.

The memory averages 168 KB (median 169 KB, largest 180 KB). Its layout, with
message text elided:

```text
Question date: 2023-05-30 (Tuesday).

# Complete log of the user's messages: every message the user sent, verbatim, from all 49 sessions of the history, in chronological order and grouped by session

## 2023-05-22 (Monday) — session s0009 — 8 days (1 week 1 day) before the question date
[s0009:0] user: …
Resolved dates (from this message's date 2023-05-22): "last weekend" = 2023-05-20 … 2023-05-21 [ends 9 days (1 week 2 days) before the question date]

# Retrieved assistant replies: the assistant messages that best match the question, verbatim, in retrieval order (only a subset of the history; each names the user message it replied to)

[s0031:5] [2023/05/28 (Sun) 14:02] assistant (reply to [s0031:4]): …
```

The instruction is the repository’s explicit-abstention reader instruction
followed by three paragraphs: how to read the two parts, when to answer rather
than decline, and how to open and settle the answer. The appendix prints all
of them.

### Re-reads

A re-read gives one answer a second GPT-5 mini call with a different memory
view or instruction, and the new answer replaces the old one. Rules choose
answers from the question text or from the current answer text only; they never
see the question type or the reference answer. A re-read that fails keeps the
earlier answer. The re-reads run in this order:

| Re-read | Chooses | Memory | Instruction adds |
| --- | --- | --- | --- |
| Advice | questions that ask for suggestions, recommendations, tips or an opinion, unless they ask what was said before | the first-pass memory | never decline; build suggestions on what the user owns, did, plans and dislikes |
| Decline, twice | answers that say the memory lacks the information | whole sessions | read every message; check the question’s premise against what was said |
| Recall | questions that ask what the assistant said, suggested or created earlier | whole sessions | reproduce the assistant’s own content |

The whole-session view holds up to 100,000 bytes of complete sessions, user and
assistant messages verbatim, in date order; a message longer than 12,000
characters is cut. Sessions are chosen in three steps until the budget is
full: up to four sessions dated within three days of a date the question refers
to, such as “last Saturday” or “Valentine’s Day”; the three sessions whose
messages contain the most of the question’s content words, scaled for session
length; then sessions in fused retrieval order. When every session is dated
the same calendar day, the date step is skipped. The view averaged 99 KB.

What each step changed, counted over the three runs:

| Step | Questions chosen | Answers re-read | Mean of three runs | Questions correct in two or three runs | Answers fixed | Answers broken |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First pass | | | 91.20% | 458 | | |
| Advice | 30 | 90 | 92.53% | 467 | 24 | 4 |
| First decline re-read | 53 | 128 | 92.87% | 469 | 11 | 6 |
| Second decline re-read | 45 | 115 | 92.87% | 473 | 6 | 6 |
| Recall | 56 | 168 | 93.07% | 474 | 3 | 0 |

In all, 378 of the 1,500 answers were re-read at least once, and none more
than three times. The recall step chose 56 questions but changed only three
answers; the first pass had already answered 95.24% of the single-session
assistant questions correctly.

## What is in the Oh package

The retrieval is Oh’s. Oh semantic retrieval is the package’s semantic search,
EmbeddingGemma embeddings through the optional local QMD runtime, over each
history stored turn by turn. BM25 is SQLite FTS5 ranking over the same turns,
from the benchmark tools in `scripts/benchmarks/`. The rest of the pipeline,
the log builder, the date rules, the re-read rules and the added instructions,
ran in a private lab harness and is not part of the Oh package. The appendix
gives every instruction and rule it used.

## How the pipeline was developed

### Exposure

Earlier Oh studies had already scored all 500 questions and read some of them
one by one; see the [exposure declaration](EVOLUTION_RELEASE_RESULTS.md#exposure-declaration).
On 2026-09-25 all 500 questions were opened for question-by-question failure
analysis. The seed-17 split into 100 development and 400 test questions from
the [protocol card](PROTOCOL_CARD.md) still set the order of work, since each
idea ran on the development questions first, but it no longer separates
tuning from testing. The confirmation run scored 94.33% on the development
questions and 92.75% on the other 400; BM25 scored 85.00% and 86.42%.

### Development path

On the 100 development questions, correct in two or three runs:

| Memory | Correct of 100 |
| --- | ---: |
| BM25 retrieval, 96 KB | 87 |
| Oh semantic retrieval, 96 KB | 91 |
| BM25 retrieval with resolved-date lines | 87 |
| Notes extracted from the user’s messages by GPT-5 nano, with BM25 replies | 90, 91 |
| Complete user log with BM25 replies | 94 |
| Complete user log with fused replies and the answer-format paragraph | 95 |

A second BM25 run on the same 100 questions, part of the full-500 baseline,
scored 85, so a difference of two or three questions on this set is within
run-to-run variation. The complete log beat a model-extracted summary of the
same messages, and it stayed ahead after every later change. Fifteen designs
were then run on all 500 questions, in this order:

| # | Design | Mean of three runs | Questions correct in two or three runs | Kept |
| ---: | --- | ---: | ---: | --- |
| 1 | User log with BM25 replies, one pass | 91.07% | 459 | |
| 2 | User log with fused replies, one pass | 91.27% | 460 | yes |
| 3 | 2 plus decline re-read | 91.40% | 459 | |
| 4 | 2 plus advice re-read | 93.20% | 471 | |
| 5 | 2 plus advice and decline re-reads | 93.67% | 474 | yes |
| 6 | 5 plus a counting re-read | 93.47% | 471 | |
| 7 | 5 plus an arbiter for questions whose runs disagreed | 90.87% | 454 | |
| 8 | Instructions routed by question rule, one pass | 93.00% | 470 | |
| 9 | 8 plus decline re-read | 92.60% | 468 | |
| 10 | 5 plus a second decline re-read | 93.80% | 475 | yes |
| 11 | 10 plus a current-state re-read | 93.20% | 472 | |
| 12 | 10 plus the recall re-read | 94.07% | 476 | yes |
| 13 | 12 plus a model-built ledger in place of the memory, for counting questions whose runs disagreed | 87.07% | 437 | |
| 14 | 12 plus a current-state re-read on the first-pass memory | 93.87% | 474 | |
| 15 | 12 plus the ledger appended to the user log, for the same questions as 13 | 93.80% | 474 | |

Ten other designs ran only on the development questions and were dropped.
Six of the fifteen added a step to a kept design and scored below it. The
counting re-read asked the reader to list every instance with its date before
giving a total. The arbiter was shown the earlier answers to a question whose
runs disagreed and asked which was correct, or for the right answer if none
was. The two current-state re-reads chose questions about how things stand now;
design 11 used the same whole-session view and instruction as the decline
re-reads. Model-written notes never raised the score: GPT-5 nano’s notes lost
to the raw messages on the development questions, and the counting ledger cost
39 questions when it replaced the memory and two when it was appended to the
log.

### The leaked example and the confirmation run

After the last development run, the text of every instruction and rule was
scanned for each reference answer as a whole word or phrase. The calibration paragraph’s
example of a direct value was a dollar amount that is the reference answer to
one development question. The confirmation run replaced it with “$315”, which
matches no reference answer. That question was answered correctly in all three
runs, with the leaked example and without it. A place name that is the
reference answer to one question appeared in an instruction used by four
designs, all dropped: designs 8 and 9, the second stage of design 14, and one
design run only on the development questions.

The scan also matched common words. The user-log paragraph, which the reported
first pass and advice step carry, contains a number word that is the entire
reference answer to two test questions. BM25, Oh semantic retrieval and the
pipeline answered both correctly in all three runs, so the comparisons are
unaffected. A common two-word time phrase in the counting paragraph, used only
by the dropped design 6, is the reference answer to three test questions, none
of which design 6 re-read.

The champion, design 12, was the best of 15 full evaluations, so its score
carries selection luck. On 2026-09-26 its design was frozen and run again from
scratch, with fresh reader and judge calls for every step. Two things
differed from the development run: the example value, and the first decline
re-read, which in the development run used an earlier whole-session view
without the content-word step. The freeze record committed in advance to
reporting whatever the run scored. It scored 93.07% (474 questions correct in
two or three runs), against 94.07% (476) for the development run. The
confirmation run is the result reported on this page.

The freeze records for the confirmation run and the Oh semantic run named
questions correct in two or three runs as their primary measure. This page
leads with the mean of three runs, the measure the protocol card scores. For
the pipeline it is the lower of the two: 93.07% against 94.80%. For Oh
semantic retrieval over BM25 it gives the narrower interval, 0.53 to 5.07 points against 0.0 to
5.6, so the paired comparisons under [Results](#results) report both measures.

### Question rules that match question types

The advice and recall rules read only the question text, but they were written
after reading all 500 questions, and on this benchmark they behave as detectors
for question types. The advice rule chooses exactly the 30 single-session
preference questions and no other question. The recall rule chooses 55 of the
56 single-session assistant questions and one temporal-reasoning question. The
answer-format paragraph’s example, “the first order from a service”,
paraphrases one development question; an earlier Oh instruction with a similar
example was retired from new instructions as a dataset-specific rule. How these
rules fire on other conversations has not been measured.

## Protocol

- **Dataset.** `longmemeval_s_cleaned.json` from `xiaowu0162/longmemeval-cleaned`
  at revision `98d7416c24c778c2fee6e6f3006e7a073259d48f`, SHA-256
  `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`, 500
  questions: 78 knowledge-update, 133 multi-session, 56 single-session
  assistant, 30 single-session preference, 70 single-session user and 133
  temporal-reasoning, including 30 abstention questions whose correct answer is
  that the history does not say.
- **Identifiers.** Sessions and turns carry neutral identifiers such as
  `s0009:3`, and every index was built fresh. The
  [identifier audit](LONGMEMEVAL_IDENTIFIER_AUDIT_V1.md) found answer-label
  wording in the identifiers of earlier Oh runs.
- **Reader.** `openai/gpt-5-mini` through Vercel AI Gateway, an alias rather
  than a pinned snapshot; medium reasoning effort; at most 8,192 output tokens
  including reasoning. The question, question date and memory go in one JSON
  object in the user message.
- **Runs.** Three independent runs per question, first attempt only. A missing
  or failed answer would count as incorrect; none occurred.
- **Judge.** `openai/gpt-4o` through the same gateway, also an alias;
  temperature 0; 16 output tokens. It uses LongMemEval’s per-type grading
  prompts from [`longmemeval-judge-v1.json`](profiles/longmemeval-judge-v1.json),
  taken from the official evaluation script at commit `9e0b455f`, with exact
  yes/no parsing. Only the judge sees reference answers. The paper’s judge is
  the pinned `gpt-4o-2024-08-06`, so these scores are close to, but not exact
  reproductions of, the official stack.
- **Matched baselines.** The BM25 and Oh semantic rows follow the
  [protocol card](PROTOCOL_CARD.md): the top 100 turns packed into 96,000
  bytes, the explicit-abstention instruction and one reader call per question
  per run. The Oh semantic row joins the run on the 100 development questions
  from 2026-09-25 with a run on the other 400 made on 2026-09-26, under a freeze
  record written before it started. The pipeline is a separate protocol. It
  reads up to 180,000 bytes on the first pass and can make four more calls per
  answer, one per re-read step.

## Cost

| System | Reader calls | Mean input tokens per call | Reader cost | Judge cost | Reader cost per answer |
| --- | ---: | --- | ---: | ---: | ---: |
| Oh reading pipeline | 2,001 | 40,944 first pass; 26,222 re-read | $16.23 | $0.92 | $0.0108 |
| Oh semantic retrieval | 1,500 | 20,054 | $7.31 | $0.64 | $0.0049 |
| BM25 retrieval | 1,500 | 21,837 | $7.61 | $0.65 | $0.0051 |

Costs are the charges Vercel AI Gateway reported for each call. The first pass
accounts for $13.18 of the pipeline’s reader cost and the 501 re-reads for
$3.05. Every model call made for this study, including the discarded designs,
the Supermemory attempts described below and the baselines, cost $121.83 in
total.

## Other published LongMemEval-S results

Memory systems publish their own LongMemEval-S scores, and the headline
figures below run from 90.4% to 97%. Each chose its own answering model,
judge, prompts and configuration, so those scores do not compare directly with
these, and the table does not rank them. Figures are as each source prints
them, with the count of correct questions where it can be derived; sources
were checked on 2026-09-26.

| System | Reported | Correct of 500 | Reader | Judge | Source |
| --- | --- | ---: | --- | --- | --- |
| Supermemory | 97% with GPT-4o answering; 84.6% with GPT-5; 85.2% with Gemini 3 Pro | 485, 423, 426 | GPT-4o, GPT-5, Gemini 3 Pro | GPT-4o, LongMemEval prompts | [Supermemory research](https://supermemory.ai/research/longmembench/) |
| Mastra observational memory | 94.87%, average of the six question types | 468 | GPT-5 mini | GPT-4o, LongMemEval prompts | [Mastra research](https://mastra.ai/research/observational-memory) |
| Mem0 platform | 94.4% (top 200), 94.8% (top 50) | 472, 474 | not stated | not stated | [mem0ai/memory-benchmarks](https://github.com/mem0ai/memory-benchmarks) |
| Hindsight 0.4.19 | 94.6% | 473 | Gemini 3.1 Pro preview | Gemini 2.5 Flash Lite | [agent-memory-benchmark](https://github.com/vectorize-io/agent-memory-benchmark) |
| Chronos | 94.20%; also reports 95.60% | 471, 478 | GPT-5 mini | LongMemEval prompts; judge model not named | [arXiv 2603.16862](https://arxiv.org/abs/2603.16862) |
| MemMachine | 93.0% | 465 | GPT-5 mini | GPT-4o mini | [arXiv 2604.04853](https://arxiv.org/abs/2604.04853) |
| Honcho | 90.4% | 452 | Claude Haiku 4.5 | GPT-4o, LongMemEval prompts | [Plastic Labs](https://plasticlabs.ai/blog/research/Benchmarking-Honcho) |

Supermemory’s page gives 97% both as its score with GPT-4o answering and as
its overall Recall@20 with aggregation, the name it gives its retrieval
configuration. Mastra’s 94.87% is from its latest run, the only run basis any
of these sources states; it used GPT-5 mini to answer, as this study does, and
GPT-4o to judge. MemMachine reports choosing its configuration among about 12
variants scored on the same 500 questions. The pipeline’s three runs scored
459, 469 and 468 of 500, and the average of its six per-type scores, Mastra’s
basis, is 93.69%.

## Supermemory

Supermemory is the one outside memory service run under this repository’s
matched setup: in the [60-question pilot](FRAMEWORK_PILOT_RESULT_V1.md) it
scored 75.00% against Oh’s 71.67%. It has no row in the results table. Two
Supermemory runs were scored during this study and discarded: one on 125
questions, started 2026-09-26 at 00:49 UTC, and one on all 500. Both used the
same harness, which departed from the pilot in three ways. It stored each turn
as its own document, where the pilot, following Supermemory’s published
method, stored one document per session. It searched while Supermemory was
still generating memories from those documents. And it kept only search
results that held one whole stored turn, which dropped every memory
Supermemory generated. Their scores measure those errors and are not reported.
The model calls for the two attempts cost $2.66 and $2.76, included in the
study total above. A matched full-500 run has not been made.

## Limits

- In-sample: the added instructions and question rules were written after
  studying all 500 questions, and two of the rules match single question types
  on this benchmark.
- The reader and judge are gateway aliases; the models behind them can change.
- The user log fits because LongMemEval-S histories are short. Longer
  histories, such as the benchmark’s 500-session M variant, are untested.
- The pipeline reads up to 180,000 bytes and makes extra calls; the matched
  baselines read at most 96,000 bytes once.
- There is no GPT-5 mini run with the full history as memory. With GPT-5 nano,
  the full history scored below both retrieval arms (355 against 378 and 379,
  legacy identifiers; see [the earlier comparison](EVOLUTION_RELEASE_RESULTS.md)).
- The lab harness is not published; the appendix gives its instructions and
  rules.
- AI agents ran the study and wrote this page; no person or outside group has
  audited it.

## Appendix: instructions and rules

Each instruction is the base instruction followed by the paragraphs listed for
it, joined by single spaces. The digests are SHA-256 over the instruction
encoded as a JSON string; the aggregate result file lists them.

| Step | Paragraphs after the base instruction | SHA-256 |
| --- | --- | --- |
| First pass | user log, calibration, answer format | `551f0c0de5df5642a732ecbee7c5fef9359bb6ce4cfa67526476b20c1719dd84` |
| Advice | user log, answer format, advice | `4c1404fa181fad5e1ae281aa462a87b9c5e1099ad6349a2d0cda289ed60d9616` |
| Decline | whole sessions, answer format | `5058ea6c013da4dac2d933a6ba397ac7b6e36ab5c5cf78259d24c47528335bba` |
| Recall | whole sessions, answer format, recall | `6f055965d7594ef9bd7a4ac345b8b42d23335c371ba76578d0565a237b9c49de` |

Base instruction: `explicit-abstention-composition-v1` in
[`scripts/benchmarks/evolution-reader-contracts.ts`](../scripts/benchmarks/evolution-reader-contracts.ts).

User log:

```text
The memory has two parts. First, the complete log of the user's own messages from every session of the conversation history, verbatim and in chronological order, grouped by session with the session date and its distance from the question date; lines beginning with "Resolved dates" give absolute dates computed by the system for the relative time expressions in the preceding message (exact unless marked ≈; an ambiguous expression lists both readings). Second, retrieved assistant replies that best match the question, verbatim, only a subset of the history; each names the user message it answered. Enumerate and count across sessions using the user log, determine current state from the latest dated message, and use the retrieved assistant replies for what the assistant said, suggested or explained. Treat a question as unanswerable only when neither part contains the asked-about fact or event.
```

Calibration:

```text
Report a computed result as the direct value (for example "$315"), not as an inequality or a hedge, even when an input was approximate; at most add a brief note after the value. Interpret a time window in the question loosely: when the only matching events fall within a few days of the literal window, use them and mention their dates rather than declining. When the memory covers the subject of the question but a qualifier in the question (such as first, last, or a period) is not stated explicitly, answer under the most natural reading of the evidence and add that assumption in a few words. Decline only when no observation or turn addresses the subject of the question at all. For a recommendation, propose options consistent with the remembered preferences and avoid options the user said they dislike or want to move beyond.
```

Answer format:

```text
Begin the response with the answer itself: never open with a heading, a list of facts, or a restatement of the evidence. When the question presupposes an event (for example the first order from a service) and the memory records exactly one event matching the description, treat that event as the one meant and answer from it. When the memory notes that session timestamps are unreliable, date and order events by the dates stated inside the messages and by their tense, and count an event described as already having happened as having happened even if its stated date is later than the session timestamp. When an answer depends on an unstated detail such as a birthday or an exact day, give the single most likely value rather than a range.
```

Advice:

```text
This question asks for advice or recommendations for the user. Never decline and never say the conversation lacks information: the answer is advice, not a remembered fact. First, search the memory for everything about the user that bears on this request: what they own or already use, what they have done or tried, their plans, constraints, stated likes and dislikes, and what they said they want to try next or move beyond. Then answer concisely with tailored suggestions that explicitly build on those specifics (for example "since you already have …" or "building on your …"), put first the options that match what they said they want, and avoid anything they said they dislike, already have, or want to move away from. Do not pad the answer with generic advice or long lists copied from earlier assistant replies; a few well-targeted suggestions are better.
```

Whole sessions:

```text
The memory contains the complete text, user and assistant messages verbatim, of the sessions of the conversation history most relevant to the question, including sessions dated near any time the question refers to; other sessions are not shown. Read every message carefully, including details the user mentions in passing inside longer messages, and the assistant's own earlier answers. If these sessions contain the asked-about fact or event, answer the question directly from them. Before answering, check that the question's premise matches the memory: if the question names a role, item, person, place, date or event that differs from what was actually said (for example a different job title, product, or relative), the conversation does not contain the answer, so reply with the decline sentence.
```

Recall:

```text
This question asks what the assistant said, listed, or created earlier. The full text of the relevant sessions is in the memory, including the assistant's own messages verbatim. Find the assistant's content and answer with it directly — reproduce names, lists, progressions or details exactly as the assistant gave them — never decline just because the answer is long, unusual, or inside an earlier assistant reply.
```

The rules are case-insensitive regular expressions over the question text or
the current answer:

```text
advice   (suggest|suggestions?|recommend|recommendations?|advice|tips|ideas|what do you think|do you think|should i|could there be a reason|what should i|which one to choose|not sure which|any thoughts)
         and not (remind me|you (?:suggested|recommended|mentioned|told|said|gave|listed|provided)|did you|previous (?:conversation|chat)|last time|we (?:talked|discussed|spoke)|earlier conversation)
decline  does not contain enough information|not enough information|insufficient information|cannot determine|can.t determine|not specified in|not mentioned|no information about|does not (?:include|mention|contain|record)
recall   (remind me|you (?:suggested|recommended|mentioned|told|said|gave|listed|provided|created|wrote|made)|did you|previous (?:conversation|chat)|last time|we (?:talked|discussed|spoke)|earlier conversation|looking back at our previous)
```

The question-word patterns match whole words; the decline pattern matches
anywhere in the answer.

## Evidence

- [`results/memory-longmemeval-s-500-v1.json`](results/memory-longmemeval-s-500-v1.json):
  aggregate results for every row on this page, with the dataset pin,
  instruction digests, stage counts, paired comparisons, development record
  and cost. It holds no question text, answers or reference answers.
- Run artifacts, which contain dataset text and model responses, stay in the
  private lab.
