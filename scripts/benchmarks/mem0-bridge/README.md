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

The JSONL parent is a qualification harness; it is not the existing evolution
transport. A production baseline needs a separately versioned typed captured-call
ledger before any provider call:

1. Add `BaselineEmbeddingRequest` and `BaselineLlmRequest` with canonical bytes,
   model/router identity, operation and namespace, body digest, reservation and
   response-shape bounds. Do not coerce them into `EvolutionRequest`.
2. Give the store and transport typed admission, first-response capture,
   response/failure receipts, replay, and full-charge-on-failure accounting for
   every bridge RPC.
3. Have the parent validate and settle each operation before replying to the
   child; reject unreserved, retry, wrong-namespace and unreplayed calls.

Derived Mem0 text is not raw-source context. A later adapter must authenticate
source-to-derived-memory provenance and use a separate context plan before it
can share the fixed reader and judge matrix. The pinned OSS path rejects source
timestamps and does not supply the campaign's temporal semantics, so this worker
does not pass `timestamp` or `reference_date`.
