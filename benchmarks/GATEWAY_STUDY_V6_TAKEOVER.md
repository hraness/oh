# Resume the fixed Gateway comparison after a reader failure

The frozen three-system comparison remains incomplete. Its v5 run stopped when one reader response reached its 512-token output limit; no judges ran. Version 6 is frozen as a separate failure-scoring amendment that preserves every earlier first response and ledger. Its initial launcher failed before the native runner, so recovery must close that failed launch before submitting the remaining work.

The current work is on [PR #42](https://github.com/hraness/oh/pull/42), branch `devin/memory-superiority-20260906`. The separate [reserved 100-family evaluation](results/memory-reserved-reader-profile-v1.json) is complete and independently audited: a GPT-5 mini reader with 96 KB of retrieved context scored **84/100**, versus **78/100** with 24 KB, with six paired wins and no losses. That locked set is closed to further tuning. It does not establish the outcome of this frozen comparison, broad superiority or benchmark saturation.

**Checkpoint — 2026-09-09:** The prepared v6 runtime is commit `c7ec1194ee9ac7a0e3229c2b7197e9223d3e4435`, source SHA-256 `458086becf13ea3caeadae28dbd61cc80d5a01a634f9f387507fdcf0e02af88d`, with freeze SHA-256 `aeb1366264f7a9f968188a66117a1cbb96ab6592d653ffa529adf761d810999a`. Physical launcher 001 exited with the Vercel `scope-not-accessible` error before native admission: zero v6 model calls, no native ledger and only `freeze.json` and `preparation.json` in the study. Its configuration, status, log and diagnosis remain preserved. The new failed-launch acceptance, global budget reservation, resumed native execution and final audit are still pending operational verification; their implementation does not establish a completed run.

The earlier import replay passed with network disabled at the **2026-09-08, 22:20 UTC** checkpoint. It retained all 5,064 attempted jobs: 4,732 extraction rows and 332 reader outcomes, including the one terminal failure, and rebuilt all 360 reader jobs. Retain the private `gateway-v6-real-import-replay.json` receipt, SHA-256 `03e1bb9e4e90a6407d02cdefdfc245e1726a95921c90a9f8c731efdf7d6284fb`. Its then-uncommitted source status is historical; the later frozen identity above governs native execution.

## Preserved run and remaining work

The comparison selects 120 of 308 eligible question families and evaluates three systems: `oh-fact`, `bm25-window`, and `bm25-record-window`. All 360 cases remain in the denominator. Completion will measure this fixed comparison; it does not saturate all eligible questions or establish a general or official leaderboard claim.

All 8,413 extraction parents are accounted for: 2,442 legacy parents, 1,051 Claude first responses, four Gateway v3 responses, 184 v4 responses and 4,732 v5 responses. Batches 001 through 020 have ordinary acceptance; batch 020 ended after the first 164 readers.

Batch 021 stopped after 168 more reader requests. In total, 332 reader requests were attempted and 331 have settled transport results. The final wave contains three settled siblings and one captured, unsettled response. Those siblings require authentication during import, just as the failed response does. There is no ordinary success acceptance for batch 021.

Only 28 readers remain unattempted. Once their outcomes are complete, the plan creates judge requests for ordinary answers, deduplicating identical requests while retaining each original case ordinal. A terminal reader failure receives no judge request or alias. No previous reader or extraction request may be submitted again.

## Reader failure rule

The v6 transport first applies the existing authentication checks for request, complete HTTP response, model, provider, usage and reservation. The added failure class requires a reader response from `openai/gpt-4.1-mini` through OpenAI with `finish_reason: length`, a frozen output cap of 512, exactly 512 reported output tokens, no refusal and no tool call. Other reader failures and all judge truncations still stop execution. The v5 extraction rule remains unchanged.

The requested model family aliases remain fixed; provider snapshots are not pinned.

An eligible reader result retains status `terminal-reader-failure` and reason `output-token-limit`. Its projection contains neither a prediction nor token-F1. Its deterministic score is zero, with decision source `reader-failure-policy` and a policy hash. The partial answer stays only in the original raw evidence. The result is never presented as a successful model judgment.

The primary criterion remains a gain of at least five percentage points against both baselines, with both one-sided 97.5% finite-pool lower bounds above zero. A separate adverse sensitivity calculation assigns zero to failed Oh cases and one to failed baseline cases, holding ordinary model judgments fixed. Report the primary criterion and its robustness separately; a primary-only pass does not establish robustness.

The policy was added after execution began and before correctness inspection. Publish that timing with any result. It does not preserve an unchanged confirmatory error-control claim.

## Budget and immutable evidence

The task keeps its hard **$40 exposure cap**. The frozen native v6 accounting carries **18,268,639 micros ($18.268639)** once: 17,459,430 from the v5 ledger plus 809,209 from its ancestry. The earlier 6,938-micro reservation for the failed reader remains charged in the old ledger; reported usage does not release it retroactively.

Later development and reserved runs bring global task exposure to **25,744,095 micros ($25.744095)** before any native v6 call. The frozen runtime does not include those later ledgers. Recovery therefore requires a separate, pinned `oh.gateway-v6-global-budget-reservation.v1` document and verification of the complete global ancestry before admission. The remaining-call bound is conservative exposure, not a prediction of the eventual bill:

| Remaining work | Maximum exposure (micros) |
| --- | ---: |
| 28 unattempted readers | 170,570 |
| 205 distinct judge requests for 331 known completed readers | 2,566,092 |
| Up to 28 future judge requests, at 323,840 each | 9,067,520 |
| Total reserved for native v6 | **11,804,182** |
| Global prior plus the full reservation | **37,548,277** |

The one known terminal reader receives no judge. Future judge deduplication can reduce calls; it cannot enlarge this bound. Allocate the full **$11.804182** exclusively to this frozen recovery before dispatch, and run no concurrent paid lab experiment against the same task budget. The worst-case total leaves $2.451723 below the cap. Retain bound digest `bb3bec2510cb6eb532e1812a66fde32e90afe9b342b09fe07f368fa631a71968` and the post-reserved budget descriptor, SHA-256 `abfc92d9f30a543086996b66c02aa2fcb5b9f3f09cc3fc569f5b740a81dee5f4`. Recovery checks every new native ledger prefix against both the reserved amount and the global cap; the native carry remains unchanged and is not added again to global exposure.

| Evidence | SHA-256 |
| --- | --- |
| Frozen v5 generation source | `896d7a9cc58a907d45c2db5276455eae57ab66f4e74cb1d91b14914ed2aed433` |
| V5 freeze | `92fed47664b2907d4f47c3a7a247aa439222d70c850fc6a1f21e2c2afa87d97a` |
| Closed v5 ledger, 1,133,712 bytes | `37f8a79e8dc7bd64ebccfadf9ecd5e232462c3cd6182c678b02344c017e16a80` |
| Failed reader raw body, 4,086 bytes | `c747409b8de555aa15e8bd88ef132d25b6d76a37c9347d9bb1d198042b641aa3` |
| V6 reader failure policy | `22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1` |
| Frozen v6 generation source | `458086becf13ea3caeadae28dbd61cc80d5a01a634f9f387507fdcf0e02af88d` |
| V6 freeze | `aeb1366264f7a9f968188a66117a1cbb96ab6592d653ffa529adf761d810999a` |
| V6 import manifest | `0a39fb23510f1e66aa3fd9d80415cc790783f2c736e386496d030ae6941dd3dd` |
| Initial v6 launcher diagnosis | `9b92e311e0464893771c6cb6a4baa9aefb4220e12b63e3d695b44054fb82160e` |

Keep the complete private artifact tree referenced by the [v5 takeover guide](GATEWAY_STUDY_V5_TAKEOVER.md). It includes all ancestry, 21 launch configurations and admissions/closures, the first 20 ordinary acceptances, raw captures and ledger files. The failed response has four files and no original settlement or saved result. Never run the ordinary v5 batch closer on batch 021 or restart that frozen study.

## Integration and validation

The original import and frozen-runtime preparation completed the first three gates below. Recovery adds the failed-launch and global-budget admission checks before the remaining execution. Retain the evidence for every gate:

1. Authenticate the full closed v5 inventory, all 5,064 attempted jobs, 10,127 ledger events, the single unresolved reservation, all successful siblings and all original ancestry. Fresh operating-system process absence is required; a supervisor's saved disappearance flag alone is insufficient.
2. Rebuild all extraction parents and all 360 reader contexts from unchanged inputs, retaining the exact 332 attempted-reader prefix. Keep imported requests disjoint from the new store.
3. Review and validate the separate v6 importer, runner, custody collector and final auditor. Pin a clean committed runtime and freeze the unchanged generation settings with the new failure policy.
4. Validate the recovery implementation, pin the global reservation, accept the preserved zero-native launcher failure with a fresh process proof, and verify that acceptance before dispatch. Run only unattempted readers and required ordinary judges in drained waves of four, with fresh project OIDC qualification and the exclusively reserved global budget. Preserve each first response before parsing it.
5. Independently replay raw evidence, the complete 360-case matrix, judge alias ownership, policy provenance, budget prefixes and producer closures. Publish aggregate results only after that audit and repository delivery gates pass.

The existing v5 final auditor cannot certify v6: it requires ordinary completed readers and settled jobs under the v5 policy. Preserve its accepted packet and create a distinct v6 audit packet.

## Commands after reviewed admission

The import collection and freeze commands below record completed preparation; their occupied outputs must not be recreated. The current continuation starts at [recovery after an initial launcher failure](#recovery-after-an-initial-launcher-failure). Resolve `ABS_PYTHON`, `ABS_BUN`, `WORK` and `CONTEXT` from the private [machine context](GATEWAY_STUDY_V5_TAKEOVER.md). The closure helper binds `RUNTIME_V6` to `WORK/gateway-study-v6-candidate` and `STUDY_V6` to `WORK/gateway-study-v6`; retain those exact admitted paths. Tool-entrypoint variables below must name absolute paths from the admitted private tool packet, with its recorded hashes verified. The tracked source identifies each interface; a later mutable PR head does not replace an admitted packet. Run custody checks through the installed host scheduler. Do not substitute the old v5 closer or auditor.

The import custody packet was prepared once. `IMPORT_COLLECTOR_V6` is the admitted copy of [prepare_gateway_v6_import.py](../scripts/benchmark-audit/prepare_gateway_v6_import.py):

```sh
"$ABS_PYTHON" "$IMPORT_COLLECTOR_V6" \
  --context "$CONTEXT"
```

The collector exclusively creates `gateway-study-v6-import-manifest.json`, `gateway-v6-import-closed-inventory.json`, `gateway-v6-import-supervisor-closure.json` and `gateway-v6-import-preparation.json` under `WORK`. Retain their returned hashes. It checks fresh producer absence and hashes captured bytes without scoring responses. The runtime's separate import replay must still authenticate every original response. An occupied output or rejected check requires diagnosis; do not overwrite or rerun the collector into those paths.

The admitted clean runtime prepared the existing freeze using the collector's manifest hash and the original v5 freeze's unchanged authority pin:

```sh
"$ABS_BUN" "$RUNTIME_V6/scripts/benchmarks/gateway-study-v6.ts" prepare \
  --directory "$STUDY_V6" \
  --import-manifest "$WORK/gateway-study-v6-import-manifest.json" \
  --import-sha256 "$IMPORT_SHA256" \
  --authority "$AUTHORITY" --authority-sha256 "$AUTHORITY_SHA256"
```

Retain the returned freeze hash and committed source identity. Preparation invokes no models. Provider batches use the runner's `run --directory STUDY_V6 --freeze-sha256 FREEZE_SHA256 --max-new-calls LIMIT` arguments through the separately reviewed supervisor and project OIDC configuration. The closure helper adopts `LIMIT=32` for the first native batch and `LIMIT=256` thereafter; the runner's broader 1–256 input range does not change that custody schedule. In the current recovery, physical launcher 002 is the first native batch. The shared $40 cap requires the external global reservation described above. Do not launch a new producer until the preceding one has a valid closure and an eligible continuation decision.

For an ordinary history with no failed initial launcher, after the supervisor reports `state: exited`, `exitCode: 0` and `groupGone: true`, run the admitted [close_gateway_v6_batch.py](../scripts/benchmark-audit/close_gateway_v6_batch.py) entrypoint as `CLOSER_V6`:

```sh
"$ABS_PYTHON" "$CLOSER_V6" --context "$CONTEXT" --number 1 \
  --freeze-sha256 "$FREEZE_SHA256" --source-sha256 "$SOURCE_SHA256" \
  --import-preparation-sha256 "$IMPORT_PREPARATION_SHA256"
```

Here `SOURCE_SHA256` is the new frozen v6 source hash. `IMPORT_PREPARATION_SHA256` pins `gateway-v6-import-preparation.json`, not the import manifest. For every later batch, change `--number` and add `--previous-acceptance-sha256` with the preceding numbered acceptance's recorded hash; that argument is forbidden for batch 001. The helper checks the full history, immutable ancestors and fresh process absence, then exclusively creates `gateway-v6-batch-NNN-acceptance.json` and `gateway-v6-batch-NNN-closed-inventory.json` under `WORK`.

Only a clean `paused` result with `stopReason: call-limit` supports ordinary continuation. Failed or interrupted batches, budget pauses, occupied outputs and any rejected check require diagnosis. A custody acceptance keeps `semanticAuditStatus: pending`; it neither establishes correctness nor permits rerunning an attempted job.

When the native result reaches all 360 cases with a comparison artifact and successful closure, the same helper also creates `gateway-v6-final-supervisor-closure.json`, `gateway-v6-final-audit-config.json` and `gateway-v6-final-audit-preparation.json`. No separate final collector command is needed. Preserve their returned hashes, then run the admitted [audit-gateway-study-v6-final.ts](../scripts/benchmark-audit/audit-gateway-study-v6-final.ts) entrypoint as `AUDITOR_V6` through the host scheduler's heavy compute mode:

```sh
"$ABS_BUN" "$AUDITOR_V6" "$WORK/gateway-v6-final-audit-config.json"
```

The generated input has exactly eight fields: `runtimeRoot`, `expectedSourceSha256`, `studyDirectory`, `freeze`, `finalBatch`, `comparison`, `inventory` and `supervisorClosure`; the last five are file pins. Preserve the audit's exact stdout, exit code and validation receipt. The auditor forbids model/network calls and process dispatch, then replays the complete case matrix and accounting. Require an accepted audit before publishing aggregate results, with primary and adverse sensitivity reported separately and all qualifications above retained.

Focused synthetic checks for the implemented policy and store are:

```sh
bun test tests/memory-benchmark-gateway-reader-policy-v6.test.ts
bun test tests/memory-benchmark-gateway-study-store-v6.test.ts
```

Run focused changed-area tests and obtain independent review, then satisfy the source aggregate in [CONTRIBUTING.md](../CONTRIBUTING.md#validate-a-pull-request). Fresh successful CI on the exact head and current base may supply the complete `bun run check`, which includes every `bun run test:benchmarks` test and reproducible build checks. If that qualification does not hold, run the complete local aggregate through the installed host scheduler. Process-custody checks also use that scheduler. These source checks do not replace private import replay, provider accounting, operational custody or the final semantic audit.

Keep the PR description and the owning workspace's `work/gateway-v3-implementation-state.json` current with implementation, freeze, dispatch and audit status. The historical filename does not grant permission to resume an earlier protocol. Full reports, raw text, credentials and local paths remain outside Git.

## Recovery after an initial launcher failure

The closure tool now has a separate path for the preserved initial launcher that
failed before the native runner. Ordinary native batches still require exit zero.
The recovery path requires exactly `freeze.json` and `preparation.json` in the
native study, the original configuration/status/log/diagnosis pins, and a fresh
root-owned process inventory. It writes new external acceptance and inventory
files; it does not change the failed launcher or create a synthetic native run.

Before accepting the failed launch, exclusively create the private
`WORK/gateway-v6-global-budget-reservation.json` using the verified bound above.
Its exact fields are `protocol`, `recordedAt`, `freeze`, `sourceSha256`,
`sourceGitHead`, `budgetInput`, `priorExposureMicros`, `maximumNewExposureMicros`,
`capMicros` and `bound`. The `protocol` is
`oh.gateway-v6-global-budget-reservation.v1`; the source and freeze identify the
existing frozen runtime, and `budgetInput` pins the post-reserved descriptor.
Use the exact bound fields validated by
[gateway-v6-global-budget.ts](../scripts/benchmark-audit/gateway-v6-global-budget.ts).
Before any v6 ledger exists, its preparation verifier retains the lab budget
verifier's required absent-ledger checks. Preserve the reservation file hash;
creating the file alone does not admit recovery.

With the admitted recovery closer, run the initial failure acceptance through
the installed host scheduler:

```sh
"$ABS_PYTHON" "$CLOSER_V6" --context "$CONTEXT" --number 1 \
  --freeze-sha256 "$FREEZE_SHA256" --source-sha256 "$SOURCE_SHA256" \
  --import-preparation-sha256 "$IMPORT_PREPARATION_SHA256" \
  --accept-pre-native-failure --diagnosis-sha256 "$DIAGNOSIS_SHA256" \
  --global-budget-reservation-sha256 "$GLOBAL_BUDGET_RESERVATION_SHA256"
```

This mode requires the diagnosis and global-reservation hashes, and forbids a
previous-success hash or a previous-failure hash. It exclusively creates
`gateway-v6-launch-001-zero-native-inventory.json` and
`gateway-v6-launch-001-pre-native-acceptance.json`. Preserve their returned pins
and verify the acceptance before launching the native runner. The failure
acceptance pins `globalBudgetReservation` and proves zero new native exposure.

The next unused physical launcher is `gateway-study-v6-batch-002`, which is the
first native batch and retains the 32-call limit. Later physical launchers use
the normal 256-call limit. Close successful physical launcher 002 with:

```sh
"$ABS_PYTHON" "$CLOSER_V6" --context "$CONTEXT" --number 2 \
  --freeze-sha256 "$FREEZE_SHA256" --source-sha256 "$SOURCE_SHA256" \
  --import-preparation-sha256 "$IMPORT_PREPARATION_SHA256" \
  --pre-native-failure-acceptance-sha256 "$PRE_NATIVE_FAILURE_ACCEPTANCE_SHA256"
```

There is no previous-success argument for physical launcher 002. Closing physical
launcher 003 adds `--previous-acceptance-sha256` with successful acceptance 002's
hash. Every later closure repeats the same failure root and validates the entire
success chain. `--diagnosis-sha256` and `--global-budget-reservation-sha256` belong
only to the initial failure mode; later closures follow their immutable pins
through the failure acceptance.

Recovery success receipts use `oh.gateway-v6-batch-acceptance.v2` with separate
physical `number`, `nativeBatchNumber` and `preNativeFailureAcceptance`, plus
`globalTaskAccounting`. The final owner closure uses `oh.gateway-final-supervisor-closure.v6.1`, with exactly one
`preNativeFailures` pin and a `runs` array containing successful native batches
only. Final audit preparation v2 reports launcher attempts and native batch count
separately and includes `globalTaskAccounting`. The final auditor authenticates
the failed prefix and the unchanged foundation bytes before native response replay; missing or repeated failure roots,
shifted physical names, stale process proofs and unsuccessful native runs remain
ineligible. Ordinary v1 receipts and v6 closures retain their existing behavior.

Recovery success receipts, final preparation and the final audit report expose
`globalTaskAccounting` with `reservation`, `priorExposureMicros`,
`nativeExposureMicros` and `totalExposureMicros`. The final auditor authenticates
the original global descriptor and prior ledgers, then replays every native
ledger prefix against the exclusive reservation. Only the declared v6 target
ledger may replace a previously required absence; all other absent paths remain
required. Reservation IDs must be unique across the old and new ledgers.

Global exposure is $25.744095 plus new native v6 exposure. Native-study exposure
remains $18.268639 plus that same new native exposure. Report both with their
respective meanings; never add the native carried total to the global prior a
second time. The custody amendment itself makes zero model calls.
