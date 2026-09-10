#!/usr/bin/env python3
"""Re-encode the pinned BEAM Hugging Face parquet release as one canonical JSON file.

The Oh benchmark loaders parse JSON from ``unknown``; Bun has no parquet reader and
the base package takes no runtime dependency, so acquisition converts the three
pinned parquet parts once. The output is a pure function of the parquet logical
content: sorted keys, compact separators, UTF-8 without ASCII escaping, integers
and strings only, ``probing_questions`` parsed from its Python-literal string into
structured JSON. ``scripts/benchmarks/datasets.ts`` pins the output bytes and
SHA-256 next to the parquet part digests, so a different pyarrow decode fails
closed at load time instead of silently changing the corpus.

This script prints counts and digests only. It never prints conversation text,
questions, rubric nuggets or answers, and it refuses to overwrite its output.

Usage:
  python3 scripts/benchmarks/beam-parquet-to-json.py --input-dir DIR --output FILE

Requires pyarrow (qualified with pyarrow 21.0.0 on CPython 3.12). Install it in a
private virtual environment, for example:
  uv venv --python 3.12 .cache/beam-venv && uv pip install --python .cache/beam-venv/bin/python pyarrow==21.0.0
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import sys

PROTOCOL = "oh.beam-source-canonical.v1"
REVISION = "3205395e897e7318c7b094ef4e6047b9b82dbb03"
PARTS = (
    ("100K", "data/100K-00000-of-00001.parquet", 5_429_768,
     "c0519be25907005ba873c927c50877471d550873039d96c041554d0075a78ace"),
    ("500K", "data/500K-00000-of-00001.parquet", 33_956_263,
     "af05921c979355038e1761b7cde3d2dd713200dd3071b278de0200f6c7f30122"),
    ("1M", "data/1M-00000-of-00001.parquet", 66_156_374,
     "41b5acbbb55a586b1305514ef9d9fb03365d9b3331b598a1c2dd7603d93ef533"),
)
ROW_KEYS = ("conversation_id", "conversation_seed", "narratives", "user_profile", "conversation_plan",
            "user_questions", "chat", "probing_questions")
QUALIFIED_PYARROW = "21.0.0"


def fail(message: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"beam-parquet-to-json: {message}", file=sys.stderr)
    sys.exit(1)


def check_scalar_tree(value: object, path: str) -> None:
    """Only dict/list/str/int/None survive; floats, bytes or bools would make the encoding ambiguous."""
    if value is None or isinstance(value, str):
        return
    if isinstance(value, bool) or not isinstance(value, (int, dict, list)):
        fail(f"unsupported value type {type(value).__name__} at {path}")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                fail(f"non-string key at {path}")
            check_scalar_tree(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            check_scalar_tree(child, f"{path}[{index}]")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input-dir", required=True, help="directory holding data/<split>-00000-of-00001.parquet")
    parser.add_argument("--output", required=True, help="new canonical JSON path; existing files are never overwritten")
    args = parser.parse_args()

    try:
        import pyarrow  # noqa: F401
        import pyarrow.parquet as pq
    except ImportError:
        fail("pyarrow is required (qualified: pyarrow==21.0.0); see the module docstring for a private install command")
    if pyarrow.__version__ != QUALIFIED_PYARROW:
        print(f"warning: pyarrow {pyarrow.__version__} differs from the qualified {QUALIFIED_PYARROW}; "
              "the pinned output digest must still match", file=sys.stderr)

    parts_out = []
    rows_out = []
    for split, relative, expected_bytes, expected_sha in PARTS:
        path = os.path.join(args.input_dir, relative)
        try:
            with open(path, "rb") as handle:
                raw = handle.read()
        except OSError as error:
            fail(f"cannot read {relative}: {error.strerror}")
        if len(raw) != expected_bytes:
            fail(f"{relative}: {len(raw)} bytes, expected {expected_bytes}")
        digest = hashlib.sha256(raw).hexdigest()
        if digest != expected_sha:
            fail(f"{relative}: sha256 mismatch")
        table = pq.read_table(path)
        names = [field.name for field in table.schema]
        if tuple(names) != ROW_KEYS:
            fail(f"{relative}: unexpected parquet columns")
        for row_index, row in enumerate(table.to_pylist()):
            if set(row.keys()) != set(ROW_KEYS):
                fail(f"{relative}[{row_index}]: unexpected row keys")
            probing = row["probing_questions"]
            if not isinstance(probing, str):
                fail(f"{relative}[{row_index}]: probing_questions must be a literal string")
            try:
                parsed = ast.literal_eval(probing)
            except (ValueError, SyntaxError):
                fail(f"{relative}[{row_index}]: probing_questions is not a Python literal")
            record = {key: row[key] for key in ROW_KEYS if key != "probing_questions"}
            record["probing_questions"] = parsed
            record["split"] = split
            record["rowIndex"] = row_index
            check_scalar_tree(record, f"{split}[{row_index}]")
            rows_out.append(record)
        parts_out.append({"split": split, "path": relative, "bytes": expected_bytes, "sha256": expected_sha,
                          "rows": table.num_rows})

    document = {"protocol": PROTOCOL, "revision": REVISION, "parts": parts_out, "rows": rows_out}
    encoded = (json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                          allow_nan=False) + "\n").encode("utf-8")
    directory = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(directory, exist_ok=True)
    try:
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        fail(f"output exists: {args.output}")
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(encoded)
    print(json.dumps({"protocol": PROTOCOL, "revision": REVISION, "rows": len(rows_out),
                      "parts": [{"split": p["split"], "rows": p["rows"]} for p in parts_out],
                      "bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest(),
                      "pyarrow": pyarrow.__version__, "python": sys.version.split()[0]}))


if __name__ == "__main__":
    main()
