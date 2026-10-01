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
Include the Developer ID intermediate certificate in the P12 certificate chain.
The signing program appends its temporary keychain to the existing user search
list so macOS can evaluate that chain; deleting the owned keychain removes its
entry while preserving other keychains.

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
A separate macOS regression signs a synthetic executable ad hoc to check literal
requirement parsing and rejection by the real publisher verifier.

The retained 0.14.0 submission can be checked by the separate
`Retained Apple notarization status` workflow. Its new annotated diagnostic tag,
`v0.14.0-notarization-status.N`, must point at current reviewed `main`. The existing
immutable `v*` tag rules and tag-only Apple environment apply. This tag pattern is
excluded from the ordinary release workflow.

The diagnostic verifies the original release run, annotated release tag, receipt
artifact digest and exact receipt bytes before querying the original UUID once.
It receives only the Notary API key, never the Developer ID certificate, and
cannot sign, submit, publish or start an automatic wait. Its result records Apple
status only. The failed run did not preserve the signed helper payloads, so even
an Accepted response cannot establish an installable 0.14.0 package or authorize
recreating and resubmitting its missing bytes. Recovery needs a separately
reviewed plan after the original status is known.

A failed diagnostic records a numeric child exit code and one fixed error
classification after removing its credentials. It never retains raw Apple
messages or private key material, and an error classification is only a hint
about the failed query. Status stays unknown and package admission stays false.
Any further query needs reviewed source, passing CI and a new immutable
diagnostic tag; the previous run and tag remain intact.

Developer ID establishes a stable app identity across versions. macOS still
controls protected-data approvals, which depend on the responsible app and the
user's privacy settings; signing does not grant new access by itself.
