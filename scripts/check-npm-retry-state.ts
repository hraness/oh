import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { verifyNpmProvenance } from "./npm-provenance-verification";
import { parseNpmRelease, publicPackageName, registryVersionMetadata, registryVersionUrl, releaseArchiveName } from "./release-policy";

function required(name: string, pattern: RegExp): string {
  const value = process.env[name];
  if (value === undefined || !pattern.test(value)) throw new Error(`npm retry state requires valid ${name}.`);
  return value;
}
const [argument, extra] = process.argv.slice(2);
if (argument === undefined || extra !== undefined) throw new Error("Usage: check-npm-retry-state.ts ARTIFACT.tgz");
const tarball = resolve(argument);
const bytes = await readFile(tarball);
if (bytes.byteLength <= 0 || bytes.byteLength > 64 * 1_024 * 1_024) throw new Error("npm retry artifact is not finite.");
const manifest = JSON.parse(await readFile(resolve(import.meta.dir, "..", "package.json"), "utf8")) as { name?: unknown; version?: unknown };
if (manifest.name !== publicPackageName || typeof manifest.version !== "string" || basename(tarball) !== releaseArchiveName(manifest.version)) {
  throw new Error("npm retry artifact coordinate is invalid.");
}
const response = await fetch(registryVersionUrl(publicPackageName, manifest.version), {
  cache: "no-store", headers: { Accept: "application/json", "Cache-Control": "no-cache", "User-Agent": "oh-release-retry" },
  redirect: "error", signal: AbortSignal.timeout(10_000),
});
const metadata = registryVersionMetadata(response, publicPackageName, manifest.version);
const output = required("GITHUB_OUTPUT", /^.{1,4096}$/u);
const runId = required("GITHUB_RUN_ID", /^[1-9][0-9]*$/u);
const attemptText = required("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u);
const attempt = Number(attemptText);
if (!Number.isSafeInteger(attempt)) throw new Error("npm retry state requires a safe positive GITHUB_RUN_ATTEMPT.");
if (metadata === null) {
  await Bun.write(output, `npm_state=absent\npreflight_run_id=${runId}\npreflight_run_attempt=${attemptText}\n`);
  console.log("Exact npm version is absent; the current positive attempt may first-publish reviewed bytes.");
} else {
  const release = parseNpmRelease(metadata, manifest.version);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const shasum = createHash("sha1").update(bytes).digest("hex");
  if (release.integrity !== integrity || release.shasum !== shasum) throw new Error("Existing npm version has different immutable bytes.");
  const tarballResponse = await fetch(release.tarball, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const declared = Number(tarballResponse.headers.get("content-length"));
  if (tarballResponse.status !== 200 || !Number.isSafeInteger(declared) || declared !== bytes.byteLength || declared > 64 * 1_024 * 1_024) {
    throw new Error("Existing npm tarball response is not exactly bounded.");
  }
  const remote = new Uint8Array(await tarballResponse.arrayBuffer());
  if (!Buffer.from(remote).equals(bytes)) throw new Error("Existing npm tarball differs from the reviewed artifact.");
  await verifyNpmProvenance(remote, {
    maximumAttempt: attempt,
    requiredRunId: runId,
    verifiedSha: required("VERIFIED_SHA", /^[0-9a-f]{40}$/u),
    verifiedTag: required("VERIFIED_TAG", /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u),
    version: manifest.version,
  });
  await Bun.write(output, `npm_state=exact_same_run\npreflight_run_id=${runId}\npreflight_run_attempt=${attemptText}\n`);
  console.log("Existing exact npm version is cryptographically bound to this run at an allowed positive attempt.");
}
