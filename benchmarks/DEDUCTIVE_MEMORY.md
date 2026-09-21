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
- **Work bound was real, and is now versioned.** The v1 engine's naive-scan
  join charges per `(binding × tuple)` scan *before* the relation check, so
  multi-literal rules over ~600-fact shards exhaust the 250K work budget
  (measured: `deductive-memory-locomo-v1.json` shards could only run
  zero-rule base-fact queries). `deductive-memory-real.ts` now runs the
  **indexed evaluator**: per-relation + per-position tuple indexes built per
  fixpoint round, charging work per candidate actually examined. Bucket order
  preserves the global canonical tuple order, so `rows` and `proofs` are
  byte-identical to scan — only `work` differs, which is why results carry
  `algal.query-result.v2`.

Results on real data (`deductive-memory-locomo-v2.json`): the full rule packs
now run on **every session shard** — `record-refers` resolves each shard's
mention provenance at ≤3,835 work (vs. >250K infeasible under scan, ~100×
reduction), `history-at` at ≤1,929, and the three-literal `conflicted` audit
completes per shard at ≤1,363 work (measured). The corpus index answers 50
(session, speaker) `record-refers` rows at 1,405 work and 25 `history-at`
rows at 731. Audit across all 25 shards plus the index: 0 conflict pairs, 0
stale facts — a true negative, since the corpus carries no projected
contradiction or supersession facts. Every result replay-verifies under
`verify()` (which dispatches on the result's contract literal).

## Boundaries

- These are benchmark seams. Nothing here is a production retrieval path,
  public API, or default.
- Datalog proofs witness *derivation from the supplied facts* — they are
  evidence provenance, not proof of truth or provider attestation.
- Proof-carrying queries are intra-shard: at corpus scale, cross-session
  derivation requires a compact index projection (as demonstrated) or a
  bounded aggregation layer that does not yet exist.
- `algal.query-result.v2` results are produced and verified by the indexed
  evaluator only — the `work` metric differs from upstream Rust `v1`, so v2
  is not cross-verifiable against the reference engine. `scan` mode remains
  the byte-faithful v1 path.
- Conformal coverage is a marginal guarantee under exchangeability; it says
  nothing about a specific query's certainty.
- Calibration must be re-fit and re-measured per cohort; the development fit
  does not transfer claims to other data.
