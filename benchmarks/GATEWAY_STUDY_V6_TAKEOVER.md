# Completed fixed Gateway memory comparison

The frozen three-system continuation is complete and independently audited: `oh-fact` **81/120**, `bm25-window` **78/120**, `bm25-record-window` **79/120**. The Oh fact-retrieval arm **did not pass the fixed superiority criterion**; adverse reader-failure sensitivity also did not pass. The [numerical report](results/memory-gateway-final-v6.json) records the complete outcome and evidence digests.

| System | Correct / 120 | Accuracy |
| --- | ---: | ---: |
| `oh-fact` | 81 | 67.5% |
| `bm25-window` | 78 | 65.0% |
| `bm25-record-window` | 79 | 65.8% |

This comparison covers 120 of 308 eligible LongMemEval families and all 360 system/question cases. It does not cover every eligible family or establish benchmark saturation. The `oh-fact` adapter exercises the real SQLite authority and keyword retrieval over benchmark records and extracted facts; it does not exercise the complete memory-agent API.

## Paired outcome and scoring limits

| Criterion | Baseline | Wins / losses / ties | Gain | Lower bound | Passed |
| --- | --- | ---: | ---: | ---: | --- |
| Primary | `bm25-window` | 16 / 13 / 91 | +2.50 pp | -18.18 pp | no |
| Primary | `bm25-record-window` | 14 / 12 / 94 | +1.67 pp | -21.43 pp | no |
| Adverse failure sensitivity | `bm25-window` | 16 / 14 / 90 | +1.67 pp | -20.13 pp | no |
| Adverse failure sensitivity | `bm25-record-window` | 14 / 13 / 93 | +0.83 pp | -23.38 pp | no |

The criterion requires at least five percentage points of improvement against both baselines, with both one-sided 97.5% finite-pool lower bounds above zero. The adverse calculation keeps ordinary judgments fixed, assigns zero to failed Oh cases and one to failed baseline cases. Bounds are in percentage points above. The policy was added after execution began and before correctness inspection; these calculations do not preserve an unchanged confirmatory error-control claim.

There were 358 model-judged cases and 2 terminal reader failures, all retained in the denominator. Failure counts by system were `oh-fact`: 0, `bm25-window`: 1, `bm25-record-window`: 1. Eligible failures reached the frozen 512-token reader cap and receive zero under the primary policy. Partial answers remain private evidence and were not submitted to the judge. The 223 distinct judge requests retain all original case ordinals when identical requests share a result.

The separate [locked reserved evaluation](results/memory-reserved-reader-profile-v1.json) scored **84/100 for 96 KB versus 78/100 for 24 KB**, with six paired wins and no losses. It uses a different reader profile and sample and supports that wider-context improvement on its own locked set. Both evaluations are closed to further tuning. Their absolute scores are not a matched model comparison or an official leaderboard result.

## Completed execution and preserved evidence

All 8,413 extraction parents remain accounted for: 2,442 legacy parents, 1,051 Claude first responses, four Gateway v3 responses, 184 v4 responses and 4,732 v5 responses. This mixed extraction provenance is part of the result. Model aliases remain fixed as requested families; provider snapshots are not pinned.

The v5 import retained all 5,064 attempted jobs: 4,732 extraction rows and 332 reader outcomes, including one terminal reader failure and its original unresolved 6,938-micro reservation. No earlier first response, failed request or extraction was resubmitted. The original studies retain their incomplete/blocked status; the separately frozen v6 continuation is the completed result.

Physical launcher 001 failed before native admission with a Vercel scope-access error and made zero model calls. Its preserved failure was accepted explicitly. Physical launcher 002 then made 28 reader and four judge requests; physical launcher 003 made the remaining 219 judge requests. All **251 new reservations settled**, and both native supervisors exited successfully with their process groups gone. A fresh process check initially rejected one closure attempt; a separate subsequent snapshot found no matching producer and the unchanged closure check passed. The transient matching process could not be reconstructed, so PID reuse is not claimed as proven.

