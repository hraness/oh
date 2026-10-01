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
import sys
import tempfile
import time
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

    def test_nonzero_child_failure_discards_raw_diagnostics(self):
        self.work.mkdir()
        key = self.work / "AuthKey.p8"
        querying.write_new(key, b"fake key")
        with patch.object(querying, "bounded_child", return_value=(1, b"", b"Error: HTTP status code: 401. private-key=never-retain-me")), self.assertRaises(querying.AppleQueryFailure) as raised:
            querying.apple_info(querying.EXPECTED_RECEIPT["submissionId"], key, "ABCDE12345", "issuer", self.work)
        self.assertEqual(raised.exception.exit_code, 1)
        self.assertEqual(raised.exception.classification, "authentication-rejected")
        self.assertNotIn("never-retain-me", str(raised.exception))

    def test_capture_failures_cannot_claim_provider_status_and_clean_credentials(self):
        for classification in ("child-output-overflow", "child-capture-failed", "child-cleanup-failed"):
            with self.subTest(classification=classification), patch.dict(os.environ, self.environment), patch.object(querying, "apple_info", side_effect=querying.AppleQueryFailure(None, classification)), self.assertRaises(querying.AppleQueryFailure):
                querying.query(self.receipt, self.output, self.work)
            result = json.loads(self.output.read_text())
            self.assertIsNone(result["status"])
            self.assertFalse(result["packageAdmitted"])
            self.assertEqual(result["errorClassification"], classification)
            self.assertFalse(self.work.exists())
            self.assertNotIn("fake Notary private key", self.output.read_text())
            self.output.unlink()

    def test_timeout_or_launch_failure_has_a_fixed_classification(self):
        for expected in ("child-timeout", "child-launch-failed"):
            with self.subTest(expected=expected):
                self.work.mkdir()
                key = self.work / "AuthKey.p8"
                querying.write_new(key, b"fake key")
                with patch.object(querying, "bounded_child", side_effect=querying.AppleQueryFailure(None, expected)), self.assertRaises(querying.AppleQueryFailure) as raised:
                    querying.apple_info(querying.EXPECTED_RECEIPT["submissionId"], key, "ABCDE12345", "issuer", self.work)
                self.assertIsNone(raised.exception.exit_code)
                self.assertEqual(raised.exception.classification, expected)
                querying.cleanup(self.work)

    def test_success_exit_with_malformed_response_cannot_claim_status(self):
        self.work.mkdir()
        key = self.work / "AuthKey.p8"
        querying.write_new(key, b"fake key")
        with patch.object(querying, "bounded_child", return_value=(0, b"arbitrary non-JSON service output", b"")), self.assertRaises(querying.AppleQueryFailure) as raised:
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
        def process(argv, environment):
            self.assertEqual(argv[:3], ["/usr/bin/xcrun", "notarytool", "info"])
            self.assertEqual(argv[3], querying.EXPECTED_RECEIPT["submissionId"])
            self.assertNotIn("submit", argv)
            self.assertNotIn("wait", argv)
            self.assertEqual(set(environment), {"PATH", "HOME", "LC_ALL"})
            return 0, json.dumps({"id": argv[3], "status": "In Progress"}).encode(), b""
        with patch.object(querying, "bounded_child", side_effect=process) as child:
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


