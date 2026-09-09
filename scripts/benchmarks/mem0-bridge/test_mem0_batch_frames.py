"""Pure framed-I/O bounds in the pinned Python runtime; no SDK/provider calls."""
from __future__ import annotations
import io
import json
import os
import sys
import tempfile
from types import SimpleNamespace


def test_batch_frame_bounds() -> None:
    with tempfile.TemporaryDirectory() as state:
        os.environ.update(MEM0_DIR=state, MEM0_VECTOR_DIMENSIONS="3", MEM0_EMBEDDING_BATCH="v2", MEM0_TELEMETRY="false")
        import mem0_bridge_worker as worker
        assert worker.BATCH_EMBEDDINGS == "v2"
        stdout, stdin = sys.stdout, sys.stdin
        try:
            cases = [({"kind": "result", "text": "x" * 1_048_576}, False),
                     ({"kind": "rpc", "protocol": "oh.memory.mem0-rpc.v2", "text": "x" * 1_048_576}, False),
                     ({"kind": "rpc-result", "protocol": "other", "text": "x" * 1_048_576}, False),
                     ({"kind": "rpc-result", "protocol": "oh.memory.mem0-rpc.v2", "text": "x" * 1_048_576}, True),
                     ({"kind": "rpc-batch", "protocol": "oh.memory.mem0-rpc.v2", "text": "x" * 8_388_608}, False)]
            for value, accepted in cases:
                sink = io.BytesIO()
                sys.stdout = SimpleNamespace(buffer=sink)
                try:
                    worker._write(value)
                    assert accepted
                except worker.BridgeError:
                    assert not accepted
                raw = json.dumps(value, separators=(",", ":")).encode() + b"\n"
                sys.stdin = SimpleNamespace(buffer=io.BytesIO(raw))
                try:
                    assert worker._read() == value
                    assert accepted
                except worker.FrameFatal:
                    assert not accepted
        finally:
            sys.stdout, sys.stdin = stdout, stdin
    print("Python protocol frame bounds:10 assertions passed; no provider calls")

if __name__ == "__main__":
    test_batch_frame_bounds()
