# Full 500-question LongMemEval comparison results

This page reports the completed descriptive comparison over all 500 LongMemEval-S
questions defined by the [V7 full-release study](EVOLUTION_RELEASE_V7.md) and its
[V8 full-context companion](FULL_CONTEXT_COMPANION.md). Three configurations
answered every question with the same inexpensive reader, GPT-5 nano under the
explicit-abstention composition profile, and the same adapted native LongMemEval
judge, a GPT-4o Gateway alias with a 16-token cap:

- **BM25 window**: top-100 lexical retrieval packed into 96,000 bytes of context.
- **Oh semantic**: top-100 Oh semantic retrieval, retrieval order, same 96,000 bytes.
- **Full history**: every source turn in original order, with no retrieval.

The headline result is a tie between the two retrieval arms, and both retrieval
arms beat giving this reader the complete conversation. None of this establishes
superiority over other frameworks, an official leaderboard score, or benchmark
saturation. The exposure caveat matters: 100 of the 500 questions were used
during earlier development, and the remaining 400 are recorded as closed with
unknown exposure. Unknown does not mean unseen.

## Answer accuracy

| Arm | Correct | Closed/unknown (400) | Development (100) |
| --- | ---: | ---: | ---: |
| BM25 window, 96 KB | 378/500 (75.6%) | 298/400 (74.5%) | 80/100 |
| Oh semantic, 96 KB | 379/500 (75.8%) | 301/400 (75.2%) | 78/100 |
| Full history | 355/500 (71.0%) | 281/400 (70.3%) | 74/100 |

All 1,500 logical reader cases and their judge decisions completed with zero
reader failures and zero judge failures, so every denominator is the full
question set. Per 100-question shard, the BM25/Oh/full-history counts were
79/77/76, 74/77/75, 77/75/68, 77/76/73 and 71/74/63.

Paired on the same questions, Oh semantic versus BM25 window is 43 wins, 42
losses and 415 ties (mean delta +0.002). BM25 window beats full history 62 to 39
with 399 ties; Oh semantic beats full history 66 to 42 with 392 ties. The two
retrieval arms are indistinguishable on this reader; the roughly five-point gap
to full history is consistent across both exposure strata.

| Category | Cases | BM25 window | Oh semantic | Full history | Oh vs BM25 (W/L/T) |
| --- | ---: | ---: | ---: | ---: | --- |
| Knowledge update | 78 | 65 | 64 | 55 | 3/4/71 |
| Multi-session | 133 | 83 | 92 | 83 | 16/7/110 |
| Single-session assistant | 56 | 54 | 53 | 54 | 2/3/51 |
| Single-session preference | 30 | 12 | 13 | 9 | 5/4/21 |
| Single-session user | 70 | 66 | 63 | 63 | 3/6/61 |
| Temporal reasoning | 133 | 98 | 94 | 91 | 14/18/101 |

Oh semantic's only clear category advantage is multi-session questions, where
it adds nine correct answers. It gives back four on temporal reasoning and three
on single-session user questions. Preference questions are weak for every arm;
the abstention-oriented reader profile rarely infers an unstated preference.

## Retrieval evidence

The declared evidence sessions were included in the packed context for 499 of
500 questions by Oh semantic and 473 of 500 by BM25 window; full history
includes them by construction. Mean evidence precision is low for all arms
(0.083 for Oh, 0.103 for BM25, 0.040 for full history) because a 96,000-byte
budget holds far more sessions than the one or two that carry the answer.
Retrieval recall is therefore not what separates these arms. The reader's use
of evidence that is already present is the limiting factor.

Across the 442 questions that form their own declared family, at least one of
the three arms answered 388 (87.8%) correctly; all three agreed on 252 correct
and 54 wrong. Twenty-one questions were answered only by Oh semantic, 18 only
by BM25 window and 16 only by full history. The 58 questions in multi-question
families are excluded from this count. A configuration that reliably kept the
right answer from any of these arms would score well above any single arm, so
answer construction, not evidence access, holds the largest measured headroom
for this reader.

## Cost and latency

| Campaign | Physical requests | Reader | Judge | Accounted exposure |
| --- | ---: | ---: | ---: | ---: |
| V7 two-arm study | 1,916 | 1,000 calls, $1.225913 | 916 distinct calls, $0.401245 | $1.627158 |
| V8 full-context companion | 1,000 | 500 calls, $3.111829 | 500 calls, $0.225058 | $3.336887 |

Every request settled with parsed usage; no reservation remains unresolved.
The full-history reader consumed 60.5 million input tokens against 21.1 million
for both retrieval arms together, so it cost about five times as much per
answer while scoring lower. Median reader service time was 4.4 seconds for the
retrieval arms (95th percentile 9.8 seconds) and 8.2 seconds for full history
(95th percentile 15.7 seconds). Judge calls took about 0.75 seconds at the
median. Native Oh semantic preparation of each 100-question shard ran locally
with no provider calls and took between 22 and 45 minutes depending on host
load. These are inference-accounting figures from the campaign ledgers, not a
provider invoice, and they exclude earlier development spending.

## Fact-card development experiment

The [preregistered quote-card experiment](quote-card-development-v1/QUOTE_CARD_PREREGISTRATION.md)
also completed on its fixed 100-question development selection, under a separate
$2 allowance. Arm A rewrote the retained semantic context into source-quoted fact
cards before answering; arm B added a deterministic interpreter for counts,
arithmetic and date intervals over those cards. Both regressed against the
immutable 82/100 parent: A scored 46/100 and B 45/100, with zero paired wins and
36 and 37 paired losses respectively.

Thirty-three of the 100 extractor outputs failed validation and were scored as
failures in both arms without retry: 27 quotes did not match the source exactly
once, four cards violated the card schema, one was a duplicate and one broke the
extractor schema. The parent had answered 23 of those 33 questions correctly.
Even on the 67 questions with valid cards, A scored 46 and B 45 against the
parent's 59. The shared run made 345 physical calls for $0.205130 in 144
seconds. Neither arm approached the 87/100 promotion rule, and both were
rejected; the full-release candidate was never changed by this experiment.

## What the evidence supports

- On this benchmark and reader, Oh semantic retrieval performs as well as a
  strong lexical baseline at the same context budget and includes the labeled
  evidence more consistently. It does not outperform the baseline overall.
- Retrieval at 96,000 bytes beats feeding this reader the whole history, on
  accuracy, cost and latency. Full context is a control, not a ceiling.
- Compressing evidence into extracted cards lost accuracy at this model size;
  the extractor's exact-quote failures alone removed more correct answers than
  the cards gained.
- The next measurable gains for a cheap reader lie in answer construction:
  reconciling multiple candidate answers, better handling of preference and
  temporal questions, and keeping the reader from abandoning evidence it has.

Stronger claims need a sealed benchmark with a documented exposure audit and the
candidate fixed before any score is read, plus matched runs of competing memory
frameworks under this same reader, judge and accounting.

## Records

- [Full-release public summary](results/memory-evolution-full-release-500-v1.json):
  protocol `oh.memory.evolution-release-summary.v1`, five shard report digests,
  arm, category, exposure-stratum and paired summaries, deduplicated cost.
- [Full-context public summary](results/memory-evolution-full-context-500-v1.json):
  protocol `oh.memory.evolution-full-context-summary.v1`, the unchanged parent
  reduction plus the companion arm and both paired comparisons.

Both summaries omit question identifiers, source or answer text and local
paths. The per-shard reports, captured raw responses, campaign stores and the
fact-card audit remain private with the run operator for reproduction.
