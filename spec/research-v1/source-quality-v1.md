# Source quality V1

This pack records measured source performance: scorecards that state a hit
rate at a stated horizon over a stated sample, the maturity of that
measurement, the veto rules that can disqualify a source regardless of its
rate, and the domain the measurement applies to. Measured reliability is
recorded data. It is not a truth score, and it never generalizes beyond its
stated scope.

`createSpongeSourceQualityPackV1(previous)` accepts catalog V7 and returns
revision 1 of `sponge.source-quality`. Catalog V8 includes this optional pack.
It adds three concepts and nine predicates without changing earlier
declarations or locks. These are original local definitions under MIT; no
upstream vocabulary mapping is claimed.

## Score a source at a stated horizon

`source-scorecard` identifies one measured performance record for a source.

- `scorecard-source` names the source entity the scorecard measures.
- `horizon-days` records the evaluation horizon in whole days: the window
  after which predictions were checked.
- `hit-rate` records the measured hit rate as a decimal between 0 and 1,
  computed over the stated sample only.
- `observation-count` records the number of scored observations.
- `preregistered-sample` records the sample size committed before scoring.
  Comparing `observation-count` with `preregistered-sample` is the recorded
  basis for trusting or discounting the rate.
- `scorecard-maturity` names a `maturity-descriptor` entity — for example
  provisional, calibrated, established or retired.
- `applies-to-domain` names the domain entity the measurement covers. A
  scorecard measured on one domain does not score the source on another.

## Record veto rules explicitly

`veto-rule` identifies a stated rule that disqualifies a source for a purpose
regardless of its measured rate — for example undisclosed sponsorship or a
retracted record. `veto-rule-text` keeps the stated rule, and `triggered-veto`
connects a scorecard or record to the rule that fired. A triggered veto is
recorded evidence; it does not delete or rewrite the scorecard.

## Boundaries

These records carry a measurement's own parameters so a reader can judge them.
They do not compute hit rates, verify pre-registration, select trusted
sources, or rank sources for any purpose. `sponge.core` `start-time` and
`end-time` remain the way to bound the measurement window itself.

The direct dependencies are `sponge.core`, `sponge.foundation` and
`sponge.reference`, pinned to their V7 manifests. The query entries are
declarative predicate inventories, not executable queries.
