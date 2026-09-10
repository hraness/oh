# Full 500-question LongMemEval comparison results

This page reports the completed descriptive comparisons over all 500 LongMemEval-S
questions defined by the [V7 full-release study](EVOLUTION_RELEASE_V7.md) and its
[V8 full-context companion](FULL_CONTEXT_COMPANION.md). Three configurations
answered every question with the same inexpensive reader, GPT-5 nano under the
explicit-abstention composition profile, and the same adapted native LongMemEval
judge, a GPT-4o Gateway alias with a 16-token cap:

- **BM25 window**: top-100 lexical retrieval packed into 96,000 bytes of context.
- **Oh semantic**: top-100 Oh semantic retrieval, retrieval order, same 96,000 bytes.
- **Full history**: every source turn in original order, with no retrieval.

With the nano reader the two retrieval arms tie, and both beat giving that reader
the complete conversation. With GPT-5 mini on the same contexts, Oh semantic
reaches 89.8% and beats BM25 by 22 questions; see the stronger-reader section. None of this establishes
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

## The same retrieval with a stronger reader

The nano reader hid most of the difference between retrieval methods. A second
study kept the exact 500 frozen BM25 and Oh semantic contexts and answered them
with GPT-5 mini under the same explicit-abstention composition contract and the
same adapted judge. The contexts were rebound rather than rebuilt, so the two
studies differ only in the reader and the campaign that paid for it.

| Arm | Nano reader | GPT-5 mini reader | Mini, closed/unknown (400) | Mini, development (100) |
| --- | ---: | ---: | ---: | ---: |
| BM25 window, 96 KB | 378/500 (75.6%) | 427/500 (85.4%) | 342/400 | 85/100 |
| Oh semantic, 96 KB | 379/500 (75.8%) | 449/500 (89.8%) | 359/400 | 90/100 |

With the mini reader, Oh semantic beats BM25 window by 22 questions: 39 paired
wins against 17 losses with 444 ties. The gain concentrates where retrieval
order and coverage matter, temporal reasoning (13 wins, 3 losses; 121 versus
111 of 133) and multi-session questions (16 wins, 8 losses; 112 versus 104 of
133). Per shard the mini counts were 92/86, 90/87, 88/84, 90/88 and 89/82. All
1,000 reader calls and 711 distinct judge calls completed with zero failures.
The campaign accounted $7.126958: $6.810923 for readers and $0.316035 for
judges. Median mini reader service time was 8.2 seconds (95th percentile 20.9
seconds), against 4.4 seconds for nano.

The ranking reversal is the important result. On identical evidence, the
cheaper reader could not exploit Oh's better-ordered, higher-recall context,
and the stronger one could. Retrieval quality and reader capacity are not
separable in this benchmark: a memory system should be compared at the reader
tier its users will run.

## What else was tried on the development set

A development-only loop then tested the remaining levers on the 100
previously exposed questions, each time on identical Oh semantic contexts
prepared locally under the current source, with the same judge. The
[public summary](results/memory-evolution-reader-loop-dev100-v1.json)
records every arm and pairing; hosted outputs vary between identical
requests, so single-run differences of a few questions are within observed
repeat variation.

| Lever | Arm | Correct of 100 | Paired against the mini baseline |
| --- | --- | ---: | --- |
| Baseline | GPT-5 mini, explicit-abstention composition, Oh semantic 96 KB | 92 | |
| Baseline | Same reader and contract, BM25 window 96 KB | 87 | |
| Answer contract | Calibrated abstention and exact-value formatting | 92 | 3 wins, 3 losses |
| Answer contract | Explicit internal timeline and per-item counting | 87 | 0 wins, 5 losses |
| Reader effort | GPT-5 mini at high effort | 89 | 1 win, 4 losses |
| Reader class | GPT-5 at low effort | 87 | 2 wins, 7 losses |
| Reader class | GPT-4.1, no reasoning | 76 | 5 wins, 21 losses |
| Context width | Same retrieval, 160 KB and 240 KB byte budgets | 93 and 93 | |

Three things follow. Prompt engineering is saturated for this reader: the
calibrated contract fixed some hedged and over-abstained answers and lost an
equal number elsewhere. Reasoning effort matters more than model size, and
more effort is not better: mini at medium effort beat mini at high effort,
GPT-5 at low effort, and GPT-4.1 without reasoning, and it did so at the
lowest reader cost of the three GPT-5 settings. Byte budget is not the width
lever: the top 100 retrieved turns already fit within 96 KB for most
questions, so 160 KB and 240 KB changed only 32 of 200 contexts and moved the
score by one question. Widening beyond 100 turns is bounded by Oh's search
contract, which caps a single query at 100 results, so a wider-evidence
experiment needs a product change rather than a benchmark setting. The loop
spent $11.65 across 1,308 requests.

