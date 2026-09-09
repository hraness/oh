# Finite-pool answer comparisons

This analysis estimates the difference in judged answer accuracy on a fixed
pool of question-family representatives. It requires a simple random sample
without replacement, a frozen protocol, and one binary result per selected
family and system. It does not assume that conversation histories in different
families are independent. It does assume that the outcomes being sampled are
fixed: one family's selection or execution must not change another's outcome.

LongMemEval families can reuse conversation content, sometimes under different
dates or session IDs. Bootstrapping nominal family IDs therefore does not by
itself justify inference to new independent histories. The finite-pool result
has a narrower target: the explicitly recorded eligible representatives. A
single reader and judge realization also leaves model and grading variation
outside the interval. It is not a bound on all future reader executions.

## Calculation

Let M be the pool size and n the sample size. Among paired judgments, w families
are correct only for the candidate, and l only for the baseline; m = w + l.
In the complete pool, let A and B denote those two kinds of discordance,
D = A + B, and E = A - B. The accuracy difference is E/M.

Conditional on observing m discordant families in a simple random sample,
the number of candidate wins has a hypergeometric distribution with population
D, successes A, and m draws. This uses the ordinary
[hypergeometric sampling law](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/Hypergeometric.html).
For a null hypothesis E <= h, the implemented conservative upper-tail p-value is:

- Consider every feasible D from m through M - n + m.
- Set K = min(D, floor((D + h)/2)); skip negative K.
- Take the largest hypergeometric probability P(W >= w) across those D values,
  using K successes and m draws. If no null population is feasible, the value is zero.

K is the largest number of candidate wins allowed by the null at fixed D.
The hypergeometric upper tail increases with K, so maximizing over D and K
bounds every feasible null population. This nuisance maximization is
conservative and can lose information from the observed discordant count.

A one-sided lower confidence bound is (h* + 1)/M, where h* is the largest integer
margin whose null is rejected at alpha. The p-value is monotone in h, allowing
binary search. The implementation uses exact BigInt arithmetic for tail sums
and comparisons, including the exact binary value of the supplied alpha.
Conversion to a JavaScript number occurs only when returning a displayed
p-value or accuracy bound.

A complete census has no sampling uncertainty: the bound equals (w - l)/M.
A partial sample with no discordance still has uncertainty about unobserved
families. Neither case removes judge errors or establishes generalization
beyond this pool.

## Conditions for a confirmatory run

Freeze the eligible pool, its representative rule, the selected sample,
source identities, systems, model profiles, prompts, context budget, failure
policy, primary comparisons and decision rule before reading outcomes.
Complete the entire planned answer and judgment matrix. Missing judgments,
sample changes, outcome-driven retries or optional sample expansion invalidate
the confirmatory decision; report an incomplete or exploratory result instead.

For two primary comparisons, use alpha = 0.025 for each one-sided bound.
Bonferroni then bounds the familywise error at 0.05 without requiring the two
comparisons to be independent. A run may claim improvement over both specified
baselines only when both bounds exceed zero. An additional observed gain
threshold is a decision requirement, not proof that the population gain
exceeds that threshold: that stronger claim requires the lower bound itself
to exceed it.

The focused tests cover exact-alpha boundaries, full censuses, no-discordance
samples, invalid inputs and direct small-population type-I error and interval
coverage enumeration. These tests support the implementation; the applicability
of the sampling and fixed-outcome assumptions remains part of each run's
protocol and limitations.
