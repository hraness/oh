import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  assertReleaseAssetBytes,
  parseGitHubRelease,
  publicPackageName,
  publicRepository,
  releaseArchiveName,
} from "./release-policy";
import { verifyRemoteReleaseAuthority } from "./verify-release-authority";
import { githubReleaseEnvironment } from "./release-process-environment";
import { runBoundedProcess, type BoundedProcessResult } from "./run-bounded-process";

const [tagArgument, tarballArgument, checksumArgument, extra] = process.argv.slice(2);
if (tagArgument === undefined || tarballArgument === undefined || checksumArgument === undefined || extra !== undefined) {
  throw new Error("Usage: publish-github-release.ts TAG ARTIFACT.tgz SHA256SUMS");
}
const verifiedSha = process.env.VERIFIED_SHA;
if (verifiedSha === undefined || !/^[0-9a-f]{40}$/u.test(verifiedSha)) {
  throw new Error("GitHub Release publication requires one verified release commit.");
}
const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "package.json"), "utf8")) as Readonly<{
  name?: unknown;
  version?: unknown;
}>;
if (manifest.name !== publicPackageName || typeof manifest.version !== "string") {
  throw new Error("The public package manifest identity is invalid.");
}
if (tagArgument !== `v${manifest.version}`) throw new Error(`Release tag must be v${manifest.version}.`);
const tarball = resolve(tarballArgument);
const checksum = resolve(checksumArgument);
if (basename(tarball) !== releaseArchiveName(manifest.version) || basename(checksum) !== "SHA256SUMS") {
  throw new Error("Release artifact names do not match the public package coordinate.");
}
const tarballInformation = statSync(tarball);
const checksumInformation = statSync(checksum);
if (
  !tarballInformation.isFile()
  || tarballInformation.size <= 0
  || tarballInformation.size > 64 * 1_024 * 1_024
  || !checksumInformation.isFile()
  || checksumInformation.size <= 0
  || checksumInformation.size > 256
) throw new Error("Release artifacts are not finite regular files within their public bounds.");
const tarballBytes = readFileSync(tarball);
const checksumBytes = readFileSync(checksum);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function run(command: string[]): Promise<BoundedProcessResult> {
  const result = await runBoundedProcess(command, { env: githubReleaseEnvironment(), stderrBytes: 128 * 1_024, stdoutBytes: 512 * 1_024, timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
  return result;
}

async function readRelease(): Promise<unknown> {
  return JSON.parse((await run([
    "gh", "api", `/repos/${publicRepository}/releases/tags/${tagArgument}`,
  ])).stdout.toString()) as unknown;
}

export function residualDrafts(value: unknown, tag: string): readonly number[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("GitHub draft inventory is not bounded.");
  const identifiers: number[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error("GitHub draft inventory is malformed.");
    const release = item as Record<string, unknown>;
    if (release.draft === true && release.tag_name === tag) {
      if (!Number.isSafeInteger(release.id) || Number(release.id) <= 0) throw new Error("Residual release draft has no safe identifier.");
      identifiers.push(Number(release.id));
    }
  }
  return Object.freeze(identifiers);
}

await verifyRemoteReleaseAuthority();
const existing = await runBoundedProcess(["gh", "api", `/repos/${publicRepository}/releases/tags/${tagArgument}`], {
  env: githubReleaseEnvironment(),
  stderrBytes: 128 * 1_024,
  stdoutBytes: 512 * 1_024,
  timeoutMs: 30_000,
});
if (existing.exitCode === 0) {
  const coordinate = parseGitHubRelease(JSON.parse(existing.stdout.toString()) as unknown, manifest.version);
  assertReleaseAssetBytes(coordinate, tarballBytes, checksumBytes, sha256);
  const directory = mkdtempSync(join(tmpdir(), "oh-release-assets-"));
  try {
    await run([
      "gh", "release", "download", tagArgument, "--repo", publicRepository,
      "--dir", directory, "--pattern", basename(tarball), "--pattern", basename(checksum),
    ]);
    for (const source of [tarball, checksum]) {
      if (!readFileSync(source).equals(readFileSync(join(directory, basename(source))))) {
        throw new Error(`GitHub Release ${tagArgument} contains different ${basename(source)} bytes.`);
      }
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  console.log(`GitHub Release ${tagArgument} already contains the exact immutable artifacts.`);
} else {
  const failure = existing.stderr.toString("utf8");
  if (!/release not found|HTTP 404|Not Found/iu.test(failure)) {
    throw new Error(`Could not determine whether GitHub Release ${tagArgument} exists.`);
  }
  const drafts = residualDrafts(JSON.parse((await run([
    "gh", "api", `/repos/${publicRepository}/releases?per_page=100&page=1`,
  ])).stdout.toString()) as unknown, tagArgument);
  if (drafts.length !== 0) {
    throw new Error(`Residual draft for ${tagArgument} requires documented task-owned recovery before publication.`);
  }
  await run([
    "gh", "release", "create", tagArgument, tarball, checksum,
    "--repo", publicRepository,
    "--generate-notes",
    "--latest",
    "--verify-tag",
    "--title", `Oh ${tagArgument}`,
  ]);
  const coordinate = parseGitHubRelease(await readRelease(), manifest.version);
  assertReleaseAssetBytes(coordinate, tarballBytes, checksumBytes, sha256);
  console.log(`Created immutable GitHub Release ${tagArgument} from the exact npm tarball bytes.`);
}
const latest = JSON.parse((await run([
  "gh", "api", `/repos/${publicRepository}/releases/latest`,
])).stdout.toString()) as Readonly<{ tag_name?: unknown }>;
if (latest.tag_name !== tagArgument) throw new Error(`Latest GitHub Release is not ${tagArgument}.`);
await verifyRemoteReleaseAuthority();
