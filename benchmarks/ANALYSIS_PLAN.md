# Pre-registered analysis plan

This plan fixes how every score of the current improvement program is
computed and compared before any candidate is run. It applies to every arm
run under the [protocol card](PROTOCOL_CARD.md). Changing the plan after a
score has been read is a reported deviation, not an amendment. The plan was
fixed on 2026-09-10.

## Scored quantity

- The scorer is `scripts/benchmarks/evolution-paired-stats.ts`. It joins the
  reader plan, reader output, judge plan and judge output of a run by
  (question, variant, reader, repeat) with the request digest as the
  integrity key, asserts that the context digest of one variant is identical
  across readers and repeats, and applies the verdict rule "judge answer
  contains yes"; reader and judge failures score zero and are counted.
- Each arm runs three repeats through the campaign store's repeat index
  inside one campaign. The per-question score is the mean over repeats. The
  externally compared number is the mean of the three run totals, published
  with each single run and the range. Majority-of-3 is an internal gate
  statistic only.
- No run is dropped, no repeat is added after a result is read, no retry is
  outcome-driven. A missing judgment invalidates the comparison.
- Gold-suspect questions stay in every denominator and are never relabelled.
  There is no gold-corrected score.
- No dataset-specific answer rule is added to a reader contract or renderer.
  Any contract or renderer text that names a dataset artefact needs a
  corpus-general justification written before the run.

## Primary comparisons

Every candidate is compared with two reader-matched controls on the same
questions and the same number of calls per question:

1. candidate versus BM25 window at the same budget, run with the promoted
   reader contract;
2. candidate versus the previous Oh semantic configuration, run with the
   promoted reader contract.

The primary statistic is the paired difference in per-question mean
correctness. Its interval is a cluster bootstrap over the declared manifest
groups with 10,000 resamples and seed 17, reporting the one-sided 97.5% lower
bound. Holm's step-down is applied across the primary comparisons of one
gate. The Holm family is the set of comparisons declared for one study in one
`rescore` invocation, which is one call of the scorer; two invocations or two
study labels are separate families, so the checkpoint and the final full-500
read are each decided at one-sided 0.025 over their own two primary
comparisons, and the final read is the promotion decision. "Better than"
means the chain reaches the comparison (every smaller p met its own level)
and the lower bound at its Holm level is above zero; a comparison whose own
p is under 0.025 is not better when a smaller p in the family failed its
level. "Clearly better" additionally requires an observed gain of at least 5
points. The re-score of the
published mini result shows the lower bound moves by at most 0.2 points
between seeds at 10,000 resamples and equals +1.6 at 100,000.

A second interval under content-based reclustering is reported beside the
primary one: questions whose labelled evidence sessions share normalized
text form one cluster, joined with the declared groups. On LongMemEval_S this
gives 453 clusters against 471 declared groups. Linking on any shared
haystack session joins all 500 questions into one component and is not a
usable resampling unit.

## Secondary statistics

Reported for every comparison, descriptive, never a promotion criterion:

- wins, losses and ties on per-question means and on majority-of-3;
- the exact one-sided sign test on discordant pairs;
- the finite-population lower bound treating the 500 questions as a census;
- per-category slices (temporal reasoning, knowledge update, multi-session,
  single-session user, assistant and preference) and per-stratum slices
  (development, inspected-closed, aggregate-only-closed);
- reader flip rate (questions whose verdict differs between repeats) and
  judge-only flip rate (identical answer strings with differing verdicts),
  reported separately;
- the recoverable pool: questions correct in a majority of repeats of some
  arm, replacing the earlier max-over-arms counts;
- predicted-flip precision and recall against the pre-committed private
  prediction list, with unpredicted gains counted as noise unless they
  replicate in all three repeats, and unpredicted losses;
- a conversation-level permutation test for LoCoMo.

## Gates

- Reader-change gates run on the 100 development questions with
  byte-identical contexts per arm and promote on a majority-of-3 gain of at
  least 3 questions against the matched control with at most 2 regressions,
  the temporal slice not worse and a router fallback rate of at most 10%.
- Memory-side gates screen on the development questions for regressions only
  and decide on mechanism diagnostics plus the full-500 checkpoint read,
  because their expected development effect is inside the noise floor.
- A failed development gate is "not established", printed with its a-priori
  power from the protocol card. For a mechanism whose expected development
  effect is inside noise it is not evidence of no effect.
- At most two candidate full-500 reads happen: one checkpoint and one final.
  A combined arm is kept only if its mean-of-3 exceeds the previous promoted
  configuration's 3-run baseline by at least two standard deviations of that
  baseline with the Holm-adjusted paired lower bound above zero against the
  reader-matched BM25 control; otherwise the last promoted arm stands.
- Closed-partition identifiers never appear in a gate report. Ten
  development-partition canary questions are tracked per arm; their
  identifiers stay in the private reports.

## Strata and exposure

All 500 LongMemEval_S questions are development or evaluated. The full-500
number is a descriptive, in-sample score reported with the three strata side
by side. It is never called out-of-sample. Per-question inspection is
allowed only on the development questions and on the already inspected
closed questions, under the private work directory. Aggregate-only questions
are never read per question. A leakage scan for question text, gold and
closed identifiers outside the private directory runs at every final gate;
a hit halts the program.

## Sealed holdout

Under the budget policy the sealed holdout is the LoCoMo test split: the
existing seeded 20/80 split of the ten conversations, categories 1 to 4,
1,540 questions, all ten conversations already exposed by earlier retrieval
and reader studies and declared as such. The design is fixed before the
first reader call: candidate source digest, non-droppable controls (BM25
window and full context), readers (GPT-5 nano with three repeats; GPT-5 mini
candidate and control), the judge and the rule "lower bound above zero
against the reader-matched BM25 control". Eight conversations give wide
cluster intervals, which the report states. BEAM is not run.

## Claim ladder

The program never claims state of the art. Rung 1, held today: beats BM25 at
the mini tier on LongMemEval_S, +4.4 points, interval +1.6 to +7.3, below the
5-point clear-gain rule. Rung 2: passes the pre-registered LoCoMo test rule
against reader-matched controls. Rung 3: the tier-qualified in-sample
statement that the 3-run mean and range are at or above a leader's single
self-reported point estimate at the same reader tier under an alias judge,
shown with a two-sample binomial comparison that treats the vendor score as
n = 500. Rung 4: third-party harness placements. Formatting-class gains are
alias-only and excluded from every rung because no official-judge check is
run.
