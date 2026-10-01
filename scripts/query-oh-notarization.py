#!/usr/bin/env python3
"""Query the retained Oh 0.14.0 Apple submission without signing or uploading.

The original GitHub receipt is bound to immutable release source and artifact
bytes before the isolated query step receives only the Notary API credentials.
Accepted here records provider status; it does not admit or publish a package.
"""

import argparse
import base64
import ctypes
from datetime import datetime, timezone
import hashlib
import errno
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time
import zipfile

REPOSITORY = "hraness/oh"
SOURCE_SHA = "40fe6bd915a3ea1acaa7d586a581f60478090d1c"
RELEASE_TAG = "v0.14.0"
TAG_OBJECT = "30ba314542e0d5355ae3c2e43c418b53df182227"
RUN_ID = 36770014202
ARTIFACT_ID = 11124746411
ARTIFACT_DIGEST = "53126de808b14acb2447557763e5b0306eb114385077c0c7fec655b18e706030"
RECEIPT_DIGEST = "fb162d296d9ce29c3059a9f2331d312a2dacc6afd49e9523bea086c786e4de12"
RECEIPT_NAME = "oh-sqlite-cli-apple-notarization.json"
MAX_BYTES = 65536
EXPECTED_RECEIPT = {
    "schemaVersion": 1, "version": "0.14.0", "teamId": "8AAP53VTW3",
    "identifier": "dev.hraness.oh.sqlite-cli", "state": "wait-incomplete",
    "status": None, "submissionId": "d2f4dd52-f74d-4946-b101-89feeb3764fe",
    "submissionZipSha256": "af6d1a31ce17151405572c173b35a9abcb3baedd9f5db609095994b966f9f76e",
    "unsignedArchiveSha256": "82f9b4782385f641fb2eb4ae8a348f6c719b9a790fb0a36b02b763b3c5f00c6b",
    "signedBinarySha256": {
        "arm64": "be117998a6b18d44076cb55934c9e4c7f1a335d6260ab154c5a92ab574f49388",
        "x64": "8289c07dd21451925962e80104bc852fa10f91e1a407fe422a031662e42e253b",
    },
}
SECRET_NAMES = ("APPLE_NOTARY_KEY_P8_BASE64", "APPLE_NOTARY_KEY_ID", "APPLE_NOTARY_ISSUER_ID")
ERROR_CLASSIFICATIONS = (
    "child-signal", "child-launch-failed", "child-timeout", "local-file-limit",
    "authentication-rejected", "authorization-rejected", "submission-not-found",
    "rate-limited", "service-or-network-failure", "tool-usage-error",
    "unrecognized-tool-failure", "invalid-tool-response",
    "child-output-overflow", "child-capture-failed", "child-cleanup-failed",
)


class QueryError(Exception):
    """Only controlled, credential-free diagnostics may reach logs."""


def require(condition, message):
    if not condition:
        raise QueryError(message)


class AppleQueryFailure(QueryError):
    """A numeric exit and one fixed classification, never service text."""

    def __init__(self, exit_code, classification):
        require(exit_code is None or type(exit_code) is int, "invalid child exit code")
        require(classification in ERROR_CLASSIFICATIONS, "invalid error classification")
        self.exit_code = exit_code
        self.classification = classification
        super().__init__(f"Apple status query failed ({classification}; exit {exit_code})")


def bounded_bytes(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_BYTES,
            "input must be one bounded regular file")
    data = path.read_bytes()
    require(0 < len(data) <= MAX_BYTES, "input changed beyond byte bound")
    return data


def json_value(data):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate JSON key")
            result[key] = value
        return result
    value = json.loads(data, object_pairs_hook=unique_keys)
    require(type(value) is dict, "input must be a JSON object")
    return value


def verified_receipt(data):
    require(hashlib.sha256(data).hexdigest() == RECEIPT_DIGEST, "original receipt bytes changed")
    receipt = json_value(data)
    require(receipt == EXPECTED_RECEIPT, "original receipt identity changed")
    return receipt


