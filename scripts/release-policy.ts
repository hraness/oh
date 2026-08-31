type JsonRecord = Record<string, unknown>;

const SHA = /^[0-9a-f]{40}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const OIDC_CONFIG_ID = /^oidc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const publicPackageName = "@hraness/oh";
export const publicRepository = "hraness/oh";
export const publicRepositoryId = "1348230462";

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function text(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

export function releaseArchiveName(version: string): string {
  text(version, SEMVER, "release version");
  return `hraness-oh-${version}.tgz`;
}

export type NpmReleaseCoordinate = Readonly<{
  integrity: string;
  shasum: string;
  tarball: string;
}>;

export function parseNpmRelease(value: unknown, version: string): NpmReleaseCoordinate {
  text(version, SEMVER, "npm release version");
  const release = record(value, "npm release");
  if (release.name !== publicPackageName || release.version !== version || release.license !== "MIT") {
    throw new Error(`npm ${publicPackageName}@${version} has the wrong package identity or license.`);
  }
  const dist = record(release.dist, "npm release dist");
  const expectedTarball = `https://registry.npmjs.org/@hraness/oh/-/oh-${version}.tgz`;
  if (dist.tarball !== expectedTarball) throw new Error("npm release tarball URL is not canonical.");
  const npmUser = record(release._npmUser, "npm trusted publisher identity");
  const trustedPublisher = record(npmUser.trustedPublisher, "npm trusted publisher");
  const attestations = record(dist.attestations, "npm release provenance attestations");
  const provenance = record(attestations.provenance, "npm release provenance");
  const expectedAttestationUrl =
    `https://registry.npmjs.org/-/npm/v1/attestations/@hraness%2foh@${version}`;
  if (
    provenance.predicateType !== "https://slsa.dev/provenance/v1"
    || attestations.url !== expectedAttestationUrl
    || npmUser.name !== "GitHub Actions"
    || npmUser.email !== "npm-oidc-no-reply@github.com"
    || trustedPublisher.id !== "github"
    || typeof trustedPublisher.oidcConfigId !== "string"
    || !OIDC_CONFIG_ID.test(trustedPublisher.oidcConfigId)
  ) throw new Error("npm release trusted-publisher provenance is missing or invalid.");
  return Object.freeze({
    integrity: text(dist.integrity, SHA512_INTEGRITY, "npm release integrity"),
    shasum: text(dist.shasum, SHA1, "npm release SHA-1"),
    tarball: expectedTarball,
  });
}

export type GitHubReleaseAsset = Readonly<{
  browserDownloadUrl: string;
  digest: string;
  id: number;
  name: string;
  size: number;
}>;

export type GitHubReleaseCoordinate = Readonly<{
  checksum: GitHubReleaseAsset;
  tarball: GitHubReleaseAsset;
}>;

function parseAsset(value: unknown, expectedName: string, tag: string): GitHubReleaseAsset {
  const asset = record(value, `GitHub Release asset ${expectedName}`);
  const expectedUrl = `https://github.com/${publicRepository}/releases/download/${tag}/${expectedName}`;
  if (asset.name !== expectedName || asset.state !== "uploaded" || asset.browser_download_url !== expectedUrl) {
    throw new Error(`GitHub Release asset ${expectedName} has the wrong identity or state.`);
  }
  return Object.freeze({
    browserDownloadUrl: expectedUrl,
    digest: text(asset.digest, SHA256_DIGEST, `GitHub Release asset ${expectedName} digest`),
    id: positiveInteger(asset.id, `GitHub Release asset ${expectedName} id`),
    name: expectedName,
    size: positiveInteger(asset.size, `GitHub Release asset ${expectedName} size`),
  });
}

export function parseGitHubRelease(value: unknown, version: string): GitHubReleaseCoordinate {
  text(version, SEMVER, "GitHub release version");
  const tag = `v${version}`;
  const release = record(value, "GitHub Release");
  if (
    release.tag_name !== tag
    || release.draft !== false
    || release.prerelease !== false
    || release.immutable !== true
  ) throw new Error(`GitHub Release ${tag} is not exact, published, and immutable.`);
  if (!Array.isArray(release.assets) || release.assets.length !== 2) {
    throw new Error(`GitHub Release ${tag} must contain exactly two immutable artifacts.`);
  }
  const byName = new Map(release.assets.map((asset) => {
    const item = record(asset, "GitHub Release asset");
    return [item.name, asset] as const;
  }));
  if (byName.size !== 2) throw new Error(`GitHub Release ${tag} contains duplicate asset names.`);
  const archiveName = releaseArchiveName(version);
  return Object.freeze({
    checksum: parseAsset(byName.get("SHA256SUMS"), "SHA256SUMS", tag),
    tarball: parseAsset(byName.get(archiveName), archiveName, tag),
  });
}

export function assertReleaseAssetBytes(
  coordinate: GitHubReleaseCoordinate,
  tarballBytes: Uint8Array,
  checksumBytes: Uint8Array,
  sha256: (bytes: Uint8Array) => string,
): void {
  const tarballDigest = sha256(tarballBytes);
  const checksumDigest = sha256(checksumBytes);
  if (
    coordinate.tarball.size !== tarballBytes.byteLength
    || coordinate.tarball.digest !== `sha256:${tarballDigest}`
    || coordinate.checksum.size !== checksumBytes.byteLength
    || coordinate.checksum.digest !== `sha256:${checksumDigest}`
  ) throw new Error("GitHub Release asset size or digest does not match its immutable bytes.");
  const expectedChecksum = `${tarballDigest}  ${coordinate.tarball.name}\n`;
  if (new TextDecoder("utf-8", { fatal: true }).decode(checksumBytes) !== expectedChecksum) {
    throw new Error("SHA256SUMS does not describe the exact GitHub Release tarball.");
  }
}

const MAXIMUM_REGISTRY_BYTES = 128 * 1_024;

async function boundedJson(response: Response, label: string): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared)
    || Number(declared) > MAXIMUM_REGISTRY_BYTES)) {
    throw new Error(`${label} response exceeded its declared bound.`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error(`${label} did not return JSON.`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error(`${label} returned no response body.`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAXIMUM_REGISTRY_BYTES) throw new Error(`${label} response exceeded its bound.`);
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
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

export function registryVersionUrl(packageName: string, version: string): string {
  if (packageName !== publicPackageName) throw new Error("The public npm coordinate is invalid.");
  text(version, SEMVER, "registry version");
  return `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
}

export function classifyRegistryVersionPayload(
  value: unknown,
  packageName: string,
  version: string,
  endpoint: "latest" | "version" = "version",
): JsonRecord | null {
  if (packageName !== publicPackageName) throw new Error("The public npm coordinate is invalid.");
  text(version, SEMVER, "registry version");
  const label = `${packageName}@${version} registry version`;
  const payload = record(value, label);
  if (payload.name !== packageName) throw new Error(`${label} returned the wrong package coordinate.`);
  if (payload.version === version) return payload;
  if (payload.version !== undefined || payload._id !== packageName) {
    throw new Error(`${label} returned neither exact version metadata nor its exact package document.`);
  }
  if (endpoint === "latest") {
    const tags = record(payload["dist-tags"], `${packageName} registry distribution tags`);
    if (!Object.hasOwn(tags, "latest") || tags.latest !== version) {
      throw new Error(`${label} package document does not make the requested version latest.`);
    }
  }
  const versions = record(payload.versions, `${packageName} registry package versions`);
  if (!Object.hasOwn(versions, version)) return null;
  const release = record(versions[version], label);
  if (release.name !== packageName || release.version !== version) {
    throw new Error(`${label} package document contains an inexact version entry.`);
  }
  return release;
}

export async function registryVersionMetadata(
  response: Response,
  packageName: string,
  version: string,
  endpoint: "latest" | "version" = "version",
): Promise<JsonRecord | null> {
  const label = `${packageName}@${version} registry version`;
  if (response.status === 404) {
    const payload = await boundedJson(response, label);
    const absent = payload === "Not Found"
      || payload === `version not found: ${version}`
      || (typeof payload === "object" && payload !== null && !Array.isArray(payload)
        && Object.keys(payload).length === 1
        && ["Not Found", "Not found"].includes((payload as JsonRecord).error as string));
    if (!absent) throw new Error(`${label} returned an invalid missing-version response.`);
    return null;
  }
  if (response.status !== 200) throw new Error(`${label} returned HTTP ${String(response.status)}.`);
  return classifyRegistryVersionPayload(await boundedJson(response, label), packageName, version, endpoint);
}

export function assertSha(value: string, label: string): void {
  text(value, SHA, label);
}
