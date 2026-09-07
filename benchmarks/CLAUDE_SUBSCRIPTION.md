# Claude Code subscription benchmark

`bun run bench:claude` runs memory extraction, answering and judging through an installed Claude Code CLI with a first-party subscription login. Codex or the repository maintainer writes the harness; Claude receives only the benchmark prompt for each completion. This path does not use the OpenAI or Anthropic API clients or modify the paid benchmark ledger.

The procedure is a separate mixed-extractor study. It preserves a pinned incomplete native extraction checkpoint, then uses Claude for the missing native chunks. All new answering and judging arms use `claude-opus-5`, low effort, and Claude Code 2.1.263. The original API study remains incomplete. Changing the extractor, reader, judge, output format and model makes these results distinct from the original frozen procedure and from an official leaderboard reproduction.

## Prepare the study

Use Bun 1.3.14 and the checksum-pinned LongMemEval S dataset cache. Keep the selected family report, exclusion reports and incomplete extraction checkpoint. `prepare` validates the original selection against the dataset and all exclusions, revalidates the stored extraction quotes, and freezes the current source, native parent order, model settings and judge prompt profile. It makes no model calls.

Before preparing, verify that Claude Code is using the intended subscription and that account usage credits are disabled. Supply a previously captured native Claude JSONL stream containing an explicit server event with `status: allowed`, `isUsingOverage: false`, `overageStatus: rejected` and `overageDisabledReason: org_level_disabled`. A subscription login alone does not establish that overage is disabled. The runner never changes billing settings. This dated server evidence cannot prevent someone from changing the account later; changed or missing capacity signals stop further calls.

```sh
bun run bench:claude prepare \
  --directory /absolute/path/to/new-study \
  --cli /absolute/path/to/claude \
  --selection /absolute/path/to/selection.json \
  --legacy /absolute/path/to/incomplete-extraction.json \
  --original-source ORIGINAL_SOURCE_SHA256 \
  --capacity-evidence /absolute/path/to/claude-stream.jsonl \
  --exclude /absolute/path/to/exclusion-report.json
```

Repeat `--exclude` for each report used by the frozen selection. The new study directory must not already exist. Preparation prints a `freezeSha256`; retain it for every batch. Keep the frozen checkout unchanged while the study runs.

## Run and resume a bounded batch

```sh
bun run bench:claude run \
  --directory /absolute/path/to/new-study \
  --freeze-sha256 FREEZE_SHA256 \
  --max-new-calls 32
```

A batch allows 1–256 new transport invocations, one at a time. Each invocation has one user message, an explicit system prompt, no tools or MCP servers, no retained session, and zero ordinary CLI retries. The extraction output cap is 16,384 tokens with a five-minute timeout; answering and judging each have a 512-token cap and a two-minute timeout. The CLI's internal physical model-attempt count remains unknown.

Completed jobs are reconstructed from hashed raw stdout and stderr. They are reused without another model call. Each new response is saved before interpretation. Empty or all-rejected valid native extraction bundles remain completed chunks. Missing or malformed responses, quota errors, uncertain process closure and incomplete evidence stop the batch. The runner does not silently retry an occupied job. Keep its files for an explicit evidence review before recovery.

A study lock permits one active owner. Each batch also has an immutable admission and closure receipt. An unresolved or failed batch blocks later cache replay. The runner also pauses after a completed response reports at least 70% utilization in an active subscription window, retaining its reset metadata for a later batch. This leaves room for other subscription use; wait for the indicated window to reset before continuing. Normal pauses at the call limit can resume with the same command after the prior batch closes successfully. A CLI or source change requires a separately recorded procedure; it cannot silently alter an existing freeze.

## Read the evidence

Private study files have bounded sizes and restricted permissions. Full streams and predictions stay in the study directory. Progress prints coverage and invocation counts. Gold references are absent from extraction and reader prompts; they enter the separate judge and the local token-F1 diagnostic only after the reader returns.

The harness finishes extraction before constructing reader jobs. It requires all three arms for every selected family before judging, preserves exact-prompt judge aliases with one physical owner, and assesses superiority only after the entire judgment matrix is complete. It retains the native paired finite-population decision rule, including the minimum observed gain and both comparison bounds. These statistics describe the fixed eligible pool under this model realization; they do not establish general superiority across memory systems.

A completed comparison records actual Claude terminal usage, per-model usage, legacy provenance, reader rows, all judgment cases and the assessment. CLI dollar figures are list-price estimates. Actual billed dollars and the number of physical model attempts remain unknown; estimates are never added to the original paid ledger or represented as charges. Batch receipts record the exact comparison artifact hash after source, CLI and process-custody checks pass.
