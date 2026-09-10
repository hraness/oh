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

`evolution-two-stage-lane.ts` (`oh.memory.two-stage-experiment.v1`) runs five
arms on every configured pin:

| Arm | Reader |
| --- | --- |
| `single-call-eac` | `gpt5-mini-explicit-abstention-composition-v1-reader` on the full context (control) |
| `calibration-only` | `gpt5-mini-calibration-only-v1-reader` on the full context |
| `two-stage-routed` | mini selection on routed questions, fallback reader elsewhere |
| `two-stage-all` | mini selection on every question |
| `two-stage-routed-nano` | nano selection on routed questions |

The configuration fixes the ordered 100-question development selection, the
context plan digest, one or two pin variants, the arms, `repeats` (1–3), a new-call
allowance and the campaign pin. Every repeat of a request is a distinct physical
row in the same campaign store through the store's repeat index, so all repeats
share one cap and one ledger. Identical physical requests are shared: an unrouted
question in a routed arm reuses the calibration-only control's answer request, and
identical selections from two selector profiles produce byte-identical stage-two
requests.

Phases run in order: every selection for every repeat, a frozen answer phase plan,
answers, then the scorer labels are opened, a frozen judge phase plan, and native16
judges. The report (`oh.memory.two-stage-lane-report.v1`) lists per case the
question, variant, arm, repeat, selector status, memory kind and fallback reason,
selected turn count and context digest, reader, both stage request digests, judge
digest and score. Per arm and pin it gives per-repeat scores, per-question mean and
majority-of-repeats totals, category slices, fallback rate and reasons, accounting
and end-to-end service time. Paired rows against the control on the same pin give
majority-of-repeats deltas, wins, losses, ties, the temporal slice and the
descriptive gate arithmetic (two-stage: at least +3 with at most 2 regressions,
temporal not worse, fallback at most 10%; calibration-only: at least +2 with at
most 1 regression). When two pins are configured, a memory-delta row per arm
gives the first pin minus the second under that reader.

Gate arithmetic in the report is descriptive. Promotion additionally needs the
complete three-repeat matrix, the separately committed predicted-flip check and
the paired bootstrap from the analysis plan; a miss is not established, not no
effect.

## Contracts

`evidence-selection-v1` (stage one), `selected-answer-v1` (stage two) and
`calibration-only-v1` (explicit-abstention-composition plus calibration, without
the calibrated-abstention clause) are closed reader contracts with profile IDs for
every base reader. `calibrated-composition-v1` and `timeline-composition-v1` stay
byte-identical for replay of their recorded runs; their "only recorded order"
example is a dataset-specific answer rule and is marked legacy in the contract
source. New contracts must not name a product, phrase or ordering edge case
without a corpus-general justification.

## Tests

`tests/memory-benchmark-evolution-question-shape.test.ts` covers the router,
bounds, audit table and card. `tests/memory-benchmark-evolution-two-stage.test.ts`
covers the policy identities, the alias grammar, plan and pool validation,
source re-rendering, every fallback reason, the complete five-arm two-pin matrix
with a fake provider (shared physical requests, router audit, memory delta,
zero-call replay), three repeats in one store with mixed selector failures, a
zero-allowance run and configuration rejection. No test reaches a provider.
