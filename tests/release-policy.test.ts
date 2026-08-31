import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  assertReleaseAssetBytes,
  classifyRegistryVersionPayload,
  parseGitHubRelease,
  parseNpmRelease,
  registryVersionMetadata,
  releaseArchiveName,
} from "../scripts/release-policy";
import {
  assertRemoteReleaseAuthority,
  releaseTagObjectSha,
} from "../scripts/verify-release-authority";

const version = "1.2.3";
const tarball = new TextEncoder().encode("exact Oh npm package bytes");
const tarballDigest = createHash("sha256").update(tarball).digest("hex");
const checksum = new TextEncoder().encode(`${tarballDigest}  ${releaseArchiveName(version)}\n`);
const checksumDigest = createHash("sha256").update(checksum).digest("hex");

function npmRelease(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    _npmUser: {
      email: "npm-oidc-no-reply@github.com",
      name: "GitHub Actions",
      trustedPublisher: { id: "github", oidcConfigId: "oidc:12345678-1234-1234-1234-123456789abc" },
    },
    dist: {
      attestations: {
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
        url: `https://registry.npmjs.org/-/npm/v1/attestations/@hraness%2foh@${version}`,
      },
      integrity: "sha512-QUJDRA==",
      shasum: "b".repeat(40),
      tarball: `https://registry.npmjs.org/@hraness/oh/-/oh-${version}.tgz`,
    },
    license: "MIT",
    name: "@hraness/oh",
    version,
    ...overrides,
  };
}

function githubRelease(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    assets: [
      {
        browser_download_url: `https://github.com/hraness/oh/releases/download/v${version}/${releaseArchiveName(version)}`,
        digest: `sha256:${tarballDigest}`,
        id: 1,
        name: releaseArchiveName(version),
        size: tarball.byteLength,
        state: "uploaded",
      },
      {
        browser_download_url: `https://github.com/hraness/oh/releases/download/v${version}/SHA256SUMS`,
        digest: `sha256:${checksumDigest}`,
        id: 2,
        name: "SHA256SUMS",
        size: checksum.byteLength,
        state: "uploaded",
      },
    ],
    draft: false,
    immutable: true,
    prerelease: false,
    tag_name: `v${version}`,
    ...overrides,
  };
}

