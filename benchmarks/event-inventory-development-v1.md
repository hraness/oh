# Event inventory development experiment

This experiment prepares a question-specific inventory of events and states, checks its source citations, and computes partial ordering constraints. It is opt-in benchmark tooling. It changes no reader default, package export, stored record, or benchmark score.

## Extract and inspect an inventory

`scripts/benchmarks/oh-event-inventory.ts` accepts a question, an explicit level of detail (`granularity`), an ordering mode, a statement-time cutoff (`asOf`, or `null`), and source records with numeric session and turn positions.

1. Use `prepareOhEventInventoryV1(input)` to freeze the exact question and source packet. The input accepts no answer or scoring reference. A historical cutoff removes future and undated statements before building the extraction prompt. It reports how many sources it removed.
2. Give the returned prompt to an explicitly configured extractor. Retain the request hash, prompt hash, model settings, provider response, and cost record. The prompt asks for separate stages at the requested level of detail, exact source quotations, event-time expressions, repeated mentions, and supported state changes.
3. Pass the untouched plan and raw proposal to `resolveOhEventInventoryV1`. The parser checks request identity, source digests, exact quotation matches, allowed fields and limits. Invalid structure throws; unsupported citations remain visible with their reason.
4. Inspect the mentions, identity groups, pairwise relations, conflicts and current-state results. Preserve the original raw context alongside these annotations. Group counts do not establish complete event counts. Conflicts and unknown pairs must not be flattened into a total order.

`extractOhEventInventoryV1(input, transport)` combines those steps through one injected asynchronous call. It performs no retry, storage write, credential lookup or provider selection. The transport owner remains responsible for spending authority, timeouts, request journaling, response-byte limits and reconciliation of uncertain calls. The callback receives the exact prompt and hashes and a 262,144-byte response limit; the parser enforces the same limit after return.

In `event-time` mode, only supported event mentions establish temporal relations. Explicit same-event links group repeated mentions. Disjoint event intervals and quoted before-links supply ordering constraints; inconsistent dates, identity links and cycles remain visible. In `mention-order` mode, source session and turn positions determine order. Two mentions in one message remain unordered because the input gives no within-message position. Neither mode treats statement time as event time.

The result declares `coverage: partial` and `semanticValidation: unverified-model-assertions`. A matching quotation proves its bytes and source identity. It does not establish that the model selected the right event, associated its date correctly, or interpreted a correction correctly. The operations reuse the [experimental evidence view](../docs/evidence-view.md), including its distinction between event time and what was known at a historical cutoff.

Limits are 256 source records, 48 mentions, 96 links, a 1 MiB source input and extraction prompt, a 16 KiB question, and a 2 KiB granularity instruction. Existing evidence-view limits also apply. Oversized inputs fail before the callback runs. These limits are for focused experiments; they are not a claim of long-history extraction coverage.

## Calibrate the existing judge

`scripts/benchmarks/beam-judge-calibration.ts` keeps the custom binary judge v2 unchanged. `prepareBeamJudgeCalibrationV1(config)` prepares 16 invented candidate answers in eight positive/negative pairs. Each pair shares its question and reference. Cases cover complete endpoints and duration, date association, conflicting evidence, stage granularity, historical corrections, repeated events, unadopted suggestions and instructions embedded in candidate answers.

The requests omit expected labels and fixture identifiers. The returned immutable plan binds the fixtures, declared model settings and every request to hashes. `auditBeamJudgeCalibrationV1(config, observations)` checks those identities and reports true positives, true negatives, false positives, false negatives, unresolved responses and missing cases separately. Its `complete` field means accounting is complete; it does not mean the judge passed. Malformed verdicts never silently become incorrect answers.

The fixtures are development data authored independently of benchmark histories and labels. Local tests exercise request construction, mutation protection, transport wiring and deterministic operations with simulated responses. They do not measure live extraction accuracy or judge agreement. A provider run needs its own frozen requests, configuration and cost limit. Keep any subsequent private results local unless publication is explicitly authorized.

Run the focused checks with Bun 1.3.14:

```sh
bun test tests/memory-benchmark-oh-event-inventory.test.ts tests/memory-benchmark-beam-judge-calibration.test.ts
bun run typecheck:scripts
```

## Before a matched benchmark comparison

Freeze the extractor and judge calibration criteria before observing live responses. Test the intended operations on invented histories first, then compare fixed treatments using already exposed development data. Apply any reader treatment equally to comparators. Keep fresh confirmation data closed until the selected configuration and scorer are frozen.

The Supermemory session helper also needs a source-authenticated bridge from session references to all constituent source units before using the common context packer. Preserve provider-generated memory text through that bridge. Its standalone renderer is not the common neutral, token-budgeted reader context. A future provider smoke must independently verify the exact account and namespace, complete processing and dreaming readiness, bounded transport and spending, and reconciled cleanup. The pure helper tests do not establish live provider readiness.
