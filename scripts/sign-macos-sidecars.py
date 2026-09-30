#!/usr/bin/env python3
"""Dependency-free, non-executing boundary for Developer ID release signing.

Only this program receives Apple credentials. It never executes the payload,
installs dependencies, or invokes build scripts. Native smoke runs in a later
workflow step, after credentials and the temporary keychain have been removed.
"""

import argparse
import base64
import hashlib
import gzip
import io
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile

TEAM_ID = "8AAP53VTW3"
IDENTIFIER = "dev.hraness.oh.sqlite-cli"
BINARY = "oh-sqlite-cli"
ARCHITECTURES = {"arm64": 0x0100000C, "x64": 0x01000007}
MAX_BYTES = 128 * 1024 * 1024
UUID_PATTERN = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
SECRET_NAMES = (
    "APPLE_DEVELOPER_ID_P12_BASE64", "APPLE_DEVELOPER_ID_P12_PASSWORD",
    "APPLE_NOTARY_KEY_P8_BASE64", "APPLE_NOTARY_KEY_ID", "APPLE_NOTARY_ISSUER_ID",
)


class SigningError(Exception):
    """A controlled diagnostic that never contains subprocess output."""


def require(condition, message):
    if not condition:
        raise SigningError(message)


def version_value(value):
    value = value.removeprefix("v")
    require(re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value),
            "version must be stable semantic version")
    return value


def archive_name(version, unsigned=False):
    suffix = ".unsigned" if unsigned else ""
    return f"oh-sqlite-cli-{version_value(version)}-darwin-sidecars{suffix}.tar.gz"


def regular_file(path, maximum=MAX_BYTES):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= maximum,
            "input must be one bounded regular file")
    return path.read_bytes()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unpack_artifact(archive, expected_digest, version, destination, unsigned=True):
    """Verify the upload-artifact ZIP digest before unpacking two exact names."""
    require(re.fullmatch(r"[0-9a-f]{64}", expected_digest), "invalid artifact digest")
    require(digest(regular_file(archive)) == expected_digest, "artifact ZIP digest mismatch")
    name = archive_name(version, unsigned=unsigned)
    expected = {name, name + ".sha256"}
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        require(len(entries) == 2 and {entry.filename for entry in entries} == expected,
                "artifact ZIP must contain exactly the expected archive and checksum")
        for entry in entries:
            mode = entry.external_attr >> 16
            require(not entry.is_dir() and (stat.S_IFMT(mode) in (0, stat.S_IFREG)),
                    "artifact ZIP entry is not regular")
            require(0 < entry.file_size <= MAX_BYTES and not entry.flag_bits & 1,
                    "artifact ZIP entry is not bounded plaintext")
        destination.mkdir(mode=0o700)
        for entry in entries:
            target = destination / entry.filename
            with target.open("xb") as output:
                os.chmod(target, 0o600)
                with source.open(entry) as compressed:
                    contents = compressed.read(entry.file_size + 1)
                require(len(contents) == entry.file_size, "artifact ZIP entry size mismatch")
                output.write(contents)


def unpack_native(archive, version, destination, unsigned=True):
    require(archive.name == archive_name(version, unsigned=unsigned), "wrong sidecar archive name")
    data = regular_file(archive)
    parts = regular_file(Path(str(archive) + ".sha256"), 256).decode("ascii").split()
    require(len(parts) == 2 and parts[1] == archive.name, "sidecar checksum filename mismatch")
    require(re.fullmatch(r"[0-9a-f]{64}", parts[0]) and digest(data) == parts[0],
            "sidecar archive checksum mismatch")
    expected = {f"darwin-{arch}/{BINARY}": (arch, cpu) for arch, cpu in ARCHITECTURES.items()}
    payloads = {}
    total = 0
    # Enforce the expansion ceiling before tarfile interprets PAX/GNU extension
    # records, whose declared sizes otherwise bypass the member checks below.
    expanded_limit = MAX_BYTES + 65_536
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
        expanded = compressed.read(expanded_limit + 1)
    require(len(expanded) <= expanded_limit, "sidecar archive exceeds expanded byte bound")
    with tarfile.open(fileobj=io.BytesIO(expanded), mode="r:") as source:
        for _ in range(len(expected)):
            member = source.next()
            require(member is not None and member.name in expected and member.name not in payloads
                    and member.isreg() and not member.pax_headers and 0 < member.size <= MAX_BYTES,
                    "sidecar archive must contain each bounded regular architecture once")
            total += member.size
            require(total <= MAX_BYTES, "sidecar payloads exceed the combined bound")
            contents = source.extractfile(member).read(member.size + 1)
            arch, cpu = expected[member.name]
            require(len(contents) == member.size and len(contents) >= 32
                    and struct.unpack("<II", contents[:8]) == (0xFEEDFACF, cpu)
                    and struct.unpack("<I", contents[12:16])[0] == 2,
                    f"payload must be an {arch} Mach-O executable")
            payloads[member.name] = contents
        require(source.next() is None, "sidecar archive has extra members")
    destination.mkdir(mode=0o700)
    result = {}
    for name, contents in payloads.items():
        target = destination / name
        target.parent.mkdir(mode=0o700)
        with target.open("xb") as output:
            output.write(contents)
        target.chmod(0o755)
        result[expected[name][0]] = target
    return result