def verify_evidence(directory, output):
    run = json_value(bounded_bytes(directory / "run.json"))
    artifact = json_value(bounded_bytes(directory / "artifact.json"))
    tag_ref = json_value(bounded_bytes(directory / "tag-ref.json"))
    tag = json_value(bounded_bytes(directory / "tag.json"))
    require(run.get("id") == RUN_ID and run.get("run_attempt") == 1
            and run.get("event") == "push" and run.get("head_branch") == RELEASE_TAG
            and run.get("head_sha") == SOURCE_SHA and run.get("path") == ".github/workflows/release.yml"
            and run.get("status") == "completed" and run.get("conclusion") == "failure"
            and run.get("repository", {}).get("full_name") == REPOSITORY,
            "original release run identity changed")
    require(artifact.get("id") == ARTIFACT_ID and artifact.get("name") == "oh-apple-notarization-1"
            and artifact.get("digest") == "sha256:" + ARTIFACT_DIGEST
            and artifact.get("expired") is False
            and type(artifact.get("size_in_bytes")) is int and 0 < artifact["size_in_bytes"] <= MAX_BYTES
            and artifact.get("workflow_run", {}).get("id") == RUN_ID
            and artifact.get("workflow_run", {}).get("head_sha") == SOURCE_SHA,
            "original receipt artifact identity changed")
    require(tag_ref.get("ref") == "refs/tags/" + RELEASE_TAG
            and tag_ref.get("object", {}).get("type") == "tag"
            and tag_ref.get("object", {}).get("sha") == TAG_OBJECT
            and tag.get("sha") == TAG_OBJECT and tag.get("tag") == RELEASE_TAG
            and tag.get("object", {}).get("type") == "commit"
            and tag.get("object", {}).get("sha") == SOURCE_SHA,
            "original annotated release tag changed")
    archive = directory / "receipt.zip"
    data = bounded_bytes(archive)
    require(hashlib.sha256(data).hexdigest() == ARTIFACT_DIGEST, "original artifact ZIP changed")
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        require(len(entries) == 1, "receipt artifact must contain one file")
        entry = entries[0]
        mode = entry.external_attr >> 16
        require(entry.filename == RECEIPT_NAME and not entry.is_dir()
                and stat.S_IFMT(mode) in (0, stat.S_IFREG) and not entry.flag_bits & 1
                and 0 < entry.file_size <= MAX_BYTES, "invalid receipt artifact member")
        with source.open(entry) as contents:
            receipt_bytes = contents.read(MAX_BYTES + 1)
        require(len(receipt_bytes) == entry.file_size, "receipt artifact size changed")
        verified_receipt(receipt_bytes)
    require(not output.exists() and not output.is_symlink(), "evidence output already exists")
    output.mkdir(mode=0o700)
    write_new(output / RECEIPT_NAME, receipt_bytes)


def write_new(path, data):
    with path.open("xb") as target:
        path.chmod(0o600)
        target.write(data)


def checked_work(work):
    runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    require(work == runner_temp / "oh-notarization-status" and not work.is_symlink(),
            "query work must use its dedicated runner temporary path")


def cleanup(work):
    checked_work(work)
    if work.exists():
        require(work.is_dir(), "unsafe query work directory")
        shutil.rmtree(work)


