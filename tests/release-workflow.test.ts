import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("the stable-tag workflow publishes only one validated exact artifact set", async () => {
  const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  for (const required of [
    'tags:\n      - "v*"',
    "group: stable-release",
    "cancel-in-progress: false",
    "fetch-depth: 0",
    "persist-credentials: false",
    'git cat-file -t "$REQUESTED_TAG"',
    'tag_commit="$(git rev-parse --verify "refs/tags/$REQUESTED_TAG^{commit}")"',
    'default_head="$(git rev-parse --verify "origin/$DEFAULT_BRANCH^{commit}")"',
    "newest_stable_tag=",
    "bun run check",
    "npm pack --ignore-scripts --pack-destination artifacts .",
    "release-artifact-checksum.ts write",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "matrix:\n        os: [ubuntu-24.04, macos-14]",
    "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
    "artifact-ids: ${{ needs.verify.outputs.artifact_id }}",
    "artifact-ids: ${{ needs.verify.outputs.writer_artifact_id }}",
    "package-smoke.ts artifacts/*.tgz",
    "id-token: write",
    "actions: read",
    "contents: write",
    "RELEASE_REPOSITORY_ID: ${{ github.repository_id }}",
    "RELEASE_RUN_ATTEMPT: ${{ github.run_attempt }}",
    "RELEASE_RUN_ID: ${{ github.run_id }}",
    "RELEASE_WORKFLOW_REF: ${{ github.workflow_ref }}",
    "check-npm-trusted-publishing.ts",
    "publish-npm-release.ts artifacts/*.tgz",
    'publish-github-release.ts "$VERIFIED_TAG" artifacts/*.tgz artifacts/SHA256SUMS',
    "check-public-release.ts",
  ] as const) expect(workflow).toContain(required);

  expect(workflow).not.toContain("release:\n    types: [published]");
  expect(workflow).not.toContain("workflow_dispatch:");
  expect(workflow).not.toMatch(/\$\{\{\s*secrets\./u);
  expect(workflow.match(/^\s+contents: write$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+id-token: write$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+actions: read$/gmu)).toHaveLength(1);
  const githubJob = workflow.slice(workflow.indexOf("  publish_github:"), workflow.indexOf("  publish_npm:"));
  const npmJob = workflow.slice(workflow.indexOf("  publish_npm:"), workflow.indexOf("  pre_npm:"));
  expect(npmJob).toContain("id-token: write");
  expect(npmJob).not.toContain("contents: write");
  expect(githubJob).toContain("contents: write");
  expect(githubJob).toContain("actions: read");
  expect(githubJob).not.toContain("id-token: write");
  const githubPublicationMarker = "      - name: Create and prove immutable GitHub Release from the exact bytes";
  const githubPublicationOffset = githubJob.indexOf(githubPublicationMarker);
  expect(githubPublicationOffset).toBeGreaterThan(0);
  expect(githubJob.slice(0, githubPublicationOffset)).not.toContain("GH_TOKEN");
  expect(githubJob.slice(githubPublicationOffset)).toContain(
    "env:\n          GH_TOKEN: ${{ github.token }}\n        run: bun run ./scripts/publish-github-release.ts",
  );
  expect(githubJob.match(/GH_TOKEN/gu)).toHaveLength(1);
  expect(githubJob).not.toContain("bun install");
  expect(npmJob).not.toContain("bun install");
  expect(npmJob).not.toContain("GH_TOKEN");
  expect(npmJob).not.toContain("GITHUB_TOKEN");
  expect(npmJob).not.toContain("verifyNpmProvenance");
  expect(workflow).toContain("needs: [verify, publish_github, pre_npm]");
  expect(workflow).toContain("check-npm-retry-state.ts artifacts/*.tgz");
  expect(workflow).toContain("preflight_run_attempt: ${{ steps.state.outputs.preflight_run_attempt }}");
  expect(workflow).toContain("PRE_NPM_RUN_ATTEMPT: ${{ needs.pre_npm.outputs.preflight_run_attempt }}");
  expect(workflow).toContain("provenance_attempt: ${{ steps.publish.outputs.provenance_attempt }}");
  expect(workflow).toContain("NPM_PROVENANCE_ATTEMPT: ${{ needs.publish_npm.outputs.provenance_attempt }}");
  expect(workflow.match(/npm pack --ignore-scripts --pack-destination artifacts \./gu)).toHaveLength(1);

  const pack = workflow.indexOf("npm pack --ignore-scripts --pack-destination artifacts .");
  const validation = workflow.indexOf("package-smoke.ts artifacts/*.tgz");
  const github = workflow.indexOf("publish-github-release.ts");
  const npm = workflow.indexOf("publish-npm-release.ts artifacts/*.tgz");
  const admission = workflow.indexOf("check-public-release.ts");
  expect(validation).toBeGreaterThan(pack);
  expect(npm).toBeGreaterThan(validation);
  expect(npm).toBeGreaterThan(github);
  expect(admission).toBeGreaterThan(github);
});

test("ID-bound artifacts extract directly into every consumer directory", async () => {
  const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  const downloads = [...workflow.matchAll(
    /uses: actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4\n\s+with:\n\s+artifact-ids: ([^\n]+)\n\s+path: ([^\n]+)\n\s+merge-multiple: true/gu,
  )].map((match) => ({ id: match[1]?.trim(), path: match[2]?.trim() }));

  expect(downloads).toEqual([
    { id: "${{ needs.verify.outputs.artifact_id }}", path: "artifacts" },
    { id: "${{ needs.verify.outputs.artifact_id }}", path: "artifacts" },
    { id: "${{ needs.verify.outputs.artifact_id }}", path: "artifacts" },
    { id: "${{ needs.verify.outputs.writer_artifact_id }}", path: "writer" },
    { id: "${{ needs.verify.outputs.artifact_id }}", path: "artifacts" },
  ]);
  expect(workflow).toContain("release-artifact-checksum.ts check artifacts/*.tgz artifacts/SHA256SUMS");
  expect(workflow).toContain("bun run ./writer/scripts/check-npm-trusted-publishing.ts");
});

test("publication is tokenless, bounded, provenance-bound, and idempotent only for exact bytes", async () => {
  const [npmPublisher, npmRetry, provenance, githubPublisher, admission, authority] = await Promise.all([
    readFile(join(root, "scripts/publish-npm-release.ts"), "utf8"),
    readFile(join(root, "scripts/check-npm-retry-state.ts"), "utf8"),
    readFile(join(root, "scripts/npm-provenance-verification.ts"), "utf8"),
    readFile(join(root, "scripts/publish-github-release.ts"), "utf8"),
    readFile(join(root, "scripts/check-public-release.ts"), "utf8"),
    readFile(join(root, "scripts/verify-release-authority.ts"), "utf8"),
  ]);
  expect(npmPublisher).toContain('"npm", "publish", tarball');
  expect(npmPublisher).toContain('"--provenance"');
  expect(npmPublisher).toContain("expectedIntegrity");
  expect(npmPublisher).toContain("expectedShasum");
  expect(npmPublisher).toContain("planNpmPublication({");
  expect(npmPublisher).toContain("PRE_NPM_STATE");
  expect(npmPublisher).toContain("PRE_NPM_RUN_ID");
  expect(npmPublisher).toContain("PRE_NPM_RUN_ATTEMPT");
  expect(npmPublisher).toContain("provenance_attempt_mode=");
  expect(npmPublisher).not.toContain("verifyNpmProvenance");
  expect(npmPublisher.indexOf('fetchMetadata(registryUrl, "version")')).toBeLessThan(
    npmPublisher.indexOf('fetchMetadata(registryLatestUrl, "latest")'),
  );
  expect(npmPublisher).toContain("Date.now() + 180_000");
  expect(npmPublisher).toContain('fetchMetadata(registryUrl, "version")');
  expect(npmPublisher).toContain('fetchMetadata(registryLatestUrl, "latest")');
  expect(npmPublisher).not.toContain("NODE_AUTH_TOKEN");
  expect(npmPublisher).not.toContain("process.stdout.write");
  expect(npmPublisher).not.toContain("process.stderr.write");
  expect(npmRetry).toContain(
    "const metadata: Record<string, unknown> | null = await registryVersionMetadata(",
  );
  expect(provenance).toContain('"audit", "signatures", "--json", "--include-attestations"');
  expect(provenance).toContain('workflow.path !== ".github/workflows/release.yml"');
  expect(provenance).toContain("sourceDigest.gitCommit !== coordinate.verifiedSha");
  expect(provenance).toContain("publicReleaseEnvironment");
  expect(provenance).toContain("verify-npm-provenance-signer.mjs");
  expect(githubPublisher.match(/verifyRemoteReleaseAuthority\(\);/gu)).toHaveLength(2);
  expect(githubPublisher).toContain('"--raw-field", "make_latest=true"');
  expect(githubPublisher).toContain('"--include", `/repos/${publicRepository}/releases/tags/${tagArgument}`');
  expect(githubPublisher).toContain("lookup.state === \"draft\"");
  expect(githubPublisher).toContain("planReleaseRecovery(lookup, initialDraftIds)");
  expect(githubPublisher).toContain("waitForCreatedDraftInventory(draft.id)");
  expect(githubPublisher).toContain("const deadline = Date.now() + 30_000");
  expect(githubPublisher).toContain("classifyCreatedDraftInventory(await matchingDraftIds(), id)");
  expect(githubPublisher).toContain("waitForPublishedDraftInventory(draft.id, identityInput)");
  expect(githubPublisher).toContain("waitForLaterAttemptProviderState(identityInput)");
  expect(githubPublisher).toContain("assertConvergingPublishedIdentity(id, input)");
  expect(githubPublisher).toContain("draft.assetIds.size !== assets.length");
  expect(githubPublisher).toContain("currentAttemptCanCreateDraft(identityInput)");
  expect(githubPublisher).toContain("process.env.GITHUB_SHA !== input.commitSha");
  expect(githubPublisher).toContain("priorAttemptProvesNoDraftCreation(jobs");
  expect(githubPublisher).toContain("actions/runs/${input.run.runId}/attempts/${String(attempt)}/jobs");
  const providerSnapshotOffset = githubPublisher.indexOf("let initialDraftIds = await matchingDraftIds()");
  const priorMutationOffset = githubPublisher.indexOf("const priorMayHaveMutated = runIdentity.attempt > 1");
  const laterConvergenceOffset = githubPublisher.indexOf("if (priorMayHaveMutated)", priorMutationOffset);
  const directDraftOffset = githubPublisher.indexOf('else if (lookup.state === "draft")', laterConvergenceOffset);
  expect(providerSnapshotOffset).toBeGreaterThan(-1);
  expect(priorMutationOffset).toBeGreaterThan(providerSnapshotOffset);
  expect(laterConvergenceOffset).toBeGreaterThan(priorMutationOffset);
  expect(directDraftOffset).toBeGreaterThan(laterConvergenceOffset);
  expect(githubPublisher.slice(laterConvergenceOffset, directDraftOffset)).toContain(
    "await waitForLaterAttemptProviderState(identityInput)",
  );
  const convergenceHelperOffset = githubPublisher.indexOf("async function waitForLaterAttemptProviderState");
  const createAuthorityOffset = githubPublisher.indexOf("async function currentAttemptCanCreateDraft", convergenceHelperOffset);
  const convergenceHelper = githubPublisher.slice(convergenceHelperOffset, createAuthorityOffset);
  expect(convergenceHelper).toContain("for (;;)");
  expect(convergenceHelper.indexOf("await readReleaseTagLookup()")).toBeLessThan(
    convergenceHelper.indexOf("await matchingDraftIds()"),
  );
  expect(convergenceHelper).toContain('lookup.state === "draft"');
  expect(convergenceHelper).toContain("classifyCreatedDraftInventory(draftIds, draft.id)");
  expect(convergenceHelper).toContain('lookup.state === "published"');
  expect(convergenceHelper).toContain("classifyPublishedDraftInventory(draftIds, id)");
  expect(githubPublisher).toContain("const freshLookup = await readReleaseTagLookup()");
  expect(githubPublisher).toContain('if (freshPlan.state !== "create")');
  expect(githubPublisher.indexOf("let initialDraftIds = await matchingDraftIds();")).toBeLessThan(
    githubPublisher.indexOf('if (plan.state === "published")'),
  );
  expect(githubPublisher).toContain("ambiguous residual draft at final admission");
  expect(githubPublisher).toContain("assertExactReleaseAssetBytes");
  expect(githubPublisher).toContain("`https://uploads.github.com/repos/${publicRepository}/releases/${String(current.id)}/assets?name=${encodeURIComponent(asset.name)}`");
  expect(githubPublisher).not.toContain('"gh", "release", "upload"');
  expect(githubPublisher).not.toContain("target_commitish");
  expect(githubPublisher).toContain("parseGitHubRelease");
  expect(authority).toContain('tagObject.type !== "tag"');
  expect(authority).toContain("target.sha !== input.sha");
  expect(authority).toContain("expectedComparisonUrl");
  expect(authority).toContain("mergeBase.sha !== input.sha");
  expect(authority).not.toContain("comparison.head_commit");
  expect(authority.match(/git\/ref\/heads\/\$\{branch\}/gu)).toHaveLength(2);
  expect(admission).toContain("verifyNpmProvenance(npmTarball");
  expect(admission).toContain("parseNpmProvenanceAdmission({");
  expect(admission).toContain('required("NPM_PROVENANCE_RUN_ID"');
  expect(admission).toContain('required("NPM_PROVENANCE_ATTEMPT_MODE"');
  expect(admission).toContain("finalBranchRef");
  expect(admission).toContain("`${apiBase}/compare/${verifiedSha}...${branchSha}`");
  expect(admission).not.toContain("comparison.head_commit");
  expect(admission).toContain("Buffer.from(githubTarball).equals(Buffer.from(npmTarball))");
});

test("release controls have explicit ownership and document the public MIT boundary", async () => {
  const [owners, guide] = await Promise.all([
    readFile(join(root, ".github/CODEOWNERS"), "utf8"),
    readFile(join(root, "docs/publishing.md"), "utf8"),
  ]);
  expect(owners).toBe(
    "/.github/workflows/** @0thernet\n"
    + "/.github/CODEOWNERS @0thernet\n"
    + "/package.json @0thernet\n"
    + "/bun.lock @0thernet\n"
    + "/tsconfig*.json @0thernet\n"
    + "/LICENSE @0thernet\n"
    + "/src/cli.ts @0thernet\n"
    + "/dist/** @0thernet\n"
    + "/scripts/check-npm-trusted-publishing.ts @0thernet\n"
    + "/scripts/check-public-release.ts @0thernet\n"
    + "/scripts/check-release-provider-preflight.ts @0thernet\n"
    + "/scripts/check-npm-retry-state.ts @0thernet\n"
    + "/scripts/npm-provenance-* @0thernet\n"
    + "/scripts/verify-npm-provenance-* @0thernet\n"
    + "/scripts/verify-release-authority.ts @0thernet\n"
    + "/scripts/package-smoke.ts @0thernet\n"
    + "/scripts/publish-* @0thernet\n"
    + "/scripts/release-* @0thernet\n"
    + "/docs/publishing.md @0thernet\n",
  );
  expect(guide).toContain("public MIT package at `@hraness/oh`");
  expect(guide).toContain("one npm tarball");
  expect(guide).toContain("npm trusted publishing with OIDC provenance");
  expect(guide).toContain("with exactly the same tarball and");
  expect(guide).toContain("Do not add a long-lived npm token");
  expect(guide).toContain("npm may also initialize `latest`");
  expect(guide).toContain("Do not explicitly target `latest` for `v0.2.3`");
  expect(guide).toContain("protected `v0.2.4` tag records a release-control attempt");
  expect(guide).toContain("protected `v0.2.5` tag records the next release-control attempt");
  expect(guide).toContain("`@hraness/oh@0.2.5` must remain absent");
  expect(guide).toContain("protected `v0.2.6` tag and exact same-run bytes are published");
  expect(guide).toContain("canonical DER UTF8String bytes");
  expect(guide).toContain("without owner and repository numeric IDs");
  expect(guide).toContain("manually publish the npm half of a GitHub-only release");
  expect(guide).toContain("writer polls that bounded inventory briefly");
  expect(guide).toContain("A later attempt may create a draft only when the Actions Jobs API proves");
  expect(guide).toContain("npm trust github @hraness/oh --repo hraness/oh --file release.yml");
  expect(guide).toContain("every later publication must use the tag");
  expect(guide).toContain("privileged job's trusted computing base");
  expect(guide).toContain("npm OIDC permission is job-scoped");
  expect(guide).toContain("same workflow run may complete it");
  expect(guide).toContain("actual publication attempt");
  expect(guide).toContain("`target_commitish` is neither required nor consulted as authority");
});
