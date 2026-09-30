#!/usr/bin/env python3
"""Admit the exact finite WASM build artifact without executing its contents."""
import hashlib
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

ROOTS = {"oh-canonical-wasm", "oh-canonical-raw-wasm", "oh-archive-wasm", "oh-archive-strict-wasm", "oh-datalog-wasm"}
MAX_BYTES = 64 * 1024 * 1024


def extract(archive, expected, destination):
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("invalid build artifact digest")
    info = archive.lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_BYTES:
        raise ValueError("build artifact is not a bounded regular file")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise ValueError("build artifact digest mismatch")
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if not 1 <= len(entries) <= 100:
            raise ValueError("build artifact inventory exceeds its bound")
        seen, roots, total = set(), set(), 0
        for entry in entries:
            parts = PurePosixPath(entry.filename).parts
            mode = entry.external_attr >> 16
            if (len(parts) != 2 or parts[0] not in ROOTS or entry.filename in seen
                    or not re.fullmatch(r"[a-z0-9_]+\.(?:wasm|js|d\.ts)", parts[1])
                    or stat.S_IFMT(mode) not in (0, stat.S_IFREG) or entry.flag_bits & 1
                    or not 0 < entry.file_size <= MAX_BYTES):
                raise ValueError("unexpected WASM build artifact member")
            seen.add(entry.filename)
            roots.add(parts[0])
            total += entry.file_size
        if total > MAX_BYTES or roots != ROOTS:
            raise ValueError("build artifact payload exceeds its bound or omits a crate")
        destination.mkdir(mode=0o700)
        for entry in entries:
            with source.open(entry) as member:
                contents = member.read(entry.file_size + 1)
            if len(contents) != entry.file_size:
                raise ValueError("build artifact member size mismatch")
            target = destination / entry.filename
            target.parent.mkdir(mode=0o700, exist_ok=True)
            with target.open("xb") as output:
                output.write(contents)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: extract-release-wasm.py ZIP SHA256 DESTINATION")
    extract(Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]))