def child_exited_unreaped(child):
    # WNOWAIT keeps the owned leader PID reserved until group cleanup. Calling
    # Popen.poll/wait earlier could permit PID/group reuse before killpg.
    if hasattr(os, "waitid"):
        return os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None
    # Apple's system Python 3.9 does not expose waitid. Call the same Darwin
    # libc operation with SDK ABI constants P_PID=1, WEXITED|WNOHANG|WNOWAIT.
    require(sys.platform == "darwin", "unreaped child inspection unavailable")
    library = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
    library.waitid.argtypes = [ctypes.c_int, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]
    library.waitid.restype = ctypes.c_int
    information = ctypes.create_string_buffer(128)
    ctypes.set_errno(0)
    if library.waitid(1, child.pid, information, 0x04 | 0x01 | 0x20) != 0:
        raise OSError(ctypes.get_errno(), "owned child inspection failed")
    # Darwin siginfo starts with four 32-bit fields: signo, errno, code, pid.
    pid = ctypes.c_int32.from_buffer(information, 12).value
    require(pid in (0, child.pid), "owned child inspection returned another PID")
    return pid == child.pid


def darwin_group_has_no_live_members(group):
    """Bounded libproc lookup of only our anchored group, never argv or files."""
    if sys.platform != "darwin":
        return False
    class BsdInfo(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint32) for name in (
            "flags", "status", "exit_status", "pid", "ppid", "uid", "gid",
            "ruid", "rgid", "svuid", "svgid", "reserved",
        )] + [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)] + [
            (name, ctypes.c_uint32) for name in ("nfiles", "pgid", "job_count", "tty", "tty_group")
        ] + [("nice", ctypes.c_int32), ("start_seconds", ctypes.c_uint64), ("start_microseconds", ctypes.c_uint64)]
    try:
        library = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        library.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]
        library.proc_listpids.restype = ctypes.c_int
        library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        library.proc_pidinfo.restype = ctypes.c_int
        members = (ctypes.c_int * 129)()
        ctypes.set_errno(0)
        count = library.proc_listpids(2, group, members, ctypes.sizeof(members))
        if count < 0 or count >= ctypes.sizeof(members) or count % ctypes.sizeof(ctypes.c_int) or ctypes.get_errno():
            return False
        for pid in members[:count // ctypes.sizeof(ctypes.c_int)]:
            if pid == 0:
                continue
            information = BsdInfo()
            ctypes.set_errno(0)
            size = library.proc_pidinfo(pid, 3, 0, ctypes.byref(information), ctypes.sizeof(information))
            if size == 0 and ctypes.get_errno() == errno.ESRCH:
                continue
            if size != ctypes.sizeof(information) or information.pid != pid or information.pgid != group or information.uid != os.getuid() or information.status != 5:
                return False
        return True
    except (OSError, AttributeError, ValueError):
        return False


def signal_owned_group(child, kind):
    try:
        os.killpg(child.pid, kind)
    except ProcessLookupError:
        pass
    except PermissionError:
        # Darwin can return EPERM for zombie-only groups. Keep the leader
        # unreaped and verify every exact-group member is already dead before
        # accepting it; permission failures involving any live member fail.
        if not child_exited_unreaped(child) or not darwin_group_has_no_live_members(child.pid):
            raise


def finish_owned_child_group(child):
    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
    try:
        try:
            if os.getpgid(child.pid) != child.pid:
                raise AppleQueryFailure(None, "child-cleanup-failed")
        except ProcessLookupError:
            # macOS can stop exposing the group of an exited zombie. WNOWAIT
            # still proves our unreaped leader reserves this exact PID.
            if not child_exited_unreaped(child):
                raise AppleQueryFailure(None, "child-cleanup-failed")
        # start_new_session created only this owned group. The unreaped leader
        # anchors its identity throughout both signals, including after exit.
        signal_owned_group(child, signal.SIGTERM)
        time.sleep(0.1)
        signal_owned_group(child, signal.SIGKILL)
        return child.wait(timeout=1)
    except (OSError, subprocess.SubprocessError):
        raise AppleQueryFailure(None, "child-cleanup-failed") from None
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)


