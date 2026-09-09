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
scores, source/rubric pins, costs and phase timings. The
[paired BM25 comparisons](results/memory-evolution-spans-100-paired-v1.json) and
[matched packing comparisons](results/memory-evolution-spans-100-packing-paired-v1.json)
show that excerpts at 24 KB tie whole-turn Oh's totals while changing individual
outcomes and costing more. At 48 KB, excerpts have eight wins and eleven losses
with nano, and two wins and eight losses with mini, against whole-turn Oh.

## Measured first generation

The first genetic evaluation runs every one of the five nano children proposed
from the packing experiment alongside its three selected parents. Candidate IDs,
parent IDs, policy, seeds and genomes remain unchanged. All eight configurations
answer the same 100 development questions before the next selection.

| Role | Configuration | Nano correct | Attributed reader usage |
| --- | --- | ---: | ---: |
| Parent | BM25 top100, 96 KB | 75/100 | $0.106606 |
| Parent | Oh keyword top100, 48 KB | 69/100 | $0.053988 |
| Parent | BM25 top20, 24 KB | 66/100 | $0.038634 |
| Child | BM25 top100, 48 KB | 69/100 | $0.064205 |
| Child | BM25 top100, 24 KB | 65/100 | $0.035160 |
| Child | BM25 top20, 96 KB | 65/100 | $0.045129 |
| Child | Oh keyword top20, 48 KB | 64/100 | $0.038108 |
| Child | Oh keyword top20, 24 KB | 59/100 | $0.030489 + $0.004644 unresolved |

No child improves on the strongest parent's accuracy. The declared selection
retains Oh keyword top100/48 KB and BM25 top100/96 KB, and promotes the measured
BM25 top100/48 KB child under the accuracy/cost/service-time policy with category
specialists. This selection is not a proof of a general latency improvement.
It then proposes one previously unseen generation-two child: BM25 top20/48 KB.
That child has lineage but no measured fitness. The archive prevents rediscovered
genomes from being presented as new experiments.

The 800 logical cases use 679 distinct reader attempts: 678 verified responses
and one captured response whose reported reasoning-token count exceeds its
completion-token count. The unchanged parser rejects its usage; it scores zero
and retains the full $0.004644 reservation. The first dispatch admitted 64 new
requests in 19.93 seconds and stopped admission on this failure. A second
dispatch admitted only the remaining 298 previously unattempted requests in
92.92 seconds. The failed request was never retried. All 256 required judge
requests are verified; 46 were new, completed in 14.52 seconds.

The whole campaign now contains 3,221 occupied calls and $6.007862 conservative
exposure: $5.965562 known usage plus $0.042300 unresolved. Historical exposure
before this campaign is separate. The
[compact result](results/memory-evolution-offspring-nano-100-v1.json) preserves
both reader dispatches, and the
[generation record](results/memory-evolution-offspring-nano-100-generation-v1.json)
pins observed fitness, exact genomes, selected parents, archive and the untested
next child. This demonstrates a measured generation/selection cycle, not
benchmark saturation or a successful accuracy improvement from breeding.
[Paired comparisons](results/memory-evolution-offspring-nano-100-paired-v1.json)
retain the exact full-width BM25 control identity and every failed case.

## Focused source-packing mechanisms

The fixed V3 comparison evaluated three new 48 KB packing policies on all 100
exposed development questions with the same low-effort nano reader. These are
component ablations, separate from the genetic generation above.

| Configuration | Correct answers | Attributed reader usage |
| --- | ---: | ---: |
| BM25 window, 96 KB | 75/100 | $0.106606 |
| Oh focused query with neighbors, 48 KB | 71/100 | $0.037686 |
| Original raw-pool excerpts, 48 KB | 66/100 | $0.052059 |
| Focused-pool excerpts, 48 KB | 65/100 | $0.072145 + $0.006275 unresolved |
| Contiguous continuation, 48 KB | 65/100 | $0.069878 |
| Source diversity, 48 KB | 60/100 | $0.056711 |

None of the new policies qualifies as an accuracy finalist. Against original
excerpts, focused pooling has four wins and five losses. Continuation has six
wins and six losses against focused pooling; diversity has six wins and eleven
losses. All three remain below the fixed BM25 control. The
[mechanism diagnostics](results/memory-evolution-mechanisms-nano-100-diagnostics-v1.json)
separate these paired answer results from structural changes in the contexts.

