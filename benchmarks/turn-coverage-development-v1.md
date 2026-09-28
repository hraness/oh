# User-turn coverage experiment

This opt-in experiment accounts for each admitted user turn before grouping topics for a question. It preserves repeated mentions, explicit exclusions, uncertainty and ties. It changes no default reader, package export or stored record.

## Collect and group mentions

Use the pure functions in `scripts/benchmarks/oh-turn-coverage.ts`:

1. Call `prepareOhTurnCoverageV1({sources, asOf})`. Each source supplies an authenticated `record` and explicit numeric `sessionOrdinal` and `turnOrdinal`. Records must contain text and a `user` or `assistant` speaker. The cutoff is a canonical timestamp or `null`; a cutoff excludes future and undated records. Extraction accepts no question, scope, answer count or reference.
2. Send each plan batch's prompt through an explicitly configured extractor. Batches contain up to eight target users and each user's preceding two turns in the same session. Code partitions by complete prompt bytes before dispatch. An indivisible oversized target and its context fail; text is never clipped.
3. Call `resolveOhTurnCoverageV1(plan, proposals)` with one first response per batch, in batch order. Every target user must appear exactly once as `candidate`, `irrelevant` or `unresolved`. A candidate requires mentions; an unresolved turn may retain known mentions. Every mention cites a unique exact quotation from its user source. Optional context citations must use the declared preceding window. Code assigns mention IDs and keeps each primary user position.
4. Call `prepareOhTurnGroupingV1(plan, coverage, scope)` with a frozen scope that omits the requested answer count. Natural-language scope needs review: code cannot prove that prose contains no count hint. Give its prompt to the grouping extractor, then call `resolveOhTurnGroupingV1(plan, coverage, groupPlan, proposal)`. Every mention must belong to one group or have an explicit excluded or unresolved disposition. Code computes each group's earliest admitted user position. Groups with the same position remain tied.
5. Call `renderOhTurnGroupingV1(plan, coverage, groupPlan, result, {requestedCount, maximumBytes})`. The count may be `null`; otherwise it reports a match or mismatch. It never removes groups to fit the count. The canonical JSON retains all accepted mentions, groups and dispositions. An oversized rendering throws without a partial result.

The dedicated Evolution profiles are `gpt5-mini-turn-coverage-v1-extractor` and `gpt5-mini-turn-grouping-v1-extractor`. Each fixes its JSON schema, low reasoning effort, 8,192-token output limit and ten-minute deadline. They use Gateway aliases, without immutable snapshot qualification. Existing profiles and event-inventory protocols retain their identities.

The caller owns provider selection, explicit spending limits, timeouts, first-response storage, uncertain-call reconciliation and any raw-context fallback. These functions perform no I/O or retry. When adding the rendering to a reader context, preserve the original context and additionally bound the complete serialized reader messages, including escaping. Reusing one identical request's response is shared evidence, not another replication.

## Optional message refinement

`scripts/benchmarks/oh-turn-coverage-refinement.ts` supplies a separate experimental instruction policy. `makeOhTurnCoverageRefinementMessagesV1({sources, asOf}, batchIndex)` reconstructs the original plan and returns system/user messages for the selected batch. `makeOhTurnGroupingRefinementMessagesV1(plan, coverage, scope)` revalidates the original dependencies and returns grouping messages. Use those complete messages with the same dedicated profiles and resolve responses through the original V1 functions.

The added instructions clarify each target's local citation window, self-contained repeated topics, non-adoption, and grouping by the underlying task. They change neither the V1 user prompts nor schemas, profiles or reasoning effort. They do not establish semantic correctness. Complete serialized messages have a 139,264-byte limit; exceeding it throws without clipping.

Freeze `OH_TURN_COVERAGE_REFINEMENT_POLICY_SHA256_V1` with the source plans, chosen batches, ordered messages and native provider request identities. The echoed V1 `requestSha256` associates a proposal with its structural parent plan; it does **not** identify the refined provider request. Preserve the actual native request hash and its first response separately. Do not transplant old responses into this revision or combine its results with historical V1 results.

## What validation establishes

`structuralCoverage: all-admitted-user-turns-accounted` means every admitted user turn has a disposition. It does not mean every facet was found. Exact quotations authenticate source bytes; they do not prove that a reply adopts an assistant's suggestion, that a label has the right meaning, or that two mentions belong together. Missing antecedents, scope ambiguity, tentativeness and declines require semantic review. Results retain `semanticValidation: unverified-model-assertions`.

The model sees admitted source content and numeric positions. Record digests, excluded-source counts and local audit identities stay out of extraction and grouping prompts. Adding excluded future records therefore leaves the model-visible request unchanged. Returned plans and results are immutable, bounded and checked again on replay.

Limits include 256 sources, 32 KiB per source, 1 MiB total source text, 64 KiB per extraction prompt, 128 KiB per grouping prompt, 64 mentions per batch, 512 mentions overall, 128 groups, 4 KiB per quotation and 256 KiB per response or rendering. The common JSON parser also enforces depth and node limits; output expansion must fit the same replay limits. Bounds reject complete operations instead of silently dropping evidence.

## Validate before a benchmark run

Freeze invented cases and criteria before observing model responses. Measure facet recall, speaker attribution, repeated mentions, earliest positions, ties and unresolved cases separately. Keep requested counts outside both model stages, references outside extraction, and fresh benchmark data closed while developing this method.

Judge calibration V2 in `beam-judge-calibration.ts` adds controls for an omitted final facet, verbose distractors, valid paraphrases and reversed ordering. `prepareBeamJudgeCalibrationV2`, `auditBeamJudgeCalibrationV2` and `assessBeamJudgeCalibrationV2` retain all 24 expected cases. A pass requires complete responses and zero disagreement. V1's 16 cases and request identities remain unchanged. These custom binary checks do not reproduce official BEAM ordering scores or establish comparative superiority.

Run focused checks with Bun 1.3.14:

```sh
bun test tests/memory-benchmark-oh-turn-coverage.test.ts tests/memory-benchmark-oh-turn-coverage-refinement.test.ts tests/memory-benchmark-beam-judge-calibration.test.ts tests/memory-benchmark-evolution-model.test.ts
bun run typecheck:scripts
```

Local tests use simulated responses and establish deterministic behavior. A live evaluation needs its own frozen inputs, provider configuration and cost limit. Keep private results local unless publication is authorized.