def bounded_child(argv, environment, timeout=90, limit=MAX_BYTES):
    require(type(limit) is int and 0 < limit <= MAX_BYTES, "invalid capture byte bound")
    require(type(timeout) in (int, float) and 0 < timeout <= 90, "invalid capture deadline")
    deadline = time.monotonic() + timeout
    child = None
    pending_signals = set()
    previous_handlers = {kind: signal.getsignal(kind) for kind in (signal.SIGINT, signal.SIGTERM)}
    def defer_interrupt(kind, frame):
        pending_signals.add(kind)
    try:
        # Defer Python interruptions until the returned child is inside this
        # cleanup scope. Caught handlers reset on exec, so the SDK does not
        # inherit blocked signals or ignored SIGTERM/SIGINT dispositions.
        for kind in previous_handlers:
            signal.signal(kind, defer_interrupt)
        try:
            child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, env=environment, close_fds=True,
                                     start_new_session=True)
        except (OSError, subprocess.SubprocessError):
            raise AppleQueryFailure(None, "child-launch-failed") from None
        for kind, handler in previous_handlers.items():
            signal.signal(kind, handler)
        for kind in sorted(pending_signals):
            handler = previous_handlers[kind]
            if callable(handler):
                handler(kind, None)
            elif handler == signal.SIG_DFL:
                raise SystemExit(128 + kind)
        output = {"stdout": bytearray(), "stderr": bytearray()}
        with selectors.DefaultSelector() as selector:
            for name in output:
                stream = getattr(child, name)
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            while selector.get_map() or not child_exited_unreaped(child):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise AppleQueryFailure(None, "child-timeout")
                if not selector.get_map():
                    time.sleep(min(0.01, remaining))
                    continue
                for key, _ in selector.select(min(0.1, remaining)):
                    buffer = output[key.data]
                    # Retain at most limit bytes; one discarded probe byte
                    # distinguishes exact-limit EOF from overflowing output.
                    data = os.read(key.fd, min(8192, limit - len(buffer) + 1))
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    if len(data) > limit - len(buffer):
                        raise AppleQueryFailure(None, "child-output-overflow")
                    buffer.extend(data)
            if time.monotonic() > deadline:
                raise AppleQueryFailure(None, "child-timeout")
    except (OSError, ValueError):
        raise AppleQueryFailure(None, "child-capture-failed") from None
    finally:
        # Also remove descendants after a normal leader exit. Do not reap the
        # leader or close pipes before terminating this exact anchored group.
        try:
            if child is not None:
                exit_code = finish_owned_child_group(child)
        finally:
            if child is not None:
                child.stdout.close()
                child.stderr.close()
            for kind, handler in previous_handlers.items():
                signal.signal(kind, handler)
    return exit_code, bytes(output["stdout"]), bytes(output["stderr"])


def failure_classification(exit_code, output, errors):
    if exit_code < 0:
        return "child-signal"
    # Service text is used only for these fixed hints and is never retained.
    text = (output + b"\n" + errors).decode("utf8", errors="replace")
    patterns = (
        ("local-file-limit", r"file too large|file size limit exceeded"),
        ("authentication-rejected", r"HTTP status code:\s*401\b|invalid credentials|(?:unable|failed) to authenticate|authentication failed"),
        ("authorization-rejected", r"HTTP status code:\s*403\b|not authorized|permission denied"),
        ("submission-not-found", r"HTTP status code:\s*404\b|submission[^\n]{0,160}(?:not found|does not exist)|unable to find a submission"),
        ("rate-limited", r"HTTP status code:\s*429\b|too many requests|rate limit exceeded"),
        ("service-or-network-failure", r"HTTP status code:\s*5[0-9]{2}\b|(?:connection|network|service)[^\n]{0,80}(?:failed|unavailable)|could not connect|could not resolve|connection timed out"),
        ("tool-usage-error", r"usage:\s*notarytool|unknown argument|unrecognized subcommand"),
    )
    for classification, pattern in patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return classification
    return "unrecognized-tool-failure"


