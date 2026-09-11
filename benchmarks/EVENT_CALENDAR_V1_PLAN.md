# Event calendar development screen

Status: offline prototype and request planning on 2026-09-11. Paid execution
requires separate approval of the frozen launch; the earlier answer-audit
approval does not cover this experiment. Publishing this source does not
activate a production feature or change a default reader.

This experiment tests whether source-quoted event pointers help GPT-5 mini use
the evidence already retrieved by Oh. It uses all 100 previously exposed
LongMemEval development questions, with one fresh answer per question and arm.
No held-out result, full-benchmark promotion or state-of-the-art claim follows
from this screen.

## Comparison

| Role | Fixed profile | Input |
| --- | --- | --- |
| Control reader | `gpt5-mini-explicit-abstention-composition-v1-reader` | Question, question date and exact original semantic top-100 context, at most 96,000 UTF-8 bytes |
| Candidate organizer | `gpt5-mini-reader` | Question, question date and the same retained source turns, with opaque aliases, original speakers and statement dates |
| Candidate reader | Same profile and answer instruction as the control | Exact original raw context followed by at most 16,384 bytes of partial event pointers, including framing |
| Separate grader | `gpt4o-gateway-native-rubric-16-judge-v1` | Frozen native rubric, question, original reference and final answer |

Both mini profiles use medium reasoning and an 8,192-token output ceiling.
All three distinct profiles route to OpenAI through Vercel AI Gateway; their
aliases are not verified model snapshots. This compares complete inference
pipelines, with added context and organizer cost in the candidate arm.

Earlier development experiments justify preserving the raw evidence. Reordering
the same source bytes scored 76/100 against the semantic parent's 82/100
(3 paired wins, 9 losses); that was a nano-reader, historical-control comparison.
The [source-order aggregate](results/memory-evolution-source-order-100-v1.json)
does not establish that every chronological view fails. A separate mini timeline
prompt scored 87/100 against EAC's 92/100. Replacing raw context with quote cards
scored 46/100 and 45/100 against an 82/100 nano parent. The
[recorded results](EVOLUTION_RELEASE_RESULTS.md) describe those interventions
and their limitations. This candidate keeps every original byte and adds
source-anchored event-time proposals instead of reordering or replacing turns.

## Event-pointer contract

The [pure prototype](../scripts/benchmarks/evolution-event-calendar.ts) accepts
at most 32 entries. Each selects one supplied source alias and a unique,
unchanged quote of at most 1,024 UTF-8 bytes. The host derives the source speaker,
statement date and exact quote byte offsets from the authenticated structured
source; it never parses apparent headers embedded in conversation text.

An entry preserves its quoted time expression, at most 256 bytes, or uses null.
An optional proposed interval has inclusive start and exclusive end dates, with
day, month, year or range precision. The parser checks valid dates, interval
shape, precision and recognized literal ISO contradictions. It never substitutes
the statement date for an absent event date. Source speaker, event participant,
statement time and event time remain distinct concepts. Plans, hypothetical
statements, updates and uncertainty remain visible in the quotes and labeled
model proposals.

Exact source bytes do not prove relevance, completeness, event identity,
attribution interpretation or general natural-language date resolution. The
index is explicitly partial: missing entries are not negative evidence and
entry counts are not event counts. The reader still receives all original raw
memory. An empty index preserves the raw-only reader request exactly.

Organizer JSON is bounded to 32,768 bytes and the complete appended index to
16,384 bytes. Unknown fields, duplicate JSON keys, invalid scalar text, ambiguous
quote matches and oversized output are rejected without repair or truncation.
A known noncompleted organizer response or a typed index-output rejection takes
an explicitly recorded raw-EAC fallback. Its organizer cost and failure reason
remain in the result; fallback is not successful index generation. Changed
source, plan, routing or native capture evidence stops execution.

## Execution and accounting

