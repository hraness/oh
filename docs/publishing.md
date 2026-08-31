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
publish only that tarball with maintainer 2FA using the `legacy` dist-tag.
npm may also initialize `latest` to the only published version when first
creating the coordinate. Do not explicitly target `latest` for `v0.2.3`; the
first OIDC stable release must replace that bootstrap alias with its exact bytes.

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
authority. Dependency-free does not mean the repository writer is the only code
in a privileged job's trusted computing base. The GitHub writer also trusts the
SHA-pinned checkout, Bun setup, and artifact-download actions; the npm writer
trusts the SHA-pinned Bun setup, Node setup, and artifact-download actions. The
explicit `GH_TOKEN` environment variable is withheld from the job and supplied
only to the publication step, whose reviewed publisher rechecks remote tag and
branch authority before and after mutation. npm OIDC permission is job-scoped,
so its setup and download action pins remain release-control changes even though
the writer receives no GitHub token or traditional npm credential. No job
receives both npm OIDC publication authority and GitHub Release write authority.
Initial and later authority accept only the same reviewed release commit
remaining an ancestor of current `main`, while the annotated tag remains exact.
The workflow uses no npm token, GitHub App credential, deployment credential,
or private-data source. If an npm version already exists, publication succeeds
only when its immutable bytes and trusted-publisher provenance are exact. A
failed or partial release is recovered by rerunning the workflow; do not retag,
replace an npm version, or edit an immutable GitHub Release.

Every positive workflow attempt is an eligible recovery attempt for the same
reviewed annotated tag, commit, and ID-bound artifact bytes. Before npm, a
read-only gate records its explicit run ID and attempt and treats the version as
either absent or requires its exact bytes and Sigstore provenance to bind the
same run at a positive attempt no greater than that preflight attempt, including
Fulcio extension OID `1.3.6.1.4.1.57264.1.21`. The writer rejects another run,
reversed attempt ordering, and a same-attempt absent-to-existing race. A later
failed-job rerun retaining an earlier absent preflight may publish if the version
remains absent. If it instead observes exact bytes, it performs no mutation.

The writer always emits a nonempty provenance run and attempt constraint. A
writer that publishes an absent version emits its exact current attempt; a
read-only recovery emits a bounded maximum attempt. Final admission requires
that run to equal its own `GITHUB_RUN_ID`, requires the bound not to exceed its
own `GITHUB_RUN_ATTEMPT`, and cryptographically verifies the npm provenance
against it. Thus rerunning only final admission can safely reuse a successful
attempt-one publisher's exact attempt-one output, while blank or stale outputs
cannot relax admission.

If a GitHub API interruption leaves an exact-tag draft, a later attempt of that
same workflow run may complete it without deleting, retagging, or rebuilding
anything. Recovery first requires a structured successful API read or exact 404,
then an exhaustive bounded inventory containing exactly one draft ID for the tag.
That draft must have the GitHub Actions author, the exact release title and state,
and one canonical identity marker binding the repository ID, workflow ref, run
ID, creation attempt, annotated tag object, peeled commit, and the names, lengths,
and SHA-256 digests of both expected artifacts. The creation attempt must be
positive and no greater than the actual current run attempt. A draft from another
run, a future or reversed attempt, a duplicate draft, an edited marker, an extra
asset, or any different tag object, commit, name, length, digest, uploader, or
downloaded byte fails closed.

A published immutable Release is admitted only when that same exhaustive
inventory contains no matching draft. The writer inventories again after draft
publication and at final admission, so a leftover or concurrently introduced
same-tag draft cannot be silently carried into npm publication.

The recovery writer rechecks the annotated tag object, peeled commit, and current
`main` ancestry before creating the draft, before each missing-asset upload, and
before publication. Existing assets are downloaded by provider asset ID and
compared byte for byte; only a missing expected asset is uploaded. Publication
replaces the draft marker with the actual publication attempt, makes the fully
validated draft Latest, and immediately requires an exact immutable readback.
Later attempts admit that published Release only for the same run and a positive
publication attempt no greater than the current attempt. Metadata is never enough
by itself, the workflow never deletes a draft or edits a published Release, and
mutable `target_commitish` is neither required nor consulted as authority. The
remote annotated tag object and its peeled reviewed commit remain release
authority throughout.
