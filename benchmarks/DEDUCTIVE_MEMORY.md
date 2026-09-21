# Deductive memory and calibrated selection seam

Five benchmark-scoped primitives, composed in
[`scripts/benchmarks/deductive-memory.ts`](../scripts/benchmarks/deductive-memory.ts).
None of them changes production retrieval, the store, or any wire contract.
They answer a narrower question than "is retrieval good": can memory answers
carry their own evidence, and can channel selection be principled instead of
greedy top-k?

## What each piece does

**Proof-carrying Datalog** (`scripts/benchmarks/memory-datalog.ts`). A
byte-faithful TypeScript port of ALGAL's bounded positive-Datalog engine
(`algal.memory.v1` / `algal.query.v1` / `algal.query-result.v1`, kept verbatim
for cross-implementation parity). Facts are `{relation, tuple, sources}` rows
whose sources are content digests; rules are safe (every head variable bound
in the body); evaluation is a fixpoint under fail-closed budgets on work,
rounds, derived tuples, join bindings, rows, and output bytes. Every derived
tuple carries a content-addressed proof node; `verify` replays the query and
compares canonical bytes, so an answer is checkable without trusting the
evaluator.

**Consistency rule packs** (`scripts/benchmarks/consistency-rules.ts`). A
frozen vocabulary (`FACT_RELATIONS`) plus four validated rule packs —
`alias-expansion`, `supersession`, `temporal`, `consistency-audit` — expressed
as data. The positive fragment is the honest boundary: negation, inequality,
aggregation, and self-pair exclusion are inexpressible, so comparisons are
projected as facts (`contradicts`, `valid-after`) and set difference is left
to the consumer.

**Jev calibration** (`scripts/benchmarks/jev-calibration.ts`). Isotonic
(PAVA) and Platt calibrators over labeled `(score, label)` samples, with ECE,
Brier, and log-loss metrics and a deterministic k-fold evaluation. Every
model carries a digest bound to its exact training input.

**Conformal selection** (`scripts/benchmarks/conformal-selection.ts`).
Split-conformal thresholding: select all candidates scoring above a
quantile-derived cutoff, with the honest finite-sample marginal coverage
bound reported — never the bare nominal target. Vacuous calibration fails
closed to an empty set.

**Submodular packing** (`scripts/benchmarks/submodular-selection.ts`).
Density-greedy monotone-submodular maximization with a best-single fallback
under a byte budget, emitting a marginal-gain trace so the selection is
auditable pick by pick.

## Evidence so far

On the frozen `jev-request-shape-v1` captures (505 pointwise scores, 25
annotated positives), isotonic recalibration cut 5-fold held-out expected
calibration error from 0.155 to 0.019 and Brier score from 0.157 to 0.046.
Platt's logistic fit diverged on the near-separable cohort and is not the
recommended default. The full artifact is
[`results/jev-isotonic-calibration-v1.json`](results/jev-isotonic-calibration-v1.json).

## Boundaries

- These are benchmark seams. Nothing here is a production retrieval path,
  public API, or default.
- Datalog proofs witness *derivation from the supplied facts* — they are
  evidence provenance, not proof of truth or provider attestation.
- Conformal coverage is a marginal guarantee under exchangeability; it says
  nothing about a specific query's certainty.
- Calibration must be re-fit and re-measured per cohort; the development fit
  does not transfer claims to other data.