The 600 logical cases required 599 physical reader attempts. One new captured
response reported more reasoning tokens than completion tokens, so its usage
was unverifiable. It scores zero, retains its full $0.006275 reservation, and
was never retried. Two dispatches admitted 70 and 230 new requests in a combined
93.52 seconds; the second admitted only previously unattempted requests. All
259 physical judge requests were verified, including 48 new requests in 24.21
seconds. These times exclude preparation and host queue waits.

The incremental campaign exposure was $0.228543, reaching $6.236405 after this
stage. Attributed costs include earlier cached requests and must not be added
to incremental campaign spending. The
[compact result](results/memory-evolution-mechanisms-nano-100-v1.json) retains
both reader receipts, complete denominators, model identities and source pins.
These scores use the original Gateway proxy judge.

## Untruncated full history

The full-history control includes every source turn in its original order. A
six-question service canary qualified 12 new nano/mini responses before the
complete 100-question matrix. All 200 full-history reader attempts subsequently
completed with verified usage. The canary overlaps the full cohort and adds no
independent evaluation data.

| Configuration | Nano correct | Mini correct | Nano reader usage | Mini reader usage |
| --- | ---: | ---: | ---: | ---: |
| BM25 window, 96 KB | 75/100 | 82/100 | $0.106606 | $0.582321 |
| Full history | 68/100 | 84/100 | $0.616918 | $3.140961 |

Sending all history reduces nano's accuracy. Mini gains two correct answers at
about 5.4 times the attributed reader cost. Neither result establishes a clear
advantage for full history. The [paired comparison](results/memory-evolution-full-history-100-paired-v1.json)
records nine wins and sixteen losses for nano, and six wins and four losses for
mini, against their matched BM25 controls. The contexts are larger by design; this is a system
configuration comparison, with each reader's prompt and settings fixed.

The complete matrix contains 400 verified physical reader responses and 214
verified physical judge responses, with no failures. Exact cache reuse left
188 new reader requests, completed in 161.19 seconds, and 35 new judge requests.
The campaign reached $10.012509 conservative exposure: $9.963934 verified usage
plus $0.048575 retained from earlier unverifiable attempts. These totals exclude
$25.885579 in authenticated historical exposure before this campaign.

The [canary receipt](results/memory-evolution-full-history-canary-6-v1.json) and
[complete result](results/memory-evolution-full-history-100-v1.json) record live
provider acceptance, source completeness, model qualification and measured cost.
Provider acceptance does not retroactively make the financial reservation a
verified tokenizer estimate. These accuracy scores use the original Gateway
proxy judge; native-rubric regrading receives separate records and identities.

## Native-rubric Gateway qualification

The initial one-message, 10-output-token Gateway judge was rejected with HTTP400:
the routed API requires at least 16 output tokens. Four bounded continuation
passes admitted 48 distinct requests, all rejected. No request was retried, no
new reader calls were made, and no complete accuracy report was produced.
The $0.327591 in full reservations remains unresolved; it is not verified billed
usage. The [qualification receipt](results/memory-evolution-native-judge-rejection-v1.json)
retains every pass identity and cumulative campaign accounting.

A separate 16-token profile preserves the native prompt and contains-yes rule,
with explicit alias and output-cap deviations from the official evaluator.
It passed a real one-request qualification before expansion. New orchestration
stops on a new deterministic client rejection or a batch with no new verified
transport responses. Authenticated truncated answers still score zero.
Earlier proxy scores and rejected 10-token captures keep their original meaning.

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

## High-effort nano reader

The same 100 development questions were crossed with BM25 96 KB, focused Oh
with neighbors at 96 KB, and complete history. A six-question service canary
qualified all 18 logical reader cases and the adapted native-rubric judge before
expansion. Its questions and exact captures are included in the 100-question run.
These results use the distinct Gateway native-rubric 16-token judge. They cannot
be compared with the earlier proxy table as an isolated reasoning-effort change.

| High-effort nano context | Correct | Reader failures |
| --- | ---: | ---: |
| BM25 window, 96 KB | 78/100 | 2 |
| Oh focused query with neighbors, 96 KB | 75/100 | 1 |
| Full history | 65/100 | 1 |

Four distinct output truncations count as incorrect. All 299 distinct reader
responses have authenticated captures and usage; 300 logical cases share one
exact request. All 169 distinct judge responses completed. Oh has three wins,
six losses and 91 ties against BM25; full history has six wins, nineteen losses
and 75 ties. Higher reasoning effort does not establish a memory improvement.

