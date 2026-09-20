# Compact repair: held-out confirmation

A fixed Jev-assisted repair raised the benchmark score on two questions and lowered none among 24 BEAM questions, but it did not meet the preregistered confirmation rule. The instruction-score confidence interval includes zero. This is a promising small result, not a confirmed quality gain or a production recommendation.

The candidate first creates a baseline answer, uses Jev to select applicable instructions and check compliance, and conditionally makes one further reader call with a compact repair prompt. The comparison tests that complete procedure. It does not isolate Jev's contribution from the additional reader call.

## Frozen comparison

The candidate was selected on a separate development group before confirmation. Confirmation used 24 questions from eight histories disjoint from the eight development histories: 16 instruction-following questions, four information-extraction questions and four temporal-reasoning questions. Prompts, cases, scorer and decision rule stayed unchanged. The operational score uses the corrected Rust BEAM scorer; a separate half-credit sensitivity score is retained in the result.

| Operational BEAM score | Baseline | Compact repair | Paired difference |
| --- | ---: | ---: | ---: |
| Instruction following, 16 questions | 79.17% | 88.54% | +9.375 percentage points |
| Pooled controls, 8 questions | 62.50% | 62.50% | 0 |
| All 24 questions | 73.61% | 79.86% | +6.25 percentage points |

The instruction comparison had two wins, 14 ties and no losses. Its 95% whole-history bootstrap interval was **0 to +21.875 percentage points**, using 10,000 resamples and seed 20260919. Controls tied on every question. Across all questions there were two wins, 22 ties and no losses.

Success required a positive instruction difference, an instruction confidence lower bound strictly above zero, nondecreasing pooled controls and a nondecreasing overall score. Three conditions passed; the confidence condition failed. The frozen verdict is **unsuccessful confirmation**, with no production activation. The sample was not expanded after observing this result.

## What this establishes

The previously selected compact procedure retained its direction of improvement on a history-disjoint group. The effect remains imprecise with eight independent history clusters. This cohort is not certified globally unseen, and the bootstrap does not include model or judge variability from repeated draws. Model names served through Gateway are aliases, not verified immutable snapshots.

The baseline is an experimental reader with lexical aids and full source context, not current production Oh. Benchmark scores do not establish source grounding or a hallucination rate. A future causal comparison needs an equal-budget second-reader control; these results cannot show that Jev itself caused the gains.

The separate [source-bound answer-program probe](ANSWER_PROGRAM_SPIKE.md) addresses a different question: exact code can enforce joins and output rules, but semantic admissions can still attach evidence to the wrong item. Its authored fixtures must not be pooled with this BEAM confirmation.

## Execution and cost

The procedure used 24 baseline calls and 13 repair calls; 11 candidate answers passed through unchanged. The 48 logical answer cells were graded through 90 logical judge calls, deduplicated to 68 new physical requests. Confirmation added 258 Jev applicability calls and 28 compliance calls.

An independent offline audit reconstructed the captured requests and responses, replayed all 48 grades and the frozen decision rule, preserved the previous 291 Gateway records, and reconciled every semantic ledger exactly once. The audit made no provider calls.

This confirmation added **$1.027007**. Cumulative campaign exposure is **$4.024362 of the $10 cap**: $3.791594 settled plus $0.232768 retained for two uncertain earlier attempts. There were no new uncertain requests. The complete campaign contains 396 Gateway requests and 673 settled Jev requests.

[Audited aggregate result](results/memory-compact-repair-confirmation-v6.json) records the complete development and confirmation statistics, fixed verdict, source and scorer identities, execution counts, model profiles and accounting. It excludes source conversations, answer prose and judge traces; it supports inspection of the reported aggregates, not a public replay of the underlying private captures.
