# Memory evolution development results

These experiments choose memory changes and inexpensive readers on the existing
development partition. They do not establish benchmark saturation or superiority.
The earlier frozen and reserved comparisons remain closed.

## Reader calibration

The fixed calibration crosses 24 LongMemEval questions with four retrieval
variants and four reader profiles. There are four questions in each of six
categories. All questions were already exposed for development and are included
in the subsequent 100-question experiment.

Correct answers, with failures retained in the denominator:

| Reader | BM25 24 KB | BM25 96 KB | Oh keyword 96 KB | Facets 96 KB |
| --- | ---: | ---: | ---: | ---: |
| Qwen 3.7 Flash | 15/24 | 12/24 | 15/24 | 12/24 |
| GPT-5 nano | 18/24 | 19/24 | 18/24 | 19/24 |
| Gemini 2.5 Flash-Lite | 14/24 | 16/24 | 11/24 | 16/24 |
| GPT-5 mini | 19/24 | 22/24 | 18/24 | 22/24 |

Oh keyword with mini includes one 120-second network timeout. It counts as an
incorrect answer and retains its full $0.037656 reservation. No retry replaced
it. Faceting often produces the same physical prompt as BM25; these are separate
logical treatments with shared responses, not independent replications.

The 384 logical answers required 300 distinct reader attempts and 101 distinct
judge requests. The campaign, including its reused canary, recorded $0.668089 in
known usage plus the $0.037656 unresolved reservation. These amounts are not
additive with the canary's separate report.

For the 96 KB BM25 arm, nano's attributed reader usage was $0.025837 and mini's
was $0.135540. Their median captured service times were 4.26 and 6.47 seconds.
The complete second reader dispatch admitted 276 new requests at concurrency
four in 383.09 seconds; earlier canary responses were reused. A reporting-bound
fix then reconstructed the terminal receipt with zero new calls. Its 0.35-second
replay is not answering throughput. Grading admitted 92 new requests in 36.15
seconds and reused nine earlier verdicts.

This calibration selects nano for inexpensive exploration and mini as a quality
reference. It does not establish that nano is the cheapest adequate reader for
every task. Qwen remains cheaper per request, while its wide-context accuracy
here was lower. Flash-Lite was fastest but did not justify broadening this next
memory comparison.

The initial native Oh context included more labeled evidence sessions in the
100-question offline screen, yet did worse in this answer calibration. Evidence
session recall is a diagnostic; it does not establish that context packing
preserves the necessary answer facts or makes them easy to use.

The full calibration is pinned by the
[compact result](results/memory-evolution-calibration-24-v1.json). It records
the exact private report hash, input and rubric identities, category scores,
usage, failures and separate dispatch/replay timings. Gateway GPT-4o alias
grading remains a development proxy, distinct from the pinned native official
snapshot protocol.

## Packing experiment

The completed fixed comparison uses all 100 already-exposed development questions,
five context variants and the same nano/mini readers. It keeps BM25 24/96 KB
controls and crosses native Oh keyword with 24/48/96 KB. Oh's top-K is held at
100 while its context budget changes. The 48 KB arm is an explicitly chosen
ablation informed by the offline packing screen, not a fabricated genetic child.
The run used concurrency 12 and the existing first-response cache and shared cap.

| Configuration | Nano | Mini | Nano wins/losses vs BM25 96 KB | Mini wins/losses vs BM25 96 KB |
| --- | ---: | ---: | ---: | ---: |
| BM25 24 KB | 66/100 | 72/100 | 4/13 | 0/10 |
| BM25 96 KB | 75/100 | 82/100 | Reference | Reference |
| Oh keyword 24 KB | 65/100 | 67/100 | 8/18 | 0/15 |
| Oh keyword 48 KB | 69/100 | 72/100 | 7/13 | 0/10 |
| Oh keyword 96 KB | 66/100 | 72/100 | 6/15 | 0/10 |

There were 999 verified reader responses and one reused timeout among 1,000
planned attempts, with no new reader or judge failures. The 856 new reader
requests completed in 431.53 seconds. Grading admitted 237 new requests in
35.06 seconds and reused another 68. Preparing 500 contexts took 18.03 seconds
with no provider calls. These are observed stage timings with different request
mixes and cache reuse, not a controlled causal throughput comparison.

The entire new campaign through this stage used $2.554998 in verified usage and
retained $0.037656 unresolved, for $2.592654 conservative exposure. The stage's
own attributed cost is $2.374951, including prior responses; do not sum the two.
For native Oh at 48 KB, the 100 attributed nano reader responses cost $0.053988
and mini cost $0.292538. The corresponding 96 KB BM25 costs were $0.106606 and
$0.582321. Nano remains about five times cheaper, with a quality gap that depends
on the memory configuration.

The current Oh configuration loses to the matched 96 KB BM25 control. Smaller
Oh contexts cost less, but also change the available context allowance. The
mini timeout explains at most one of ten losses for Oh at 96 KB; it does not
explain the overall result. This rejects the hypothesis that increasing native
Oh's context cap alone is sufficient. It motivates better source selection and
packing before adding expensive memory extraction.

The [complete compact result](results/memory-evolution-packing-100-v1.json) and
[paired comparison](results/memory-evolution-packing-100-paired-v1.json) retain
input hashes, fixed denominators, category scores and the distinction between
same-budget and different-budget comparisons. The 100 questions span 94 declared
families; repeated arms and the overlapping calibration add no independent
histories.

Source excerpts are a separate candidate representation. Their offline evidence
session coverage increased from 87/100 for whole-turn Oh at 24 KB to 91/100 at
about 23 KB average. They retain original UTF-8 offsets, source record digests,
dates, speakers and verbatim text. Answer quality requires a separate paid
comparison before that representation can be selected.