The independent final auditor reconstructed the complete matrix from saved responses, verified request and judge ownership, replayed every ledger prefix, and rechecked source, inputs, inventories and original evidence. It made zero model, credential, network or process-dispatch calls and no study writes. The current implementation and public results are on [PR #42](https://github.com/hraness/oh/pull/42), branch `devin/memory-superiority-20260906`.

| Evidence | Identity |
| --- | --- |
| Frozen generation commit | `c7ec1194ee9ac7a0e3229c2b7197e9223d3e4435` |
| Frozen generation source SHA-256 | `458086becf13ea3caeadae28dbd61cc80d5a01a634f9f387507fdcf0e02af88d` |
| Freeze SHA-256 | `aeb1366264f7a9f968188a66117a1cbb96ab6592d653ffa529adf761d810999a` |
| Reader-failure policy SHA-256 | `22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1` |
| Final semantic audit SHA-256 | `97e32feb83272d19060d5fbe7077d00dfad55cb893327401817a6db509071977` |
| Full comparison SHA-256 | `4d9732c9e7683afa89b454c9fe9180347a1225bb38cc0cb81d91739b1f23e374` |
| Final batch acceptance SHA-256 | `f6b586a7e2d004c07da3e7ea8380350d567dc275a09afcd24af05285c7695a7d` |
| Final inventory SHA-256 | `caa97a1c2f05c8fa84ec8fa5db4a1d226e231211f70a85d9af06e96ff662f398` |
| Owner closure SHA-256 | `b5a356e61cf9203034c6cbebab8a804dedf6827f7fab0fc7a148cb1c657b69e0` |

Keep the complete private artifact tree described in the [v5 takeover guide](GATEWAY_STUDY_V5_TAKEOVER.md), the separate v6 store, all three launcher packets, failure acceptance, both native acceptances, global reservation, final configuration, exact auditor stdout and execution receipt. Raw conversations, questions, answers, credentials and absolute machine paths are not public artifacts.

## Final budget

Global prior exposure was **$25.744095**. The continuation added **$0.141484**, for **$25.885579 under the unchanged $40 cap**. This is conservative accounting, not a provider invoice.

The native study separately carries $18.268639 from its ancestors and totals **$18.410123** with the same new calls. Do not add that carried native total to the global prior again. Old unresolved reservations remain charged. The exclusive remaining-work reservation was $11.804182; its unused amount is not spending. Reservation SHA-256: `54effed6fddc9307396c04b8cdd8254cdf16ae8afce734daf4feceb07bf59cdf`.

No producer from this comparison remains active. Any future paid experiment needs a new pinned budget descriptor accounting for every development, reserved and native v6 ledger exactly once across the descriptor and active cache. A fresh descriptor changes the generic runner's cache namespace, so it cannot reopen the occupied original cache; a compatible new namespace/runner or reviewed migration must preserve the old evidence. Old descriptors requiring the v6 ledger to be absent are historical and cannot authorize another dispatch. These totals cover the cumulative task amendment; the earlier original-study ledger remains a separate authenticated anchor.

## Verify the saved result

The admitted audit and custody tools were preserved from commit `b702023d91beb1642e8f71e338ad090a68522526`; the generation runtime above stayed unchanged. Resolve absolute tool and evidence locations from the private machine context. A mutable current PR checkout does not replace either admitted source identity.

The final custody collector already created `gateway-v6-final-audit-config.json`, SHA-256 `9f239753d77643ae19a89707e59d3004b6635d32973d759a335458b70185a7d4`, and final preparation SHA-256 `91789a02ea00473f44eead244f0abc31a2fba44a24f00571017206e551e95246`. The configuration contains exactly `runtimeRoot`, `expectedSourceSha256`, `studyDirectory`, `freeze`, `finalBatch`, `comparison`, `inventory` and `supervisorClosure`.

Only when an independent replay is needed, run the admitted [final auditor](../scripts/benchmark-audit/audit-gateway-study-v6-final.ts) through the installed host scheduler:

```sh
"$ABS_OOMPA_HOST_RUN" --mode=heavy --lane=compute --label=oh-v6-final-audit -- \
  "$ABS_BUN" "$AUDITOR_V6" "$WORK/gateway-v6-final-audit-config.json"
```

Preserve exact stdout and exit status in new private files. Require `status: accepted` and all zero side-channel counters. The auditor authenticates the old failed launcher through the accepted failure root and the complete successful native history. The [custody collector](../scripts/benchmark-audit/close_gateway_v6_batch.py) remains available as source for that protocol, but its successful occupied outputs must not be recreated. Do not restart a frozen producer, clear a cache or rerun an attempted model request.

## Faster future work

The [development guide](DEVELOPMENT.md) records the positive and negative screens and the current paired reader workflow. The locked reserved pair completed in 210.73 seconds. The frozen continuation took 24m32s of launcher time; [filesystem timing estimates](results/memory-gateway-recovery-timing-v1.json) place only about 1m55s inside request-processing windows. The final semantic audit is separate from those timings.

The new extraction splitter achieved a [9.52–14.84× synthetic chunk-construction speedup](results/memory-segmentation-performance-v1.json) with exact chunk, ID and prompt parity. That change was not inserted into this frozen generation source. The next bounded performance experiment should measure one shared immutable import graph against one instrumented baseline while preserving fresh entry/exit evidence checks and all request bytes. It is a proposed experiment, not a measured whole-import gain.

Further accuracy work must use development groups and an independently fixed new evaluation. Keep the two completed evaluation sets closed. Measure actual memory-API behavior separately from this keyword/fact adapter, and report source evidence recall, answer quality, context size, latency and spending together. Repository delivery still requires focused validation, independent review and the exact-head/current-base aggregate described in [CONTRIBUTING.md](../CONTRIBUTING.md#validate-a-pull-request).
