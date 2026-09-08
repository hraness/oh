# Gateway extraction failures at the output limit

`bun run bench:gateway:v5` continues the fixed memory comparison after an extraction reached the 16,384-token output limit. It preserves all 184 captured responses from the closed v4 run, including the three successful responses in its final concurrent wave. Only the 4,732 unattempted extraction parents remain eligible for new calls.

A complete, authenticated extraction response with `finish_reason: length` and exactly 16,384 reported output tokens receives an explicit `invalid-truncation` disposition. It contributes zero memory, even if its partial output happens to be valid JSON. Partial text is retained only in the original raw capture and never enters memory, answering or judgments. Every future extraction meeting the same rule receives the same disposition. Reader and judge truncations remain fatal, as do incomplete transport, unexplained identity, ambiguous usage or cost, and changed evidence.

The amendment keeps the existing request bodies, model aliases, provider restriction, output limits, prompts, selected families and four-request waves. It does not retry the truncated parent or alter generation to obtain another answer. All 183 previously completed v4 responses retain their original native results. The earlier API, Claude and Gateway studies remain incomplete and unchanged.

## Budget and evidence

The old v4 ledger retains $0.687407 of exposure, including the truncated response's full unresolved $0.028024 reservation. Together with the earlier Gateway ledger's $0.121802, the continuation carries $0.809209 within the same $40 amendment cap. Every new ledger prefix includes that full amount, leaving at most $39.190791 of additional exposure. No old settlement is added or reduced. Verified usage for future truncated responses can settle only their own new reservations.

The import authenticates the complete closed source, all raw responses and native results, both supervised batches, original parent order and every ledger prefix. The final comparison must retain all 120 families and all 360 cases across the three retrieval arms. A separate final audit reconstructs memory, reader contexts, judgments, aliases, costs and producer closures from the complete evidence.

## Prepare and run

Use a clean committed Bun 1.3.14 runtime, the original authority and the three reviewed import manifests. Preparation makes no model calls.

```sh
bun run bench:gateway:v5 prepare \
  --directory /absolute/path/to/new-study \
  --import-manifest /absolute/path/to/claude-import.json \
  --import-sha256 CLAUDE_IMPORT_SHA256 \
  --prior-gateway-manifest /absolute/path/to/gateway-v3-import.json \
  --prior-gateway-sha256 GATEWAY_V3_IMPORT_SHA256 \
  --prior-continuation-manifest /absolute/path/to/gateway-v4-import.json \
  --prior-continuation-sha256 GATEWAY_V4_IMPORT_SHA256 \
  --authority /absolute/path/to/approved-authority.json \
  --authority-sha256 AUTHORITY_SHA256
```

Retain the printed freeze hash and unchanged runtime. For a supervised study, the launch configuration must use the project and scope from the authority and the direct frozen script path:

```sh
vercel env run --project APPROVED_PROJECT --scope APPROVED_SCOPE --environment development -- \
  bun /absolute/frozen/runtime/scripts/benchmarks/gateway-study-v5.ts run \
  --directory /absolute/path/to/new-study \
  --freeze-sha256 FREEZE_SHA256 \
  --max-new-calls 32
```

This shows the child command only. Use the [takeover runbook](GATEWAY_STUDY_V5_TAKEOVER.md) to preserve the exact argv in a reviewed supervisor configuration, launch it once, verify process closure, and prepare the final audit. An existing study must continue from its recorded configuration and frozen runtime.

A successfully closed pause at the call limit may resume in batches of at most 256 calls. Budget exhaustion, interruption or failed evidence requires review before further dispatch.

This is another post-start failure-policy amendment, recorded before correctness inspection. Zero memory can remove distracting information, so it is not a guaranteed accuracy lower bound. The fixed decision rule and full matrix do not restore unchanged confirmatory error control. Report the truncation rate and mixed extraction history with the results; this procedure alone establishes neither an official leaderboard result nor general superiority.

See the [initial Gateway procedure](GATEWAY_STUDY_V3.md) for fixed models, prompts and assessment, and the [routing metadata continuation](GATEWAY_STUDY_V4.md) for the earlier four-response import.
