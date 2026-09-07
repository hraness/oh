# Gateway memory comparison amendment

`bun run bench:gateway:v3` implements a separately frozen, post-start amendment to the closed Claude subscription studies. It imports every captured first response and sends only unattempted native extraction chunks to Vercel AI Gateway. Codex or the maintainer writes the harness; the models complete benchmark prompts.

This approved run keeps the original 120 selected families, all three retrieval arms and the full 360-case answering and judgment matrix. Of the 5,971 originally missing extraction chunks, 1,051 already have captured responses. The import reproduces 1,049 valid payloads, one invalid native envelope and one explicitly reported refusal-driven Claude model fallback. Both invalid responses contribute zero memory. Their original bytes and models remain identifiable; neither parent is sent to Gateway again. The original API, Claude v1 and Claude v2 studies remain incomplete.

## Fixed models and budget

New extraction and answering use `openai/gpt-4.1-mini`; the separate judge uses `openai/gpt-4o`. Requests specify only the OpenAI provider, temperature zero, no retained storage, no fallback model list and no ordinary retries. Gateway model names are family aliases. Each saved response records returned routing and snapshot information; the procedure does not claim to pin a snapshot.

Extraction retains the 16,384-token maximum and five-minute timeout. Answering and judging allow 512 output tokens and two minutes. Four concurrent requests form a wave. All admitted requests finish or reach their bounded transport failure before another wave can begin.

A single append-only ledger covers every new extraction, answer and judgment across batches. The hard new exposure ceiling is $40, within the unused portion of the earlier $50 authorization. Each call reserves a conservative input/output bound before dispatch; incomplete or ambiguous responses retain their reservation. Verified usage settles to the larger of known token-rate cost and Gateway-reported cost. These values describe spending exposure, not a consolidated billing statement. The original paid ledger is read-only and hash-pinned.

This entry point is specific to the approved fixed study: it requires its 1,051-response ancestry, 4,920 unattempted chunks, model choices, selected project OIDC identity and budget authority. It is not a general-purpose launcher for another dataset or account.

## Prepare and run

Use a clean committed checkout with Bun 1.3.14, the pinned dataset cache, a reviewed v3 ancestry manifest and the approved authority record. Preparation authenticates the closed source trees, complete inventories, supervisor closures, original native parent order and all first responses. It makes no model calls.

```sh
bun run bench:gateway:v3 prepare \
  --directory /absolute/path/to/new-gateway-study \
  --import-manifest /absolute/path/to/v3-import.json \
  --import-sha256 IMPORT_MANIFEST_SHA256 \
  --authority /absolute/path/to/approved-authority.json \
  --authority-sha256 AUTHORITY_SHA256
```

Keep the printed freeze hash and unchanged runtime. Use the exact project and scope named by the approved authority record for `APPROVED_PROJECT` and `APPROVED_SCOPE`. Run one bounded batch through that project identity:

```sh
vercel env run --project APPROVED_PROJECT --scope APPROVED_SCOPE --environment development -- \
  bun run bench:gateway:v3 run \
  --directory /absolute/path/to/new-gateway-study \
  --freeze-sha256 FREEZE_SHA256 \
  --max-new-calls 32
```

Each batch permits 1–256 new transport invocations. A successful pause at the call limit can resume after the producer exits and its closure is verified. The shared budget persists. A study lock, exclusive job directories and complete admission/closure evidence prevent overlapping owners or retrying occupied jobs. Failed or unresolved evidence blocks continuation; preserve those files for review.

Malformed extraction JSON or an invalid top-level native envelope receives an invalid zero-memory disposition. Explicitly authenticated extraction refusal and content-filter responses also contribute zero memory. Valid empty envelopes and envelopes whose individual units are all rejected remain valid. Unknown identity, truncation, incomplete transport, ambiguous cost or usage, changed source and custody failures stop the run. Answering and judge failures also stop it. No response is regenerated to improve its content.

## Interpret the completed evidence

Progress exposes coverage and spending exposure. Extraction and answering prompts contain no gold answers. Gold enters the separate judge and the local token-F1 diagnostic only after the reader returns. Identical judge requests have one positional owner and explicit aliases covering every case.

The comparison retains the paired finite-population rule: both one-sided 97.5% lower bounds must be positive and both observed gains must reach five percentage points. The full matrix is required before assessment. A separate final audit must reconstruct all imported and new memory, reader contexts, judge ownership, decisions, spending and producer closures from raw evidence.

This amendment changes extraction models, provider and failure handling after the earlier runs started, without inspecting correctness outcomes. Zero memory can remove distracting information, so the policy is not a guaranteed accuracy lower bound. The statistics apply to the fixed eligible pool under this model realization; they do not establish unchanged confirmatory error control, an official leaderboard result or general superiority across memory systems.
