"""Stdlib-only parser/artifact tests; no native artifact, dataset or network needed."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pilot_tokenizer_worker", HERE / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def request(self, texts):
        return json.dumps({"protocol": "oh.framework-pilot-token-batch-input.v1", "texts": texts}).encode()

    def test_exact_unicode_and_special_strings(self):
        texts = ["", "a\n\x00", "é", "e\u0301", "👩🏽‍💻", "<|endoftext|>", "<|endofprompt|>"]
        self.assertEqual(worker.parse_request(self.request(texts)), texts)

    def test_closed_schema_and_json(self):
        for raw in (b"{}", b"[]", b"null", b"\xff", b'{"protocol":1,"protocol":2,"texts":[]}',
                    b'{"protocol":"oh.framework-pilot-token-batch-input.v1","texts":[NaN]}',
                    self.request([]), self.request([True]), self.request(["\ud800"]), self.request(["\udfff"]),
                    self.request([""] * 22), self.request(["x" * (worker.MAX_TEXT_BYTES + 1)]),
                    self.request(["😀" * (worker.MAX_TEXT_BYTES // 4 + 1)]),
                    b" " * (worker.MAX_REQUEST_BYTES + 1)):
            with self.subTest(length=len(raw)), self.assertRaises(worker.Rejected):
                worker.parse_request(raw)
        value = json.loads(self.request(["safe"]))
        value["gold"] = "forbidden"
        with self.assertRaises(worker.Rejected):
            worker.parse_request(json.dumps(value).encode())

    def test_exact_byte_boundary(self):
        text = "😀" * (worker.MAX_TEXT_BYTES // 4)
        self.assertEqual(worker.parse_request(self.request([text])), [text])

    def test_manifest_pin_and_supported_abi(self):
        artifacts = worker.manifest()
        self.assertEqual(artifacts["asset"]["sha256"], "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d")
        with patch.object(worker.sys, "version_info", (3, 13)), self.assertRaises(worker.Rejected):
            worker.select_wheel(artifacts)
        with patch.object(worker.sys, "version_info", (3, 14)), patch.object(worker.sysconfig, "get_config_var", return_value=1), self.assertRaises(worker.Rejected):
            worker.select_wheel(artifacts)
        with patch.object(worker.sys, "version_info", (3, 14)), patch.object(worker.sysconfig, "get_config_var", return_value=0), patch.object(worker.platform, "machine", return_value="unlisted"), self.assertRaises(worker.Rejected):
            worker.select_wheel(artifacts)

    def test_artifact_tamper_and_symlink_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "artifact"
            file.write_bytes(b"test")
            digest = hashlib.sha256(b"test").hexdigest()
            self.assertEqual(worker.read_exact(file, 4, digest), b"test")
            for size, expected in ((3, digest), (4, "0" * 64)):
                with self.assertRaises(worker.Rejected):
                    worker.read_exact(file, size, expected)
            link = Path(directory) / "link"
            link.symlink_to(file)
            with self.assertRaises(OSError):
                worker.read_exact(link, 4, digest)

    def test_archive_members_verified_before_import(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "fixture.whl"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("tiktoken/core.py", b"known")
            raw = archive.read_bytes()
            wheel = {"filename": archive.name, "bytes": len(raw), "sha256": worker.sha(raw),
                     "members": [{"name": "tiktoken/core.py", "bytes": 5, "sha256": worker.sha(b"known")}]}
            self.assertEqual(worker.verified_members(Path(directory), wheel), {"tiktoken/core.py": b"known"})
            for change in ({"bytes": 6}, {"sha256": "0" * 64}, {"name": "../evil.py"}):
                bad = {**wheel, "members": [{**wheel["members"][0], **change}]}
                with self.assertRaises(worker.Rejected):
                    worker.verified_members(Path(directory), bad)

    def test_network_guard(self):
        for function in (worker.no_network,):
            with self.assertRaises(worker.Rejected):
                function("https://example.invalid")


if __name__ == "__main__":
    unittest.main()