The main answering phase admitted 281 new calls in 491.71 seconds at concurrency
12, and grading admitted 159 new calls in 32.04 seconds. New campaign exposure
increased by $1.075881, while attributed stage usage is $1.141368 including reused
canary captures. The campaign through this stage accounts for $11.481468,
including $0.376166 retained unresolved from earlier attempts. Summed new-request
service times occupy about 98% of the available 12 slots; greater concurrency
requires separate live qualification and does not promise linear speedup.

The [complete compact result](results/memory-evolution-nano-high-100-v1.json),
[paired outcomes](results/memory-evolution-nano-high-100-paired-v1.json), and
[overlapping service canary](results/memory-evolution-nano-high-canary-6-v1.json)
pin the original reports, exact source, stages, costs and failure denominators.

## Wider retrieval

An offline screen found every labeled evidence session in 99 of 100 questions
for focused native Oh at 120 KB. A 192 KB allowance retains the entire native
top100 pool; 256 KB produces the same contexts. This session-level coverage is
not proof that each required answer fact survives. The paid fixed comparison
uses all 100 development questions with both low- and high-effort nano and the
same native-rubric 16-token judge.

| Context | Low-effort nano | High-effort nano |
| --- | ---: | ---: |
| Oh focused native hits, 120 KB | 74/100 | 70/100 |
| Oh focused native hits, 192 KB | 70/100 | 67/100 |
| BM25 window, 192 KB | 71/100 | 75/100 |

At low effort, Oh 120 KB has nine wins and six losses against BM25 192 KB;
Oh 192 KB has eight wins and nine losses. At high effort the corresponding
pairs are three/eight and two/ten. The 120 KB comparison changes the context
allowance. These results do not establish a clear advantage, and increasing the
Oh allowance from 120 to 192 KB reduces the observed answer score.

The 600 logical reader cases used 556 distinct requests. Nine distinct truncated
responses affect ten logical cases; two additional requests timed out after
120 seconds. All twelve logical reader failures remain scored zero. The two
unresolved reservations total $0.022785 and were not retried. All 240 distinct
judge responses completed.

Three bounded reader passes admitted 535 new requests in 705.51 seconds; grading
admitted 117 new requests in 39.45 seconds. The stage reused 144 distinct earlier
reader/judge captures. New exposure increased by $1.122027; attributed stage cost
is $1.189560. Cumulative campaign exposure is $12.603495: $12.204544 known usage
plus $0.398951 unresolved. Including the recorded earlier campaigns, conservative
exposure is $38.489074. None of these cumulative or overlapping attributed totals
should be added together.

The [offline screen](results/memory-evolution-context-budgets-100-v1.json) and
[public preparation parity](results/memory-evolution-context-budget-public-parity-v1.json)
retain source and packing identities. The [paid result](results/memory-evolution-wide-retrieval-100-v1.json)
and [paired comparison](results/memory-evolution-wide-retrieval-100-paired-v1.json)
record all questions, category scores, failure costs and stage lineage. Reader
composition and targeted source selection are subsequent experiments; these
negative wider-context results remain part of the record.

## Matched native-rubric regrading

Regrading the existing answers with the same Gateway native-rubric 16-token
judge aligns the matched Oh and full-history controls with the newer runs.
Every original reader response is retained; these stages make no new reader
calls. All arms contain the same 100 development questions and have no reader
or judge failures.

| Context | Low-effort nano | Medium-effort mini |
| --- | ---: | ---: |
| BM25 window, 96 KB | 77/100 | 83/100 |
| Oh focused query with neighbors, 96 KB | 71/100 | 82/100 |
| Full history | 69/100 | 85/100 |

Against matched BM25, Oh has zero wins and six losses with nano, and one win
and two losses with mini. Full history has eight wins and sixteen losses with
nano, and six wins and four losses with mini. The two-point mini full-history
gain is small and does not establish superiority. High-effort nano's BM25
score of 78 is one point above low effort, with two reader failures and much
longer service time; it is not the leading reader for the next experiments.

The [full-history regrade](results/memory-evolution-full-history-100-native16-v1.json)
and its [paired results](results/memory-evolution-full-history-100-native16-paired-v1.json)
preserve the original reader source and configuration separately from the
regrader. The [matched Oh regrade](results/memory-evolution-matched-oh-finalist-100-native16-v1.json)
and [paired results](results/memory-evolution-matched-oh-finalist-100-native16-paired-v1.json)
authenticate exact reuse of the earlier neighboring-turn reader captures.

