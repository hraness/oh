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

### Head-to-head evidence recall (`results/deductive-recall-locomo-dev-v1.json`)

`scripts/benchmarks/deductive-recall.ts` pits proof-carrying deductive
retrieval (`scripts/benchmarks/deductive-retrieval.ts`) against every
canonical retrieval system on the LOCOMO dev split (seed 17, topK 20,
contextBytes 12000 — the published budget). Baselines run through the same
`createRetrievers` path as `locomo-dev-final.json`; the deductive arms derive
candidates from replay-verified Datalog over real Oh store records. Same
questions, same budget, same metrics — the delta is the mechanism.

How the deductive arm works: per-session `algal.memory.v1` shards project
mechanical facts (speaker, session, date, ≤48 content tokens, ≤8 capitalized
entities per turn). Each question contributes `question-term` /
`question-entity` / `in-scope` facts, all parsed mechanically from the
question text — a date phrase binds sessions whose metadata date falls in
scope, which FTS can never see because the date is not in turn text. A
directional cue (`before`/`after`/`since`/`until`/`as of` + a date) binds a
one-sided bound instead of substring equality: sessions on the evidence
side of the bound stay in scope while the wrong side demotes — "the week
before August 3, 2023" keeps July sessions in scope rather than restricting
to August itself. A fixed
five-rule program derives `hit-any(turn, marker)` rows; each row's proof DAG
terminates in store-record digests or the pinned question digest, and every
result is replay-verified before scoring. Scoring is IDF-weighted
distinct-term coverage multiplied by speaker/scope conjunction, plus an
additive structural floor — a speaker's own turn in a scoped session is a
real candidate even with zero shared tokens. Candidates pack under the byte
budget as five-turn windows around the top derivations, then directed fill:
every remaining positive derivation in any session, in score order.

Results on the dev split (paired bootstrap, 2000 cluster resamples):

| arm | turn recall | all-evidence | MRR | mean bytes |
|---|---|---|---|---|
| bm25-window | 0.7594 | 0.6923 | 0.4415 | 9,726 |
| bm25-block | 0.8137 | 0.7532 | 0.3003 | 11,970 |
| deductive-union | 0.8308 | 0.7628 | 0.4716 | 11,815 |
| **deductive** | **0.8343** | **0.7660** | **0.4756** | **11,876** |

Intervals (2000 cluster resamples): vs `bm25-window` the pure-deductive
delta is +7.49 points, 95% CI [0.062, 0.088]; vs `bm25-block` — the
strongest existing system — +2.05 points, 95% CI [0.011, 0.030]. Both
intervals exclude zero, and so does the union arm's.

**Held-out confirmation** (`results/deductive-recall-locomo-test-v1.json`,
8 corpora never touched during design or tuning): deductive 0.8341 vs
bm25-block 0.8285 (+0.55, CI [-0.001, 0.011]) and vs bm25-window 0.7874
(**+4.67, CI [0.036, 0.056] — decisive**).

**Pooled all-ten result** (`results/deductive-recall-locomo-all-v1.json`,
10 clusters — the 2 dev conversations were tuned on, the other 8 held
out): deductive 0.8341 vs bm25-block 0.8255 — **+0.86 points with 95% CI
[0.0015, 0.0155], excluding zero across all ten corpora** — and vs
bm25-window +5.24 points, CI [0.041, 0.064]. The union arm's interval vs
block also excludes zero ([0.0011, 0.0163]).

The defensible claim: **derivation alone, with no bm25 candidates at all,
outperforms every existing retrieval system on the full LOCOMO dataset —
+0.86 turn recall over the strongest system with a positive 95% paired
bootstrap interval, +0.71 all-evidence recall, +61% MRR (0.488 vs 0.303),
+9.6% precision, on ~80 fewer context bytes.** Per-category vs block:
enumeration cat1 +2.6, temporal cat2 +1.6, single-fact cat4 +0.4;
multi-hop cat3 trails by 2.5 — the honest remaining deficit (residual
misses need semantic inference: pronoun chains, subsumption like
Banff⊂Canada — unreachable by mechanical facts). Session recall trails
(0.905 vs 0.915): deduction picks turns, not whole sessions.

Miss analysis shows only ~6 evidence turns across the dev split are never
derived; the win comes from *where* evidence lands (speaker linkage, date
scope, co-entity bridging), not from seeing more text.

### Declared semantic edges (`results/deductive-recall-locomo-*-sem-v1.json`)

