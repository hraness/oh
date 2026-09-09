#!/usr/bin/env python3
"""Qualification test: real Mem0 SDK and local Qdrant, deterministic fake parent RPC."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent


def digest(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


class Parent:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        # sitecustomize terminates the child if an SDK import or operation opens
        # a socket. MEM0_TELEMETRY is intentionally absent: worker bootstrap
        # must disable the pinned SDK default before its first import.
        (Path(self.temp.name) / "sitecustomize.py").write_text("import os, socket\ndef blocked(*args, **kwargs): os._exit(81)\nsocket.socket.connect = blocked\n", encoding="utf-8")
        env = {"PATH": os.environ["PATH"], "PYTHONPATH": f"{self.temp.name}{os.pathsep}{HERE}", "MEM0_DIR": self.temp.name, "MEM0_VECTOR_DIMENSIONS": "3",
               "NO_PROXY": "*", "http_proxy": "", "https_proxy": "",
               "HTTP_PROXY": "", "HTTPS_PROXY": "", "ALL_PROXY": "", "all_proxy": ""}
        # Run as an importable module: Mem0's dynamic factory imports this same
        # module path for both provider classes, so it must share CURRENT_RPC.
        self.process = subprocess.Popen([sys.executable, "-m", "mem0_bridge_worker"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env)
        self.operations: list[str] = []

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        self.temp.cleanup()

    def send(self, value: dict[str, Any]) -> dict[str, Any]:
        assert self.process.stdin and self.process.stdout
        self.process.stdin.write(json.dumps(value, separators=(",", ":")) + "\n")
        self.process.stdin.flush()
        while True:
            line = self.process.stdout.readline()
            assert line, self.process.stderr.read() if self.process.stderr else "worker closed"
            frame = json.loads(line)
            if frame["kind"] == "rpc":
                self.operations.append(frame["operation"])
                result = self.respond(frame)
                self.process.stdin.write(json.dumps({"kind": "rpc-result", "id": frame["id"], "ok": True,
                                                     "result": result}, separators=(",", ":")) + "\n")
                self.process.stdin.flush()
                continue
            return frame

    @staticmethod
    def respond(frame: dict[str, Any]) -> dict[str, Any]:
        if frame["operation"] == "llm":
            # Real Mem0 parses this standard additive-extraction response.
            user = frame["payload"]["messages"][1]["content"]
            fact = "alpha fact" if "alpha" in user else "beta fact"
            return {"content": json.dumps({"memory": [{"event": "ADD", "text": fact}]})}
        text = frame["payload"]["text"].lower()
        return {"embedding": [1.0, 0.0, 0.0] if "alpha" in text else [0.0, 1.0, 0.0]}


def expect_ok(frame: dict[str, Any]) -> dict[str, Any]:
    assert frame["kind"] == "result" and frame["ok"] is True, frame
    return frame["result"]


def command(parent: Parent, kind: str, request_id: str, namespace: str, **extra: Any) -> dict[str, Any]:
    return expect_ok(parent.send({"kind": kind, "id": request_id, "namespace": namespace, **extra}))


def test_real_sdk_add_search_and_isolation() -> None:
    parent = Parent()
    try:
        alpha, beta = digest("alpha-user"), digest("beta-user")
        command(parent, "prepare", "p-alpha", alpha)
        command(parent, "prepare", "p-beta", beta)
        command(parent, "add", "a-alpha", alpha,
                messages=[{"role": "user", "content": "Remember alpha preference"},
                          {"role": "assistant", "content": "alpha acknowledgement"}],
                metadata={"chunkId": "chunk-a", "sourceDigest": digest("source-a")})
        command(parent, "add", "a-beta", beta,
                messages=[{"role": "user", "content": "Remember beta preference"},
                          {"role": "assistant", "content": "beta acknowledgement"}],
                metadata={"chunkId": "chunk-b", "sourceDigest": digest("source-b")})
        found = command(parent, "search", "s-alpha", alpha, query="alpha", topK=50, threshold=0.1)
        isolated = command(parent, "search", "s-beta", beta, query="alpha", topK=50, threshold=0.1)
        assert [row["memory"] for row in found["results"]] == ["alpha fact"]
        assert isolated["results"] == []
        assert "llm" in parent.operations and "embed" in parent.operations
        command(parent, "close", "done", alpha)
        assert parent.process.wait(timeout=5) == 0
    finally:
        parent.close()


def test_frame_contract_rejects_cross_namespace_and_oversized_inputs() -> None:
    parent = Parent()
    try:
        namespace = digest("one")
        command(parent, "prepare", "p", namespace)
        frame = parent.send({"kind": "search", "id": "bad", "namespace": digest("other"),
                             "query": "alpha", "topK": 50, "threshold": 0.1})
        assert frame["ok"] is False and "not prepared" in frame["error"]
        frame = parent.send({"kind": "add", "id": "huge", "namespace": namespace,
                             "messages": [{"role": "user", "content": "x" * 262_145},
                                          {"role": "assistant", "content": "ok"}],
                             "metadata": {"chunkId": "c", "sourceDigest": digest("s")}})
        assert frame["ok"] is False and "262144" in frame["error"]
        command(parent, "close", "done", namespace)
    finally:
        parent.close()


def test_worker_refuses_provider_credentials() -> None:
    with tempfile.TemporaryDirectory() as state:
        env = {"PATH": os.environ["PATH"], "PYTHONPATH": str(HERE), "MEM0_DIR": state, "MEM0_VECTOR_DIMENSIONS": "3",
               "MEM0_TELEMETRY": "false", "OPENAI_API_KEY": "synthetic-test-key"}
        process = subprocess.run([sys.executable, "-m", "mem0_bridge_worker"], cwd=HERE, env=env,
                                 text=True, capture_output=True, timeout=5)
        assert process.returncode != 0
        assert "worker refuses provider credentials" in process.stderr


def test_eof_and_oversized_frames_stop_without_reframing() -> None:
    for payload in (b"", b"x" * 1_048_577 + b"\n"):
        parent = Parent()
        try:
            assert parent.process.stdin
            parent.process.stdin.buffer.write(payload)
            parent.process.stdin.close()
            assert parent.process.wait(timeout=5) == 1
            assert parent.process.stdout and parent.process.stdout.read() == ""
        finally:
            parent.close()


if __name__ == "__main__":
    test_real_sdk_add_search_and_isolation()
    test_frame_contract_rejects_cross_namespace_and_oversized_inputs()
    test_worker_refuses_provider_credentials()
    test_eof_and_oversized_frames_stop_without_reframing()
    print("mem0 bridge qualification: 4 tests passed")