## Native query and neighborhood ablation

The first Oh packing matrix used raw query text and isolated native hits. Its
BM25 control used focused query terms and adjacent source turns. The completed
factorial comparison separates those differences through actual Oh search:
raw query with direct hits, raw query with neighbors, focused query with direct
hits, and focused query with neighbors. A focused query removes the existing
common-word list before applying the 16-term cap. Neighborhoods add the preceding
and following turn only within the same session occurrence.

The combined `oh-focused-window` treatment brings the established `oh-window`
adapter into this reusable runner; it is not a novel search engine. Focused tests
verify its legacy behavior, authority and source provenance, budgets and session
boundaries. The ablation preserves every previous treatment and reader prompt.
Source excerpts remain a separately versioned candidate.

| Configuration | Nano | Mini |
| --- | ---: | ---: |
| BM25 96 KB | 75/100 | 82/100 |
| Oh raw query, direct hits, 96 KB | 66/100 | 72/100 |
| Oh raw query, neighbors, 96 KB | 69/100 | 77/100 |
| Oh focused query, direct hits, 96 KB | 71/100 | 76/100 |
| Oh focused query, neighbors, 96 KB | 71/100 | 82/100 |
| Oh focused query, neighbors, 48 KB | 71/100 | 74/100 |

With mini, query focusing and adjacent turns together recover ten correct
answers in aggregate, reaching the matched BM25 score. With nano, the combined
arm improves by five and remains four below BM25. These are development
comparisons on the same 100 questions, not independent confirmation. The combined
48 KB arm retains nano's 71 correct answers but loses eight with mini relative
to its 96 KB version; context compression affects the two readers differently.

The 1,200 logical cases used 1,194 distinct reader attempts: 1,193 verified
responses and the same earlier timeout. All 794 new reader requests succeeded
in 415.77 seconds; 103 new judge requests succeeded in 35.32 seconds. The
remaining judgments reused exact cached requests. Campaign exposure after this
stage is $5.133559 ($5.095903 known usage plus $0.037656 unresolved). The
[compact result](results/memory-evolution-neighbors-100-v1.json) pins each arm,
category, phase timing and cost. Equal aggregate scores do not imply equal
question outcomes or a demonstrated equivalence bound. The
[paired results](results/memory-evolution-neighbors-100-paired-v1.json) show two
wins and two losses for mini, and two wins and six losses for nano, for the
combined 96 KB Oh treatment against BM25. The
[within-Oh comparisons](results/memory-evolution-neighbors-100-factorial-v1.json)
show mini's combined treatment gaining eleven questions and losing one versus
raw direct hits. Nano's equal 71 totals at 48 and 96 KB contain seven wins and
seven losses; reducing the cap changes which questions are answered correctly.

## Source-excerpt answer experiment

The completed V2 experiment uses the same 100 development questions and fixed
nano/mini readers. Its source spans come from one complete native raw-query
keyword top100 pool per question. Each ranked excerpt preserves original text,
source digests, UTF-8 offsets, speaker and date. This is the frozen first excerpt
policy, with no query focusing or later policy changes introduced mid-run.

| Configuration | Nano | Mini |
| --- | ---: | ---: |
| BM25 96 KB | 75/100 | 82/100 |
| Oh whole turns, raw query, 48 KB | 69/100 | 72/100 |
| Oh focused query with neighbors, 96 KB | 71/100 | 82/100 |
| Oh source excerpts, 24 KB | 65/100 | 67/100 |
| Oh source excerpts, 48 KB | 66/100 | 66/100 |

The first excerpt policy is not an accuracy improvement. At 48 KB it scores
below whole-turn Oh with both readers; doubling its own cap gives one additional
correct nano answer and one fewer mini answer. Better offline session recall did
not translate into better answers. This result rejects this policy as the next
accuracy finalist; it does not settle whether other source-preserving packing
policies can improve the system.

All 976 distinct reader attempts and 300 distinct judge requests have verified
responses; this matrix contains no failed attempts. Exact cache reuse reduced
new answering to 378 requests in 182.12 seconds and new grading to 44 requests
in 24.01 seconds. After this stage, total new-campaign exposure is $5.818345:
$5.780689 known usage plus the earlier $0.037656 unresolved reservation, which
is outside this matrix and remains in the campaign. Attributed excerpt reader
usage per 100 questions is $0.044339/$0.270478 for nano/mini at 24 KB and
$0.052059/$0.325798 at 48 KB. These include exact cached responses and are not
incremental stage spending. The
[compact result](results/memory-evolution-spans-100-v1.json) records the complete
scores, source/rubric pins, costs and phase timings.

## Selection and confirmation

Population proposals use observed paired development scores, conservative
attributed reader cost and captured service latency. They retain selected
parents and requested category specialists, mutate one declared parameter at a
time, and cross compatible parents. A proposed child has lineage but no fitness
until it is evaluated. The calibration domain contains 24/96 KB and top-K
20/100; a later domain extension must be recorded explicitly.

Development scores guide experiments. Finalists still need matched-reader
external memory baselines, ingestion and storage accounting, and a separately
sealed confirmation set with audited exposure and shared-history overlap.
The other LongMemEval questions are currently closed by the exposure manifest;
they cannot be relabeled fresh by drawing another random split.

The [proposed confirmation method](EVOLUTION_CONFIRMATION.md) records the
external comparator, exposure audit, scorer qualifications and proposed decision
rule that still need to be fixed and qualified before confirmation.
