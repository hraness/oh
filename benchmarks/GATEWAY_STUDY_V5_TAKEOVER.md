# Continue and verify the Gateway memory comparison

The v5 comparison runs from an immutable checkout while implementation and audit tools continue to receive commits on [PR #42](https://github.com/hraness/oh/pull/42), branch `devin/memory-superiority-20260906`. Use this runbook to transfer ownership of the existing run. A newer PR head is not permission to change its frozen runtime.

The study keeps 120 selected families and 360 reader/judge cases across `oh-fact`, `bm25-window`, and `bm25-record-window`. Its 8,413 extraction parents comprise 2,442 legacy parents, 1,051 Claude first responses, four earlier Gateway responses, 184 v4 responses, and 4,732 initially unattempted v5 parents. A completed v5 prefix is reused on every continuation. See the [failure policy](GATEWAY_STUDY_V5.md) before interpreting results.

## Find the current owner and evidence

The PR description records a dated snapshot. For live state, use `work/gateway-v3-implementation-state.json` and `work/superiority-live-state.md` in the owning task's workspace. The historical `v3` state filename describes the current v5 run. Read the active supervisor's `status.json` and the latest numbered acceptance before acting; a running process can outlive the task turn.

Exactly one operator owns provider dispatch, process verification and the next batch. Transfer that ownership explicitly, including any scheduled continuation, before launching a command. The PR alone does not contain the captures and cannot resume this study on a fresh machine. The receiving operator needs the existing private artifact tree, its recorded paths, required public dataset cache, and access to the selected Vercel project. Missing evidence requires recovery, not replacement requests or a new study directory.

Use these path aliases in the commands below:

| Alias | Meaning |
| --- | --- |
| `WORK` | Existing task artifact directory named `work` |
| `REPO` | Mutable checkout of the PR branch |
| `RUNTIME` | `WORK/gateway-study-v5-candidate`, the frozen checkout |
| `STUDY` | `WORK/gateway-study-v5`, the append-only live study |
| `CONTEXT` | Private absolute-path context JSON for the tracked Python tools |

These are placeholders for verified absolute paths, not commands to create or move those directories. Accepted manifests contain absolute paths. Relocating code is supported; rewriting frozen evidence to move a study is not.

The immutable run identity is:

| Evidence | Expected value |
| --- | --- |
| Runtime commit | `7e5cdcfc9ef211d3108bc1bf26279e071d3fbecb` |
| Generation source SHA-256 | `896d7a9cc58a907d45c2db5276455eae57ab66f4e74cb1d91b14914ed2aed433` |
| `STUDY/freeze.json` SHA-256 | `92fed47664b2907d4f47c3a7a247aa439222d70c850fc6a1f21e2c2afa87d97a` |
| `WORK/gateway-v5-runtime-preparation.json` SHA-256 | `ea13440e8c405e288c1e7bfaea7a0c1d78aba755cf6e1dcbfa42601db1c03e71` |

Retain the complete dependency tree referenced by the freeze and preparation: authority, public dataset cache, selection and legacy run, Claude and Gateway import manifests, earlier frozen runtimes and stores, all raw captures, old ledgers, accepted inventories and process closures, numbered launch configurations, and audit implementation/review receipts. Hashes do not replace the files they identify. Keep full reports and credentials outside Git; publish only reviewed aggregate evidence when the final audit succeeds.

## Tools and validation

The tracked implementations are in [`scripts/benchmark-audit`](../scripts/benchmark-audit):

| Tool | Responsibility |
| --- | --- |
| `benchmark-supervisor.py` | Launch one reviewed argv once; retain status, log, process identity and group closure |
| `close_gateway_v5_batch.py` | Verify a closed numbered batch and write exclusive acceptance/inventory receipts |
| `prepare_gateway_v5_final_audit.py` | Verify the complete producer history and construct final audit inputs |
| `audit-gateway-study-v5-final.ts` | Independently reconstruct memory, contexts, judgments, budget and custody |
| `gateway-v5-audit-supervisor.ts` | Validate external supervisor configuration and status for the semantic auditor |

The tracked supervisor treats permission-denied process-group probes as possibly live and keeps cleanup bounded when group signaling is denied. It requires fresh disappearance before reporting group closure. The live run retains its original accepted supervisor pending separate adoption of this repair. The Python closure and preparation ports use an explicit context instead of a machine-specific source path. They still authenticate the existing study and accepted audit packet. They do not authorize a different project, tool, artifact path or budget.

The accepted live packet remains under `WORK`, including `benchmark-supervisor.py`, `close-gateway-v5-batch.py`, `prepare-gateway-v5-final-audit.py`, `audit-gateway-study-v5-final.ts`, its adjacent helper and canonical dependency. Preserve these originals: existing review receipts pin their bytes. The tracked copies make the implementation reviewable and testable; their changed imports and context arguments do not inherit those original acceptance hashes. Until a separate adoption receipt binds tracked tools to this study, continue with the accepted originals for actual closure and final verification.

Run focused checks with Bun 1.3.14 and Python 3.14:

```sh
bun test tests/memory-benchmark-gateway-final-audit.test.ts
python3 -B -m unittest discover -s tests -p 'test_benchmark_supervisor.py'
python3 -B -m unittest discover -s tests -p 'test_gateway_v5_audit_helpers.py'
```

Supervisor integration requires macOS `/bin/ps` and `/usr/sbin/sysctl`; Linux runs the portable tests and skips the macOS integration class. CI runs both OS jobs. On hosts with `hra-host-run`, use its installed absolute path for process tests and required final gates. Use the mac-native lane for macOS supervisor integration and compute for other checks. The repository delivery gate remains `bun run test:benchmarks`, `bun run check`, and `git diff --exit-code -- dist`. Synthetic audit tests do not certify actual comparison results.

The tracked Python tools require `--context /absolute/context.json`. Its exact shape is:

```json
{
  "schema": "oh.gateway-audit-context.v1",
  "workDirectory": "/absolute/existing/work",
  "repositoryDirectory": "/absolute/existing/repository",
  "tools": {
    "python": "/absolute/python3",
    "bun": "/absolute/bun",
    "vercel": "/absolute/vercel",
    "ps": "/bin/ps"
  },
  "auth": {
    "method": "project-oidc",
    "project": "APPROVED_PROJECT",
    "scope": "APPROVED_SCOPE",
    "environment": "development"
  }
}
```

Populate it from the immutable authority and recorded supervisor argv. The process tool must be `/bin/ps`; project/scope and Bun/Vercel paths must match the pinned authority and first launch configuration. The Python path describes the operator environment; these helpers do not launch an interpreter. Keep the context private; it contains local paths but no token. The tracked tools reject mismatches against the accepted evidence.

## Close a batch before continuing

1. Observe the active supervisor. `running`, `starting`, and `leader-exited-descendants-present` all mean a producer may remain live. Wait without holding a compute lease. Read bounded progress metadata rather than dumping raw logs or correctness values.
2. Require terminal `state: exited`, `exitCode: 0`, and `groupGone: true`. Through the host scheduler in shared compute mode, run the accepted `python3 WORK/close-gateway-v5-batch.py NUMBER`. The tracked equivalent is `python3 REPO/scripts/benchmark-audit/close_gateway_v5_batch.py --context CONTEXT --batch NUMBER` after reviewed adoption. This performs fresh process absence and writes numbered receipts with exclusive creation. Do not rerun into occupied receipt paths.
3. Inspect the native closure pinned by acceptance. Ordinary continuation requires `result.status: paused`, top-level `stopReason: call-limit`, successful source/import/store/ledger closure, and the complete admitted prefix. Budget exhaustion, interruption, transport, identity, usage, custody, reader or judge failure requires diagnosis. An accepted per-batch inventory alone is not a continuation decision.
4. If the comparison is complete, proceed to final verification. Otherwise create one fresh numbered launch configuration from the preceding accepted configuration. Preserve `cwd`, the full argv and the exact `requireAbsent` list; change only `jobDir` and, after the initial pilot, `--max-new-calls` to 256. Retain the external `gateway-study-v5-batch-NNN-launch-config.json` file. Use canonical sorted compact JSON and mode `0600`.
5. Launch through the accepted `python3 WORK/benchmark-supervisor.py launch ABS_CONFIG`, using reviewed provider access. Confirm the durable status/configuration binding and record the new batch in the live state. Do not start another producer until this one closes and passes step 2.

The exact supervisor configuration keys are `cwd`, `argv`, `jobDir`, and `requireAbsent`. The selected-provider argv is an array, not shell text:

```text
ABS_VERCEL env run --project APPROVED_PROJECT --scope APPROVED_SCOPE
--environment development -- ABS_BUN
ABS_RUNTIME/scripts/benchmarks/gateway-study-v5.ts run
--directory ABS_STUDY --freeze-sha256 RECORDED_FREEZE --max-new-calls 256
```

Use the authority's selected project OIDC identity. Extraction and reader use `openai/gpt-4.1-mini`; the separate judge uses `openai/gpt-4o`, with OpenAI upstream only, unchanged output caps and drained waves of four. Gold references go only to the judge. Do not retry an occupied request, regenerate an attempted parent, change models or prompts, add fallbacks, or select another billing route.

The total amendment exposure cap is **$40 across all phases**, including the full **$0.809209** prior carry at every reservation prefix. That carry is $0.121802 from v3 plus $0.687407 from v4, including its unresolved truncated-response reservation. Never append old settlements or substitute reported cost for reserved old exposure. The closing figure excludes later in-flight reservations; report its timestamp and batch.

## Verify the complete result and deliver

Require all 4,732 new v5 extractions, all 360 reader/judge cases, exactly one native comparison artifact, and the final numbered batch acceptance. Authenticate `gateway-v5-final-auditor-acceptance.json`, `gateway-v5-final-preparation-acceptance.json`, their referenced reviews and the full pinned tool packet before executing them.

Through the host scheduler in heavy compute mode, run the accepted collector:

```text
ABS_PYTHON WORK/prepare-gateway-v5-final-audit.py
  --final-batch NUMBER --final-acceptance-sha256 ACCEPTANCE_SHA256
```

The tracked collector adds `--context CONTEXT` to the same arguments. It performs one fresh read-only process inventory, verifies all numbered directories and launch files, and exclusively writes the external final inventory, supervisor closure, configuration and preparation receipt. It does not invoke the auditor or models. Fresh process discovery and complete producer ownership are required; absent locks alone are insufficient.

Then invoke the accepted `ABS_BUN WORK/audit-gateway-study-v5-final.ts WORK/gateway-v5-final-audit-config.json` through heavy compute and preserve stdout bytes, exit code and a fresh receipt. The tracked auditor has the same one-config-path CLI. Its exact eight configuration fields are `runtimeRoot`, `expectedSourceSha256`, `studyDirectory`, `freeze`, `finalBatch`, `comparison`, `inventory`, and `supervisorClosure`; the last five are `{path, sha256}` pins. The auditor denies network and child dispatch, verifies metadata before semantic replay, and reconstructs all parents, full reader contexts, physical judge owners and aliases, assessment and every ledger prefix.

Only an accepted complete audit supports publishing aggregate results. Report invalid-envelope, refusal and truncation rates separately. The fixed criterion requires both one-sided 97.5% lower bounds above zero and both gains at least five percentage points. This mixed-extractor/provider, post-start failure-policy amendment does not restore unchanged confirmatory error control, prove an accuracy lower bound, complete earlier studies, or constitute an official leaderboard result.

Push validated task-owned commits to the PR throughout execution. Keep its description current with the latest commit, dated closed batch and exposure, validation, unresolved work, and takeover command. Once the full evidence is accepted, publish the reviewed result, complete required checks/review and merge, then record applicable deployment or production evidence. Keep the continuation active until both benchmarking and repository delivery are conclusively finished.