def status_record(receipt, status, state):
    return {
        "schemaVersion": 1, "state": state, "status": status,
        "checkedAt": datetime.now(timezone.utc).isoformat(), "repository": REPOSITORY,
        "releaseTag": RELEASE_TAG, "releaseSourceSha": SOURCE_SHA, "releaseRunId": RUN_ID,
        "receiptArtifactId": ARTIFACT_ID, "receiptArtifactSha256": ARTIFACT_DIGEST,
        "originalReceiptSha256": RECEIPT_DIGEST,
        "submissionId": receipt["submissionId"], "submissionZipSha256": receipt["submissionZipSha256"],
        "signedBinarySha256": receipt["signedBinarySha256"],
        "packageAdmitted": False,
    }


def apple_info(submission_id, key, key_id, issuer, work):
    environment = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": os.environ["HOME"], "LC_ALL": "C"}
    exit_code, output, errors = bounded_child(
        ["/usr/bin/xcrun", "notarytool", "info", submission_id,
         "--key", str(key), "--key-id", key_id, "--issuer", issuer, "--output-format", "json"],
        environment,
    )
    if exit_code != 0:
        raise AppleQueryFailure(exit_code, failure_classification(exit_code, output, errors))
    try:
        return json_value(output)
    except (QueryError, ValueError, UnicodeDecodeError):
        raise AppleQueryFailure(0, "invalid-tool-response") from None


def query(receipt_path, output, work):
    values = {name: os.environ.pop(name, "") for name in SECRET_NAMES}
    try:
        receipt = verified_receipt(bounded_bytes(receipt_path))
        require(sys.platform == "darwin", "Apple status query requires macOS")
        checked_work(work)
        require(not work.exists() and not output.exists() and not output.is_symlink(),
                "query output or work already exists")
        require(all(values.values()), "Notary API credentials are incomplete")
        require(re.fullmatch(r"[A-Z0-9]{10}", values["APPLE_NOTARY_KEY_ID"]), "invalid Notary key ID")
        require(re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}",
                             values["APPLE_NOTARY_ISSUER_ID"]), "invalid Notary issuer ID")
        key_bytes = base64.b64decode(values["APPLE_NOTARY_KEY_P8_BASE64"], validate=True)
        require(0 < len(key_bytes) <= 16384, "invalid Notary key byte bound")
        work.mkdir(mode=0o700)
        query_failure = None
        try:
            key = work / "AuthKey.p8"
            write_new(key, key_bytes)
            response = apple_info(receipt["submissionId"], key, values["APPLE_NOTARY_KEY_ID"],
                                  values["APPLE_NOTARY_ISSUER_ID"], work)
            require(response.get("id") == receipt["submissionId"], "Apple returned another submission")
            status = response.get("status")
            require(status in ("Accepted", "Invalid", "Rejected", "In Progress"), "unrecognized Apple status")
            result = status_record(receipt, status, "status-queried")
        except AppleQueryFailure as error:
            query_failure = error
            result = status_record(receipt, None, "query-incomplete")
            result.update(toolExitCode=error.exit_code, errorClassification=error.classification)
        finally:
            cleanup(work)
        # Cleanup completes before any result is written or printed.
        write_new(output, (json.dumps(result, sort_keys=True) + "\n").encode("utf8"))
        if query_failure is not None:
            raise query_failure
        print("Original Apple submission status: " + status)
    finally:
        values.clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    verify = commands.add_parser("verify-evidence")
    verify.add_argument("directory", type=Path)
    verify.add_argument("output", type=Path)
    status = commands.add_parser("query")
    status.add_argument("receipt", type=Path)
    status.add_argument("output", type=Path)
    status.add_argument("work", type=Path)
    cleaning = commands.add_parser("cleanup")
    cleaning.add_argument("work", type=Path)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    os.umask(0o077)
    try:
        if args.command == "verify-evidence":
            verify_evidence(args.directory, args.output)
        elif args.command == "query":
            query(args.receipt, args.output, args.work)
        else:
            cleanup(args.work)
    except Exception as error:
        message = str(error) if isinstance(error, QueryError) else type(error).__name__
        print("error: " + message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