## Under a third-party harness

To compare with other systems on someone else's protocol, Oh was run inside
[ProsusAI MemEval](https://github.com/ProsusAI/MemEval) through the
retrieval-only command, on its stratified 102-question LongMemEval_S sample.
MemEval's protocol differs from the study above in ways that lower every
system's score: it drops the question date, uses a short generic answer prompt
with a 50-token cap, and re-ingests the haystack per question. Its judge is the
LongMemEval prompt set on gpt-4o. Three local harness patches were needed and
are recorded in the [summary](results/memory-evolution-memeval-102-v1.json):
the Gateway requires a 16-token judge cap instead of 10, the gateway model id
contains a slash that broke the result filename, and Mem0's embedder name is
read from an environment variable so it can carry the gateway prefix.

| System on MemEval | Reader | Judge accuracy | Source |
| --- | --- | ---: | --- |
| PropMem | gpt-4.1 | 71.6% | MemEval README |
| SimpleMem | gpt-4.1 | 66.7% | MemEval README |
| **Oh semantic, 96 KB** | gpt-4.1 | **61.8%** (62.7% on a first run whose rows were lost) | this run |
| **Oh semantic, 96 KB** | gpt-4.1-mini | **60.8%** | this run |
| OpenClaw | gpt-4.1 | 59.8% | MemEval README |
| Full context | gpt-4.1 | 52.0% | MemEval README |
| Mem0 OSS 1.0.3, first 30 questions | gpt-4.1-mini | 43.3% (13/30) | this run |
| **Oh semantic on the same 30** | gpt-4.1-mini / gpt-4.1 | **60.0% (18/30) / 66.7% (20/30)** | this run |

Under this protocol Oh sits between OpenClaw and SimpleMem. Its temporal
reasoning (41%) and multi-session (41%) scores are where the missing question
date and the short answer cap bite; single-session user questions were 100%.
The same retrieval scores 89.8% on the full 500 with the mini reader and the
question date supplied, so most of the gap between the two tables is protocol,
not evidence. MemEval's leaderboard does not include Mem0 or Graphiti on
LongMemEval; the Mem0 row above is a local run of its open-source library
under MemEval's own adapter on the first 30 questions of the sample (its
ingestion takes about twelve minutes per question, so the run was bounded),
and the Oh rows on the same 30 questions are the matched controls. With the
same gpt-4.1-mini reader, Oh answered 18 of those 30 and Mem0 13, and Mem0
spent 9.0 million tokens across 2,982 calls against about 0.55 million for
Oh. Thirty questions cannot support a precise margin; it is a matched
observation, not a superiority claim.

## Where this sits among published results

Vendors report LongMemEval_S accuracy with different readers, judges and
protocols, and almost every figure is a self-run. The table lists claims as
published; none of them was reproduced here, and the Oh rows are the two
studies above under the adapted 16-token Gateway judge.

