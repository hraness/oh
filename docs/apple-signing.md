# Mac helper signing

The next release signs the arm64 and x64 Mac helpers with Apple Developer ID
team `8AAP53VTW3` and the stable identifier `dev.hraness.oh.sqlite-cli`. Each
helper uses hardened runtime and a secure timestamp. Publication requires one
Accepted Apple notarization submission for the two exact signed helpers.

Compilation and source checks run without Apple credentials. Only the tag-only
`hraness-apple-release` GitHub environment supplies credentials to the isolated
signing job. That environment has no manual reviewers or wait timer. The signing
program never executes the input binary or installs dependencies. Its temporary
keychain, certificate and API key are removed before any package smoke runs.

The release verifies the original upload artifact digest, the final signed
archive and checksum hashes, and each architecture's signed bytes before
creating the npm package. The manifest is generated after signing; stripping or
rebuilding a signed helper is forbidden. The exact npm archive is installed and
exercised before the same bytes are published to GitHub and npm.

The packaged default helper is checked with `/usr/bin/codesign` before native
execution. The check requires the Developer ID certificate, team and identifier,
and rejects a file that changes during verification. The explicit development
path `HRANESS_OH_SQLITE_CLI_PATH` remains available for locally built or
caller-managed helpers. Release package smoke clears that override.

A notarization timeout is not an automatic retry. The non-secret receipt keeps
the submission UUID, submitted archive hash and signed helper hashes so its
status can be reconciled before another submission. Signing tests mock Apple
commands; they do not demonstrate a live certificate or service acceptance.

Developer ID establishes a stable app identity across versions. macOS still
controls protected-data approvals, which depend on the responsible app and the
user's privacy settings; signing does not grant new access by itself.
