# Gateway response continuation

This run later stopped on an extraction at its output-token limit. The separate [v5 continuation](GATEWAY_STUDY_V5.md) retains every captured response and records truncation as a failed extraction with zero memory.

`bun run bench:gateway:v4` continues the fixed memory comparison after four successful Gateway responses were rejected because optional routing fields were absent. It imports those saved responses under a separately frozen parser correction and sends only the remaining 4,916 extraction chunks. No completed request is sent again.

The correction accepts an alias-only response when the returned model, original model, canonical slug, successful model attempt and sole OpenAI provider attempt agree with the request. Every reported model identifier is still checked. Missing resolved model or snapshot identifiers remain `null`; an alias is never presented as a pinned snapshot. This change does not alter request bodies, model choices or generation settings.

The original Gateway study remains blocked and its files stay unchanged. The import authenticates its frozen source, complete four-response inventory, native admission and failed closure, supervisor exit, raw response bytes and original parent order. All four responses receive the native extraction disposition. Their complete $0.121802 reserved exposure remains charged within the same $40 amendment cap; parsed usage is recorded separately. The new ledger therefore permits at most $39.878198 of additional exposure, including extraction, answering and judging.

## Prepare and run

Use a clean committed Bun 1.3.14 checkout, the reviewed Claude ancestry manifest, a reviewed closed Gateway import manifest and the existing budget authority. Preparation verifies all 1,051 Claude responses and all four Gateway responses. It makes no model calls.

```sh
bun run bench:gateway:v4 prepare \
  --directory /absolute/path/to/new-gateway-continuation \
  --import-manifest /absolute/path/to/claude-import.json \
  --import-sha256 CLAUDE_IMPORT_SHA256 \
  --prior-gateway-manifest /absolute/path/to/gateway-import.json \
  --prior-gateway-sha256 GATEWAY_IMPORT_SHA256 \
  --authority /absolute/path/to/approved-authority.json \
  --authority-sha256 AUTHORITY_SHA256
```

Keep the printed freeze hash and unchanged runtime. Use the project and scope from the approved authority record:

```sh
vercel env run --project APPROVED_PROJECT --scope APPROVED_SCOPE --environment development -- \
  bun run bench:gateway:v4 run \
  --directory /absolute/path/to/new-gateway-continuation \
  --freeze-sha256 FREEZE_SHA256 \
  --max-new-calls 32
```

The [Gateway comparison procedure](GATEWAY_STUDY_V3.md) still defines the fixed GPT-4.1 mini extraction and reader, GPT-4o judge, four-request waves, refusal handling, complete 360-case matrix and paired decision rule. Only a successfully closed batch may resume. Failed, truncated, unexplained identity or cost evidence still stops the run. Each new ledger prefix includes the entire earlier reserved exposure.

A separate final audit must reconstruct the imported and new memory, all reader contexts and judgments, request ownership, producer closures and both Gateway ledgers. This parser correction occurred after four requests and before correctness inspection. The comparison remains a post-start amendment with mixed extractors, subject to the limitations in the original procedure. It does not complete the earlier studies or establish an official leaderboard result.