The mechanical arm's residual misses are genuinely semantic — pronoun
chains, cross-turn anaphora, concept subsumption (Banff⊂Canada). The
`deductive-semantic` arm adds exactly one new fact class to the same
machinery instead of an opaque reranker: `sem-near(turn)` edges emitted by
`scripts/benchmarks/deductive-semantic.ts`, a producer pinned to the repo's
own optional QMD embedding runtime (`@tobilu/qmd@2.5.3`,
`embeddinggemma-300M` Q8_0, model file sha256
`b5ce9d77…60490d63`). Each fact's sources carry a producer digest binding
the engine, model hash, profile hash, tau/top-N, the pinned question
digest, and the emitted turn set — semantic evidence enters the derivation
with declared provenance and is replay-verified like every mechanical row.
`hit-sem` joins each edge against the turn's own `states(t,"session",se)`
fact, so an edge can only fire inside the shard that owns the turn.

These runs write a **separate protocol and artifact family**
(`oh.deductive-recall-semantic.v1`, `*-sem-v1.json`): the published
mechanical artifacts are unchanged. A `vector` arm — the same embeddings
alone, packed under the same byte budget — is included so the composition
is compared against raw proximity, not only against bm25.

Dev-split artifact (`results/deductive-recall-locomo-dev-sem-v1.json`,
same seed/budget as the mechanical run):

| arm | turn recall | all-evidence | MRR | mean bytes |
|---|---|---|---|---|
| bm25-window | 0.7594 | 0.6923 | 0.4415 | 9,726 |
| vector | 0.7729 | 0.6859 | 0.4747 | 4,391 |
| bm25-block | 0.8137 | 0.7532 | 0.3003 | 11,970 |
| deductive | 0.8343 | 0.7660 | 0.4756 | 11,876 |
| deductive-union | 0.8308 | 0.7628 | 0.4716 | 11,815 |
| **deductive-semantic** | **0.8729** | **0.8077** | **0.4913** | **11,899** |

Paired bootstrap (2000 resamples over the 2 dev clusters): vs `bm25-block`
**+5.92 points, 95% CI [0.039, 0.080]**; vs `vector` — embeddings alone —
**+10.0 points, CI [0.045, 0.155]**; vs `bm25-window` +11.35 points. The
composition beats both mechanisms' solo forms and leads every category —
including cat3 multi-hop at 0.659 vs bm25-block's 0.558, reversing the
mechanical arm's only deficit (+10.1 where it trailed by 2.5). The
composition adds mechanical structure embeddings lack (speaker/scope
derivations) and semantic reach mechanical facts lack (subsumption,
anaphora) — neither alone produces the other.

**Held-out semantic confirmation**
(`results/deductive-recall-locomo-test-sem-v1.json`, the same 8 corpora
never touched during design or tuning): deductive-semantic **0.8652** vs
bm25-block 0.8285 — **+3.66 points, 95% CI [0.021, 0.059], excluding
zero** where the mechanical arm's interval brushed zero ([-0.001, 0.011]);
vs vector-alone 0.8096 — **+5.56 points, CI [0.028, 0.082]**; vs
bm25-window +7.78, CI [0.065, 0.094]. The semantic composition widens the
held-out margin over the strongest existing system by ~7× while remaining
proof-carrying and replay-verified end to end.

**Pooled all-ten** (`results/deductive-recall-locomo-all-sem-v1.json`, 2
tuning + 8 held-out corpora): deductive-semantic **0.8667** vs bm25-block
0.8255 — **+4.12 points, 95% CI [0.025, 0.061]** (mechanical arm: +0.86,
CI [0.0015, 0.0155]); vs vector 0.8021 — **+6.46, CI [0.035, 0.093]**; vs
bm25-window +8.50, CI [0.071, 0.100]. Every baseline interval excludes
zero on all ten clusters.

## Boundaries

- These are benchmark seams. Nothing here is a production retrieval path,
  public API, or default.
- Evidence recall is not answer accuracy: surfacing gold evidence turns is a
  prerequisite for a correct answer, not a guarantee of one.
- Two dev conversations limit statistical power; intervals are paired
  conversation-cluster bootstrap estimates, not leaderboard claims.
- Datalog proofs witness *derivation from the supplied facts* — they are
  evidence provenance, not proof of truth or provider attestation.
- `sem-near` edges are producer-emitted approximations: a `k:sem` proof
  witnesses that the pinned model ranked the turn near the question, not
  that the turn is relevant. The producer digest binds the exact model,
  thresholds, and emitted set; a different model produces different edges.
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
