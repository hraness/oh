# Two-stage evidence-selection reader lane

This optional development lane tests whether a reader that first selects the
source turns bearing on a question, and then answers from only those turns,
scores better than the single-call reader on the same retrieved evidence. It is
a reader change, so it is applied identically to every retrieval system: each
arm runs on both the Oh semantic and the BM25 window context pins of the same
100 development questions, and the report separates the retrieval difference
from the reader difference.

The lane reads existing `oh.memory.evolution-context-plan.v1` pins by digest. It
does not retrieve again, does not change production Oh, and does not change any
runner protocol. Promotion into the runner is a separate change.

## Selector policy v2

`OH_SELECTOR_POLICY_V2` (`oh.memory.source-selector-policy.v2`, in
`scripts/benchmarks/evolution-two-stage.ts`) fixes the pool as one pinned whole-turn
context result of either `oh-semantic` or `bm25-window` at top-100 within 96,000
bytes, with at most 400 turns and no facet coverage. The selector is the closed
`gpt5-mini-evidence-selection-v1-reader` profile (medium effort); the
`gpt5-nano-evidence-selection-v1-reader` profile is the ablation. Stage two uses
`gpt5-mini-selected-answer-v1-reader`; the fallback uses
`gpt5-mini-calibration-only-v1-reader` on the full pool context. The selected
context keeps the pool's 96,000-byte budget, so a selection, which is a subset of
its pool, is never truncated; the `omittedAliasesForBudget` field stays for the
contract and is empty in practice.

Stage one sends the question, its date and the pool turns rendered with opaque
aliases `s000`, `s001`, … in pool rank order. Speakers, dates and original text
are visible; benchmark labels, categories and gold are not. The response must be
exactly `{"ids":[…]}` with at most 32 distinct supplied aliases in priority order.
Extra keys, escapes, markdown, prose and unknown aliases fail validation.

Stage two re-renders the selected turns from the corpus with `renderTurn`, in
corpus order, into the ordinary answer message. Model text never becomes memory.
The `selected-answer-v1` contract composes the explicit-abstention and
composition instructions with the calibration instruction and adds one
provenance note: the memory holds unchanged, dated source turns selected for the
question and may omit others. The note names no product, phrase or ordering rule.

## Fallback policy

An empty, invalid, truncated or failed selection is not repaired or retried. The
case answers from the full pool context under `calibration-only-v1`, is flagged
with its reason (`empty-selection`, `invalid-selection`, `selector-truncated`,
`selector-failed`), and stays in the denominator with that answer. The report
carries the fallback rate per arm and pin; the gate requires at most 10%.

A pinned pool with no turn at all (a question whose retrieval returned nothing)
is not a preparation failure and never reaches the selector: the case is planned
with no selector, answers from the empty pool context under `calibration-only-v1`
(the same physical request as the calibration-only control), and is flagged
`memory: "fallback"` with reason `empty-pool`. Such cases are counted per arm and
pin as `emptyPoolCases` and are excluded from the selector fallback rate, whose
numerator and denominator are completed selections only. The single-call
controls answer the same empty context, so the paired comparison stays matched.

## Question-shape router

`routeEvolutionQuestionShapeV1` (`scripts/benchmarks/evolution-question-shape.ts`)
reads only the question text, NFC-normalized and case-insensitive, against a
fixed rule table with precedence aggregate > order > recommendation:

| Shape | Rules |
| --- | --- |
| aggregate | `how many`, `total`/`in total`/`altogether`/`combined`, `how much`, `how long` |
| order | `first`, `last`, `before`, `after` |
| recommendation | `recommend…`, `suggest…`, `should i`, `what would you` |

`renderEvolutionQuestionShapeRouterCard()` prints the table verbatim with its
digest for the protocol card. The router never reads categories; after scoring,
`auditEvolutionQuestionShapeRouter` reports the shape × gold-category table so
that category leakage is visible rather than hidden, and the same function gives
outcome-blind hit rates on other corpora's question texts to show transfer.

## Arms and report

`evolution-two-stage-lane.ts` (`oh.memory.two-stage-experiment.v1`) runs any
subset of six arms on every configured pin:

| Arm | Reader |
| --- | --- |
| `single-call-eac` | `gpt5-mini-explicit-abstention-composition-v1-reader` on the full context (control) |
| `calibration-only` | `gpt5-mini-calibration-only-v1-reader` on the full context |
| `two-stage-routed` | mini selection on routed questions, fallback reader elsewhere |
| `two-stage-all` | mini selection on every question |
| `two-stage-routed-nano` | nano selection on routed questions |
| `two-stage-all-nano` | nano selection on every question |

The two nano arms are the counterparts of the two mini-selector arms, so a
configuration can run the whole matrix with the nano selector and mini answerers
under a smaller campaign cap; the selector profile is part of every case row.

The configuration fixes the ordered 100-question development selection, the
context plan digest, one or two pin variants, the arms, `repeats` (1–3), a new-call
allowance and the campaign pin. Every repeat of a request is a distinct physical
row in the same campaign store through the store's repeat index, so all repeats
share one cap and one ledger. Identical physical requests are shared: an unrouted
question in a routed arm reuses the calibration-only control's answer request, and
identical selections from two selector profiles produce byte-identical stage-two
requests. Judge requests are keyed by prompt and repeat index, so byte-identical
answers across repeats are judged once per repeat, never once overall.

