## Outcome

Describe what changed, why it changed, and what a user can now observe.

## Contract impact

Name the invariant this change affects, for example that sync accepts only
fast-forward history. If the change alters what Oh stores or exchanges, such
as records, operations, digests, the SQLite schema, sync bundles, or embedding
profiles, name each changed format and the new version that carries it. Write
`no wire change` if those bytes stay the same.

## Verification

- [ ] I added or updated focused regression tests or fixtures.
- [ ] If a public behavior or limit changed, I updated the matching
  specification pages and machine-readable files and copied the `spec/`
  changes into `site/public/spec/`.
- [ ] `bun run check` passes, locally or in a CI run that meets the conditions
  linked below.
- [ ] After the check, no tracked file is modified and no new untracked file
  appears.
- [ ] I inspected the package contents with
  `bun pm pack --dry-run --ignore-scripts`.
- [ ] This pull request contains no credentials or private research data.

If CI stands in for the final local check under the conditions in
[CONTRIBUTING.md](https://github.com/hraness/oh/blob/main/CONTRIBUTING.md#validate-a-pull-request),
record the run URLs, the tested merge SHA, the head SHA, the base SHA, and the
conclusions here.