Together these stages admitted 103 new judge requests for $0.048576 in verified
usage, including the one-request qualification, with no new unresolved cost.
The closed campaign accounts for $12.652071: $12.253120 verified usage and
$0.398951 unresolved reservations. Earlier recorded campaigns add $25.885579,
giving $38.537650 in cumulative conservative exposure. Attributed report costs
include earlier reader captures and are not additional spending.

The native-rubric profile still uses a Gateway alias and a 16-token adaptation.
Repeated scoring and development experiments add no independent questions.

## Answer-contract comparison

Some answer instructions scored higher in this fixed development comparison.
The fixed comparison crossed the same 100 development questions with two
retrieval configurations, two reader models and four answer contracts: 1,600
logical answers. Within each reader and retrieval configuration, the question,
date, context bytes and model settings were identical. The changed system
instruction asked for an explicit statement when information was missing,
better composition of facts across the context, or both.

Both retrieval configurations used top100 and a 96,000-byte context allowance.
Oh used focused query terms and neighboring turns. All 16 arms retained every
question, with no reader or judge failures.

| Reader and context | Legacy | Explicit abstention | Composition | Both |
| --- | ---: | ---: | ---: | ---: |
| Low-effort nano, BM25 | 68/100 | 80/100 | 76/100 | 78/100 |
| Low-effort nano, Oh | 73/100 | 76/100 | 71/100 | 81/100 |
| Medium-effort mini, BM25 | 81/100 | 86/100 | 81/100 | 85/100 |
| Medium-effort mini, Oh | 79/100 | 85/100 | 82/100 | 83/100 |

For Oh with nano, the combined instruction gained eight correct answers over
its fresh legacy control: thirteen wins and five losses. It improved abstention
questions from 3/7 to 7/7 and other questions from 70/93 to 74/93. For Oh with
mini, explicit abstention gained six answers: eight wins and two losses,
improving those groups from 4/7 to 7/7 and 75/93 to 78/93. The gains therefore
include changes on questions that have supported answers.

The retrieval comparison still depends on the reader contract. With the
combined nano instruction, Oh scored 81 versus BM25's 78, with seven wins and
four losses. With explicit abstention and mini, Oh scored 85 versus BM25's 86,
with zero wins and one loss. Composition alone reduced Oh's nano score from
73 to 71. These observations support further testing of specific combinations,
not a general claim that one instruction or retriever is better.

The fresh legacy BM25 nano arm used the exact same complete request objects
for all 100 questions as the earlier native-rubric regrade's reader captures,
yet scored 68 here versus 77 earlier. Forty-one answer strings changed. Among
the 59 identical judge requests, one verdict changed. Both immutable repeats
remain in the record; this matrix uses its own fresh legacy controls. These
repeats demonstrate hosted-output variation under unchanged requests, but do
not provide a reliable estimate of its distribution.

The run admitted 1,592 distinct reader requests and 605 distinct judge requests
for $6.500682 in verified usage, with no new unresolved reservation. Its first
24 reader requests per model qualified concurrency 24 and remained in the full
matrix before expansion to 32. The six execution receipts reconcile in their
actual order across both models. Summing the two reports' attributed costs
gives $6.542196, which includes $0.041514 of shared judge usage counted in both
reports. It is not additional spending. For the two Oh configurations discussed
above, attributed reader usage per 100 answers was $0.123214 for combined nano
and $0.613883 for explicit-abstention mini; selector or ingestion costs are not
part of this instruction-only experiment.

The [complete result](results/memory-evolution-answer-contracts-1600-native16-v1.json)
and [paired comparisons](results/memory-evolution-answer-contracts-1600-native16-paired-v1.json)
retain all category scores, the seven abstention and 93 other questions,
request/source identities, failures and cost accounting. They cover eight
matched retrieval comparisons and twelve instruction-versus-legacy comparisons.
The same exposed 100 questions represent 100 corpus identities and 94 declared
families; repeated arms add no independent questions. Grading uses the native
LongMemEval rubric and contains-yes rule with a Gateway GPT-4o alias and a
16-token output cap. It is not a pinned-snapshot, native 10-token or full-set
evaluation, and these development results do not establish superiority.
