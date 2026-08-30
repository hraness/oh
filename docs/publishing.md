# Publishing Oh

Oh is a public MIT package at `@hraness/oh`. A stable release is one exact set
of bytes, not a rebuild performed independently by each registry.

Before releasing, enable immutable GitHub Releases and configure npm trusted
publishing for repository `hraness/oh`, workflow `.github/workflows/release.yml`,
and package `@hraness/oh`. Do not add a long-lived npm token or publish from a
developer machine.

Keep an active no-bypass ruleset named `Immutable version tags`, scoped exactly
to `refs/tags/v*`. It allows creation, blocks updates and deletions, contains no
bypass actors, and must read back `current_user_can_bypass=never`. This is a
provider prerequisite; the workflow never weakens or rewrites it.

Before creating any stable tag, an owner with repository-administration read
access must save bounded JSON containing the repository readback and expanded
ruleset readbacks, then run `bun run release:preflight -- ADMIN_READBACK.json`.
The command fails unless immutable Releases are enabled and there is exactly one
active, no-bypass `refs/tags/v*` ruleset containing only update and deletion
restrictions. The tag workflow token intentionally lacks administration access,
so this pre-tag admin readback cannot be weakened or substituted by the
publication workflow.

## One-time npm coordinate bootstrap

If `@hraness/oh` still returns npm 404, npm cannot configure its trusted
publisher yet. Build and retain one exact tarball plus `SHA256SUMS` from the
already-public `v0.2.3` source after its historical complete gate passes, then
publish only that tarball with maintainer 2FA under the non-Latest `legacy`
dist-tag. Do not reuse the release workflow or make `v0.2.3` Latest.

After the coordinate exists, configure the permanent publisher with a current
npm client:

```sh
npm trust github @hraness/oh --repo hraness/oh --file release.yml --allow-publish --yes
```

Verify the publisher before preparing a new version. The bootstrap is the sole
traditional-credential exception; every later publication must use the tag
workflow's OIDC identity and cryptographically verified provenance. After the
first OIDC release succeeds, remove any traditional publish token that is not
needed for account recovery.

## Stable releases

Prepare the next stable version on `main`, including the matching compiled CLI
version and documentation. After required review and checks pass, create a new
annotated `v<version>` tag at a reviewed commit that remains an ancestor of
current `main`. Never reuse or move a tag.
Immutable releases through `v0.2.3` predate the exact npm-artifact path and have
no attached artifacts; leave them intact and use a new version for this path.

The tag workflow then:

1. proves the request is the newest stable annotated tag at a reviewed commit
   in current `main` history and that the package and CLI versions agree;
2. runs the complete repository gate, creates one npm tarball, and records its
   SHA-256 in `SHA256SUMS`;
3. installs and exercises that unchanged tarball on Ubuntu and macOS;
4. creates and reads back an exact `immutable: true` Latest GitHub Release in a
   dependency-free job with only `contents: write`, using the same tarball and
   `SHA256SUMS`—with exactly the same tarball and checksum bytes as the tested
   artifact; npm mutation cannot begin unless this proof succeeds;
5. publishes the tarball through a separate dependency-free job with only
   `id-token: write`, using npm trusted publishing with OIDC provenance, no
   GitHub token, and no traditional npm credential;
6. in a read-only job, installs the pinned Sigstore verifier and
   cryptographically proves npm provenance binds the tarball to the exact tag,
   commit, repository, and release workflow; and
7. downloads both public copies and admits their identities, digests, sizes,
   provenance, and byte equality.

GitHub's mutable `target_commitish` display field is not release authority when
the tag already exists. The workflow instead resolves the remote annotated tag
object to its exact commit before npm publication, before and after GitHub
Release creation, and again during public admission.

Neither irreversible writer runs dependency installation. Workflow artifacts
are selected by the immutable artifact IDs emitted by this exact run, including
a separate reviewed dependency-free npm-writer artifact; names alone are never
authority. No job receives both npm OIDC publication authority and GitHub
Release write authority. Initial and later authority accept only the same
reviewed release commit remaining an ancestor of current `main`, while the
annotated tag remains exact.
The workflow uses no npm token, GitHub App credential, deployment credential,
or private-data source. If an npm version already exists, publication succeeds
only when its immutable bytes and trusted-publisher provenance are exact. A
failed or partial release is recovered by rerunning the workflow; do not retag,
replace an npm version, or edit an immutable GitHub Release.

Every positive workflow attempt is an eligible recovery attempt for the same
reviewed annotated tag, commit, and ID-bound artifact bytes. Before npm, a
read-only gate treats the version as either absent or requires its exact bytes
and Sigstore provenance to bind the same `GITHUB_RUN_ID` and a positive attempt
no greater than `GITHUB_RUN_ATTEMPT`, including Fulcio extension OID
`1.3.6.1.4.1.57264.1.21`. If absent, the resulting publication must bind the
exact current run ID and attempt. Subsequent read-only admission may accept any
positive attempt only after the tag, commit, workflow, repository, signer, and
artifact digests are all cryptographically cross-bound.

If a failed GitHub API call leaves an exact-tag draft, the workflow fails closed
and reports that recovery is required. An owner must inspect the draft ID and
audit log out of band, prove it was created by this release run, and remove only
that task-owned draft before rerunning. The workflow never guesses ownership,
deletes a published Release, or uses mutable `target_commitish` as authority.
Draft author, title, body, tag, and target fields are mutable provider metadata,
not an unforgeable binding to the workflow run, tag object, commit, and artifact
digests. Consequently they are insufficient for safe autonomous deletion or
resume; recovery remains deliberately fail-closed.
