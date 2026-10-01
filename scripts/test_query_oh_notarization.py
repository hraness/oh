#!/usr/bin/env python3
"""Query-only recovery tests; no Apple calls or live credentials."""
import base64
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("querying", Path(__file__).with_name("query-oh-notarization.py"))
querying = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(querying)


class QueryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="oh-status-query-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.inputs = self.root / "input"
        self.inputs.mkdir()
        self.receipt = self.root / querying.RECEIPT_NAME
        self.receipt.write_bytes((json.dumps(querying.EXPECTED_RECEIPT, sort_keys=True) + "\n").encode())
        self.assertEqual(hashlib.sha256(self.receipt.read_bytes()).hexdigest(), querying.RECEIPT_DIGEST)
        self.work = self.root / "oh-notarization-status"
        self.output = self.root / "status.json"
        self.environment = {
            "RUNNER_TEMP": str(self.root), "HOME": str(self.root),
            "APPLE_NOTARY_KEY_P8_BASE64": base64.b64encode(b"fake Notary private key").decode(),
            "APPLE_NOTARY_KEY_ID": "ABCDE12345", "APPLE_NOTARY_ISSUER_ID": "12345678-1234-1234-1234-123456789abc",
        }
        for active in (patch.dict(os.environ, self.environment), patch.object(querying.sys, "platform", "darwin")):
            active.start()
            self.addCleanup(active.stop)
        self.calls = []

    def fixture_metadata(self):
        run = {
            "id": querying.RUN_ID, "run_attempt": 1, "event": "push", "head_branch": querying.RELEASE_TAG,
            "head_sha": querying.SOURCE_SHA, "path": ".github/workflows/release.yml",
            "status": "completed", "conclusion": "failure", "repository": {"full_name": querying.REPOSITORY},
        }
        artifact = {
            "id": querying.ARTIFACT_ID, "name": "oh-apple-notarization-1", "expired": False,
            "workflow_run": {"id": querying.RUN_ID, "head_sha": querying.SOURCE_SHA},
        }
        tag_ref = {"ref": "refs/tags/" + querying.RELEASE_TAG,
                   "object": {"sha": querying.TAG_OBJECT, "type": "tag"}}
        tag = {"sha": querying.TAG_OBJECT, "tag": querying.RELEASE_TAG,
               "object": {"sha": querying.SOURCE_SHA, "type": "commit"}}
        with zipfile.ZipFile(self.inputs / "receipt.zip", "w") as archive:
            archive.writestr(querying.RECEIPT_NAME, self.receipt.read_bytes())
        archive_bytes = (self.inputs / "receipt.zip").read_bytes()
        artifact["size_in_bytes"] = len(archive_bytes)
        digest = hashlib.sha256(archive_bytes).hexdigest()
        artifact["digest"] = "sha256:" + digest
        for name, value in (("run", run), ("artifact", artifact), ("tag-ref", tag_ref), ("tag", tag)):
            (self.inputs / (name + ".json")).write_text(json.dumps(value))
        return digest

    def fake_query(self, submission, key, key_id, issuer, work):
        self.calls.append(submission)
        self.assertEqual(key.stat().st_mode & 0o777, 0o600)
        self.assertEqual(key.read_bytes(), b"fake Notary private key")
        self.assertTrue(all(name not in os.environ for name in querying.SECRET_NAMES))
        return {"id": submission, "status": "Accepted", "arbitraryServiceMessage": "fake Notary private key"}

    def test_exact_receipt_artifact_and_original_release_identity_are_required(self):
        digest = self.fixture_metadata()
        with patch.object(querying, "ARTIFACT_DIGEST", digest):
            querying.verify_evidence(self.inputs, self.root / "evidence")
        self.assertEqual((self.root / "evidence" / querying.RECEIPT_NAME).read_bytes(), self.receipt.read_bytes())

    def test_changed_run_attempt_tag_or_artifact_are_rejected_before_query(self):
        for name, field, changed in (("run", "run_attempt", 2), ("artifact", "expired", True), ("tag", "sha", "0" * 40)):
            with self.subTest(name=name):
                digest = self.fixture_metadata()
                target = self.inputs / (name + ".json")
                value = json.loads(target.read_text())
                value[field] = changed
                target.write_text(json.dumps(value))
                with patch.object(querying, "ARTIFACT_DIGEST", digest), self.assertRaises(querying.QueryError):
                    querying.verify_evidence(self.inputs, self.root / "evidence")
                self.assertFalse((self.root / "evidence").exists())

    def test_tampered_receipt_archive_is_rejected(self):
        digest = self.fixture_metadata()
        with (self.inputs / "receipt.zip").open("ab") as archive:
            archive.write(b"tampered")
        with patch.object(querying, "ARTIFACT_DIGEST", digest), self.assertRaisesRegex(querying.QueryError, "ZIP changed"):
            querying.verify_evidence(self.inputs, self.root / "evidence")

    def test_one_query_retains_binding_cleans_credentials_and_never_admits_package(self):
        captured = io.StringIO()
        with patch.object(querying, "apple_info", self.fake_query), redirect_stdout(captured):
            querying.query(self.receipt, self.output, self.work)
        self.assertEqual(self.calls, [querying.EXPECTED_RECEIPT["submissionId"]])
        self.assertFalse(self.work.exists())
        result = json.loads(self.output.read_text())
        self.assertEqual(result["status"], "Accepted")
        self.assertFalse(result["packageAdmitted"])
        self.assertEqual(result["signedBinarySha256"], querying.EXPECTED_RECEIPT["signedBinarySha256"])
        self.assertNotIn("arbitraryServiceMessage", result)
        self.assertNotIn("fake Notary private key", self.output.read_text() + captured.getvalue())

    def test_failure_unknown_status_or_other_uuid_clean_credentials_without_output(self):
        responses = ({"id": "wrong", "status": "Accepted"},
                     {"id": querying.EXPECTED_RECEIPT["submissionId"], "status": "unexpected"},
                     querying.QueryError("Apple status query failed"))
        for response in responses:
            with self.subTest(response=str(response)), patch.dict(os.environ, self.environment):
                mocked = patch.object(querying, "apple_info", side_effect=response) if isinstance(response, Exception) else patch.object(querying, "apple_info", return_value=response)
                with mocked, self.assertRaises(querying.QueryError):
                    querying.query(self.receipt, self.output, self.work)
                self.assertFalse(self.work.exists())
                self.assertFalse(self.output.exists())

    def test_changed_original_receipt_never_invokes_apple(self):
        self.receipt.write_bytes(self.receipt.read_bytes() + b" ")
        with patch.object(querying, "apple_info") as apple, self.assertRaisesRegex(querying.QueryError, "receipt bytes changed"):
            querying.query(self.receipt, self.output, self.work)
        apple.assert_not_called()
        self.assertFalse(self.work.exists())

    def test_failed_query_records_numeric_exit_and_fixed_classification_after_cleanup(self):
        with patch.object(querying, "apple_info", side_effect=querying.AppleQueryFailure(-25, "child-signal")), self.assertRaises(querying.AppleQueryFailure):
            querying.query(self.receipt, self.output, self.work)
        self.assertFalse(self.work.exists())
        result = json.loads(self.output.read_text())
        self.assertEqual(result["state"], "query-incomplete")
        self.assertIsNone(result["status"])
        self.assertEqual(result["toolExitCode"], -25)
        self.assertEqual(result["errorClassification"], "child-signal")
        self.assertEqual(result["submissionId"], querying.EXPECTED_RECEIPT["submissionId"])
        self.assertFalse(result["packageAdmitted"])
        self.assertNotIn("fake Notary private key", self.output.read_text())

    def test_error_classification_is_a_fixed_allowlist_without_service_text(self):
        cases = (
            (-25, b"private service text", "child-signal"),
            (1, b"Error: File too large", "local-file-limit"),
            (1, b"Error: HTTP status code: 401. secret=never-retain-me", "authentication-rejected"),
            (1, b"Error: HTTP status code: 403. secret=never-retain-me", "authorization-rejected"),
            (1, b"Error: HTTP status code: 404. secret=never-retain-me", "submission-not-found"),
            (1, b"Error: HTTP status code: 429. secret=never-retain-me", "rate-limited"),
            (1, b"Error: HTTP status code: 503. secret=never-retain-me", "service-or-network-failure"),
            (64, b"Usage: notarytool info. secret=never-retain-me", "tool-usage-error"),
            (1, b"arbitrary service text secret=never-retain-me", "unrecognized-tool-failure"),
        )
        for code, text, expected in cases:
            with self.subTest(code=code, expected=expected):
                classification = querying.failure_classification(code, b"", text)
                self.assertEqual(classification, expected)
                self.assertIn(classification, querying.ERROR_CLASSIFICATIONS)
                self.assertNotIn("never-retain-me", str(querying.AppleQueryFailure(code, classification)))
        with self.assertRaisesRegex(querying.QueryError, "invalid error classification"):
            querying.AppleQueryFailure(1, "arbitrary provider text")

    def test_real_child_nonzero_failure_discards_raw_diagnostics(self):
        self.work.mkdir()
        key = self.work / "AuthKey.p8"
        querying.write_new(key, b"fake key")
        def process(argv, **options):
            options["stderr"].write(b"Error: HTTP status code: 401. private-key=never-retain-me")
            return subprocess.CompletedProcess(argv, 1)
        with patch.object(querying.subprocess, "run", side_effect=process), self.assertRaises(querying.AppleQueryFailure) as raised:
            querying.apple_info(querying.EXPECTED_RECEIPT["submissionId"], key, "ABCDE12345", "issuer", self.work)
        self.assertEqual(raised.exception.exit_code, 1)
        self.assertEqual(raised.exception.classification, "authentication-rejected")
        self.assertNotIn("never-retain-me", str(raised.exception))

    def test_timeout_or_launch_failure_has_a_fixed_classification(self):
        for exception, expected in ((subprocess.TimeoutExpired(["notarytool"], 90), "child-timeout"),
                                    (OSError("arbitrary launch details"), "child-launch-failed")):
            with self.subTest(expected=expected):
                self.work.mkdir()
                key = self.work / "AuthKey.p8"
                querying.write_new(key, b"fake key")
                with patch.object(querying.subprocess, "run", side_effect=exception), self.assertRaises(querying.AppleQueryFailure) as raised:
                    querying.apple_info(querying.EXPECTED_RECEIPT["submissionId"], key, "ABCDE12345", "issuer", self.work)
                self.assertIsNone(raised.exception.exit_code)
                self.assertEqual(raised.exception.classification, expected)
                querying.cleanup(self.work)

    def test_success_exit_with_malformed_response_cannot_claim_status(self):
        self.work.mkdir()
        key = self.work / "AuthKey.p8"
        querying.write_new(key, b"fake key")
        def process(argv, **options):
            options["stdout"].write(b"arbitrary non-JSON service output")
            return subprocess.CompletedProcess(argv, 0)
        with patch.object(querying.subprocess, "run", side_effect=process), self.assertRaises(querying.AppleQueryFailure) as raised:
            querying.apple_info(querying.EXPECTED_RECEIPT["submissionId"], key, "ABCDE12345", "issuer", self.work)
        self.assertEqual(raised.exception.exit_code, 0)
        self.assertEqual(raised.exception.classification, "invalid-tool-response")

    def test_work_directory_cannot_select_another_path(self):
        with self.assertRaisesRegex(querying.QueryError, "dedicated runner"):
            querying.cleanup(self.root)
        self.assertTrue(self.root.exists())

    def test_duplicate_json_keys_are_rejected(self):
        with self.assertRaisesRegex(querying.QueryError, "duplicate JSON key"):
            querying.json_value(b'{"id":"first","id":"second"}')

    def test_apple_command_is_info_once_with_bounded_output_and_no_credentials_in_environment(self):
        self.work.mkdir()
        key = self.work / "AuthKey.p8"
        querying.write_new(key, b"fake key")
        def process(argv, **options):
            self.assertEqual(argv[:3], ["/usr/bin/xcrun", "notarytool", "info"])
            self.assertEqual(argv[3], querying.EXPECTED_RECEIPT["submissionId"])
            self.assertNotIn("submit", argv)
            self.assertNotIn("wait", argv)
            self.assertEqual(set(options["env"]), {"PATH", "HOME", "LC_ALL"})
            self.assertEqual(options["timeout"], 90)
            self.assertTrue(callable(options["preexec_fn"]))
            options["stdout"].write(json.dumps({"id": argv[3], "status": "In Progress"}).encode())
            return subprocess.CompletedProcess(argv, 0)
        with patch.object(querying.subprocess, "run", side_effect=process) as child:
            result = querying.apple_info(querying.EXPECTED_RECEIPT["submissionId"], key, "ABCDE12345", "issuer", self.work)
        self.assertEqual(result["status"], "In Progress")
        self.assertEqual(child.call_count, 1)

    def test_workflow_keeps_protected_tag_boundary_and_has_no_signing_or_publish_permissions(self):
        root = Path(__file__).parent.parent
        workflow = (root / ".github/workflows/notarization-status.yml").read_text()
        self.assertIn('"v0.14.0-notarization-status.*"', workflow)
        self.assertIn("environment: hraness-apple-release", workflow)
        self.assertIn("group: stable-release", workflow)
        self.assertIn('origin/$DEFAULT_BRANCH^{commit}', workflow)
        for forbidden in ("workflow_dispatch", "APPLE_DEVELOPER_ID", "contents: write", "id-token: write", "sign-macos-sidecars.py", "notarytool submit", "npm publish"):
            self.assertNotIn(forbidden, workflow)
        self.assertIn('"!v*-notarization-status.*"', (root / ".github/workflows/release.yml").read_text())
        self.assertIn("python -I -B scripts/test_query_oh_notarization.py", (root / ".github/workflows/ci.yml").read_text())


if __name__ == "__main__":
    unittest.main()