Phases run in order: every selection for every repeat, a frozen answer phase plan,
answers, then the scorer labels are opened, a frozen judge phase plan, and native16
judges. The report (`oh.memory.two-stage-lane-report.v1`) lists per case the
question, variant, arm, repeat, selector status, memory kind and fallback reason,
selected turn count and context digest, reader, both stage request digests, judge
digest and score. Per arm and pin it gives per-repeat scores, per-question mean and
majority-of-repeats totals, category slices, fallback rate and reasons, accounting
and end-to-end service time. Paired rows on the same pin give majority-of-repeats
deltas, wins, losses, ties, the temporal slice and the descriptive gate
arithmetic (two-stage: at least +3 with at most 2 regressions, temporal not
worse, fallback at most 10%; calibration-only: at least +2 with at most 1
regression). Rows are emitted against two controls when both are configured:
every other arm against `single-call-eac`, and the four two-stage arms
additionally against `calibration-only` under the same two-stage rule. The
unrouted, fallback and empty-pool cases of a two-stage arm are the
calibration-only control's exact physical answer requests, so a two-stage row
against `single-call-eac` includes the calibration instruction's effect, and the
row against `calibration-only` isolates the selection gain (only selected cases
can differ); each row names its `comparison`. A tie in majority-of-repeats (one
correct of two scored repeats) counts as incorrect; the descriptive pass already
requires three repeats. The fallback rate is selector fallbacks over completed
selections, so not-run or unresolved selections in an interrupted run do not
understate it; the report lists planned and completed selections separately.
When two pins are configured, a memory-delta row per arm gives the first pin
minus the second under that reader.

`complete` is true only when every selection plan was prepared, no case failed
answer or judge preparation, every physical attempt settled with a response or
a charged failure record, and no reservation is unresolved (an uncertain
dispatch keeps its full reservation and makes the run incomplete until it is
reconciled). Gate arithmetic in the report is descriptive. Promotion additionally needs the
complete three-repeat matrix, the separately committed predicted-flip check and
the paired bootstrap from the analysis plan; a miss is not established, not no
effect.

## Running the lane

The lane has no CLI entry (like the fact-card and selector lanes). The callable
entry points are `prepareEvolutionTwoStageLane(configPin)` and
`runEvolutionTwoStageLane({configPin, planPin, credential, fetcher?, stopped?,
onPhasePrepared?})` in `scripts/benchmarks/evolution-two-stage-lane.ts`. A config
uses the `oh.memory.two-stage-experiment.v1` protocol with exactly these keys:

- `protocol` and `partition: "development"`;
- separate `sourcePin`, `contextPin`, `scorerPin` and `campaignPin` file pins
  (four distinct paths, each `{path, sha256}`);
- `executionSourceSha256` (the current committed source identity, which must
  include the lane, selector and router files) and `contextPlanSha256` (the
  digest of the pinned V1 context plan);
- `variantIds`: one or two distinct IDs of `oh-semantic` or `bm25-window`
  variants at top-100 / 96,000 bytes present in the context plan;
- `questionIds`: exactly the ordered 100 distinct development question IDs of the
  source pin;
- `arms`: one to six distinct arm IDs from the table above;
- `repeats` 1 through 3, `maximumNewCalls` 0 through 12,000 and `concurrency`
  1 through 12.

The source pin uses the source-selector input projection and reads up to 64 MiB;
the context and plan pins read up to 128 MiB, the scorer 32 MiB and the config
64 KiB. Preparation reads config, source and context only, routes every question,
constructs every selection plan and emits the
`oh.memory.two-stage-experiment-plan.v1` plan with its reservation ceilings; it
opens no store or scorer and makes no provider request. Write that plan to a new
private file and pin its bytes as `planPin` before running: the run recompiles
the plan and refuses when it differs. The run requires the campaign's selected
project OIDC credential and clean committed source, drains on interrupt, and
replays from the store with zero new calls when rerun. `onPhasePrepared`
receives the frozen answer and judge phase plans before each phase dispatches,
so a caller can pin them.

## Contracts

`evidence-selection-v1` (stage one), `selected-answer-v1` (stage two) and
`calibration-only-v1` (explicit-abstention-composition plus calibration, without
the calibrated-abstention clause) are closed reader contracts with profile IDs for
every base reader. `evidence-selection-v1` is a selection contract, not an answer
contract: `evolutionAnswerMessages` refuses it, `EVOLUTION_ANSWER_CONTRACT_IDS`
excludes it, and the runner and selector-lane configurations reject reader
profiles that carry it. `calibrated-composition-v1` and `timeline-composition-v1` stay
byte-identical for replay of their recorded runs; their "only recorded order"
example is a dataset-specific answer rule and is marked legacy in the contract
source. New contracts must not name a product, phrase or ordering edge case
without a corpus-general justification.

## Tests

`tests/memory-benchmark-evolution-question-shape.test.ts` covers the router,
bounds, audit table and card. `tests/memory-benchmark-evolution-two-stage.test.ts`
covers the policy identities, the alias grammar, plan and pool validation,
source re-rendering, every fallback reason including a provider refusal, the
selection request byte cap as a preparation failure that keeps its cases in the
denominator, the complete six-arm two-pin matrix with a fake provider (shared
physical requests, router audit, memory delta, paired rows against both
controls, zero-call replay), three repeats in one store with mixed selector
failures, an empty pinned pool answered as a flagged empty-pool fallback on the
calibration-only request, a fallback rate above the gate, an uncertain selection
dispatch that stops admission and stays unresolved, a zero-allowance run and
configuration rejection. No test reaches a provider.