class RealChildCaptureTests(unittest.TestCase):
    """Owned Python fixtures exercise the real pipes and teardown, never Apple."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="oh-status-child-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.environment = {"PATH": os.environ.get("PATH", ""), "HOME": str(self.root), "LC_ALL": "C"}

    def command(self, program):
        return [sys.executable, "-I", "-B", "-c", program]

    def assert_dead(self, pid):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.01)
        self.fail("owned fixture process survived group cleanup")

    def test_exact_limit_both_streams_closed_stdin_and_large_cache_write(self):
        cache = self.root / "fixture-cache"
        program = ("import sys,pathlib; assert sys.stdin.buffer.read() == b''; "
                   f"pathlib.Path({str(cache)!r}).write_bytes(b'c' * 262144); "
                   "sys.stdout.buffer.write(b'o' * 65536); sys.stderr.buffer.write(b'e' * 65536)")
        code, output, errors = querying.bounded_child(self.command(program), self.environment, timeout=5)
        self.assertEqual(code, 0)
        self.assertEqual(output, b"o" * 65536)
        self.assertEqual(errors, b"e" * 65536)
        self.assertEqual(cache.stat().st_size, 262144)

    def test_either_stream_overflow_is_bounded_and_reaps_owned_leader(self):
        for stream in ("stdout", "stderr"):
            with self.subTest(stream=stream):
                pidfile = self.root / (stream + ".pid")
                program = ("import os,sys,time,pathlib; "
                           f"pathlib.Path({str(pidfile)!r}).write_text(str(os.getpid())); "
                           f"sys.{stream}.buffer.write(b'x' * 262144); sys.{stream}.flush(); time.sleep(30)")
                with self.assertRaises(querying.AppleQueryFailure) as raised:
                    querying.bounded_child(self.command(program), self.environment, timeout=5)
                self.assertEqual(raised.exception.classification, "child-output-overflow")
                self.assert_dead(int(pidfile.read_text()))

    def descendant_program(self, pidfile, exit_normally):
        grandchild = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)"
        return ("import os,sys,time,json,pathlib,subprocess; "
                f"child=subprocess.Popen([sys.executable,'-I','-B','-c',{grandchild!r}],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); "
                f"pathlib.Path({str(pidfile)!r}).write_text(json.dumps([os.getpid(),child.pid])); "
                + ("sys.stdout.write('done'); sys.stdout.flush()" if exit_normally else "time.sleep(30)"))

    def test_timeout_removes_the_exact_owned_group_including_descendant(self):
        pidfile = self.root / "timeout.pids"
        started = time.monotonic()
        with self.assertRaises(querying.AppleQueryFailure) as raised:
            querying.bounded_child(self.command(self.descendant_program(pidfile, False)), self.environment, timeout=0.5)
        self.assertEqual(raised.exception.classification, "child-timeout")
        self.assertLess(time.monotonic() - started, 2)
        for pid in json.loads(pidfile.read_text()):
            self.assert_dead(pid)

    def test_normal_exit_also_removes_descendant_without_reaping_anchor_early(self):
        pidfile = self.root / "normal.pids"
        code, output, errors = querying.bounded_child(self.command(self.descendant_program(pidfile, True)), self.environment, timeout=5)
        self.assertEqual((code, output, errors), (0, b"done", b""))
        for pid in json.loads(pidfile.read_text()):
            self.assert_dead(pid)

    def test_capture_error_cleans_up_real_child_without_retaining_error_text(self):
        owned = []
        original = querying.subprocess.Popen
        def launch(*args, **kwargs):
            child = original(*args, **kwargs)
            owned.append(child.pid)
            self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
            self.assertTrue(kwargs["start_new_session"])
            self.assertTrue(kwargs["close_fds"])
            return child
        with patch.object(querying.subprocess, "Popen", side_effect=launch), patch.object(querying.selectors, "DefaultSelector", side_effect=OSError("private service data")), self.assertRaises(querying.AppleQueryFailure) as raised:
            querying.bounded_child(self.command("import time; time.sleep(30)"), self.environment, timeout=5)
        self.assertEqual(raised.exception.classification, "child-capture-failed")
        self.assertNotIn("private service data", str(raised.exception))
        self.assertEqual(len(owned), 1)
        self.assert_dead(owned[0])

    def test_launch_failure_and_invalid_bounds_never_start_another_child(self):
        with self.assertRaises(querying.AppleQueryFailure) as raised:
            querying.bounded_child([str(self.root / "missing-executable")], self.environment)
        self.assertEqual(raised.exception.classification, "child-launch-failed")
        for options in ({"limit": 65537}, {"limit": 0}, {"timeout": 91}, {"timeout": float("nan")}):
            with patch.object(querying.subprocess, "Popen") as child, self.assertRaises(querying.QueryError):
                querying.bounded_child(self.command("pass"), self.environment, **options)
            child.assert_not_called()

    def test_permission_failure_cannot_claim_cleanup_with_an_unverified_live_group(self):
        child = type("OwnedChild", (), {"pid": 123})()
        for exited, no_live in ((False, True), (True, False)):
            with self.subTest(exited=exited, no_live=no_live), patch.object(querying.os, "killpg", side_effect=PermissionError()), patch.object(querying, "child_exited_unreaped", return_value=exited), patch.object(querying, "darwin_group_has_no_live_members", return_value=no_live), self.assertRaises(PermissionError):
                querying.signal_owned_group(child, querying.signal.SIGKILL)
        with patch.object(querying.os, "killpg", side_effect=PermissionError()), patch.object(querying, "child_exited_unreaped", return_value=True), patch.object(querying, "darwin_group_has_no_live_members", return_value=True) as verified:
            querying.signal_owned_group(child, querying.signal.SIGKILL)
        verified.assert_called_once_with(123)

    def test_interrupt_during_child_acquisition_defers_until_owned_cleanup_is_installed(self):
        original = querying.subprocess.Popen
        for kind, exception in ((querying.signal.SIGINT, KeyboardInterrupt), (querying.signal.SIGTERM, SystemExit)):
            with self.subTest(signal=kind):
                owned = []
                previous_term = querying.signal.signal(querying.signal.SIGTERM, lambda *_: sys.exit(143))
                previous = {value: querying.signal.getsignal(value) for value in (querying.signal.SIGINT, querying.signal.SIGTERM)}
                def launch(*args, **kwargs):
                    child = original(*args, **kwargs)
                    owned.append(child.pid)
                    os.kill(os.getpid(), kind)
                    return child
                try:
                    with patch.object(querying.subprocess, "Popen", side_effect=launch), self.assertRaises(exception) as raised:
                        querying.bounded_child(self.command("import time; time.sleep(30)"), self.environment, timeout=5)
                    if kind == querying.signal.SIGTERM:
                        self.assertEqual(raised.exception.code, 143)
                    self.assertEqual(len(owned), 1)
                    self.assert_dead(owned[0])
                    self.assertEqual({value: querying.signal.getsignal(value) for value in previous}, previous)
                finally:
                    querying.signal.signal(querying.signal.SIGTERM, previous_term)

    def test_actual_sigint_and_sigterm_clean_owned_leader_descendant_and_credentials(self):
        for kind, expected_code in ((querying.signal.SIGINT, 130), (querying.signal.SIGTERM, 143)):
            with self.subTest(signal=kind):
                fixture = self.root / ("interrupt-" + str(kind))
                fixture.mkdir()
                pidfile = fixture / "child.pids"
                work = fixture / "oh-notarization-status"
                # A dedicated outer fixture calls the real query credential
                # scope, replacing only the Apple invocation with owned Python
                # leader/descendant fixtures and fake credentials.
                program = f'''import base64,importlib.util,json,os,pathlib,signal,sys
spec=importlib.util.spec_from_file_location("querying",{str(Path(__file__).with_name('query-oh-notarization.py').resolve())!r})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=pathlib.Path({str(fixture)!r})
os.environ.update(RUNNER_TEMP=str(root),HOME=str(root),APPLE_NOTARY_KEY_P8_BASE64=base64.b64encode(b"fake fixture key").decode(),APPLE_NOTARY_KEY_ID="ABCDE12345",APPLE_NOTARY_ISSUER_ID="12345678-1234-1234-1234-123456789abc")
m.sys.platform="darwin"
receipt=root/m.RECEIPT_NAME;receipt.write_bytes((json.dumps(m.EXPECTED_RECEIPT,sort_keys=True)+chr(10)).encode())
def owned_info(*args):
 return m.bounded_child([sys.executable,"-I","-B","-c",{self.descendant_program(pidfile, False)!r}],{{"PATH":os.environ["PATH"],"HOME":str(root)}},timeout=5)
m.apple_info=owned_info
signal.signal(signal.SIGTERM,lambda *_:sys.exit(143))
try:m.query(receipt,root/"status.json",root/"oh-notarization-status")
except KeyboardInterrupt:sys.exit(130)
'''
                outer = subprocess.Popen(self.command(program), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=self.environment)
                try:
                    deadline = time.monotonic() + 3
                    while not pidfile.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(pidfile.exists(), "owned query fixture never became ready")
                    os.kill(outer.pid, kind)
                    self.assertEqual(outer.wait(timeout=3), expected_code)
                    self.assertFalse(work.exists())
                    self.assertFalse((fixture / "status.json").exists())
                    for pid in json.loads(pidfile.read_text()):
                        self.assert_dead(pid)
                finally:
                    # The outer fixture is our direct, unreaped Popen child.
                    if outer.poll() is None:
                        outer.kill()
                    outer.wait(timeout=3)


if __name__ == "__main__":
    unittest.main()
