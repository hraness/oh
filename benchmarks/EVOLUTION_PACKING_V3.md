# Fixed packing mechanisms and full-history control

The V3 development configuration adds three fixed source-packing mechanisms and
an untruncated full-history control. These mechanisms are experimental benchmark
treatments. They do not change the production memory API or the existing V1
genetic domain. Previous run, context and model request bytes retain their
original meanings.

Use `oh.memory.evolution-run.v3` when a matrix contains either new treatment.
Native-only matrices remain V1; matrices containing only native treatments and
the original `oh-source-spans` treatment remain V2. Preparation emits a V3 context
plan and the existing reader, judge and report commands authenticate it.

## Packing treatments

```json
{
  "id": "oh-spans-v2-continuation",
  "system": "oh-source-spans-v2",
  "mechanism": "continuation",
  "budget": { "topK": 100, "contextBytes": 48000 }
}
```

The three mechanism values are `focused-pool`, `continuation` and `diverse`.
They share one complete native Oh focused-query top-100 pool per question. An
original source-span control uses its separate raw-query pool. Each corpus is
prepared once; readers reuse the resulting context bytes.

- `focused-pool` uses the original source-window selection on the focused pool.
- `continuation` extends a selected window within the same source turn to at
  most 2,048 bytes, using original source-window boundaries.
- `diverse` prioritizes uncovered query terms and limits selection to two ranges
  per turn and four per session.

All three use a fixed 48,000-byte context limit and at most 128 nonoverlapping
ranges. Source offsets, text digests, speaker, date and session occurrence are
validated against the current corpus. Limits reject invalid inputs or omit
over-budget ranges; no text is invented. The result/policy protocols retain the
explicit `v2-prototype` identifier used during development.

The intended ablations compare focused pooling with the original raw-pool
policy, then continuation and diversity with focused pooling. Compare every
selected question, including questions whose two pools happen to coincide.
Pool equality is a synthetic parity check, not a selection criterion.

## Full-history control

```json
{ "id": "full-history", "system": "full-history" }
```

This treatment has no top-K or truncation budget. It includes every source turn
in the input corpus order using the legacy whole-turn renderer. The dataset
parser supplies chronological order. Its distinct result authenticates the
complete ordered source-record list, source digests and rendered context;
resealing a subset cannot make it a valid full-history result.

Full-history readers use a separately versioned V2 request, restricted to the
existing nano and mini profiles. The body preserves their model, router, prompt,
reasoning and output settings. It is limited to 2 MiB and records its exact byte
length and digest. Financial admission reserves 400,000 input tokens plus the
8,192-token output cap: 23,277 microdollars for nano or 116,384 for mini. This is a
conservative financial bound, not a tokenizer count or proof of fitting the
combined context window. `tokenizerFit` remains `unknown`; live provider
acceptance must be measured. No heuristic division of characters or bytes
silently admits a truncated history.

The first bounded provider response is retained, including errors. A failed or
unverifiable attempt keeps its full reservation and cannot be automatically
retried. Existing V1 requests and stored responses retain identical hashes and
replay semantics. Context and reader plans remain limited to 128 MiB; split an
explicit reader matrix if it exceeds this bound.

## Interpretation and handoff

The [results guide](EVOLUTION_RESULTS.md) records completed runs. A larger
development score does not establish superiority. Keep this exposed development
selection separate from closed evaluations and future confirmation data. The
Gateway judge remains a development proxy, distinct from a pinned official
snapshot. External framework baselines and confirmation qualification remain
tracked in the [confirmation guide](EVOLUTION_CONFIRMATION.md).

To continue a prepared run, retain its exact configuration, source commit,
context/readers pins, shared campaign store and first-response receipts. Use the
[development CLI](EVOLUTION.md#run-the-development-cli) with an explicit spending
and new-call limit. A stopped phase may admit previously unattempted requests in
a new receipt; never discard the original receipt or retry an occupied failure.
