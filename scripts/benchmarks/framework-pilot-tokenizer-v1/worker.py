"""Offline o200k_base counting over a verified official tiktoken wheel.

Run with CPython -I -S -B. No package installation or encoding download occurs.
The parent owns the scratch directory and removes it after collecting the child.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import socket
import stat
import sys
import sysconfig
import zipfile

HERE = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 12 * 1024 * 1024
MAX_TEXT_BYTES = 262_144
MAX_TEXTS = 21
MAX_RESPONSE_BYTES = 32_768
ARTIFACTS_SHA256 = "4f2d970b650d245e4d6430d05500233bc86d64d7cb75461e80435b2703310e97"
# From the pinned OpenAI source identified in artifacts.json; see LICENSE.tiktoken.
PATTERN = "|".join([
    r"[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
    r"[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
    r"\p{N}{1,3}", r" ?[^\s\p{L}\p{N}]+[\r\n/]*", r"\s*[\r\n]+", r"\s+(?!\S)", r"\s+",
])
SPECIAL_TOKENS = {"<|endoftext|>": 199999, "<|endofprompt|>": 200018}


class Rejected(ValueError):
    pass


def reject(message):
    raise Rejected(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def no_network(*_args, **_kwargs):
    reject("network access is disabled")


def disable_network():
    # Defense in depth, not an operating-system sandbox. The admitted path has no network client.
    socket.socket = no_network
    socket.create_connection = no_network
    socket.getaddrinfo = no_network


def exact_keys(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        reject("unexpected object fields")


def unique_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            reject("duplicate JSON key")
        out[key] = value
    return out


def parse_request(raw):
    if not raw or len(raw) > MAX_REQUEST_BYTES:
        reject("request byte bound")
    try:
        request = json.loads(raw.decode("utf-8", "strict"), object_pairs_hook=unique_object,
                             parse_constant=lambda _: reject("nonfinite JSON number"))
    except (UnicodeError, json.JSONDecodeError):
        reject("invalid request JSON")
    exact_keys(request, ("protocol", "texts"))
    if request["protocol"] != "oh.framework-pilot-token-batch-input.v1":
        reject("invalid request protocol")
    texts = request["texts"]
    if type(texts) is not list or not 1 <= len(texts) <= MAX_TEXTS:
        reject("text count bound")
    for text in texts:
        if type(text) is not str or len(text) > MAX_TEXT_BYTES:
            reject("invalid text")
        try:
            encoded = text.encode("utf-8", "strict")
        except UnicodeError:
            reject("lone surrogate")
        if len(encoded) > MAX_TEXT_BYTES:
            reject("text byte bound")
    return texts


def read_exact(path, size, digest):
    # No symlink or nonregular artifact is accepted. Read and validate the same open file.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size != size:
            reject("artifact size or type mismatch")
        data = file.read(size + 1)
    if len(data) != size or sha(data) != digest:
        reject("artifact digest mismatch")
    return data


def manifest():
    path = HERE / "artifacts.json"
    data = read_exact(path, 3705, ARTIFACTS_SHA256)
    return json.loads(data)


def select_wheel(artifacts):
    if (sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 14)
            or sysconfig.get_config_var("Py_GIL_DISABLED") == 1):
        reject("requires CPython 3.14 with the standard GIL ABI")
    machine = platform.machine()
    choices = [item for item in artifacts["wheels"]
               if item["platform"] == sys.platform and item["architecture"] == machine]
    if len(choices) != 1:
        reject("unsupported tokenizer platform")
    return choices[0]


def verified_members(artifact_directory, wheel):
    data = read_exact(artifact_directory / wheel["filename"], wheel["bytes"], wheel["sha256"])
    result = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if len(names) > 64 or len(names) != len(set(names)):
            reject("invalid wheel member inventory")
        for member in wheel["members"]:
            name = member["name"]
            if name.startswith("/") or ".." in name.split("/") or "\\" in name:
                reject("invalid wheel member path")
            info = archive.getinfo(name)
            if info.file_size != member["bytes"] or not 0 < info.file_size <= 4_000_000:
                reject("wheel member size mismatch")
            with archive.open(info) as file:
                content = file.read(member["bytes"] + 1)
            if len(content) != member["bytes"] or sha(content) != member["sha256"]:
                reject("wheel member digest mismatch")
            result[name] = content
    return result


def ranks_from_asset(data):
    ranks = {}
    for index, line in enumerate(data.splitlines()):
        pair = line.split(b" ")
        if len(pair) != 2 or pair[1] != str(index).encode("ascii"):
            reject("invalid encoding rank")
        token = base64.b64decode(pair[0], validate=True)
        if not token or token in ranks:
            reject("invalid encoding token")
        ranks[token] = index
    if len(ranks) != 199_998:
        reject("invalid encoding vocabulary size")
    return ranks


def load_tokenizer(artifact_directory, scratch):
    artifacts = manifest()
    wheel = select_wheel(artifacts)
    members = verified_members(artifact_directory, wheel)
    asset = artifacts["asset"]
    ranks = ranks_from_asset(read_exact(artifact_directory / asset["filename"], asset["bytes"], asset["sha256"]))
    extension_names = [name for name in members if name.endswith(".so")]
    if len(extension_names) != 1:
        reject("ambiguous native extension")
    extension_name = extension_names[0]
    if not extension_name.endswith(sysconfig.get_config_var("EXT_SUFFIX")):
        reject("extension ABI mismatch")
    if not scratch.is_dir() or scratch.is_symlink() or list(scratch.iterdir()):
        reject("scratch directory must be owned and empty")
    scratch_info = scratch.stat()
    if scratch_info.st_uid != os.getuid() or stat.S_IMODE(scratch_info.st_mode) != 0o700:
        reject("scratch directory ownership or permissions mismatch")
    extension_path = scratch / Path(extension_name).name
    with extension_path.open("xb") as file:
        file.write(members[extension_name])
    extension_path.chmod(0o600)
    spec = importlib.util.spec_from_file_location("_tiktoken", extension_path)
    if spec is None or spec.loader is None:
        reject("native loader unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    core = module.CoreBPE(ranks, SPECIAL_TOKENS, PATTERN)
    executable = Path(sys.executable).resolve()
    binary_size = executable.stat().st_size
    if not 0 < binary_size <= 64 * 1024 * 1024:
        reject("interpreter byte bound")
    with executable.open("rb") as file:
        binary = file.read(binary_size + 1)
    if len(binary) != binary_size:
        reject("interpreter changed during observation")
    provenance = {
        "artifactsSha256": ARTIFACTS_SHA256,
        "workerSha256": sha(Path(__file__).read_bytes()),
        "wheelSha256": wheel["sha256"], "extensionSha256": sha(members[extension_name]),
        "assetSha256": asset["sha256"], "pythonExecutable": str(executable),
        "pythonExecutableSha256": sha(binary), "pythonVersion": platform.python_version(),
        "pythonImplementation": sys.implementation.name, "pythonCacheTag": sys.implementation.cache_tag,
        "platform": sys.platform, "architecture": platform.machine(),
    }
    return core, provenance, ranks, members, module


def main():
    if len(sys.argv) != 3 or not (sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode):
        reject("requires isolated invocation and two explicit local directories")
    artifact_directory, scratch = map(Path, sys.argv[1:])
    if not artifact_directory.is_absolute() or not scratch.is_absolute():
        reject("requires absolute directories")
    texts = parse_request(sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1))
    disable_network()
    core, provenance, _ranks, _members, _module = load_tokenizer(artifact_directory, scratch)
    rows = []
    for text in texts:
        raw = text.encode("utf-8")
        tokens = core.encode_ordinary(text)
        if any(type(token) is not int or not 0 <= token < 199_998 for token in tokens):
            reject("unexpected token outside ordinary vocabulary")
        rows.append({"textSha256": sha(raw), "textBytes": len(raw), "tokens": len(tokens)})
    response = {"protocol": "oh.framework-pilot-token-batch.v1", "scope": "context-string-only",
                "specialTokens": "ordinary-text", "provenance": provenance, "rows": rows}
    encoded = json.dumps(response, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    if len(encoded) > MAX_RESPONSE_BYTES:
        reject("response byte bound")
    sys.stdout.buffer.write(encoded + b"\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Neither source text, caller paths, nor interpreter tracebacks enter process logs.
        print("Framework pilot tokenizer rejected the invocation.", file=sys.stderr)
        raise SystemExit(1)
