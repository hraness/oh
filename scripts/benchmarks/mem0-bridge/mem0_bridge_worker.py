#!/usr/bin/env python3
"""Credential-free JSONL host for Mem0 2.0.20 custom-provider qualification.

The child owns no model credentials and uses no provider URL.  Mem0 invokes the
two real SDK provider subclasses below; each invocation is a bounded RPC back to
the parent, which is the only future place a campaign ledger can dispatch a
captured provider request.  Qdrant is local; persistence is an explicit parent opt-in.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any, Literal, Optional

BATCH_EMBEDDINGS = os.environ.get("MEM0_EMBEDDING_BATCH", "off")
if BATCH_EMBEDDINGS not in {"off", "v2"}:
    raise ValueError("MEM0_EMBEDDING_BATCH must be off or v2")
MAX_FRAME_BYTES = 8_388_608 if BATCH_EMBEDDINGS == "v2" else 1_048_576
MAX_TEXT_BYTES = 262_144
MAX_TOP_K = 50
def _vector_dimensions() -> int:
    raw = os.environ.get("MEM0_VECTOR_DIMENSIONS")
    if raw is None or not raw.isdecimal() or not 1 <= int(raw) <= 16_384:
        raise BridgeError("MEM0_VECTOR_DIMENSIONS must be 1..16384")
    return int(raw)

NAMESPACE = re.compile(r"^[a-f0-9]{64}$")
REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
FORBIDDEN_CREDENTIALS = (
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
    "COHERE_API_KEY", "MISTRAL_API_KEY", "AZURE_OPENAI_API_KEY", "VOYAGE_API_KEY",
)


class BridgeError(ValueError):
    pass


class FrameFatal(BridgeError):
    """An EOF or oversized frame has no safe synchronization point to continue."""


def _bootstrap_environment() -> None:
    # This must run before importing any Mem0 module: pinned Mem0 creates its
    # telemetry object during import and defaults telemetry to enabled.
    if any(os.environ.get(name) for name in FORBIDDEN_CREDENTIALS):
        raise BridgeError("worker refuses provider credentials")
    mem0_dir = os.environ.get("MEM0_DIR")
    if not mem0_dir:
        raise BridgeError("MEM0_DIR must be explicit")
    os.environ["MEM0_TELEMETRY"] = "false"
    Path(mem0_dir).mkdir(parents=True, exist_ok=True)


_bootstrap_environment()
VECTOR_DIMENSIONS = _vector_dimensions()
VECTOR_PERSISTENCE = os.environ.get("MEM0_VECTOR_PERSISTENCE", "memory")
if VECTOR_PERSISTENCE not in {"memory", "local"}:
    raise BridgeError("MEM0_VECTOR_PERSISTENCE must be memory or local")

# Import the pinned SDK only after the credential and telemetry boundary above.
from mem0 import Memory
from mem0.configs.embeddings.base import BaseEmbedderConfig
from mem0.configs.llms.base import BaseLlmConfig
from mem0.embeddings.base import EmbeddingBase
from mem0.llms.base import LLMBase
from mem0.utils.factory import EmbedderFactory, LlmFactory


def _exact(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise BridgeError(f"{label} must have exactly {sorted(keys)}")
    return value


def _text(value: Any, label: str, limit: int = MAX_TEXT_BYTES) -> str:
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > limit:
        raise BridgeError(f"{label} must be nonempty UTF-8 text <= {limit} bytes")
    return value


def _namespace(value: Any) -> str:
    if not isinstance(value, str) or not NAMESPACE.fullmatch(value):
        raise BridgeError("namespace must be lowercase SHA-256")
    return value


class FramedRpc:
    def __init__(self, namespace: str):
        self.namespace = namespace
        self.serial = 0

    def call(self, operation: Literal["llm", "embed", "embed-batch"], payload: dict[str, Any]) -> dict[str, Any]:
        self.serial += 1
        rpc_id = f"provider-{self.serial}"
        batch = operation == "embed-batch"
        frame = {"kind": "rpc-batch" if batch else "rpc", "id": rpc_id, "operation": operation,
                 "namespace": self.namespace, "payload": payload}
        if batch:
            frame["protocol"] = "oh.memory.mem0-rpc.v2"
        _write(frame)
        reply = _read()
        _exact(reply, {"kind", "id", "ok", "result", "protocol"} if batch else {"kind", "id", "ok", "result"}, "rpc result")
        if batch and reply["protocol"] != "oh.memory.mem0-rpc.v2":
            raise BridgeError("batch RPC result protocol")
        if reply["kind"] != "rpc-result" or reply["id"] != rpc_id or reply["ok"] is not True:
            raise BridgeError("RPC reply did not match provider request")
        if not isinstance(reply["result"], dict):
            raise BridgeError("RPC result must be an object")
        return reply["result"]


CURRENT_RPC: Optional[FramedRpc] = None


class RpcLlm(LLMBase):
    def __init__(self, config: Optional[BaseLlmConfig | dict[str, Any]] = None):
        super().__init__(config)
        if CURRENT_RPC is None:
            raise BridgeError("LLM constructed without a bridge RPC")
        self.rpc = CURRENT_RPC

    def generate_response(self, messages: list[dict[str, str]], tools: Any = None,
                          tool_choice: str = "auto", **kwargs: Any) -> str:
        if tools is not None or tool_choice != "auto":
            raise BridgeError("tools are not admitted in the bridge")
        if not isinstance(messages, list) or len(messages) != 2:
            raise BridgeError("Mem0 extraction must use exactly two messages")
        for message in messages:
            _exact(message, {"role", "content"}, "LLM message")
            if message["role"] not in {"system", "user"}:
                raise BridgeError("LLM roles must be system/user")
            _text(message["content"], "LLM message content")
        result = self.rpc.call("llm", {"messages": messages, "responseFormat": kwargs.get("response_format")})
        _exact(result, {"content"}, "LLM RPC result")
        return _text(result["content"], "LLM content")


class RpcEmbedder(EmbeddingBase):
    def __init__(self, config: Optional[BaseEmbedderConfig] = None):
        super().__init__(config)
        if CURRENT_RPC is None:
            raise BridgeError("embedder constructed without a bridge RPC")
        self.rpc = CURRENT_RPC

    def embed(self, text: str, memory_action: Optional[Literal["add", "search", "update"]]):
        _text(text, "embedding text")
        if memory_action not in {"add", "search", "update"}:
            raise BridgeError("unsupported embedding action")
        result = self.rpc.call("embed", {"text": text, "action": memory_action})
        _exact(result, {"embedding"}, "embedding RPC result")
        vector = result["embedding"]
        if (not isinstance(vector, list) or len(vector) != VECTOR_DIMENSIONS or
                any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in vector)):
            raise BridgeError("embedding must match the configured finite dimensions")
        return [float(n) for n in vector]


    def embed_batch(self, texts, memory_action="add"):
        if BATCH_EMBEDDINGS == "off":
            return super().embed_batch(texts, memory_action)
        if not isinstance(texts, list) or len(texts) > 1024:
            raise BridgeError("batch embedding input list bound")
        if memory_action not in {"add", "search", "update"}:
            raise BridgeError("unsupported batch embedding action")
        for text in texts:
            _text(text, "batch embedding text")
        embeddings = []
        # The SDK native OpenAI provider uses at most100 inputs/request. Keep
        # our exact text bytes; the parent can subdivide under its input cap.
        batch_size = min(100, 262_144 // VECTOR_DIMENSIONS)
        for start in range(0, len(texts), batch_size):
            chunk = texts[start:start + batch_size]
            result = self.rpc.call("embed-batch", {"texts": chunk, "action": memory_action})
            _exact(result, {"embeddings"}, "batch embedding RPC result")
            vectors = result["embeddings"]
            if not isinstance(vectors, list) or len(vectors) != len(chunk):
                raise BridgeError("batch embedding result count")
            for vector in vectors:
                if (not isinstance(vector, list) or len(vector) != VECTOR_DIMENSIONS or
                        any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in vector)):
                    raise BridgeError("batch embedding result dimensions")
                embeddings.append([float(n) for n in vector])
        return embeddings


def _frame_limit(value: dict[str, Any]) -> int:
    if (BATCH_EMBEDDINGS == "v2" and value.get("protocol") == "oh.memory.mem0-rpc.v2"
            and value.get("kind") in {"rpc-batch", "rpc-result"}):
        return MAX_FRAME_BYTES
    return 1_048_576


def _write(value: dict[str, Any]) -> None:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > _frame_limit(value):
        raise BridgeError("outbound frame exceeds bound")
    sys.stdout.buffer.write(encoded + b"\n")
    sys.stdout.buffer.flush()


def _read() -> dict[str, Any]:
    raw = sys.stdin.buffer.readline(MAX_FRAME_BYTES + 2)
    if not raw:
        raise FrameFatal("input closed")
    if len(raw) > MAX_FRAME_BYTES + 1 or not raw.endswith(b"\n"):
        # The remainder of an oversized line cannot be treated as a new frame.
        raise FrameFatal("oversized or truncated inbound frame")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise BridgeError("invalid JSON frame") from error
    if not isinstance(value, dict):
        raise BridgeError("frame must be an object")
    if len(raw) - 1 > _frame_limit(value):
        raise FrameFatal("inbound protocol frame exceeds bound")
    return value


def _messages(value: Any) -> list[dict[str, str]]:
    # The parent passes a declared contiguous projection of the original source
    # turns. Do not invent an acknowledgement or discard an assistant turn.
    if not isinstance(value, list) or not 1 <= len(value) <= 8192:
        raise BridgeError("source messages must be a bounded nonempty sequence")
    messages: list[dict[str, str]] = []
    for item in value:
        _exact(item, {"role", "content"}, "source message")
        if item["role"] not in {"user", "assistant"}:
            raise BridgeError("source roles must be user or assistant")
        messages.append({"role": item["role"], "content": _text(item["content"], "source message content")})
    return messages

def _metadata(value: Any) -> dict[str, str]:
    _exact(value, {"chunkId", "sourceDigest"}, "metadata")
    return {"chunkId": _text(value["chunkId"], "chunk ID", 128),
            "sourceDigest": _text(value["sourceDigest"], "source digest", 128)}


def _memory(namespace: str) -> Memory:
    global CURRENT_RPC
    CURRENT_RPC = FramedRpc(namespace)
    # Mem0 2.0.20 validates config provider names before its extensible factory
    # registry runs. Use its admitted placeholder name only for config parsing,
    # then replace both factory implementations with the real custom subclasses;
    # no OpenAI client or API key is constructed or used.
    LlmFactory.register_provider("openai", f"{__name__}.RpcLlm", BaseLlmConfig)
    EmbedderFactory.provider_to_class["openai"] = f"{__name__}.RpcEmbedder"
    # A separate local collection plus Mem0's required user_id filter gives
    # two independent isolation boundaries. No URL, token, timestamp, or reranker.
    return Memory.from_config({
        "version": "v1.1",
        "llm": {"provider": "openai", "config": {"model": "parent-ledger"}},
        "embedder": {"provider": "openai", "config": {"model": "parent-ledger"}},
        "vector_store": {"provider": "qdrant", "config": {
            "collection_name": f"mem0_{namespace}", "embedding_model_dims": VECTOR_DIMENSIONS,
            "path": str(Path(os.environ["MEM0_DIR"]) / f"qdrant-{namespace}") if VECTOR_PERSISTENCE == "local" else ":memory:", "on_disk": False,
        }},
        "history_db_path": str(Path(os.environ["MEM0_DIR"]) / f"history-{namespace}.db"),
    })


def _validate_command(value: dict[str, Any]) -> tuple[str, str]:
    if set(value) < {"kind", "id", "namespace"}:
        raise BridgeError("command needs kind, id, and namespace")
    kind = value.get("kind")
    if kind not in {"prepare", "add", "search", "close"}:
        raise BridgeError("unsupported command")
    request_id = value.get("id")
    if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
        raise BridgeError("invalid command id")
    return kind, _namespace(value["namespace"])


def main() -> int:
    memories: dict[str, Memory] = {}
    while True:
        try:
            command = _read()
            kind, namespace = _validate_command(command)
            request_id = command["id"]
            if kind == "prepare":
                _exact(command, {"kind", "id", "namespace"}, "prepare")
                if namespace in memories:
                    raise BridgeError("namespace was already prepared")
                memories[namespace] = _memory(namespace)
                _write({"kind": "result", "id": request_id, "ok": True, "result": {"prepared": True}})
            elif kind == "add":
                _exact(command, {"kind", "id", "namespace", "messages", "metadata"}, "add")
                memory = memories.get(namespace)
                if memory is None:
                    raise BridgeError("namespace is not prepared")
                result = memory.add(_messages(command["messages"]), user_id=namespace,
                                    metadata=_metadata(command["metadata"]), infer=True)
                _write({"kind": "result", "id": request_id, "ok": True, "result": {"count": len(result["results"])}})
            elif kind == "search":
                _exact(command, {"kind", "id", "namespace", "query", "topK", "threshold"}, "search")
                memory = memories.get(namespace)
                if memory is None:
                    raise BridgeError("namespace is not prepared")
                top_k = command["topK"]
                threshold = command["threshold"]
                if isinstance(top_k, bool) or not isinstance(top_k, int) or not 1 <= top_k <= MAX_TOP_K:
                    raise BridgeError("topK must be 1..50")
                if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not 0 <= threshold <= 1:
                    raise BridgeError("threshold must be 0..1")
                result = memory.search(_text(command["query"], "query"), filters={"user_id": namespace},
                                       top_k=top_k, threshold=float(threshold), rerank=False)
                rows = [{"memory": row["memory"], "metadata": row.get("metadata", {})} for row in result["results"]]
                _write({"kind": "result", "id": request_id, "ok": True, "result": {"results": rows}})
            else:
                _exact(command, {"kind", "id", "namespace"}, "close")
                _write({"kind": "result", "id": request_id, "ok": True, "result": {"closed": True}})
                return 0
        except FrameFatal:
            return 1
        except (BridgeError, ValueError, KeyError, TypeError) as error:
            request_id = command.get("id") if "command" in locals() and isinstance(command.get("id"), str) else "invalid"
            _write({"kind": "result", "id": request_id, "ok": False, "error": str(error)[:512]})


if __name__ == "__main__":
    raise SystemExit(main())
