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

### Real-corpus run (`results/deductive-memory-locomo-v1.json`)

`scripts/benchmarks/deductive-memory-real.ts` ingests the LOCOMO dev corpus
`conv-49` (509 turns, 25 sessions) into a real Oh SQLite store through the
same batched `store.commit` path the native lab uses, replays the operation
log (`integrity: verified`), reads the snapshot back, and projects the
`edition` records into `algal.memory.v1` facts. Projection is mechanical
only — speaker/session/date become `states`/`states-at`, capitalized tokens
become lexical `mentions`. No labels, no paid calls, no fabricated
`contradicts`/`supersedes` facts.

Two measured findings shaped the architecture:

- **Snapshot bound is real.** `algal.memory.v1` caps a snapshot at 256 KiB /
  2048 facts; the full corpus projects ~8,900 facts. The honest shape shards
  at session granularity (25 shards, max 598 facts / 103 KiB each) plus one
  compact corpus-level index (~200 facts).
- **Work bound is real.** The engine's naive-scan join charges per
  `(binding × tuple)` scan *before* the relation check, so multi-literal
  rules over ~600-fact shards exhaust the 250K work budget. Shards therefore
  run zero-rule base-fact queries (proof-carrying provenance lookups); the
  session-granular index carries the derived queries.

Results on real data: `record-refers` resolved 50 (session, speaker) index
records through `mentions ∘ refers` with proof DAGs terminating in the index
record digests; `history-at` restated all 25 session dates as derived facts;
the consistency audit reported 0 conflict pairs and 0 stale facts — a true
negative, since the corpus carries no projected contradiction or supersession
facts. Every query result replay-verified under `verify()`.

## Boundaries

- These are benchmark seams. Nothing here is a production retrieval path,
  public API, or default.
- Datalog proofs witness *derivation from the supplied facts* — they are
  evidence provenance, not proof of truth or provider attestation.
- Proof-carrying queries are intra-shard: at corpus scale, cross-session
  derivation requires a compact index projection (as demonstrated) or a
  bounded aggregation layer that does not yet exist.
- The 250K-work naive-scan join is the measured feasibility ceiling;
  production-scale deductive queries would need indexed evaluation, which
  changes the work metric and therefore the `algal.query-result.v1` contract.
- Conformal coverage is a marginal guarantee under exchangeability; it says
  nothing about a specific query's certainty.
- Calibration must be re-fit and re-measured per cohort; the development fit
  does not transfer claims to other data.
