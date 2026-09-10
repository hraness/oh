# Experimental Mem0 bridge qualification

This optional benchmark support qualifies the real [Mem0 OSS 2.0.20 source at
`9a7924befd7026e41e445ba809370009e5e985a6`](https://github.com/mem0ai/mem0/tree/9a7924befd7026e41e445ba809370009e5e985a6).
It is isolated Python support, not an Oh runtime dependency, a baseline runner,
or authorization to make provider calls.

The pinned Python 3.14 environment is recorded in
[`requirements-py314.lock`](requirements-py314.lock); it includes the immutable
Mem0 commit and `qdrant-client==1.19.0`. Install it only in a disposable virtual
environment. An admissible future run must additionally record its resolved
wheel/source digest and interpreter identity. Ordinary Bun installs must not
install these requirements.

The worker executes actual `Memory.from_config`, `Memory.add(..., infer=True)`,
and `Memory.search(..., filters={"user_id": namespace}, top_k=50,
threshold=0.1, rerank=False)` with local in-memory Qdrant. Its custom
`LLMBase` and `EmbeddingBase` subclasses use a bounded JSONL RPC to their
parent. The child has no provider endpoint or provider credential: it requires
an explicit `MEM0_DIR`, rejects common provider-key environment variables, and
sets `MEM0_TELEMETRY=false`. The worker gives each opaque SHA-256 namespace both
a separate local collection and Mem0's `user_id` filter.

The pinned SDK validates its provider name before its extensible factory is
consulted. The worker therefore uses the SDK's admitted `openai` configuration
label only to pass that validation, immediately substitutes both factory
implementations with its own RPC subclasses, and never constructs an OpenAI
client or reads an OpenAI key. This compatibility seam is tested through the
real SDK path.

Run the synthetic, no-network qualification after creating an environment from
the lock:

```sh
MEM0_TELEMETRY=false MEM0_DIR="$(mktemp -d)" \
  python scripts/benchmarks/mem0-bridge/test_mem0_bridge.py
```

The test starts a credential-free child, supplies deterministic fake parent RPC
results, and proves Mem0 extraction/embedding calls traverse that bridge,
same-user search is isolated, malformed/cross-namespace input is rejected, and
provider credentials cause the child to stop. It uses synthetic text only.

## Integration boundary

The JSONL child is a qualification harness; it is not the existing evolution
transport. This staging patch adds a separately versioned typed captured-call
ledger (`mem0-ledger.ts`) and parent (`mem0-parent.ts`), but neither creates a
spending authority. A production baseline must pin the final cumulative
antecedent exposure and one shared additional allowance before any provider
call:

1. Use `Mem0EmbeddingRequest` and `Mem0LlmRequest` with canonical bytes,
   model/router identity, operation and namespace, body digest, reservation and
   response-shape bounds. Do not coerce them into `EvolutionRequest`.
2. Give the store and transport typed admission, first-response capture,
   response/failure receipts, replay, and full-charge-on-failure accounting for
   every bridge RPC.
3. Have the parent validate and settle each operation before replying to the
   child; reject unreserved, retry, wrong-namespace and unreplayed calls.

`mem0-qualification.ts` is a no-dispatch admission step. It reconstructs one
selected development corpus only from a SHA-256-pinned, complete V3
full-history context plan, verifies the rendered text and ordered source receipt,
and writes an exclusive mode-0600 receipt. It rejects a non-full-history or
omitted context. It deliberately does not open a worker, ledger, or provider
connection.

Derived Mem0 text is not raw-source context. A later adapter must authenticate
source-to-derived-memory provenance and use a separate context plan before it
can share the fixed reader and judge matrix. The pinned OSS path rejects source
timestamps and does not supply the campaign's temporal semantics, so this worker
does not pass `timestamp` or `reference_date`.

## TypeScript parent and full-source qualification

The source admission command requires exact pins for the prior V3 context plan,
its run config, and the already exposed source cache:

```sh
bun scripts/benchmarks/mem0-qualification.ts \
  --config /absolute/config.json --config-sha256 CONFIG_SHA256 \
  --context-plan /absolute/contexts.json --context-plan-sha256 CONTEXT_SHA256 \
  --source-corpora /absolute/source-corpora.json --source-corpora-sha256 SOURCE_SHA256 \
  --question-id q-OPAQUE_SHA256 --output /absolute/new-source-receipt.json
```

It reads the pinned manifest's metadata, proves every selected source corpus
against its original corpus digest, checks development membership and the fixed
selection, and validates the V3 context against those source bytes. It does not
open the raw dataset or campaign store. The resulting ordered parts preserve
original source ID/digest, role, date, session, and UTF-8 offsets. Each dated chunk
is at most 4,096 bytes. Continuations are consecutive, have no gaps or overlap,
and reconstruct each original source digest; splitting never discards text.

The separate fake-provider qualifier runs the real Python SDK through the actual
TypeScript dispatcher and typed ledger:

```sh
bun scripts/benchmarks/mem0-bridge/qualify_fake_parent.ts \
  --source-receipt /absolute/new-source-receipt.json \
  --source-receipt-sha256 RECEIPT_SHA256 \
  --python /absolute/pinned-venv/bin/python \
  --output /absolute/new-sdk-receipt.json
```

Route process-custody qualification through the repository's host scheduler. The
qualifier always supplies fake provider responses and synthetic credentials in
an isolated temporary ledger; it has no live mode. It blocks Python socket
connections, checks installed Mem0/Qdrant identities, verifies each chunk's
source text reaches the SDK's search embedding and extraction prompt, ingests
one synthetic fact per chunk, then searches with a synthetic query. It verifies
returned chunk provenance, exact call settlement and ledger reopen, graceful
child exit, and removal of its temporary state. Its receipt separates simulated
ledger charges from actual provider cost, which is zero.

The development qualification ingested all 616 original turns as 619 source
parts in 149 chunks (487,820 source text bytes), completed 448 fake provider
operations, and replayed all 448 settled calls. This proves transport, source,
SDK, and custody compatibility. It does not measure extraction or answer
quality, embedding quality, live routing, or live cost.

The default duration policy preserves the 120-second qualification lifecycle.
For one live corpus, `MEM0_ONE_CORPUS_DURATION_POLICY` explicitly allows a
1,800-second lifecycle, 180 seconds per command, two seconds for graceful exit,
two seconds per forced termination wait, and 60 seconds to drain the dispatcher.
Pass that exact, independently pinned policy as `startMem0Worker`'s
`durationPolicy`. The worker exposes its policy digest for the execution receipt.
A new command resets only its command deadline; the lifecycle deadline never
moves. Lifecycle or command expiry aborts the current provider operation, kills
the child, and drains admitted work. An interrupted request remains captured and
fully charged; it cannot be retried. Provider call timeouts must fit the selected
drain bound. The transport also bounds stalled fetches and response streams.
The duration policy does not change provider request hashes, model choices, or
budget authority, and it does not supply the final shared spending authority.
`search` binds its first argument to SHA-256 of the exact query text. Vector state
is ephemeral by default, and there is no automatic partial-ingestion restart or retry.
Derived facts require their own authenticated context contract before evaluation
with the shared reader/judge matrix. Exact SDK prompts and responses remain in
private captured-call ledgers; public receipts contain only digests and counts.

For a benchmark that needs stable extraction prompts across UTC midnight, a
parent may explicitly pass `experimentDate: "2026-09-09"` to `startMem0Worker`.
The value must be a real calendar date in `YYYY-MM-DD` form. Declare the date
when configuring the experiment and retain
`makeMem0ExperimentDateBinding(experimentDate)` in its pinned execution
descriptor. The opted-in worker exposes the same `experimentDateBinding`, with
protocol `oh.memory.mem0-experiment-date.v1` and a canonical binding digest.

This option binds the pinned SDK's module-local
`mem0.memory.main.generate_additive_extraction_prompt` callable. It supplies
`current_date` only when that argument is missing or `None`; the SDK then uses
that date for an absent observation date. Explicit `current_date` and
`timestamp` arguments pass through unchanged. This is an experiment clock, not
a source-event timestamp or a rewrite of captured prompts. The worker does not
patch `datetime`, alter installed SDK files, or change the source turns.

When the option is omitted, the SDK retains its wall-clock defaults and the
parent's environment and returned metadata shape remain unchanged. An ambient
`MEM0_EXPERIMENT_DATE` is not inherited by the parent-launched child. Exact
request hashes still govern replay: a changed date cannot reuse an earlier
response unless the complete generated request matches. The focused contract
check is `bun test tests/memory-benchmark-mem0-experiment-date.test.ts`; it uses
synthetic process and prompt fixtures without requiring an installed Mem0 SDK.
Real-SDK clock qualification and any paid recovery remain separate evidence.

A parent may explicitly set `persistentVectorStore: true` to retain Qdrant
collections under its supplied Mem0 state directory. The default remains
in-memory. History and vectors are then available for inspection after process
exit; this does not authorize automatic re-ingestion or paid-request replay.
The restart fixture writes one synthetic memory, closes the worker, and reads
that memory through a new worker without extraction. Search still projects only
`memory` and `metadata`; SDK IDs and scores are unavailable in this projection.

The [full-source qualification receipt](../../../benchmarks/results/memory-evolution-mem0-all-source-qualification-v1.json) records the actual SDK and parent proof with fake provider responses. It contains no source messages or local paths.

The [reader-context adapter](../../../benchmarks/MEM0_READER_CONTEXT.md) packs the
current SDK search projection into a separately identified 48/96 KB derived-memory
context. It preserves SDK order and does not claim that an extraction is supported
by its attributed source. Actual Mem0 accuracy remains a separate paid evaluation.

An optional parent dispatcher flag, `batchEmbeddings: true`, enables a separate
`oh.memory.mem0-rpc.v2` channel and `oh.memory.mem0-call.v2` batch embedding
requests. The default remains the existing single-text path. The SDK's existing
`embed_batch` list is transmitted in stable groups of at most100 texts; the parent
may split these further to satisfy the pinned aggregate input byte allowance.
Texts retain their exact bytes and order. Every returned vector has a unique
in-range index and the configured finite dimensions before the original order is
reconstructed. The same ledger admits, captures and settles both request formats
against one authority; a batch is one physical HTTP reservation, not one per text.

Only opted-in batches can use8MiB responses/worker frames. Legacy responses and
frames remain limited to1MiB. Each batch RPC has at most262,144 vector components,
and the existing total ledger storage/call/cost caps remain unchanged. Before
admitting a batch, and on every later admission to that ledger, the parent
reserves derived file headroom for the new reservation row and all outstanding
raw-capture/settlement rows, including legacy requests. The obligation is
reconstructed from existing replay state; no ledger schema changes. These
bounds can produce groups smaller than100. Batch mode changes transport; it does
not parallelize or reorder extraction chunks, change SDK prompts, add NLP models,
automatically retry failures, or activate the private live qualification helper.

`qualify_fake_batch_parent.ts` compares the default path and opt-in batch path
through the real pinned SDK using one synthetic chunk and three extracted facts.
It requires a caller-supplied pinned Python environment and writes a private
receipt. Both modes use fake responses and a socket-blocked worker. No benchmark
source or actual provider credential is used. Run it through the host scheduler
where required, supplying `--python` and a fresh `--output` path.
