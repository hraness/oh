#!/usr/bin/env python3
import hashlib
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("extractor", Path(__file__).with_name("extract-release-wasm.py"))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class WasmArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / "artifact.zip"
        self.members = [(name + "/artifact.js", b"export default 1;", None) for name in sorted(extractor.ROOTS)]

    def write(self):
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for name, data, mode in self.members:
                entry = zipfile.ZipInfo(name)
                entry.compress_type = zipfile.ZIP_DEFLATED
                if mode is not None:
                    entry.external_attr = mode << 16
                output.writestr(entry, data)
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def test_accepts_exact_build_digest_and_all_crates(self):
        extractor.extract(self.archive, self.write(), self.root / "output")
        self.assertEqual(len(list((self.root / "output").rglob("*.js"))), 5)

    def test_changed_zip_is_rejected_before_output(self):
        self.write()
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            extractor.extract(self.archive, "0" * 64, self.root / "output")
        self.assertFalse((self.root / "output").exists())

    def test_missing_crate_is_rejected(self):
        self.members.pop()
        with self.assertRaises(ValueError):
            extractor.extract(self.archive, self.write(), self.root / "output")

    def test_traversal_and_unexpected_paths_are_rejected(self):
        for name in ("../outside.js", "/tmp/escape.js", "oh-canonical-wasm/../escape.js", "oh-canonical-wasm/script.sh"):
            with self.subTest(name=name):
                self.members.append((name, b"x", None))
                with self.assertRaises(ValueError):
                    extractor.extract(self.archive, self.write(), self.root / "output")
                self.members.pop()

    def test_symlink_and_declared_expansion_are_rejected(self):
        self.members[0] = (self.members[0][0], b"target", stat.S_IFLNK | 0o777)
        with self.assertRaises(ValueError):
            extractor.extract(self.archive, self.write(), self.root / "output")
        self.members[0] = (self.members[0][0], b"x" * 1_000_000, None)
        expected = self.write()
        with patch.object(extractor, "MAX_BYTES", self.archive.stat().st_size + 1):
            with self.assertRaises(ValueError):
                extractor.extract(self.archive, expected, self.root / "output")


if __name__ == "__main__":
    unittest.main()
