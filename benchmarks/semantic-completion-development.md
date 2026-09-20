# Semantic completion on LoCoMo development

Appending nearby source turns recovered all annotated evidence for ten
additional LoCoMo development questions without losing existing evidence.
The fresh paired reader comparison nevertheless scored **83/100 versus 84/100**
for the control, with three wins and four losses. It failed its frozen
development gate. Better annotation coverage did not produce better answers
in this comparison.

A separate test of source chronology scored **76/90 versus 74/90** with the
same retrieved turns and bytes. Its two-answer gain also fell short of the
frozen development gate, and one history declined. Neither candidate qualifies
for promotion.

## Population and construction

The screen covers all 314 category 1–4 questions from the two previously exposed
development histories, `conv-49` and `conv-50`. Of these, 312 have evidence
annotations. The other two remain unscored for evidence coverage; absent
annotations do not count as complete retrieval. These are development data,
not held-out histories. The underlying LoCoMo revision is
`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`.

The parent is the existing `oh-semantic` retrieval result at top-k 100, packed
under a 24,000 UTF-8 byte limit. Both candidates start from its retained turns;
they do not reconstruct a larger semantic ranking. A neighbor is the immediate
previous or next source turn within the same session and session occurrence.
Candidates use original source text, deduplicate turns and retain whole turns.
Evidence annotations and answer labels are used only for evaluation.

The first candidate, [interleaved neighborhoods](../scripts/benchmarks/evolution-semantic-neighborhood.ts),
visits each retained anchor followed by its previous and next neighbors, then
packs that sequence under the same byte limit. This can displace original
anchors. Its rule, fixed before inspecting the screen, required at least five
net complete-evidence gains, no decline in either history, and at most two
coverage losses.

The second candidate, [semantic completion](../scripts/benchmarks/evolution-semantic-completion.ts),
preserves the entire original context as an exact byte prefix. It considers
unseen neighbors in anchor order, previous before next, and appends each whole
turn that fits the remaining budget. A turn that does not fit is skipped.
Nothing is truncated or evicted. Its separate rule required at least five net
complete-evidence gains, zero coverage losses, no history decline, and exact
prefix preservation within the same byte limit for all 314 questions.

## Free retrieval screens

Complete coverage means that every annotated evidence turn is present. It
measures coverage of those annotations, not whether the context supplies every
fact needed for a correct answer.

| Screen | Parent complete / 312 | Candidate complete / 312 | Coverage gains | Coverage losses | Frozen rule |
| --- | ---: | ---: | ---: | ---: | --- |
| V8: interleaved neighborhoods | 258 | 271 | 24 | 11 | Failed |
| V9: preserve parent, then complete | 258 | 268 | 10 | 0 | Passed |

V8 failed because its eleven losses exceeded the allowed two. Its larger net
gain does not override that failure. V9 improved `conv-49` from 122 to 129 of
156 annotated questions and `conv-50` from 136 to 139 of 156. It retained every
parent turn and byte prefix across all 314 questions, adding 3,761 turn
exposures. Median context size increased from 22,167 to 23,977 bytes; the
byte ceiling remained 24,000 bytes. Equal byte ceilings therefore do not imply
equal input size or cost.

Neither screen made model calls. No Jev selection, generated facts or answer
rewriting enters these adapters. The failed V8 screen remains a negative result;
V9 is a separately evaluated construction, not a revised score for V8.

## Fresh paired reader comparison

The comparison fixed 100 questions, 50 per history, by a source-only hash
ordering of question IDs: ascending SHA-256 of the UTF-8 string
`oh-semantic-neighborhood-dev-v1` followed by a NUL byte and the question ID,
with ASCII question ID as the tie-breaker, taking the first 50 per history.
Selected cases are reported in corpus/question ID order. Selection uses no evidence labels,
categories or old answer scores. Each question receives a fresh control reader and a fresh
completion reader, for 200 physical reader draws. Eleven selected questions
have identical context bytes; they still receive separate draws.

