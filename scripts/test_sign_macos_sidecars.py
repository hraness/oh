#!/usr/bin/env python3
"""Behavioral tests use mocked Apple tools; no credentials or signing service."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("signing", Path(__file__).with_name("sign-macos-sidecars.py"))
signing = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(signing)
TEAM = "A1B2C3D4E5"
VERSION = "0.13.4"
UUID = "12345678-1234-1234-1234-123456789abc"


class SigningTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="oh-sqlite-cli-signing-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.work = self.root / "oh-sqlite-cli-apple-signing"
        self.output = self.root / "signed-artifacts"
        self.archive = self.root / signing.archive_name(VERSION, unsigned=True)
        self.binary = struct.pack("<IIIIIIII", 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b"not executable"
        self.x64_binary = struct.pack("<IIIIIIII", 0xFEEDFACF, 0x01000007, 0, 2, 0, 0, 0, 0) + b"not executable x64"
        self.native_archive()
        self.calls = []
        self.original_search_list = [str(self.root / "Existing Login.keychain-db"), "/Library/Keychains/System.keychain"]
        self.search_list = self.original_search_list.copy()
        self.status = "Accepted"
        self.wait_id = UUID
        self.metadata = ("Identifier=dev.hraness.oh.sqlite-cli\nTeamIdentifier=" + TEAM + "\n"
                         "CodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=2+7 location=embedded\n"
                         "Timestamp=Sep 30, 2026 at 2:00:00 AM\n")
        self.identity_team = TEAM
        self.tool_failure = None
        self.environment = {
            "RUNNER_TEMP": str(self.root), "HOME": str(self.root),
            "GITHUB_REPOSITORY": "hraness/oh", "GITHUB_SHA": "a" * 40,
            "VERIFIED_SHA": "a" * 40, "VERIFIED_TAG": "v" + VERSION,
            "GITHUB_REF": "refs/tags/v" + VERSION, "GITHUB_RUN_ID": "12345",
            "GITHUB_RUN_ATTEMPT": "1",
            "APPLE_DEVELOPER_ID_P12_BASE64": base64.b64encode(b"fake private p12").decode(),
            "APPLE_DEVELOPER_ID_P12_PASSWORD": "never-print-me",
            "APPLE_NOTARY_KEY_P8_BASE64": base64.b64encode(b"fake private p8").decode(),
            "APPLE_NOTARY_KEY_ID": "ABCDE12345", "APPLE_NOTARY_ISSUER_ID": UUID,
        }
        for active in (patch.dict(os.environ, self.environment), patch.object(signing, "TEAM_ID", TEAM),
                       patch.object(signing.sys, "platform", "darwin"), patch.object(signing, "run", self.tool)):
            active.start()
            self.addCleanup(active.stop)

    def native_archive(self, extra=False, symlink=False):
        with tarfile.open(self.archive, "w:gz", format=tarfile.USTAR_FORMAT) as archive:
            for arch, contents in (("arm64", self.binary), ("x64", self.x64_binary)):
                member = tarfile.TarInfo(f"darwin-{arch}/{signing.BINARY}")
                member.size = len(contents)
                member.mode = 0o755
                if symlink:
                    member.type = tarfile.SYMTYPE
                    member.linkname = "/bin/sh"
                    member.size = 0
                archive.addfile(member, None if symlink else io.BytesIO(contents))
            if extra:
                archive.addfile(tarfile.TarInfo("extra"))
        Path(str(self.archive) + ".sha256").write_text(signing.digest(self.archive.read_bytes()) + "  " + self.archive.name + "\n")

    def tool(self, args, timeout=60):
        args = [str(arg) for arg in args]
        self.calls.append(args)
        self.assertFalse(any(name in os.environ for name in signing.SECRET_NAMES))
        if self.tool_failure and self.tool_failure in args:
            raise signing.SigningError("mock Apple rejection")
        if "create-keychain" in args:
            Path(args[-1]).touch(mode=0o600)
            for path in (self.work / "credentials").iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        if "list-keychains" in args:
            if "-s" in args:
                self.search_list = args[args.index("-s") + 1:]
                return ""
            return "\n".join(json.dumps(path) for path in self.search_list)
        if "delete-keychain" in args:
            self.search_list = [path for path in self.search_list if path != args[-1]]
        if "--requirements" in args:
            self.assertTrue(args[args.index("--requirements") + 1].startswith("=designated => "))
        if "--test-requirement" in args:
            self.assertTrue(args[args.index("--test-requirement") + 1].startswith("="))
        if "find-identity" in args:
            self.assertIn(str(self.work / "credentials" / "signing.keychain-db"), self.search_list)
            return f'  1) {"A" * 40} "Developer ID Application: Example ({self.identity_team})"\n'
        if "--display" in args:
            return self.metadata
        if "notarytool" in args:
            if "submit" in args:
                self.assertEqual(timeout, 180)
                self.assertNotIn("--wait", args)
                return json.dumps({"id": UUID})
            self.assertEqual(timeout, 960)
            self.assertIn("15m", args)
            self.assertIn("wait", args)
            self.assertEqual(args[3], UUID)
            return json.dumps({"status": self.status, "id": self.wait_id})
        return ""

    def sign(self):
        signing.sign(self.archive, VERSION, self.output, self.work)

    def test_gzip_expansion_is_rejected_before_tar_parsing(self):
        import gzip
        expanded = b"x" * (65_536 + 2049)
        self.archive.write_bytes(gzip.compress(expanded))
        Path(str(self.archive) + ".sha256").write_text(signing.digest(self.archive.read_bytes()) + "  " + self.archive.name + "\n")
        with patch.object(signing, "MAX_BYTES", 2048), patch.object(signing.tarfile, "open") as parser:
            with self.assertRaisesRegex(signing.SigningError, "expanded byte bound"):
                signing.unpack_native(self.archive, VERSION, self.root / "unpacked")
            parser.assert_not_called()

    def test_pax_extension_is_rejected(self):
        with tarfile.open(self.archive, "w:gz", format=tarfile.PAX_FORMAT) as archive:
            member = tarfile.TarInfo("darwin-arm64/" + signing.BINARY)
            member.size = len(self.binary)
            member.pax_headers = {"comment": "extension"}
            archive.addfile(member, io.BytesIO(self.binary))
        Path(str(self.archive) + ".sha256").write_text(signing.digest(self.archive.read_bytes()) + "  " + self.archive.name + "\n")
        with self.assertRaises(signing.SigningError):
            signing.unpack_native(self.archive, VERSION, self.root / "unpacked")

    def test_final_archive_is_signed_then_notarized_and_keychain_is_removed(self):
        self.sign()
        final = self.output / signing.archive_name(VERSION)
        self.assertTrue(final.is_file())
        self.assertEqual(Path(str(final) + ".sha256").read_text().strip(), signing.digest(final.read_bytes()) + "  " + final.name)
        with tarfile.open(final) as archive:
            self.assertEqual([entry.name for entry in archive], ["darwin-arm64/oh-sqlite-cli", "darwin-x64/oh-sqlite-cli"])
            self.assertEqual(archive.extractfile("darwin-arm64/oh-sqlite-cli").read(), self.binary)
            self.assertEqual(archive.extractfile("darwin-x64/oh-sqlite-cli").read(), self.x64_binary)
        codesign = next(args for args in self.calls if "--sign" in args)
        self.assertIn("runtime", codesign)
        self.assertIn("--timestamp", codesign)
        self.assertIn("dev.hraness.oh.sqlite-cli", codesign)
        self.assertIn("certificate leaf[field.1.2.840.113635.100.6.1.13] exists", codesign[-2])
        notarized = next(i for i, args in enumerate(self.calls) if "--check-notarization" in args)
        removed = next(i for i, args in enumerate(self.calls) if "delete-keychain" in args)
        self.assertLess(notarized, removed)
        self.assertFalse(self.work.exists())
        self.assertEqual(self.search_list, self.original_search_list)
        self.assertTrue(all(args[0] in ("/usr/bin/security", "/usr/bin/codesign", "/usr/bin/xcrun") for args in self.calls))
        receipt = json.loads((self.root / "oh-sqlite-cli-apple-notarization.json").read_text())
        self.assertEqual(receipt["submissionId"], UUID)
        self.assertEqual(receipt["status"], "Accepted")
        self.assertEqual(receipt["state"], "verified")
        self.assertEqual(receipt["signedBinarySha256"], {"arm64": signing.digest(self.binary), "x64": signing.digest(self.x64_binary)})

    def assert_recovery(self, root=None, expected_status="Accepted", expected_id=UUID, final=False):
        root = self.root if root is None else root
        work = root / "oh-sqlite-cli-apple-signing"
        self.assertFalse(work.exists())
        self.assertTrue(signing.export_recovery(VERSION, work, final=final))
        exported = root / ("oh-sqlite-cli-apple-recovery-export" + ("-final" if final else ""))
        name = signing.archive_name(VERSION)
        self.assertEqual({p.name for p in exported.iterdir()}, {
            name, name + ".sha256", "oh-sqlite-cli-notarization.zip",
            "oh-sqlite-cli-recovery.json", "oh-sqlite-cli-apple-notarization.json"})
        receipt = json.loads((exported / "oh-sqlite-cli-apple-notarization.json").read_text())
        manifest = json.loads((exported / "oh-sqlite-cli-recovery.json").read_text())
        self.assertEqual(receipt["status"], expected_status)
        self.assertEqual(receipt["submissionId"], expected_id)
        self.assertEqual(manifest["sourceSha"], "a" * 40)
        self.assertEqual(manifest["runId"], 12345)
        self.assertEqual(manifest["runAttempt"], 1)
        self.assertEqual(signing.digest((exported / name).read_bytes()), manifest["signedArchiveSha256"])
        for path in exported.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            for private in (b"fake private p12", b"fake private p8", b"never-print-me"):
                self.assertNotIn(private, path.read_bytes())
        return exported

    def prepare(self):
        signing.sign(self.archive, VERSION, self.output, self.work, prepare_only=True)
        self.assertFalse(self.work.exists())
        self.assertFalse(self.output.exists())
        self.assertFalse(any("notarytool" in call for call in self.calls))
        self.assert_recovery(expected_status=None, expected_id=None)
        metadata = self.root / "prepared-metadata.json"
        metadata.write_text(json.dumps({"id": 90001, "digest": "sha256:" + "b" * 64,
            "name": "oh-apple-signed-prepared-1", "expired": False, "size_in_bytes": 4096,
            "workflow_run": {"id": 12345, "head_sha": "a" * 40}}))
        return metadata

    def notary_environment(self):
        return {**{name: self.environment[name] for name in signing.SECRET_NAMES[2:]},
                "PREPARED_ARTIFACT_ID": "90001", "PREPARED_ARTIFACT_DIGEST": "b" * 64}

    def test_two_phase_notarization_requires_retained_artifact_and_uses_only_notary_credentials(self):
        metadata = self.prepare()
        prepared = self.root / "oh-sqlite-cli-apple-recovery-export"
        before = len(self.calls)
        with patch.dict(os.environ, self.notary_environment()):
            signing.notarize(VERSION, self.output, self.work, metadata)
        self.assertFalse(any("--sign" in call or call[0] == "/usr/bin/security" for call in self.calls[before:]))
        self.assertEqual(sum("submit" in call for call in self.calls), 1)
        self.assertEqual((prepared / signing.archive_name(VERSION)).read_bytes(),
                         (self.output / signing.archive_name(VERSION)).read_bytes())
        self.assertEqual(json.loads((prepared / "oh-sqlite-cli-apple-notarization.json").read_text())["state"], "prepared")
        self.assert_recovery(final=True)

    def test_preparation_removes_developer_credentials_without_needing_notary_credentials(self):
        with patch.dict(os.environ, {name: "" for name in signing.SECRET_NAMES[2:]}):
            signing.sign(self.archive, VERSION, self.output, self.work, prepare_only=True)
        self.assertFalse(self.work.exists())
        self.assertFalse(self.output.exists())
        self.assertFalse(any("notarytool" in call for call in self.calls))
        self.assert_recovery(expected_status=None, expected_id=None)

    def test_missing_or_unbound_prepared_upload_prevents_every_submission(self):
        metadata = self.prepare()
        original = json.loads(metadata.read_text())
        before = len(self.calls)
        mutations = [{"id": 90002}, {"digest": "sha256:" + "c" * 64}, {"expired": True},
                     {"name": "another-artifact"}, {"size_in_bytes": signing.MAX_RECOVERY_ARTIFACT_BYTES + 1},
                     {"workflow_run": {"id": 54321, "head_sha": "a" * 40}},
                     {"workflow_run": {"id": 12345, "head_sha": "c" * 40}}]
        with self.assertRaises(signing.SigningError):
            signing.notarize(VERSION, self.output, self.work, metadata)
        for mutation in mutations:
            with self.subTest(mutation=mutation), patch.dict(os.environ, self.notary_environment()):
                metadata.write_text(json.dumps({**original, **mutation}))
                with self.assertRaises(signing.SigningError):
                    signing.notarize(VERSION, self.output, self.work, metadata)
                self.assertEqual(len(self.calls), before)
                self.assertFalse(self.work.exists())
                self.assertFalse(self.output.exists())

    def test_two_phase_unknown_submission_preserves_latest_receipt_and_cannot_resubmit(self):
        metadata = self.prepare()
        self.tool_failure = "submit"
        with patch.dict(os.environ, self.notary_environment()):
            with self.assertRaises(signing.SigningError):
                signing.notarize(VERSION, self.output, self.work, metadata)
        self.assertFalse(self.work.exists())
        self.assertFalse(self.output.exists())
        self.assert_recovery(expected_status=None, expected_id=None, final=True)
        before = len(self.calls)
        with patch.dict(os.environ, self.notary_environment()):
            with self.assertRaises(signing.SigningError):
                signing.notarize(VERSION, self.output, self.work, metadata)
        self.assertEqual(len(self.calls), before)
        self.assertEqual(sum("submit" in call for call in self.calls), 1)

    def test_notary_phase_rejects_developer_credentials_and_rerun_attempts(self):
        metadata = self.prepare()
        before = len(self.calls)
        for extra in [{"APPLE_DEVELOPER_ID_P12_BASE64": "must-not-reach-notary"},
                      {"GITHUB_RUN_ATTEMPT": "2"}]:
            with self.subTest(extra=extra), patch.dict(os.environ, {**self.notary_environment(), **extra}):
                with self.assertRaises(signing.SigningError):
                    signing.notarize(VERSION, self.output, self.work, metadata)
                self.assertEqual(len(self.calls), before)

    def test_changed_prepared_export_prevents_submission_even_with_matching_metadata(self):
        metadata = self.prepare()
        exported = self.root / "oh-sqlite-cli-apple-recovery-export"
        (exported / signing.archive_name(VERSION)).write_bytes(b"changed")
        before = len(self.calls)
        with patch.dict(os.environ, self.notary_environment()):
            with self.assertRaisesRegex(signing.SigningError, "bytes changed"):
                signing.notarize(VERSION, self.output, self.work, metadata)
        self.assertEqual(len(self.calls), before)

    def test_combined_recovery_export_is_bounded_before_submission(self):
        metadata = self.prepare()
        before = len(self.calls)
        with patch.object(signing, "MAX_RECOVERY_BYTES", 1), patch.dict(os.environ, self.notary_environment()):
            with self.assertRaisesRegex(signing.SigningError, "exceeds byte bound"):
                signing.notarize(VERSION, self.output, self.work, metadata)
        self.assertEqual(len(self.calls), before)
        self.assertFalse(self.work.exists())

    def test_success_promotes_exact_retained_archive_and_exports_only_bound_public_files(self):
        self.sign()
        exported = self.assert_recovery()
        name = signing.archive_name(VERSION)
        self.assertEqual((exported / name).read_bytes(), (self.output / name).read_bytes())
        self.assertEqual((exported / (name + ".sha256")).read_bytes(),
                         (self.output / (name + ".sha256")).read_bytes())

    def test_signed_snapshot_exists_before_the_only_submission_and_survives_wait_failure(self):
        def timeout_after_snapshot(args, timeout=60):
            if "submit" in args:
                snapshot = self.root / "oh-sqlite-cli-apple-recovery"
                self.assertTrue((snapshot / signing.archive_name(VERSION)).is_file())
                self.assertEqual((snapshot / "oh-sqlite-cli-notarization.zip").read_bytes(),
                                 (self.work / "notarization.zip").read_bytes())
                self.assertFalse(self.output.exists())
            if "wait" in args:
                self.calls.append([str(arg) for arg in args])
                raise RuntimeError("mock wait interruption")
            return self.tool(args, timeout)
        with patch.object(signing, "run", timeout_after_snapshot):
            with self.assertRaisesRegex(RuntimeError, "mock wait interruption"):
                self.sign()
        self.assertFalse(self.output.exists())
        self.assert_recovery(expected_status=None)
        self.assertEqual(sum("submit" in call for call in self.calls), 1)

    def test_unknown_submission_keeps_signed_bytes_without_retry_or_package_output(self):
        self.tool_failure = "submit"
        with self.assertRaises(signing.SigningError):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assert_recovery(expected_status=None, expected_id=None)
        self.assertEqual(sum("submit" in call for call in self.calls), 1)

    def test_retention_failure_prevents_any_provider_submission(self):
        with patch.object(signing, "retain_signed_recovery", side_effect=OSError("mock retention failure")):
            with self.assertRaises(OSError):
                self.sign()
        self.assertFalse(self.work.exists())
        self.assertFalse(self.output.exists())
        self.assertFalse(any("notarytool" in call for call in self.calls))
        self.assertFalse(signing.export_recovery(VERSION, self.work))

    def test_export_requires_completed_credential_cleanup(self):
        self.work.mkdir()
        with self.assertRaisesRegex(signing.SigningError, "cleaned"):
            signing.export_recovery(VERSION, self.work)

    def test_a_workflow_rerun_cannot_start_another_signing_submission(self):
        with patch.dict(os.environ, {"GITHUB_RUN_ATTEMPT": "2"}):
            with self.assertRaisesRegex(signing.SigningError, "cannot be rerun"):
                self.sign()
        self.assertFalse(self.calls)
        self.assertFalse(self.work.exists())
        self.assertFalse(self.output.exists())

    def test_recovery_rejects_changed_or_private_members_and_wrong_release_binding(self):
        self.sign()
        recovery = self.root / "oh-sqlite-cli-apple-recovery"
        receipt = self.root / "oh-sqlite-cli-apple-notarization.json"
        manifest = recovery / "oh-sqlite-cli-recovery.json"
        changes = [
            (recovery / signing.archive_name(VERSION), b"changed archive"),
            (recovery / "oh-sqlite-cli-notarization.zip", b"changed submission"),
            (receipt, json.dumps({**json.loads(receipt.read_text()), "private": "never-print-me"}).encode()),
            (manifest, json.dumps({**json.loads(manifest.read_text()), "sourceSha": "b" * 40}).encode()),
            (manifest, json.dumps({**json.loads(manifest.read_text()), "private": "never-print-me"}).encode()),
        ]
        for path, changed in changes:
            with self.subTest(path=path.name, change=changed[:20]):
                original = path.read_bytes()
                try:
                    path.write_bytes(changed)
                    with self.assertRaises(signing.SigningError):
                        signing.export_recovery(VERSION, self.work)
                    self.assertFalse((self.root / "oh-sqlite-cli-apple-recovery-export").exists())
                finally:
                    path.write_bytes(original)
        extra = recovery / "credentials"
        extra.symlink_to(receipt)
        with self.assertRaisesRegex(signing.SigningError, "unexpected"):
            signing.export_recovery(VERSION, self.work)

    @unittest.skipUnless(os.name == "posix", "POSIX interruption fixture")
    def test_real_int_and_term_keep_signed_recovery_and_remove_fake_credentials(self):
        fixture = r'''
import importlib.util,json,os,pathlib,signal,sys
root=pathlib.Path(os.environ["SIGN_FIXTURE_ROOT"])
spec=importlib.util.spec_from_file_location("fixture_signing",os.environ["SIGN_FIXTURE_SCRIPT"])
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
s.TEAM_ID="A1B2C3D4E5";s.sys.platform="darwin"
def tool(args,timeout=60):
 args=[str(a) for a in args]
 if "create-keychain" in args:pathlib.Path(args[-1]).touch(mode=0o600)
 if "list-keychains" in args:return ""
 if "find-identity" in args:return '1) '+"A"*40+' "Developer ID Application: Example (A1B2C3D4E5)"\n'
 if "--display" in args:return "Identifier=dev.hraness.oh.sqlite-cli\nTeamIdentifier=A1B2C3D4E5\nCodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=fixture\n"
 if "submit" in args:return json.dumps({"id":"12345678-1234-1234-1234-123456789abc"})
 if "wait" in args:
  (root/"ready").write_text("ready")
  signal.pause()
 return ""
s.run=tool
signal.signal(signal.SIGTERM,lambda *_:sys.exit(143))
notary={name:os.environ[name] for name in s.SECRET_NAMES[2:]}
work=root/"oh-sqlite-cli-apple-signing"
s.sign(root/s.archive_name("0.13.4",unsigned=True),"0.13.4",root/"signed-artifacts",work,prepare_only=True)
s.export_recovery("0.13.4",work)
metadata=root/"prepared-metadata.json"
metadata.write_text(json.dumps({"id":90001,"digest":"sha256:"+"b"*64,"name":"oh-apple-signed-prepared-1","expired":False,"size_in_bytes":4096,"workflow_run":{"id":12345,"head_sha":"a"*40}}))
os.environ.update(notary)
os.environ.update({"PREPARED_ARTIFACT_ID":"90001","PREPARED_ARTIFACT_DIGEST":"b"*64})
s.notarize("0.13.4",root/"signed-artifacts",work,metadata)
'''
        for interruption in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=interruption), tempfile.TemporaryDirectory(prefix="oh-real-sign-interruption-") as directory:
                root = Path(directory).resolve()
                shutil.copyfile(self.archive, root / self.archive.name)
                shutil.copyfile(Path(str(self.archive) + ".sha256"), root / (self.archive.name + ".sha256"))
                environment = {**self.environment, "RUNNER_TEMP": str(root), "HOME": str(root),
                               "SIGN_FIXTURE_ROOT": str(root),
                               "SIGN_FIXTURE_SCRIPT": str(Path(signing.__file__).resolve())}
                child = subprocess.Popen([sys.executable, "-I", "-B", "-c", fixture],
                                         env=environment, stdin=subprocess.DEVNULL,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                         start_new_session=True)
                try:
                    deadline = time.monotonic() + 5
                    while not (root / "ready").exists() and time.monotonic() < deadline:
                        self.assertIsNone(child.poll())
                        time.sleep(0.01)
                    self.assertTrue((root / "ready").exists())
                    os.kill(child.pid, interruption)
                    self.assertNotEqual(child.wait(timeout=3), 0)
                    with patch.dict(os.environ, environment):
                        self.assert_recovery(root, expected_status=None, final=True)
                    self.assertFalse((root / "signed-artifacts").exists())
                    self.assertEqual(json.loads((root / "oh-sqlite-cli-apple-notarization.json").read_text())["state"], "wait-incomplete")
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait(timeout=3)

    def test_search_list_is_appended_before_identity_lookup_and_cleanup_preserves_other_entries(self):
        def with_concurrent_entry(args, timeout=60):
            if "delete-keychain" in args:
                self.search_list.append("/Library/Keychains/Concurrent.keychain")
            return self.tool(args, timeout)
        with patch.object(signing, "run", with_concurrent_entry):
            self.sign()
        added = next(i for i, args in enumerate(self.calls) if "list-keychains" in args and "-s" in args)
        found = next(i for i, args in enumerate(self.calls) if "find-identity" in args)
        self.assertLess(added, found)
        self.assertEqual(self.calls[added][5:-1], self.original_search_list)
        self.assertEqual(self.search_list, self.original_search_list + ["/Library/Keychains/Concurrent.keychain"])

    def test_search_list_failure_cleans_credentials_without_signing(self):
        self.tool_failure = "list-keychains"
        with self.assertRaises(signing.SigningError):
            self.sign()
        self.assertFalse(self.work.exists())
        self.assertFalse(self.output.exists())
        self.assertFalse(any("--sign" in args for args in self.calls))
        self.assertEqual(self.search_list, self.original_search_list)

    def test_notary_rejection_removes_credentials_and_never_creates_release(self):
        self.status = "Invalid"
        with self.assertRaisesRegex(signing.SigningError, "not Accepted"):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        self.assertTrue(any("delete-keychain" in args for args in self.calls))
        receipt = json.loads((self.root / "oh-sqlite-cli-apple-notarization.json").read_text())
        self.assertEqual(receipt["submissionId"], UUID)
        self.assertEqual(receipt["status"], "Invalid")

    def test_incomplete_notary_status_is_not_success(self):
        self.status = "In Progress"
        with self.assertRaisesRegex(signing.SigningError, "not Accepted"):
            self.sign()
        self.assertFalse(self.output.exists())

    def test_wait_timeout_preserves_submission_and_exact_hashes_without_retry(self):
        def timed_out(args, timeout=60):
            if "wait" in args:
                self.calls.append([str(arg) for arg in args])
                raise RuntimeError("Apple tool failed or timed out: xcrun")
            return self.tool(args, timeout)
        with patch.object(signing, "run", timed_out):
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        receipt_text = (self.root / "oh-sqlite-cli-apple-notarization.json").read_text()
        receipt = json.loads(receipt_text)
        self.assertEqual(receipt["submissionId"], UUID)
        self.assertEqual(receipt["state"], "wait-incomplete")
        self.assertIsNone(receipt["status"])
        self.assertEqual(receipt["signedBinarySha256"], {"arm64": signing.digest(self.binary), "x64": signing.digest(self.x64_binary)})
        self.assertEqual(receipt["unsignedArchiveSha256"], signing.digest(self.archive.read_bytes()))
        self.assertRegex(receipt["submissionZipSha256"], "^[0-9a-f]{64}$")
        self.assertEqual(sum("submit" in args for args in self.calls), 1)
        self.assertEqual(sum("wait" in args for args in self.calls), 1)
        for private in ("fake private p12", "fake private p8", "never-print-me", str(self.work)):
            self.assertNotIn(private, receipt_text)

    def test_wait_cannot_accept_a_different_submission(self):
        self.wait_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        with self.assertRaisesRegex(signing.SigningError, "another submission"):
            self.sign()
        self.assertFalse(self.output.exists())
        receipt = json.loads((self.root / "oh-sqlite-cli-apple-notarization.json").read_text())
        self.assertEqual(receipt["submissionId"], UUID)
        self.assertEqual(receipt["state"], "wait-incomplete")
        self.assertIsNone(receipt["status"])

    def test_submit_failure_retains_hashes_and_never_retries_an_unknown_submission(self):
        self.tool_failure = "submit"
        with self.assertRaisesRegex(signing.SigningError, "mock Apple rejection"):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        receipt = json.loads((self.root / "oh-sqlite-cli-apple-notarization.json").read_text())
        self.assertIsNone(receipt["submissionId"])
        self.assertEqual(receipt["state"], "submission-started")
        self.assertEqual(receipt["signedBinarySha256"], {"arm64": signing.digest(self.binary), "x64": signing.digest(self.x64_binary)})
        self.assertEqual(sum("submit" in args for args in self.calls), 1)
        self.assertFalse(any("wait" in args for args in self.calls))

    def test_arbitrary_service_status_is_not_retained_in_diagnostics(self):
        self.status = "unexpected secret echoed by service"
        with self.assertRaisesRegex(signing.SigningError, "not Accepted"):
            self.sign()
        receipt_text = (self.root / "oh-sqlite-cli-apple-notarization.json").read_text()
        self.assertNotIn(self.status, receipt_text)
        self.assertEqual(json.loads(receipt_text)["status"], "Unrecognized")

    def test_wrong_certificate_team_is_rejected_before_signing(self):
        self.identity_team = "Z9Y8X7W6V5"
        with self.assertRaisesRegex(signing.SigningError, "expected Developer ID"):
            self.sign()
        self.assertFalse(any("--sign" in args for args in self.calls))
        self.assertFalse(self.work.exists())

    def test_hardened_runtime_and_timestamp_are_required(self):
        self.metadata = self.metadata.replace("(runtime)", "(none)")
        with self.assertRaisesRegex(signing.SigningError, "hardened runtime"):
            self.sign()
        self.assertFalse(any("notarytool" in args for args in self.calls))

    def test_missing_secure_timestamp_is_rejected(self):
        self.metadata = "\n".join(line for line in self.metadata.splitlines() if not line.startswith("Timestamp="))
        with self.assertRaisesRegex(signing.SigningError, "secure timestamp"):
            self.sign()
        self.assertFalse(any("notarytool" in args for args in self.calls))

    def test_actual_signed_metadata_must_match_expected_team(self):
        self.metadata = self.metadata.replace("TeamIdentifier=" + TEAM, "TeamIdentifier=Z9Y8X7W6V5")
        with self.assertRaisesRegex(signing.SigningError, "identity mismatch"):
            self.sign()
        self.assertFalse(self.output.exists())

    def test_term_interruption_unwinds_and_removes_credentials(self):
        def interrupted(args, timeout=60):
            if "notarytool" in args:
                # The installed SIGTERM handler raises SystemExit(143).
                raise SystemExit(143)
            return self.tool(args, timeout)
        with patch.object(signing, "run", interrupted):
            with self.assertRaises(SystemExit) as stopped:
                self.sign()
        self.assertEqual(stopped.exception.code, 143)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        self.assertTrue(any("delete-keychain" in args for args in self.calls))

    def test_post_notarization_verification_failure_blocks_publication(self):
        self.tool_failure = "--check-notarization"
        with self.assertRaisesRegex(signing.SigningError, "mock Apple rejection"):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())

    def test_keychain_cleanup_failure_blocks_publication_and_removes_private_files(self):
        self.tool_failure = "delete-keychain"
        with self.assertRaisesRegex(signing.SigningError, "mock Apple rejection"):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())

    def test_extra_tar_member_rejected_before_apple_tools(self):
        self.native_archive(extra=True)
        with self.assertRaisesRegex(signing.SigningError, "extra members"):
            self.sign()
        self.assertFalse(self.calls)
        self.assertFalse(self.work.exists())

    def test_symlink_payload_rejected_before_apple_tools(self):
        self.native_archive(symlink=True)
        with self.assertRaisesRegex(signing.SigningError, "regular architecture"):
            self.sign()
        self.assertFalse(self.calls)

    def test_payload_checksum_rejected_before_apple_tools(self):
        Path(str(self.archive) + ".sha256").write_text("0" * 64 + "  " + self.archive.name + "\n")
        with self.assertRaisesRegex(signing.SigningError, "checksum mismatch"):
            self.sign()
        self.assertFalse(self.calls)

    def test_payload_must_be_arm64_macho_before_apple_tools(self):
        self.binary = b"#!/bin/sh\necho payload must never run\n"
        self.native_archive()
        with self.assertRaisesRegex(signing.SigningError, "arm64 Mach-O"):
            self.sign()
        self.assertFalse(self.calls)

    def test_macho_must_be_an_executable_not_a_dylib(self):
        self.binary = self.binary[:12] + struct.pack("<I", 6) + self.binary[16:]
        self.native_archive()
        with self.assertRaisesRegex(signing.SigningError, "arm64 Mach-O executable"):
            self.sign()
        self.assertFalse(self.calls)

    def test_team_placeholder_fails_closed(self):
        with patch.object(signing, "TEAM_ID", "__GOBSTOPPER_APPLE_TEAM_ID__"):
            with self.assertRaisesRegex(signing.SigningError, "not configured"):
                self.sign()
        self.assertFalse(self.calls)

    def artifact_zip(self, extra=None):
        path = self.root / "artifact.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.write(self.archive, self.archive.name)
            archive.write(Path(str(self.archive) + ".sha256"), self.archive.name + ".sha256")
            if extra:
                archive.writestr(extra, b"unexpected")
        return path

    def test_exact_artifact_zip_digest_and_two_file_inventory_are_verified(self):
        archive = self.artifact_zip()
        destination = self.root / "extracted"
        signing.unpack_artifact(archive, signing.digest(archive.read_bytes()), VERSION, destination)
        self.assertEqual((destination / self.archive.name).read_bytes(), self.archive.read_bytes())

    def test_wrong_artifact_zip_digest_is_a_hard_failure(self):
        archive = self.artifact_zip()
        destination = self.root / "extracted"
        with self.assertRaisesRegex(signing.SigningError, "ZIP digest mismatch"):
            signing.unpack_artifact(archive, "0" * 64, VERSION, destination)
        self.assertFalse(destination.exists())

    def test_extra_or_traversal_zip_member_is_rejected(self):
        archive = self.artifact_zip("../escaped")
        with self.assertRaisesRegex(signing.SigningError, "exactly the expected archive"):
            signing.unpack_artifact(archive, signing.digest(archive.read_bytes()), VERSION, self.root / "extracted")
        self.assertFalse((self.root / "extracted").exists())

    def test_wrong_architecture_label_rejects_before_signing(self):
        self.x64_binary = self.binary
        self.native_archive()
        with self.assertRaisesRegex(signing.SigningError, "x64 Mach-O"):
            self.sign()
        self.assertFalse(self.calls)

    def test_both_binaries_are_verified_before_one_notary_submission(self):
        self.sign()
        self.assertEqual(sum("--sign" in call for call in self.calls), 2)
        self.assertEqual(sum("--check-notarization" in call for call in self.calls), 2)
        self.assertEqual(sum("submit" in call for call in self.calls), 1)
        final = self.output / signing.archive_name(VERSION)
        staged = self.root / "staged"
        signing.unpack_native(final, VERSION, staged, unsigned=False)
        signing.verify_sidecars(staged, signing.digest(self.binary), signing.digest(self.x64_binary))
        (staged / "darwin-x64" / signing.BINARY).write_bytes(self.binary)
        with self.assertRaisesRegex(signing.SigningError, "hash mismatch"):
            signing.verify_sidecars(staged, signing.digest(self.binary), signing.digest(self.x64_binary))

    def test_second_architecture_failure_never_submits_or_publishes_partial_results(self):
        def fail_second(args, timeout=60):
            if "--sign" in args and Path(args[-1]).parent.name == "darwin-x64":
                raise signing.SigningError("second architecture failed")
            return self.tool(args, timeout)
        with patch.object(signing, "run", fail_second):
            with self.assertRaisesRegex(signing.SigningError, "second architecture"):
                self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        self.assertFalse(any("submit" in call for call in self.calls))

    def test_cleanup_rejects_unowned_path(self):
        with self.assertRaisesRegex(signing.SigningError, "dedicated runner"):
            signing.cleanup(self.root)
        self.assertTrue(self.root.exists())


class ToolBoundaryTests(unittest.TestCase):
    def test_subprocess_receives_no_apple_or_provider_credentials(self):
        result = subprocess.CompletedProcess([], 0, stdout="ok", stderr="")
        with patch.dict(os.environ, {"APPLE_DEVELOPER_ID_P12_PASSWORD": "private", "OPENAI_API_KEY": "private"}), \
             patch.object(signing.subprocess, "run", return_value=result) as child:
            self.assertEqual(signing.run(["/usr/bin/security", "test"]), "ok")
        self.assertEqual(set(child.call_args.kwargs["env"]), {"PATH", "HOME", "LC_ALL"})

    def test_tool_errors_do_not_echo_secret_arguments_or_output(self):
        result = subprocess.CompletedProcess([], 1, stdout="private", stderr="private")
        with patch.object(signing.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(signing.SigningError, "^Apple tool failed: security$"):
                signing.run(["/usr/bin/security", "-p", "private"])


if __name__ == "__main__":
    unittest.main()
