import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyNpmProvenance } from "./npm-provenance-verification";
import { parseNpmProvenanceAdmission } from "./release-attempt-policy";
import {
  assertReleaseAssetBytes,
  parseGitHubRelease,
  parseNpmRelease,
  publicPackageName,
  publicRepository,
} from "./release-policy";

const MAXIMUM_JSON_BYTES = 512 * 1_024;
const MAXIMUM_ARTIFACT_BYTES = 64 * 1_024 * 1_024;

function required(name: string, pattern?: RegExp): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0 || (pattern !== undefined && !pattern.test(value))) {
    throw new Error(`Public release admission requires valid ${name}.`);
  }
  return value;
}

async function readBounded(response: Response, label: string, maximum: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > maximum)) {
    throw new Error(`${label} exceeded its declared bound.`);
  }
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error(`${label} returned no response body.`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) throw new Error(`${label} exceeded its byte bound.`);
      chunks.push(item.value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* the bounded result remains authoritative */ }
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchJson(
  url: string,
  label: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache", ...headers },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200) throw new Error(`${label} returned HTTP ${String(response.status)}.`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/vnd.github+json") {
    throw new Error(`${label} did not return JSON.`);
  }
  const bytes = await readBounded(response, label, MAXIMUM_JSON_BYTES);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

async function fetchArtifact(url: string, label: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", "User-Agent": "oh-release-admission" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200) throw new Error(`${label} returned HTTP ${String(response.status)}.`);
  return readBounded(response, label, MAXIMUM_ARTIFACT_BYTES);
}

if (required("GITHUB_REPOSITORY") !== publicRepository) {
  throw new Error(`Public release admission must run in ${publicRepository}.`);
}
const token = required("GITHUB_TOKEN");
const verifiedSha = required("VERIFIED_SHA", /^[0-9a-f]{40}$/u);
const verifiedTag = required(
  "VERIFIED_TAG",
  /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u,
);
const manifest = JSON.parse(await readFile(resolve(import.meta.dir, "..", "package.json"), "utf8")) as Readonly<{
  license?: unknown;
  name?: unknown;
  version?: unknown;
}>;
if (
  manifest.name !== publicPackageName
  || manifest.license !== "MIT"
  || typeof manifest.version !== "string"
  || verifiedTag !== `v${manifest.version}`
) throw new Error("Public package, MIT license, version, and release tag do not agree.");