Both arms use `gpt5-mini-calibration-only-v1-reader`, identical prompts except
context, medium reasoning and an 8,192-token output limit. All reader outputs
must be fixed before loading reference answers. The unchanged
`gpt4o-mini-locomo-j-judge-v1` rubric supplies CORRECT/WRONG decisions. These
model aliases are not verified immutable snapshots.

Completed nonblank answers must fit 4,096 UTF-8 bytes without truncation.
Invalid reader or judge outcomes score zero, stay in the denominator and
cannot qualify the candidate. Identical answers within one question may share
a judge call; all 200 logical scores and 100 pairs remain. There are no retries
or replacement draws, and the run remains inside the shared $10 campaign cap.

The development rule requires at least five net additional correct answers,
no decline in either history and no invalid reader or judge outcome. The candidate gained three answers and lost four, with 93 ties. The first
history declined from 45/50 to 42/50; the second improved from 39/50 to 41/50.
There were no invalid reader or judge responses. The eleven unchanged-context
pairs were all correct in both arms. This diagnostic does not isolate context
effects from variation between fresh model draws.

The 200 reader calls and 165 physical judges cost $0.577274. The raw-capture
audit reproduced all requests, responses, scores and charges, retaining the
prior campaign exposure and uncertainty. Total exposure was $4.623928 of the
shared $10 cap. The [numerical result](results/semantic-completion-development-v1.json)
includes history/category counts, descriptive service times, admission
reservations, model and evaluation limits, and reproducibility hashes.

This is a negative result on two exposed development histories. It changes
no production default and establishes no benchmark leadership.


## Exact-turn chronology comparison

A separate [chronology adapter](../scripts/benchmarks/evolution-semantic-chronology.ts)
orders the original retained semantic turns by their position in the source
conversation. It adds and removes no evidence and preserves every turn's
verbatim rendering and metadata. This isolates presentation order from
retrieval membership and context size.

Its unpaid construction screen passed all 314 questions. All contexts changed
order; 30,790 turn exposures moved while all 31,142 retained exposures and
6,879,238 total UTF-8 bytes stayed identical. No model calls or answer scores
were involved. This establishes the permutation's integrity, not better
answers. Missing referents remain missing, and chronological order can
separate facts that a semantic ranking placed together.

The paid comparison selected the first 45 questions per history by the same
ascending hash rule, giving 90 pairs and 180 fresh reader draws. Both arms use
the reader and judge profiles described above; no previous answers or grades
are reused. The selected contexts have identical retained content and byte
counts, with 1,957,985 context bytes in each arm. All 90 pairs change order.

Chronology scored 76/90 against 74/90 for the fresh control, with three wins,
one loss and 86 ties. The first history declined from 38/45 to 37/45; the
second improved from 36/45 to 39/45. There were no invalid reader or judge
outcomes. It failed both the minimum five-net-answer gain and the
no-history-regression requirements. The observed 2.22-percentage-point gain
is a development result from one draw per arm across two exposed histories;
it does not establish a repeatable advantage.

The 180 reader calls and 145 physical judges cost $0.440649. The independent
raw-capture audit reproduced source ordering, all responses and scores, and
the complete spending history. Total campaign exposure reached $5.064577 of
the shared $10 cap, including $0.232768 retained from two earlier uncertain
attempts. The [chronology numerical result](results/semantic-chronology-development-v1.json)
contains the full aggregate counts, costs, timing and audit hashes. No
production default changes, and these experiments establish no superiority
over an external memory system.

The focused [neighborhood/completion tests](../tests/memory-benchmark-evolution-semantic-neighborhood.test.ts)
and [chronology tests](../tests/memory-benchmark-evolution-semantic-chronology.test.ts)
cover source binding, session occurrences, input mutation, byte limits and
preservation of the required source content.