Freeze source, code, profiles, policy, complete request plan, original context,
scorer, rubric and campaign identities after focused tests, independent review
and a clean source commit. Source and scoring artifacts remain separate. The
private offline planner reads the scorer to reserve every possible judge call;
gold, categories, previous answers and drafts never enter organizer or reader
requests. Provider-bound grading begins only after all final answers are fixed.

The first six organizer questions in lexical ID order form a service canary.
Require at least five valid indexes and zero unresolved requests; do not inspect
answer accuracy to pass it. Then run the remaining 94 organizers. Next, run fresh
control/candidate reader pairs, alternating which arm comes first, in batches
of at most six concurrent calls that drain before the next batch. Grade after
the reader phase. The canary belongs to the original 100 cases and is not rerun.

Organizer and control requests use native repeat index 0; candidates use index
1. These indexes keep fallback and empty-index candidates fresh even when their
request bytes equal the control's. They do not represent multiple experimental
repeats. Identical final answers within a question share the fresh control's
judge decision, with reuse reported explicitly. No prior answer or grade is
carried into this comparison.

The new campaign has a separate **$20 hard cap and at most 500 physical calls**:
100 organizers, 100 controls, 100 candidate readers and up to 200 judges. The
current complete offline maximum reservation is:

| Stage | Maximum reservation |
| --- | ---: |
| Organizers | $3.935735 |
| Control readers | $3.822185 |
| Candidate readers, including worst-case escaped index | $5.460585 |
| Both arms' possible judges | $3.465524 |
| **Total** | **$16.684029** |

These are conservative native reservations, not predicted invoices or measured
costs. They use frozen [mini input/output rates](https://vercel.com/ai-gateway/models/gpt-5-mini)
of $0.25/$2 and [GPT-4o rates](https://vercel.com/ai-gateway/models/gpt-4o) of
$2.50/$10 per million tokens, checked on 2026-09-11. The final frozen preparation
must reproduce the complete bound and fit the cap before separate launch
approval. Use the selected development-project OIDC authority and one native
reservation/capture ledger. Prior campaign limits and accounting remain intact
and separately attributed.

Final answers must be nonblank, at most 2,048 UTF-8 bytes and at most 4,096 bytes
after JSON string escaping, excluding enclosing quotes. Answers outside these
bounds are scored failures; they are never shortened to fit. Reader or judge
failures remain zero in the fixed denominators.

Only the separately reviewed, complete captured single-OpenAI HTTP 520 class may
remain a fixed failure while distinct, never-issued jobs continue. It retains
its full unresolved reservation and is never retried. Stop admissions after
three consecutive or ten total such failures, or immediately for unknown,
authentication, routing, partial-capture or uncaptured failures. Already admitted
calls drain. The canary's zero-unresolved requirement still applies. There is one
immutable attempt, with ordered outcome evidence and no automatic resume or
retry; any later execution policy requires separate review.

## Decision and reporting

Keep all **200 planned answer cells**, 100 per arm, including fallback and
technical failures. Incomplete runs have null accuracy and cannot pass. The
development screen requires all of:

- At least five net paired correct answers gained and at most two paired losses.
- No settled final-reader failures.
- No judge failures or invalid verdicts, including classified HTTP 520 judge
  failures. Such rows can remain accounted diagnostic zeros but cannot advance
  the screen.
- No regression in the 22 temporal questions or seven unanswerable questions.
- Complete request accounting under the frozen limits.

Report paired wins/losses/ties, each arm's score, temporal and unanswerable
slices, valid/empty/rejected indexes, fallback reasons, stage failures, reused
grades, service time, actual confirmed cost and unresolved reservations.
Include organizer cost in candidate pipeline cost. Public evidence contains
aggregates and provenance hashes, not private questions, source text, gold,
answers, credentials or local paths.

A passing screen supports a separately designed transfer evaluation. It grants
neither full benchmark promotion nor authority for further spending. The same
development exposure remains declared in every later comparison.
