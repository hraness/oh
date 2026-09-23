"""Offline parity against the pinned official public Encoding API and golden tokens."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pilot_tokenizer_worker", HERE / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def official_encoding(root, ranks, members, extension):
    # Import only these exact, digest-verified Python members; no plugin discovery.
    package = root / "tiktoken"
    package.mkdir()
    for name in ("tiktoken/__init__.py", "tiktoken/core.py", "tiktoken/model.py", "tiktoken/registry.py"):
        (root / name).write_bytes(members[name])
    plugins = types.ModuleType("tiktoken_ext")
    plugins.__path__ = []  # Empty namespace: public Encoding does not discover plugins.
    sys.modules["tiktoken_ext"] = plugins
    sys.modules["tiktoken._tiktoken"] = extension
    spec = importlib.util.spec_from_file_location("tiktoken", package / "__init__.py",
                                                submodule_search_locations=[str(package)])
    public = importlib.util.module_from_spec(spec)
    sys.modules["tiktoken"] = public
    spec.loader.exec_module(public)
    # The official constructor's loader is replaced only by the admitted local bytes.
    # Its URI/hash arguments must still identify this exact official encoding asset.
    loader = types.ModuleType("tiktoken.load")

    def local_bpe(uri, expected_hash):
        asset = worker.manifest()["asset"]
        if uri != asset["url"] or expected_hash != asset["sha256"]:
            worker.reject("unexpected official asset reference")
        return ranks

    loader.load_tiktoken_bpe = local_bpe
    loader.data_gym_to_mergeable_bpe_ranks = lambda **_: worker.reject("unexpected legacy loader")
    sys.modules["tiktoken.load"] = loader
    namespace = {}
    exec(compile(members["tiktoken_ext/openai_public.py"], "pinned-openai-public.py", "exec"), namespace)
    arguments = namespace["o200k_base"]()
    if arguments["pat_str"] != worker.PATTERN or arguments["special_tokens"] != worker.SPECIAL_TOKENS:
        worker.reject("official encoding configuration mismatch")
    return public.Encoding(**arguments)


def qualify(artifact_directory, fixtures_path):
    raw = worker.read_exact(fixtures_path, 4702, "4278140dea12fc079ba809c6f241d178b58e2174eac8d13298c9e4b11e19e8e5")
    fixtures = json.loads(raw)
    worker.exact_keys(fixtures, ("protocol", "provenance", "rows"))
    if fixtures["protocol"] != "oh.framework-pilot-tokenizer-fixtures.v1" or len(fixtures["rows"]) != 21:
        worker.reject("invalid fixtures")
    worker.disable_network()
    with tempfile.TemporaryDirectory(prefix="oh-tokenizer-parity-") as temporary:
        root = Path(temporary)
        native = root / "native"
        native.mkdir(mode=0o700)
        core, provenance, ranks, members, extension = worker.load_tokenizer(artifact_directory, native)
        public = official_encoding(root, ranks, members, extension)
        for fixture in fixtures["rows"]:
            worker.exact_keys(fixture, ("id", "text", "tokens"))
            text = worker.parse_request(json.dumps({"protocol": "oh.framework-pilot-token-batch-input.v1",
                                                   "texts": [fixture["text"]]}).encode())[0]
            expected = fixture["tokens"]
            actual = public.encode(text, allowed_special=set(), disallowed_special=())
            if actual != expected or core.encode_ordinary(text) != expected:
                worker.reject("golden/public/native parity mismatch")
            if public.decode(actual) != text:
                worker.reject("lossless Unicode round trip failed")
        # Exact 8,192 boundary is a context-string policy, separate from model chat framing.
        for count in (8191, 8192, 8193):
            text = " a" * count
            if len(public.encode(text, disallowed_special=())) != count or len(core.encode_ordinary(text)) != count:
                worker.reject("token boundary parity failed")
        try:
            public.encode("<|endoftext|>")
        except ValueError:
            pass
        else:
            worker.reject("official default special-token behavior drifted")
    return {"protocol": "oh.framework-pilot-tokenizer-qualification.v1", "scope": "context-string-only",
            "fixtureSha256": worker.sha(raw), "fixtureCount": len(fixtures["rows"]), "boundaryCases": [8191, 8192, 8193],
            "officialPublicApi": "Encoding.encode(allowed_special=set(),disallowed_special=())",
            "specialTokens": "ordinary-text", "parity": "pass", "provenance": provenance}


if __name__ == "__main__":
    if len(sys.argv) != 3 or not (sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode):
        raise SystemExit("Requires -I -S -B, an artifact directory and fixtures path.")
    try:
        print(json.dumps(qualify(Path(sys.argv[1]), Path(sys.argv[2])), separators=(",", ":")))
    except Exception:
        print("Framework pilot tokenizer parity qualification failed.", file=sys.stderr)
        raise SystemExit(1)
