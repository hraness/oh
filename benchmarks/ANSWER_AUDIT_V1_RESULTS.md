# Answer audit development results

The second-pass answer audit did not provide a convincing improvement. Across
100 LongMemEval-S development questions and three indexed repeats, GPT-5 mini
answered 280/300 correctly after auditing its earlier drafts, compared with
278/300 for those drafts. The mean difference was +0.67 percentage points, with
seven improvements and five regressions. We are dropping this approach as the
next performance intervention; these results do not establish that it is
generally ineffective.

The original experiment aborted after an upstream HTTP 520 response. A
separately frozen diagnostic continuation completed on September 11, 2026,
without retrying that request. **The original run remains aborted and its
promotion result remains false.** The [original plan](ANSWER_AUDIT_V1_PLAN.md)
is unchanged.

## What was compared

The audit reader received an authenticated prior draft, the same question and
question date, and the same complete retrieved raw-turn context. It could keep
or revise the draft after checking entities, events, preferences, updates,
dates, arithmetic and uncertainty. Retrieval and context bytes were unchanged.
Gold references, benchmark categories and prior correctness labels did not enter
the reader request.

Both readers used GPT-5 mini: the historical calibration-only profile supplied
the control drafts, and the answer-audit-v1 profile supplied the second pass.
Changed answers used the original LongMemEval native reference rubric through
the Gateway GPT-4o judge, with a 16-token output bound. Provider aliases were
not verified dated model snapshots. Exactly unchanged answers reused their
authenticated original grade: 57 grades were reused and 241 new judge calls
completed.

This was a paired development replay with historical controls, not a fresh
simultaneous comparison. Each indexed repeat produced one answer per question;
no answer was selected using correctness or rerun after failure. All 300 cells
remain in the denominator, including the failed historical draft and the failed
original audit request, each scored zero. The continuation admitted only
previously unissued requests and produced no new failures.

## Answer correctness

| Repeat | Historical draft | Audited answer | Improvements | Regressions | Ties | Exact paired p-value |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 92/100 | 93/100 | 4 | 3 | 93 | 1.0 |
| 2 | 93/100 | 93/100 | 1 | 1 | 98 | 1.0 |
| 3 | 93/100 | 94/100 | 2 | 1 | 97 | 1.0 |
| Mean accuracy | 92.67% | 93.33% | | | | |

The primary comparison is single-answer correctness within each repeat. The
exploratory, two-sided exact paired binomial tests use 100 questions per repeat
and are unadjusted across repeats. The 300 correlated repeat cells are not
treated as 300 independent questions. The observed changes provide little
evidence of a reliable gain.

The audited answers retain 20 incorrect cells: seven, seven and six by repeat.
Four of the five regressions are completed answers judged incorrect; the fifth
is the retained HTTP 520 failure. Removing the transport failure would not
remove the settled answer regressions.

| Category | Questions per repeat | Draft correct across repeats | Audit correct across repeats |
| --- | ---: | ---: | ---: |
| Knowledge update | 17 | 45/51 | 45/51 |
| Multi-session | 28 | 78/84 | 77/84 |
| Single-session assistant | 17 | 50/51 | 50/51 |
| Single-session preference | 5 | 11/15 | 14/15 |
| Single-session user | 11 | 33/33 | 33/33 |
| Temporal reasoning | 22 | 61/66 | 61/66 |

The unweighted category macro mean rose from 90.81% to 93.95%, largely because
the five-question preference category improved. It does not replace the primary
question-weighted mean. All seven unanswerable questions remained correct in
every repeat, giving 21/21 for both readers.

The retrospective judge-oracle majority fell from 95/100 to 94/100, with one
improvement, two regressions and 97 ties. This statistic uses the correctness of
three answers; it is not a deployable answer-selection method. Temporal majority
correctness fell from 21/22 to 20/22. Thus even this descriptive continuation
does not meet the original rule requiring at least three net majority gains
and no temporal regression. It cannot restore the failed original promotion.

## Cost and failures

| Attribution | Physical calls | Confirmed USD | Retained unresolved USD |
| --- | ---: | ---: | ---: |
| Original aborted attempt | 101 | $0.378755 | $0.037863 |
| Diagnostic continuation only | 439 | $0.817974 | $0.000000 |
| Audit campaign total | 540 | $1.196729 | $0.037863 |
| Reused historical draft generation | 300 | $1.304310 | $0.036751 |
| Reused historical judging | 299 | $0.126536 | $0.000000 |
| Historical pipeline plus audit campaign | 1,139 | $2.627575 | $0.074614 |

The audit total includes the original attempt and continuation; those rows must
not be added again. Its 540 calls comprise 299 audit-reader requests and 241
judge requests. Total audit exposure is $1.234592 against the unchanged $20 and
600-call caps. Historical generation and grading remain attributed even though
their outputs were reused. Including them, total exposure is $2.702189.

The historical draft failure retains $0.036751, and the original audit HTTP 520
retains $0.037863. Both are unresolved reservations, not confirmed charges. No
failed request was retried. These usage-based amounts are not a consolidated
provider invoice. The diagnostic row schema does not retain settled-call service
durations, so this report makes no new latency comparison.

## Scope and provenance

These are results on 100 previously exposed development questions. They do not
establish held-out or full-500 performance, benchmark superiority, or production
qualification. The combination of a small mean change, settled regressions and
a weaker retrospective majority does not justify promoting the audit or
spending further on variants of this intervention.

An independent offline projection checked the pinned development inputs, all
300 paired cells, preserved first responses, fixed failures, and cost accounting
against the frozen result and event receipts. It made no model calls. The
execution source was commit `9740412236e76647345fd917acab6d3575768dee`.
Full source contexts, questions, answers and per-case captures remain private;
the following SHA-256 identities identify the retained evidence without
publishing its contents.

| Artifact | SHA-256 |
| --- | --- |
| Original launch | `fef701c9460a553ef4ad017ad175f24cefe0c27f2c444cb00ddb735e97fcceeb` |
| Original aborted result | `60739356cc147931ed6a8e821f45150cc97225a76b445f02a7acdbf6a7ed9999` |
| Diagnostic launch | `490e081cb66274f209aca2cfc9347c21e0562dbc5fb9331bbf8c73bdf7107a11` |
| Diagnostic result | `bfbec638edbda178e7475750d84060ee3f42079e52a5ff00bbb3a10ce7771907` |
| Independent public aggregate | `4ce96264028e3d758463e90ed0990aa659503a7bea69eea0b977ac7f7c5b949a` |
| Independent public report | `2ef8e7eedb7914c9249cf7d17d9b77f06cb22a15faf894489dd9b27cdba3abeb` |