| System | Reported accuracy | Reader | Source |
| --- | ---: | --- | --- |
| Mem0 (Platform, Apr 2026 algorithm) | 94.4% | gpt-4o | [mem0.ai/research](https://mem0.ai/research) |
| Mastra observational memory | 94.9% / 84.2% | gpt-5-mini / gpt-4o | [mastra.ai/research](https://mastra.ai/research/observational-memory) |
| Chronos (PwC) | 92.6% | gpt-4o | [arXiv 2603.16862](https://arxiv.org/abs/2603.16862) |
| Hindsight (Vectorize) | 91.4% | Gemini 3 Pro, GPT-OSS judge | [arXiv 2512.12818](https://arxiv.org/pdf/2512.12818) |
| Honcho (Plastic Labs) | 90.4% | Claude Haiku 4.5 | [plasticlabs.ai](https://plasticlabs.ai/blog/research/Benchmarking-Honcho) |
| **Oh semantic, 96 KB** | **89.8%** | **gpt-5-mini** | this page |
| Emergence AI | 86.0% | gpt-4o | [emergence.ai](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag) |
| Supermemory | 81.6% | gpt-4o | [arXiv 2512.12818](https://arxiv.org/pdf/2512.12818) |
| Zep / Graphiti | 71.2% / 63.8% | gpt-4o / gpt-4o-mini | [arXiv 2501.13956](https://arxiv.org/abs/2501.13956) |
| Full context, original paper | 60.6% | gpt-4o | [arXiv 2410.10813](https://arxiv.org/abs/2410.10813) |
| Oh semantic, 96 KB | 75.8% | gpt-5-nano | this page |

Letta has published no LongMemEval result. The original paper's oracle
condition, answering from the labeled evidence sessions alone, reached 87.0%
with GPT-4o, so the systems above 90% are surpassing simple evidence access
with reader-side reasoning, tuned answer prompts, or larger models. Oh's 89.8%
with a small reader lands with Honcho and above every gpt-4o result except
Mem0's, Chronos's and Mastra's, but a matched comparison needs the same reader,
judge and sample; the retrieval-only command in this repository exists so
third-party harnesses can run that comparison.

## LoCoMo: exposure and the parity lane

No LoCoMo score has been read under the [V9 protocol](EVOLUTION_RELEASE_V9.md)
yet; this section records what is declared before that read. Every one of the
ten LoCoMo conversations is exposed. The two seed-17 development conversations
(conv-49 and conv-50) were used for development-only reader, judge and
memory-representation runs recorded above. The other eight were read by the
retrieval-only held-out report ([locomo-heldout-v2.json](results/locomo-heldout-v2.json),
1,586 questions, 1,224 evidence-labelled) and the 48-question reader/judge
held-out run ([locomo-judge-heldout.json](results/locomo-judge-heldout.json)),
both summarized in the [benchmark README](README.md#recorded-reader-results).
The private exposure manifest therefore declares the development pair as
development/development and the eight test conversations as closed/evaluated.
Nothing in LoCoMo is unseen, and no LoCoMo result will be called a holdout.
Counted from the pinned file, the parity denominator per conversation is
conv-26 152, conv-30 81, conv-41 152, conv-42 199, conv-43 178, conv-44 123,
conv-47 150, conv-48 191, conv-49 156 and conv-50 158 (1,540 of 1,986; the
446 adversarial questions are outside it).

The parity lane scores J the way Mem0 and Zep report it: the Packer/Mem0/Zep
CORRECT/WRONG prompt ([profile](profiles/locomo-judge-v1.json), a normalized
transcription of Zep's grader in `zep_locomo_eval.py`: straight quotes, the
upstream typo removed, de-indented, without its trailing JSON-label
instruction, with named placeholders for its format slots) on a gpt-4o-mini
alias at temperature 0 with a 512-token output cap, over categories 1-4
(multi-hop 282, temporal 321, open-domain 96, single-hop 841; 1,540
questions), with the adversarial category outside the denominator because it
has no gold. Exactly one label must appear; both, neither or a truncated
completion is a judge failure scored 0, never a label. The official F1 is reported beside J as a
diagnostic that underestimates abstention. The reader date policy is fixed in
the study as the final session date, the closest analogue to the leaders'
harnesses, before any score exists. Like-for-like references are Mem0 66.88 /
Mem0g 68.44 and Zep 75.14 with the gpt-4o-mini answerer; a GPT-5 nano or mini
reader on the same lane is a different reader tier and will be labelled so.
Ten conversations are ten clusters, so any interval will be wide by
construction. Under the current budget policy the first descriptor uses the
GPT-5 nano reader with three indexed repeats at 24 KB under a $20 cap; the
gpt-4o-mini row is declared but unfunded.

The V9 protocol smoke (E4a) rebound the five mini full-500 context plans under
a V9 study with zero API calls: the V2 scope (`36df7bbf…5cc6`) reproduced the
five V1 shards exactly, and every rebound case carried the parent case's exact
retrieval result under the current retrieval source `f2cc0ace…7f0a`. The
[V9 page](EVOLUTION_RELEASE_V9.md#rebind-existing-contexts-e4a) lists the
per-shard digests; the private receipt holds the full values.

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
- [Mini-reader public summary](results/memory-evolution-full-release-500-mini-v1.json):
  the same protocol over the rebound study with `gpt5-mini-explicit-abstention-composition-v1-reader`.
- [Development loop summary](results/memory-evolution-reader-loop-dev100-v1.json)
  and [MemEval summary](results/memory-evolution-memeval-102-v1.json): the
  development experiments and third-party harness runs above.
- [Full-context public summary](results/memory-evolution-full-context-500-v1.json):
  protocol `oh.memory.evolution-full-context-summary.v1`, the unchanged parent
  reduction plus the companion arm and both paired comparisons.

Both summaries omit question identifiers, source or answer text and local
paths. The per-shard reports, captured raw responses, campaign stores and the
fact-card audit remain private with the run operator for reproduction.