const registryBase = `https://registry.npmjs.org/${encodeURIComponent(publicPackageName)}`;
const [versionPayload, latestPayload] = await Promise.all([
  fetchJson(`${registryBase}/${encodeURIComponent(manifest.version)}`, "npm exact version"),
  fetchJson(`${registryBase}/latest`, "npm latest version"),
]);
const npmVersion = parseNpmRelease(versionPayload, manifest.version);
const npmLatest = parseNpmRelease(latestPayload, manifest.version);
if (npmLatest.integrity !== npmVersion.integrity || npmLatest.shasum !== npmVersion.shasum) {
  throw new Error("npm latest does not resolve to the exact verified version bytes.");
}
const npmTarball = await fetchArtifact(npmVersion.tarball, "npm release tarball");
if (
  `sha512-${createHash("sha512").update(npmTarball).digest("base64")}` !== npmVersion.integrity
  || createHash("sha1").update(npmTarball).digest("hex") !== npmVersion.shasum
) throw new Error("npm release tarball bytes do not match registry integrity metadata.");
const provenanceAdmission = parseNpmProvenanceAdmission({
  admissionAttempt: required("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u),
  admissionRunId: required("GITHUB_RUN_ID", /^[1-9][0-9]*$/u),
  provenanceAttempt: required("NPM_PROVENANCE_ATTEMPT", /^[1-9][0-9]*$/u),
  provenanceAttemptMode: required("NPM_PROVENANCE_ATTEMPT_MODE", /^(?:exact|maximum)$/u),
  provenanceRunId: required("NPM_PROVENANCE_RUN_ID", /^[1-9][0-9]*$/u),
});
await verifyNpmProvenance(npmTarball, {
  ...provenanceAdmission,
  verifiedSha,
  verifiedTag,
  version: manifest.version,
});

const githubHeaders = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "oh-release-admission",
  "X-GitHub-Api-Version": "2026-03-10",
};
const apiBase = `https://api.github.com/repos/${publicRepository}`;
const reference = await fetchJson(
  `${apiBase}/git/ref/tags/${encodeURIComponent(verifiedTag)}`,
  "GitHub annotated tag ref",
  githubHeaders,
) as Readonly<{ object?: Readonly<{ sha?: unknown; type?: unknown; url?: unknown }> }>;
if (
  reference.object?.type !== "tag"
  || typeof reference.object.sha !== "string"
  || !/^[0-9a-f]{40}$/u.test(reference.object.sha)
  || reference.object.url !== `${apiBase}/git/tags/${reference.object.sha}`
) throw new Error("GitHub release ref is not one exact annotated tag object.");
const tag = await fetchJson(reference.object.url, "GitHub annotated tag", githubHeaders) as Readonly<{
  object?: Readonly<{ sha?: unknown; type?: unknown }>;
  tag?: unknown;
}>;
if (tag.tag !== verifiedTag || tag.object?.type !== "commit" || tag.object.sha !== verifiedSha) {
  throw new Error("GitHub annotated tag does not target the verified release commit.");
}
const branch = required("DEFAULT_BRANCH", /^[A-Za-z0-9._/-]+$/u);
const branchRef = await fetchJson(`${apiBase}/git/ref/heads/${branch}`, "GitHub default branch", githubHeaders) as Readonly<{
  object?: Readonly<{ sha?: unknown; type?: unknown }>;
}>;
const branchSha = branchRef.object?.sha;
const comparison = await fetchJson(
  `${apiBase}/compare/${verifiedSha}...${encodeURIComponent(branch)}`,
  "GitHub reviewed-main ancestry",
  githubHeaders,
) as Readonly<{ base_commit?: Readonly<{ sha?: unknown }>; head_commit?: Readonly<{ sha?: unknown }>; merge_base_commit?: Readonly<{ sha?: unknown }>; status?: unknown }>;
if (
  branchRef.object?.type !== "commit"
  || typeof branchSha !== "string"
  || !["ahead", "identical"].includes(String(comparison.status))
  || comparison.base_commit?.sha !== verifiedSha
  || comparison.merge_base_commit?.sha !== verifiedSha
  || comparison.head_commit?.sha !== branchSha
) throw new Error("Reviewed release commit is not an ancestor of current main.");
const [releasePayload, latestRelease] = await Promise.all([
  fetchJson(`${apiBase}/releases/tags/${encodeURIComponent(verifiedTag)}`, "GitHub Release", githubHeaders),
  fetchJson(`${apiBase}/releases/latest`, "Latest GitHub Release", githubHeaders),
]);
if ((latestRelease as Readonly<{ tag_name?: unknown }>).tag_name !== verifiedTag) {
  throw new Error("Latest GitHub Release is not the admitted stable release.");
}
const release = parseGitHubRelease(releasePayload, manifest.version);
const [githubTarball, githubChecksum] = await Promise.all([
  fetchArtifact(release.tarball.browserDownloadUrl, "GitHub Release tarball"),
  fetchArtifact(release.checksum.browserDownloadUrl, "GitHub Release checksum"),
]);
assertReleaseAssetBytes(
  release,
  githubTarball,
  githubChecksum,
  (bytes) => createHash("sha256").update(bytes).digest("hex"),
);
if (!Buffer.from(githubTarball).equals(Buffer.from(npmTarball))) {
  throw new Error("npm and GitHub do not expose the same exact release tarball bytes.");
}

console.log(`Public release admission passed for ${publicPackageName}@${manifest.version}.`);
console.log("- npm: exact MIT latest package with cryptographically verified trusted-publisher provenance");
console.log("- GitHub: exact annotated tag and immutable tarball plus SHA256SUMS with identical bytes");
