# Publishing Oh

Oh is a public MIT package at `@hraness/oh`. Each stable release is one npm
tarball, built once by the tag workflow, `.github/workflows/release.yml`, and
served byte for byte from both npm and an immutable GitHub Release. npm receives
it through npm trusted publishing with OIDC provenance, so no maintainer
credential touches the package.

## Before you release

### Repository settings

- Immutable GitHub Releases are enabled and enforced by the owner, and the
  repository `hraness/oh` is public.
- A ruleset named `Immutable version tags` is active, targets tags, includes
  exactly `refs/tags/v*`, and excludes nothing. Its only rules block tag updates
  and deletions, so creating a tag is allowed. It has no bypass actors, and the
  API reports `current_user_can_bypass=never`. The release workflow never
  changes this ruleset.
- The GitHub environment `npm-release` has `can_admins_bypass` set to false,
  no required reviewers or wait timer, and one custom deployment policy that
  allows only tags matching `v*`.

The workflow’s token has no administration permission and cannot read these
settings, so a maintainer with administration read access checks them before
each tag (see [Check the settings](#check-the-settings)).

### npm trusted publisher

npm trusts repository `hraness/oh`, workflow `.github/workflows/release.yml`,
and package `@hraness/oh` to run `npm publish`. The publishing job runs in the
protected `npm-release` environment, and the workflow rejects provenance that
does not name that environment. Do not add a long-lived npm token or publish
from a developer machine.

npm’s own [environment name condition is optional](https://docs.npmjs.com/trusted-publishers/#for-github-actions).
The configured publisher leaves it unset, so npm matches on the repository and
workflow alone. GitHub’s protections on `npm-release` and the workflow’s
provenance checks apply either way. Setting the condition narrows the publisher
further and is not needed before a routine release.

To create the publisher or add the condition, use npm 11.15.0 or later with
two-factor authentication on the account. npm keeps one trusted publisher per
package, so replace the configured one:

```sh
npm trust list @hraness/oh
npm trust revoke @hraness/oh --id=<id>
npm trust github @hraness/oh --repo hraness/oh --file release.yml --environment npm-release --allow-publish --yes
```

Run `npm trust list @hraness/oh` again to confirm the result before you prepare
a version. Delete any npm publish token that account recovery does not need.

### Check the settings

Run these commands from the repository root with a GitHub CLI session that can
read the repository’s administration settings.

1. Save the five API responses. The ruleset list omits each ruleset’s
   conditions and rules, so fetch each ruleset by ID.

   ```sh
   gh api repos/hraness/oh > repository.json
   gh api -H "X-GitHub-Api-Version: 2026-03-10" repos/hraness/oh/immutable-releases > immutable-releases.json
   gh api --paginate repos/hraness/oh/rulesets --jq '.[].id' | while read -r id; do gh api "repos/hraness/oh/rulesets/$id"; done > rulesets.jsonl
   gh api repos/hraness/oh/environments/npm-release > environment.json
   gh api repos/hraness/oh/environments/npm-release/deployment-branch-policies > environment-policies.json
   ```

2. Combine them into one file, `ADMIN_READBACK.json`:

   ```sh
   jq -n --slurpfile repository repository.json --slurpfile immutableReleases immutable-releases.json --slurpfile rulesets rulesets.jsonl --slurpfile environment environment.json --slurpfile environmentPolicies environment-policies.json '{repository: $repository[0], immutableReleases: $immutableReleases[0], rulesets: $rulesets, environment: $environment[0], environmentPolicies: $environmentPolicies[0]}' > ADMIN_READBACK.json
   ```

   The check accepts a file of at most 1 MiB holding at most 100 rulesets.

3. Run the check:

   ```sh
   bun run release:preflight -- ADMIN_READBACK.json
   ```

   It fails at the first setting that differs from the list above.

4. Delete the six JSON files.

## Release a version

1. Set the new version in `package.json`, `site/package.json`, and
   `OH_PACKAGE_VERSION` in `src/cli.ts`.
2. Update the version pins in `tests/public-surface.test.ts` and
   `site/tests/source.test.ts`.
3. Run `bun run check` and commit the rebuilt `dist/` files with the version
   change.
4. Open a pull request. Merge it after a person or agent who did not write it
   has reviewed it and the `Required` check has passed.
5. Run [Check the settings](#check-the-settings).
6. Create an annotated tag on the merged commit:

   ```sh
   git fetch origin main
   git tag -a v<version> -m "Oh <version>" <commit>
   ```

   The tag must be a stable `vMAJOR.MINOR.PATCH` name that matches the package
   version, point to a commit in `main`, and be the highest stable tag. Never
   reuse or move a tag.
7. Push the tag:

   ```sh
   git push origin v<version>
   ```

8. Follow the run:

   ```sh
   gh run list --workflow release.yml --limit 1
   gh run watch <run-id>
   ```

## What the workflow does

The `Release` workflow runs once per pushed `v*` tag, and two releases never
run at the same time. Its jobs run in this order:

1. `Build native sidecar` builds the `oh-sqlite-cli` binary for Linux x64,
   macOS arm64, and macOS x64.
2. `Verify and build exact release` checks the tag. It must arrive as a tag
   push, be annotated, be named `v` plus the version, be the newest stable tag,
   and point to a commit that is `HEAD` and an ancestor of `main`. `package.json`,
   `site/package.json`, and the compiled CLI must report the same version. The
   job then installs dependencies from the lockfile, runs `bun run check`, tests
   and builds the site, and fails if any of this changed the working tree. It
   adds the three sidecar binaries, packs one npm tarball, and writes its
   SHA-256 to `SHA256SUMS`.
3. `Exact tarball install` installs that tarball into an empty project on Ubuntu
   and macOS, then runs the CLI and loads the package under Bun and Node.js.
4. `Publish immutable GitHub Release` creates the Release `Oh v<version>`,
   marks it Latest, and serves it with exactly the same tarball and
   `SHA256SUMS` bytes that the install jobs tested. It downloads both files back
   and requires `immutable: true`. Nothing is published to npm unless this job
   succeeds.
5. `Admit npm retry state` confirms that npm either lacks the version or holds
   the same bytes published earlier by this run (see
   [How the npm jobs resume](#how-the-npm-jobs-resume)).
6. `Publish exact npm package` runs `npm publish --provenance` in the
   `npm-release` environment, then waits up to 10 minutes for the version and
   the `latest` tag to show the tarball’s integrity and shasum.
7. `Admit public release` downloads the tarball from npm and from the GitHub
   Release, checks each against the npm integrity field or `SHA256SUMS`,
   requires the two to match byte for byte, and verifies the npm provenance
   with the pinned Sigstore verifier. The Release must be Latest, and the
   provenance must name the tag, commit, repository, workflow, `npm-release`
   environment, and this run.

### Jobs that publish

Neither publishing job installs dependencies. Each downloads its files by the
artifact ID recorded earlier in the same run, never by name, including a
separate artifact that holds the npm publishing script. Both jobs also run
third-party actions pinned by commit SHA: checkout, Bun setup, and artifact
download in the GitHub job, and Bun setup, Node.js setup, and artifact download
in the npm job. A change to those pins needs the same review as a change to the
release scripts.

In the GitHub job, `GH_TOKEN` is set only on the publishing step, and that step
checks the remote tag and `main` before and after each write.
The npm OIDC permission is job-scoped: every step in the npm job can request a
token that npm accepts. That job has no GitHub token and no npm token, and no job holds
both npm OIDC and GitHub Release write permission. The workflow uses no GitHub
App credential, deployment credential, or private data.

Each check requires the same annotated tag object and the same commit, which
must be an ancestor of `main`. The workflow never uses the `target_commitish` field of a
GitHub Release. It resolves the remote tag through the API before and after
each GitHub write and again in the final job.

## Confirm the release

The release is complete when `Admit public release` passes. To look for
yourself:

```sh
npm view @hraness/oh dist-tags
gh release view v<version>
```

`latest` shows the version. The Release is titled `Oh v<version>`, is
immutable, and has two assets, `hraness-oh-<version>.tgz` and `SHA256SUMS`.

Then record the release in a pull request. Set `version` and `verificationRun`,
the URL of the release run, in `site/published-release.json`. Update the
install instructions in `README.md` and `skills/oh/SKILL.md` and the matching
pins in `tests/public-surface.test.ts` and the site tests.

## When a run fails

Never move, delete, or reuse a tag, replace an npm version, or edit a
published Release.
Never weaken provenance, manually publish the npm half of a GitHub-only release,
or publish different bytes under the failed tag.

- **A transient failure**, such as a network error or an API outage: rerun the
  failed jobs.

  ```sh
  gh run rerun <run-id> --failed
  ```

  The rerun reuses the tarball from the first attempt and resumes where the
  run stopped. Workflow artifacts expire after seven days, so rerun within
  that window. Rerunning every job rebuilds the tarball, and the workflow stops
  if those bytes differ from anything already published.
- **A failure that repeats on every rerun**, caused by a defect in the
  workflow or its scripts: leave npm and GitHub as they are, whether nothing
  was published or only the GitHub Release exists. Fix the defect on `main`
  and release the next patch version under a new tag.
- **GitHub rejects the tag push** under `immutable_release_tag`: the name is
  reserved, even though the tag and Release endpoints return 404, and no
  workflow runs. Release the next patch version.

### How the GitHub Release job resumes

If an API error leaves a draft for the tag, a later attempt of the
same workflow run may complete it without deleting, retagging, or rebuilding
anything.

The job first reads the tag’s Release and accepts only a successful response
or a 404. It then lists every draft, up to 1,000, and requires at most one for
the tag. After creating a draft, it polls the list of drafts for up to 30
seconds, because GitHub may not list a new draft at once. An empty list keeps
it waiting. Any other draft ID fails the job.

A later attempt may create a draft only when the Actions Jobs API proves that,
in every earlier attempt of the same run, the Release job was skipped or its
publishing step was skipped before any release code ran. Immediately before
creating the draft, the job again requires that the tag has no Release and no
draft. If an earlier publishing step may have run, the later attempt waits for
that draft or Release to appear instead of creating a second one.

The draft must be authored by GitHub Actions and carry the expected title,
state, and one identity marker. The marker records the repository ID, workflow
ref, run ID, creating attempt, annotated tag object, commit, and the name,
length, and SHA-256 of both assets. The creating attempt must be positive and
no greater than the current one. The job fails on a draft from another run or
a later attempt, a second draft, an edited marker, an extra asset, or any
difference in tag object, commit, file name, length, digest, uploader, or
downloaded bytes.

The job checks the tag object, its commit, and `main` again before creating the
draft, before each upload, and before publishing. It downloads each asset
already on the draft by ID and compares it byte for byte, and uploads only the
assets that are missing. Publishing keeps the creating attempt in the marker,
adds the attempt that published the Release, marks the Release Latest, and
requires `immutable: true`. A later attempt accepts that published Release only
from the same run, with a publishing attempt no greater than its own. The job
lists drafts again after publishing and before it exits, and fails if any
draft for the tag remains. It never deletes a draft or edits a published
Release.

### How the npm jobs resume

`Admit npm retry state` records its run ID and attempt. It accepts an npm
version that is absent, or one whose bytes match and whose Sigstore provenance
names the same run at an attempt no greater than its own. The provenance
certificate must carry Fulcio extension OID `1.3.6.1.4.1.57264.1.21`, the
environment name `npm-release` in OID `1.3.6.1.4.1.57264.1.23`, and the
repository subject with numeric IDs in OID `.24`. The certificate identity and
OIDs `.6`, `.14`, `.18`, and `.19` bind the tag, workflow, and commit.

The publishing script rejects provenance from another run, attempts out of
order, and a version that appears between the check and the publish in the
same attempt. A rerun of failed jobs that reuses an earlier “absent” result
publishes only if the version is absent. If it finds the same bytes, it
publishes nothing.

The publishing script always reports the run and attempt that the provenance
must name. After a publish, that is its own attempt. After finding the version
already present, it is the highest attempt the provenance may name. `Admit
public release` requires that run to be its own and that attempt to be no
greater than its own, then verifies the provenance against both. A rerun of
only the final job can therefore reuse a successful first attempt’s result,
and an empty or outdated result fails.

## Tags that are not full releases

The tags below are protected and stay as they are. Each fix shipped under a
later version.

- **`v0.1.0` through `v0.2.3`** are immutable Releases from before the npm
  workflow, with no files attached.
- **Package name bootstrap.** npm cannot configure a trusted publisher for a
  package that does not exist yet. The tarball built from the `v0.2.3` source
  was published once by hand, with maintainer two-factor authentication, under
  the `legacy` dist-tag, which points to it.
  npm may also initialize `latest` when a package is first created.
  Do not explicitly target `latest` for `v0.2.3`; the first release from the
  tag workflow replaced it. That was the only publish with a personal
  credential, and every later publication must use the tag workflow’s OIDC
  identity and verified provenance.
- **`v0.2.4`.** The protected `v0.2.4` tag records a release attempt that
  failed before any GitHub Release or npm publish. Nothing was published.
- **`v0.2.5`.** The protected `v0.2.5` tag records the next release attempt.
  Its tarball passed every check and both installs, and its immutable GitHub
  Release is published. A missing `await` in the npm retry check then failed
  every rerun before npm. Never publish `@hraness/oh@0.2.5`, and do not treat
  the GitHub-only Release as a supported npm version. The fix shipped as
  `v0.2.6`.
- **`v0.2.6`.** The protected `v0.2.6` tag and the tarball its run built are
  published as an immutable GitHub Release and on npm, with provenance from run
  `33358569648`, attempt 1. Only the final check failed: its signer policy
  expected Fulcio OIDs `1.3.6.1.4.1.57264.1.11` through `.24` as raw ASCII
  instead of their canonical DER UTF8String bytes, and expected the `.24`
  subject in an older form without owner and repository numeric IDs. The fix
  shipped as `v0.2.7`.
- **`v0.4.0`.** The protected `v0.4.0` tag and the tarball its run built are
  published as an immutable GitHub Release and on npm, with provenance from run
  `34024027946`, attempt 1. Only the final check failed. The certificate
  carries `npm-release` in OID `1.3.6.1.4.1.57264.1.23` and the subject
  `repo:hraness@307125679/oh@1348230462:environment:npm-release` in OID `.24`,
  but the policy ignored `.23` and expected a `.24` subject naming the ref. The
  tag, commit, workflow, repository ID, event, and run claims are
  required. The fix shipped as `v0.4.1`.
- **`v0.10.1`.** The version check loaded the optional support dependency
  before dependencies were installed, so the run stopped before anything was
  published. The fix shipped as `v0.10.2`.
- **`v0.10.4`.** The run was cancelled while the macOS x64 sidecar build waited
  for a `macos-13` runner that was never assigned. Nothing was published.
  `v0.10.5` builds that sidecar on `macos-14`.
- **`v0.10.5`.** `Exact tarball install` failed because the package text scan
  flagged Rust build paths inside the sidecar binaries. Nothing was published.
  `v0.10.6` exempts the three sidecar binaries from that scan.

GitHub rejected these tag pushes under `immutable_release_tag`, so no workflow
ran and no Release or npm version exists:

| Tag | Rule suite | Released as | Changes |
| --- | --- | --- | --- |
| `v0.6.0` | not recorded | `v0.6.1` | Research profile changes |
| `v0.7.0` | `4056944341` | `v0.7.1` | Source relationship additions, with schema, catalog, and preview digests unchanged |
| `v0.8.0` | `4072119912` | `v0.8.1` | Ontology depth changes, with ontology contracts and digests unchanged |
