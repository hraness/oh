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
    "contents: write",
    "check-npm-trusted-publishing.ts",
    "verify-release-authority.ts",
    "publish-npm-release.ts artifacts/*.tgz",
    'publish-github-release.ts "$VERIFIED_TAG" artifacts/*.tgz artifacts/SHA256SUMS',
    "check-public-release.ts",
  ] as const) expect(workflow).toContain(required);

  expect(workflow).not.toContain("release:\n    types: [published]");
  expect(workflow).not.toContain("workflow_dispatch:");
  expect(workflow).not.toMatch(/\$\{\{\s*secrets\./u);
  expect(workflow.match(/^\s+contents: write$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+id-token: write$/gmu)).toHaveLength(1);
  const githubJob = workflow.slice(workflow.indexOf("  publish_github:"), workflow.indexOf("  publish_npm:"));
  const npmJob = workflow.slice(workflow.indexOf("  publish_npm:"), workflow.indexOf("  pre_npm:"));
  expect(npmJob).toContain("id-token: write");
  expect(npmJob).not.toContain("contents: write");
  expect(githubJob).toContain("contents: write");
  expect(githubJob).not.toContain("id-token: write");
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
  const [npmPublisher, provenance, githubPublisher, admission, authority] = await Promise.all([
    readFile(join(root, "scripts/publish-npm-release.ts"), "utf8"),
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
  expect(npmPublisher.indexOf("fetchMetadata(registryUrl)")).toBeLessThan(npmPublisher.indexOf("fetchMetadata(registryLatestUrl)"));
  expect(npmPublisher).toContain("Date.now() + 180_000");
  expect(npmPublisher).not.toContain("NODE_AUTH_TOKEN");
  expect(npmPublisher).not.toContain("process.stdout.write");
  expect(npmPublisher).not.toContain("process.stderr.write");
  expect(provenance).toContain('"audit", "signatures", "--json", "--include-attestations"');
  expect(provenance).toContain('workflow.path !== ".github/workflows/release.yml"');
  expect(provenance).toContain("sourceDigest.gitCommit !== coordinate.verifiedSha");
  expect(provenance).toContain("publicReleaseEnvironment");
  expect(provenance).toContain("verify-npm-provenance-signer.mjs");
  expect(githubPublisher.match(/verifyRemoteReleaseAuthority\(\);/gu)).toHaveLength(2);
  expect(githubPublisher).toContain('"--latest"');
  expect(githubPublisher).toContain("parseGitHubRelease");
  expect(authority).toContain('tagObject.type !== "tag"');
  expect(authority).toContain("target.sha !== input.sha");
  expect(authority).toContain('["ahead", "identical"]');
  expect(authority).toContain("mergeBase.sha !== input.sha");
  expect(admission).toContain("verifyNpmProvenance(npmTarball");
  expect(admission).toContain("parseNpmProvenanceAdmission({");
  expect(admission).toContain('required("NPM_PROVENANCE_RUN_ID"');
  expect(admission).toContain('required("NPM_PROVENANCE_ATTEMPT_MODE"');
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
  expect(guide).toContain("non-Latest `legacy`");
  expect(guide).toContain("npm trust github @hraness/oh --repo hraness/oh --file release.yml");
  expect(guide).toContain("every later publication must use the tag");
});