describe("release distribution policy", () => {
  test("derives the scoped npm pack filename", () => {
    expect(releaseArchiveName(version)).toBe("hraness-oh-1.2.3.tgz");
    expect(() => releaseArchiveName("latest")).toThrow("release version");
  });

  test("requires exact public MIT trusted-publisher npm metadata", () => {
    expect(parseNpmRelease(npmRelease(), version)).toEqual({
      integrity: "sha512-QUJDRA==",
      shasum: "b".repeat(40),
      tarball: `https://registry.npmjs.org/@hraness/oh/-/oh-${version}.tgz`,
    });
    expect(() => parseNpmRelease(npmRelease({ license: "UNLICENSED" }), version)).toThrow("identity");
    expect(() => parseNpmRelease(npmRelease({ _npmUser: { name: "token publisher" } }), version))
      .toThrow();
    const wrong = npmRelease() as Record<string, unknown>;
    const dist = { ...(wrong.dist as Record<string, unknown>) };
    dist.attestations = {
      provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      url: `https://registry.npmjs.org/-/npm/v1/attestations/@attacker%2foh@${version}`,
    };
    expect(() => parseNpmRelease({ ...wrong, dist }, version)).toThrow("provenance");
  });

  test("classifies exact metadata and a bounded full package document", async () => {
    const exact = npmRelease();
    const other = npmRelease({ version: "1.2.2" });
    const packument = {
      _id: "@hraness/oh",
      name: "@hraness/oh",
      versions: { "1.2.2": other },
    };
    expect(classifyRegistryVersionPayload(exact, "@hraness/oh", version)).toEqual(exact);
    expect(classifyRegistryVersionPayload(packument, "@hraness/oh", version)).toBeNull();
    expect(classifyRegistryVersionPayload({
      ...packument,
      versions: { ...packument.versions, [version]: exact },
    }, "@hraness/oh", version)).toEqual(exact);
    expect(() => classifyRegistryVersionPayload({
      ...packument,
      "dist-tags": { latest: "1.2.2" },
      versions: { ...packument.versions, [version]: exact },
    }, "@hraness/oh", version, "latest")).toThrow("does not make the requested version latest");
    expect(classifyRegistryVersionPayload({
      ...packument,
      "dist-tags": { latest: version },
      versions: { ...packument.versions, [version]: exact },
    }, "@hraness/oh", version, "latest")).toEqual(exact);
    expect(() => classifyRegistryVersionPayload({ ...packument, _id: "@attacker/oh" }, "@hraness/oh", version))
      .toThrow("neither exact version metadata nor its exact package document");
    expect(() => classifyRegistryVersionPayload({ ...packument, versions: { [version]: other } }, "@hraness/oh", version))
      .toThrow("inexact version entry");
    const inherited = Object.create({ [version]: exact }) as Record<string, unknown>;
    expect(classifyRegistryVersionPayload({ ...packument, versions: inherited }, "@hraness/oh", version)).toBeNull();

    const response = new Response(JSON.stringify(packument), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
    expect(await registryVersionMetadata(response, "@hraness/oh", version, "version")).toBeNull();
  });

  test("requires two exact immutable GitHub assets and their bytes", () => {
    const release = parseGitHubRelease(githubRelease(), version);
    expect(() => assertReleaseAssetBytes(
      release,
      tarball,
      checksum,
      (bytes) => createHash("sha256").update(bytes).digest("hex"),
    )).not.toThrow();
    expect(() => parseGitHubRelease(githubRelease({ immutable: false }), version)).toThrow("immutable");
    expect(() => parseGitHubRelease(githubRelease({ assets: [] }), version)).toThrow("exactly two");
    expect(() => assertReleaseAssetBytes(
      release,
      new TextEncoder().encode("different"),
      checksum,
      (bytes) => createHash("sha256").update(bytes).digest("hex"),
    )).toThrow("size or digest");
  });

  test("binds a full annotated tag and reviewed-main ancestry", () => {
    const sha = "a".repeat(40);
    const tag = `v${version}`;
    const objectSha = "b".repeat(40);
    const reference = {
      ref: `refs/tags/${tag}`,
      object: {
        sha: objectSha,
        type: "tag",
        url: `https://api.github.com/repos/hraness/oh/git/tags/${objectSha}`,
      },
    };
    expect(releaseTagObjectSha(reference, tag)).toBe(objectSha);
    expect(() => releaseTagObjectSha({
      ...reference,
      object: { ...reference.object, type: "commit" },
    }, tag)).toThrow("annotated tag object");
    const annotated = { tag, object: { sha, type: "commit" } };
    const head = { ref: "refs/heads/main", object: { sha, type: "commit" } };
    const comparison = {
      ahead_by: 0,
      base_commit: { sha },
      behind_by: 0,
      merge_base_commit: { sha },
      status: "identical",
      total_commits: 0,
      url: `https://api.github.com/repos/hraness/oh/compare/${sha}...${sha}`,
    };
    expect(() => assertRemoteReleaseAuthority(annotated, head, comparison, head, { branch: "main", sha, tag }))
      .not.toThrow();
    const next = "c".repeat(40);
    const nextHead = {
      ...head,
      object: { ...head.object, sha: next },
    };
    expect(() => assertRemoteReleaseAuthority(annotated, nextHead, {
      ahead_by: 1,
      base_commit: { sha },
      behind_by: 0,
      merge_base_commit: { sha },
      status: "ahead",
      total_commits: 1,
      url: `https://api.github.com/repos/hraness/oh/compare/${sha}...${next}`,
    }, nextHead,
    { branch: "main", sha, tag })).not.toThrow();
    expect(() => assertRemoteReleaseAuthority(annotated, head, {
      ...comparison, status: "diverged", merge_base_commit: { sha: next },
    }, head, { branch: "main", sha, tag })).toThrow("not an ancestor");
    expect(() => assertRemoteReleaseAuthority(
      annotated, head, comparison, nextHead, { branch: "main", sha, tag },
    )).toThrow("moved");
    expect(() => assertRemoteReleaseAuthority(
      annotated, nextHead, comparison, nextHead, { branch: "main", sha, tag },
    )).toThrow("not an ancestor");
  });
});
