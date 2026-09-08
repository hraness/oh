# Resume the fixed Gateway comparison after a reader failure

The frozen v5 study stopped when one reader response reached its 512-token output limit. No judge requests ran, no comparison exists, and the run has not established superiority. Version 6 prepares a separate failure-scoring amendment while preserving every earlier first response and ledger.

The current work is on [PR #42](https://github.com/hraness/oh/pull/42), branch `devin/memory-superiority-20260906`. The response policy, reader/judge plan, assessment adapter and durable store have focused synthetic validation. Import, execution, custody and final-audit integration must be validated together before a v6 freeze or provider dispatch. These modules alone do not authorize or complete a benchmark run.

**Checkpoint — 2026-09-08, 22:20 UTC:** The real custody packet was prepared, and import replay passed with network disabled. It retained all 5,064 attempted jobs: 4,732 extraction rows and 332 reader outcomes, including the one terminal failure, and rebuilt all 360 reader jobs. The complete carried exposure remains 18,268,639 micros. Retain the private `gateway-v6-real-import-replay.json` receipt, SHA-256 `03e1bb9e4e90a6407d02cdefdfc245e1726a95921c90a9f8c731efdf7d6284fb`. At that checkpoint, the candidate source was uncommitted and unfrozen; aggregate gates, runtime admission, freeze and provider dispatch were pending. Benchmark accuracy and superiority remain unestablished.

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

The amendment keeps its hard $40 exposure cap. At the v5 failure, total carried exposure is exactly **18,268,639 micros ($18.268639)**: 17,459,430 from the v5 ledger plus 809,209 from its ancestry. Version 6 carries that total once and adds only its new ledger exposure. The earlier 6,938-micro reservation for the failed reader remains charged in the old ledger; reported usage does not release it retroactively.

| Evidence | SHA-256 |
| --- | --- |
| Frozen v5 generation source | `896d7a9cc58a907d45c2db5276455eae57ab66f4e74cb1d91b14914ed2aed433` |
| V5 freeze | `92fed47664b2907d4f47c3a7a247aa439222d70c850fc6a1f21e2c2afa87d97a` |
| Closed v5 ledger, 1,133,712 bytes | `37f8a79e8dc7bd64ebccfadf9ecd5e232462c3cd6182c678b02344c017e16a80` |
| Failed reader raw body, 4,086 bytes | `c747409b8de555aa15e8bd88ef132d25b6d76a37c9347d9bb1d198042b641aa3` |
| V6 reader failure policy | `22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1` |

Keep the complete private artifact tree referenced by the [v5 takeover guide](GATEWAY_STUDY_V5_TAKEOVER.md). It includes all ancestry, 21 launch configurations and admissions/closures, the first 20 ordinary acceptances, raw captures and ledger files. The failed response has four files and no original settlement or saved result. Never run the ordinary v5 batch closer on batch 021 or restart that frozen study.

## Integration and validation

The owner must complete these gates in order:

1. Authenticate the full closed v5 inventory, all 5,064 attempted jobs, 10,127 ledger events, the single unresolved reservation, all successful siblings and all original ancestry. Fresh operating-system process absence is required; a supervisor's saved disappearance flag alone is insufficient.
2. Rebuild all extraction parents and all 360 reader contexts from unchanged inputs, retaining the exact 332 attempted-reader prefix. Keep imported requests disjoint from the new store.
3. Review and validate the separate v6 importer, runner, custody collector and final auditor. Pin a clean committed runtime and freeze the unchanged generation settings with the new failure policy.
4. Run only unattempted readers and required ordinary judges in drained waves of four, with fresh project OIDC qualification and the shared budget. Preserve each first response before parsing it.
5. Independently replay raw evidence, the complete 360-case matrix, judge alias ownership, policy provenance, budget prefixes and producer closures. Publish aggregate results only after that audit and repository delivery gates pass.

The existing v5 final auditor cannot certify v6: it requires ordinary completed readers and settled jobs under the v5 policy. Preserve its accepted packet and create a distinct v6 audit packet.

## Commands after reviewed admission

These commands describe the handoff workflow; no v6 freeze or provider dispatch is established by this document. Resolve `ABS_PYTHON`, `ABS_BUN`, `WORK` and `CONTEXT` from the private [machine context](GATEWAY_STUDY_V5_TAKEOVER.md). The closure helper binds `RUNTIME_V6` to `WORK/gateway-study-v6-candidate` and `STUDY_V6` to `WORK/gateway-study-v6`; retain those exact admitted paths. Tool-entrypoint variables below must name absolute paths from the admitted private tool packet, with its recorded hashes verified. The tracked source identifies each interface; a later mutable PR head does not replace an admitted packet. Run custody checks through the installed host scheduler. Do not substitute the old v5 closer or auditor.

Prepare the import custody packet once. `IMPORT_COLLECTOR_V6` is the admitted copy of [prepare_gateway_v6_import.py](../scripts/benchmark-audit/prepare_gateway_v6_import.py):

```sh
"$ABS_PYTHON" "$IMPORT_COLLECTOR_V6" \
  --context "$CONTEXT"
```

The collector exclusively creates `gateway-study-v6-import-manifest.json`, `gateway-v6-import-closed-inventory.json`, `gateway-v6-import-supervisor-closure.json` and `gateway-v6-import-preparation.json` under `WORK`. Retain their returned hashes. It checks fresh producer absence and hashes captured bytes without scoring responses. The runtime's separate import replay must still authenticate every original response. An occupied output or rejected check requires diagnosis; do not overwrite or rerun the collector into those paths.

After the clean committed runtime is admitted, prepare the new freeze using the collector's manifest hash and the original v5 freeze's unchanged authority pin:

```sh
"$ABS_BUN" "$RUNTIME_V6/scripts/benchmarks/gateway-study-v6.ts" prepare \
  --directory "$STUDY_V6" \
  --import-manifest "$WORK/gateway-study-v6-import-manifest.json" \
  --import-sha256 "$IMPORT_SHA256" \
  --authority "$AUTHORITY" --authority-sha256 "$AUTHORITY_SHA256"
```

Retain the returned freeze hash and committed source identity. Preparation invokes no models. Provider batches use the runner's `run --directory STUDY_V6 --freeze-sha256 FREEZE_SHA256 --max-new-calls LIMIT` arguments through the separately reviewed supervisor and project OIDC configuration. The closure helper adopts `LIMIT=32` for batch 001 and `LIMIT=256` thereafter; the runner's broader 1–256 input range does not change that custody schedule. The shared $40 cap still includes $18.268639 carried once. Do not launch a new producer until the preceding one has a valid closure and an ordinary continuation decision.

After the supervisor reports `state: exited`, `exitCode: 0` and `groupGone: true`, run the admitted [close_gateway_v6_batch.py](../scripts/benchmark-audit/close_gateway_v6_batch.py) entrypoint as `CLOSER_V6`:

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

The required integration gates remain `bun run test:benchmarks`, `bun run check`, and `git diff --exit-code -- dist`. Use the installed host scheduler for broad gates and process-custody checks. Passing synthetic tests proves the covered behavior; it does not authenticate the retained real run or establish accuracy.

Keep the PR description and the owning workspace's `work/gateway-v3-implementation-state.json` current with implementation, freeze, dispatch and audit status. The historical filename does not grant permission to resume an earlier protocol. Full reports, raw text, credentials and local paths remain outside Git.