def verify_sidecars(directory, arm64, x64):
    for arch, expected in (("arm64", arm64), ("x64", x64)):
        require(re.fullmatch(r"[0-9a-f]{64}", expected), "invalid signed sidecar hash")
        require(digest(regular_file(directory / f"darwin-{arch}" / BINARY)) == expected,
                "signed sidecar hash mismatch")


def apple_requirement():
    require(re.fullmatch(r"[A-Z0-9]{10}", TEAM_ID), "Apple team ID is not configured")
    return (f'identifier "{IDENTIFIER}" and anchor apple generic '
            'and certificate 1[field.1.2.840.113635.100.6.2.6] exists '
            'and certificate leaf[field.1.2.840.113635.100.6.1.13] exists '
            f'and certificate leaf[subject.OU] = "{TEAM_ID}"')


def run(command, timeout=60):
    # Apple tools need HOME for standard system services, never the caller's
    # credentials, provider environment, or arbitrary command search path.
    environment = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": os.environ["HOME"], "LC_ALL": "C"}
    try:
        result = subprocess.run([str(part) for part in command], capture_output=True,
                                text=True, timeout=timeout, env=environment, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(f"Apple tool failed or timed out: {Path(command[0]).name}") from None
    # Do not include argv or output: security takes passphrases on its command
    # line, and service errors can echo authentication inputs.
    require(result.returncode == 0, f"Apple tool failed: {Path(command[0]).name}")
    return result.stdout + result.stderr


def include_signing_keychain(keychain):
    # Trust evaluation must discover the imported Developer ID issuer chain.
    # Preserve the existing search order and append only this owned keychain.
    try:
        existing = shlex.split(run(["/usr/bin/security", "list-keychains", "-d", "user"]))
    except ValueError:
        raise SigningError("invalid keychain search list") from None
    require(len(existing) <= 64 and all(Path(item).is_absolute() and len(item) <= 4096
                                       for item in existing), "invalid keychain search list")
    if str(keychain) not in existing:
        run(["/usr/bin/security", "list-keychains", "-d", "user", "-s", *existing, keychain])


def private_file(path, data):
    with path.open("xb") as output:
        path.chmod(0o600)
        output.write(data)


def cleanup_credentials(work):
    credentials = work / "credentials"
    if not credentials.exists():
        return
    require(credentials.is_dir() and not credentials.is_symlink(), "unsafe credential directory")
    keychain = credentials / "signing.keychain-db"
    # The supported delete API also removes only this owned search-list entry,
    # preserving existing keychains and any concurrently added entries.
    try:
        if keychain.exists():
            run(["/usr/bin/security", "delete-keychain", keychain])
    finally:
        shutil.rmtree(credentials)


def checked_work(path):
    runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    require(path == runner_temp / "oh-sqlite-cli-apple-signing" and not path.is_symlink(),
            "signing work directory must be the dedicated runner temporary path")
    return path


def cleanup(work):
    checked_work(work)
    if work.exists():
        require(work.is_dir(), "unsafe signing work directory")
        cleanup_credentials(work)
        shutil.rmtree(work)


def diagnostic(path, receipt):
    # This small allowlisted receipt survives credential/work cleanup. Atomic
    # replacement preserves the latest known submission ID even on TERM.
    require(not path.is_symlink(), "unsafe notarization diagnostic path")
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf8", dir=path.parent,
                                     prefix=".oh-sqlite-cli-notarization-", delete=False) as output:
        temporary = Path(output.name)
        try:
            json.dump(receipt, output, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def sign(archive, version, output, work):
    requirement = apple_requirement()
    checked_work(work)
    require(sys.platform == "darwin", "Developer ID signing requires macOS")
    require(not output.exists(), "final output directory already exists")
    values = {name: os.environ.pop(name, "") for name in SECRET_NAMES}
    require(all(values.values()), "Apple signing credentials are incomplete")
    require(re.fullmatch(r"[A-Z0-9]{10}", values["APPLE_NOTARY_KEY_ID"]), "invalid notary key ID")
    require(re.fullmatch(UUID_PATTERN, values["APPLE_NOTARY_ISSUER_ID"]), "invalid notary issuer ID")
    receipt_path = work.with_name("oh-sqlite-cli-apple-notarization.json")
    require(not receipt_path.exists() and not receipt_path.is_symlink(), "notarization diagnostic already exists")
    work.mkdir(mode=0o700)
    try:
        binaries = unpack_native(archive, version, work / "payload")
        credentials = work / "credentials"
        credentials.mkdir(mode=0o700)
        keychain = credentials / "signing.keychain-db"
        p12 = credentials / "identity.p12"
        key = credentials / "AuthKey.p8"
        private_file(p12, base64.b64decode(values["APPLE_DEVELOPER_ID_P12_BASE64"], validate=True))
        private_file(key, base64.b64decode(values["APPLE_NOTARY_KEY_P8_BASE64"], validate=True))
        password = secrets.token_hex(32)
        try:
            run(["/usr/bin/security", "create-keychain", "-p", password, keychain])
            keychain.chmod(0o600)
            run(["/usr/bin/security", "set-keychain-settings", "-lut", "21600", keychain])
            run(["/usr/bin/security", "unlock-keychain", "-p", password, keychain])
            run(["/usr/bin/security", "import", p12, "-k", keychain,
                 "-P", values["APPLE_DEVELOPER_ID_P12_PASSWORD"], "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"])
            run(["/usr/bin/security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:",
                 "-s", "-k", password, keychain])
            include_signing_keychain(keychain)
            identities = run(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning", keychain])
            matches = re.findall(r'\b([0-9A-Fa-f]{40}) "Developer ID Application: [^"\n]+ \(' + TEAM_ID + r'\)"', identities)
            require(len(matches) == 1, "keychain must contain exactly one expected Developer ID Application identity")
            for binary in binaries.values():
                run(["/usr/bin/codesign", "--force", "--sign", matches[0], "--keychain", keychain,
                     "--identifier", IDENTIFIER, "--options", "runtime", "--timestamp",
                     "--requirements", "=designated => " + requirement, binary], timeout=180)
                run(["/usr/bin/codesign", "--verify", "--strict", "--test-requirement", "=" + requirement, binary])
                metadata = run(["/usr/bin/codesign", "--display", "--verbose=4", binary])
                require(f"Identifier={IDENTIFIER}\n" in metadata and f"TeamIdentifier={TEAM_ID}\n" in metadata,
                        "signed binary identity mismatch")
                require(re.search(r"^CodeDirectory .*flags=.*\(.*runtime.*\)", metadata, re.M)
                        and re.search(r"^Timestamp=.+", metadata, re.M), "signature needs hardened runtime and secure timestamp")
            submitted = work / "notarization.zip"
            with zipfile.ZipFile(submitted, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                for arch, binary in binaries.items():
                    bundle.write(binary, f"darwin-{arch}/{BINARY}")
            receipt = {
                "schemaVersion": 1, "version": version_value(version), "teamId": TEAM_ID,
                "identifier": IDENTIFIER, "submissionId": None, "state": "submission-started",
                "status": None, "unsignedArchiveSha256": digest(archive.read_bytes()),
                "signedBinarySha256": {arch: digest(binary.read_bytes()) for arch, binary in binaries.items()},
                "submissionZipSha256": digest(submitted.read_bytes()),
            }
            diagnostic(receipt_path, receipt)
            authentication = ["--key", key, "--key-id", values["APPLE_NOTARY_KEY_ID"],
                              "--issuer", values["APPLE_NOTARY_ISSUER_ID"], "--output-format", "json"]
            # Separate upload and wait so a first-time Apple review can time
            # out without losing the UUID. Never automatically resubmit.
            submission = json.loads(run(["/usr/bin/xcrun", "notarytool", "submit", submitted,
                                        *authentication], timeout=180))
            submission_id = str(submission.get("id", ""))
            require(re.fullmatch(UUID_PATTERN, submission_id), "missing notarization submission ID")
            receipt.update(submissionId=submission_id, state="submitted")
            diagnostic(receipt_path, receipt)
            print(f"Apple notarization submission {submission_id}; receipt oh-sqlite-cli-apple-notarization.json", flush=True)
            try:
                response = json.loads(run(["/usr/bin/xcrun", "notarytool", "wait", submission_id,
                                          *authentication, "--timeout", "15m"], timeout=960))
                require(response.get("id") == submission_id, "notarization result is for another submission")
            except BaseException:
                receipt["state"] = "wait-incomplete"
                diagnostic(receipt_path, receipt)
                raise
            # Do not copy arbitrary service response strings or logs into the
            # receipt. Only these public status values are retained.
            status = response.get("status")
            receipt.update(state="wait-complete", status=status if status in (
                "Accepted", "Invalid", "Rejected", "In Progress") else "Unrecognized")
            diagnostic(receipt_path, receipt)
            require(status == "Accepted", "Apple notarization was not Accepted")
            # Raw CLI tarballs cannot carry stapled tickets. Apple's online
            # notarization check must recognize the signed executable itself.
            for binary in binaries.values():
                run(["/usr/bin/codesign", "--verify", "--strict", "--check-notarization",
                     "--test-requirement", "=" + requirement, binary], timeout=180)
            receipt["state"] = "verified"
            diagnostic(receipt_path, receipt)
        finally:
            values.clear()
            password = ""
            cleanup_credentials(work)
        # Credential removal precedes final packaging and the later workflow
        # smoke step. Neither packaging nor signing executes the payload.
        output.mkdir(mode=0o700)
        final = output / archive_name(version)
        with tarfile.open(final, "w:gz", format=tarfile.USTAR_FORMAT) as bundle:
            for arch, binary in binaries.items():
                entry = tarfile.TarInfo(f"darwin-{arch}/{BINARY}")
                entry.size = binary.stat().st_size
                entry.mode = 0o755
                with binary.open("rb") as payload:
                    bundle.addfile(entry, payload)
        Path(str(final) + ".sha256").write_text(digest(final.read_bytes()) + "  " + final.name + "\n", encoding="ascii")
        print(f"Signed and notarized {final.name}; submission {response['id']}")
    finally:
        cleanup(work)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    extract = commands.add_parser("extract-artifact")
    extract.add_argument("archive", type=Path)
    extract.add_argument("digest")
    extract.add_argument("version", type=version_value)
    extract.add_argument("destination", type=Path)
    extract.add_argument("--signed", action="store_true")
    unpack = commands.add_parser("unpack-sidecars")
    unpack.add_argument("archive", type=Path)
    unpack.add_argument("version", type=version_value)
    unpack.add_argument("destination", type=Path)
    unpack.add_argument("--signed", action="store_true")
    verify = commands.add_parser("verify-sidecars")
    verify.add_argument("directory", type=Path)
    verify.add_argument("arm64")
    verify.add_argument("x64")
    signing = commands.add_parser("sign")
    signing.add_argument("archive", type=Path)
    signing.add_argument("version", type=version_value)
    signing.add_argument("output", type=Path)
    signing.add_argument("work", type=Path)
    cleaning = commands.add_parser("cleanup")
    cleaning.add_argument("work", type=Path)
    args = parser.parse_args()
    # GitHub cancellation sends TERM before KILL; unwind finally blocks while
    # possible. The workflow also has a separate always() cleanup step.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    os.umask(0o077)
    try:
        if args.command == "extract-artifact":
            unpack_artifact(args.archive, args.digest, args.version, args.destination, unsigned=not args.signed)
        elif args.command == "unpack-sidecars":
            unpack_native(args.archive, args.version, args.destination, unsigned=not args.signed)
        elif args.command == "verify-sidecars":
            verify_sidecars(args.directory, args.arm64, args.x64)
        elif args.command == "sign":
            sign(args.archive, args.version, args.output, args.work)
        else:
            cleanup(args.work)
    except Exception as error:
        # Only local controlled errors may reach logs, never Apple tool output.
        message = str(error) if isinstance(error, (SigningError, RuntimeError)) else type(error).__name__
        print(f"error: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
