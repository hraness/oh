import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  parseNpmRelease,
  publicPackageName,
  registryVersionMetadata,
  registryVersionUrl,
  releaseArchiveName,
  type NpmReleaseCoordinate,
} from "./release-policy";
import { trustedPublishingEnvironment } from "./release-process-environment";
import { planNpmPublication, type NpmRetryState } from "./release-attempt-policy";

function required(name: string, pattern: RegExp): string {
  const value = process.env[name];
  if (value === undefined || !pattern.test(value)) throw new Error(`npm publication requires valid ${name}.`);
  return value;
}

const [tarballArgument, extra] = process.argv.slice(2);
if (tarballArgument === undefined || extra !== undefined) {
  throw new Error("Usage: publish-npm-release.ts ARTIFACT.tgz");
}
const tarball = resolve(tarballArgument);
const information = await stat(tarball);
if (!information.isFile() || information.size <= 0 || information.size > 64 * 1_024 * 1_024) {
  throw new Error("npm publication requires one finite release tarball.");
}
const bytes = await readFile(tarball);
const expectedIntegrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const expectedShasum = createHash("sha1").update(bytes).digest("hex");
const verifiedSha = process.env.VERIFIED_SHA;
const verifiedTag = process.env.VERIFIED_TAG;
const runId = required("GITHUB_RUN_ID", /^[1-9][0-9]*$/u);
const runAttempt = required("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u);
const preNpmState = process.env.PRE_NPM_STATE;
const preflightRunId = required("PRE_NPM_RUN_ID", /^[1-9][0-9]*$/u);
const preflightAttempt = required("PRE_NPM_RUN_ATTEMPT", /^[1-9][0-9]*$/u);
const output = required("GITHUB_OUTPUT", /^.{1,4096}$/u);
if (verifiedSha === undefined || !/^[0-9a-f]{40}$/u.test(verifiedSha)) {
  throw new Error("npm publication requires one verified release commit.");
}
if (preNpmState !== "absent" && preNpmState !== "exact_same_run") throw new Error("npm publication requires an admitted retry state.");

const manifest = JSON.parse(await Bun.file(resolve(import.meta.dir, "..", "package.json")).text()) as Readonly<{
  license?: unknown;
  name?: unknown;
  publishConfig?: Readonly<{ access?: unknown; provenance?: unknown; registry?: unknown }>;
  version?: unknown;
}>;
if (
  manifest.name !== publicPackageName
  || manifest.license !== "MIT"
  || typeof manifest.version !== "string"
  || manifest.publishConfig?.access !== "public"
  || manifest.publishConfig.provenance !== true
  || manifest.publishConfig.registry !== "https://registry.npmjs.org"
) throw new Error("The public npm package identity or publication policy is invalid.");
if (verifiedTag !== `v${manifest.version}`) {
  throw new Error(`npm publication requires verified tag v${manifest.version}.`);
}
if (basename(tarball) !== releaseArchiveName(manifest.version)) {
  throw new Error("npm publication tarball name does not match the package coordinate.");
}
const coordinate = `${manifest.name}@${manifest.version}`;
const registryUrl = registryVersionUrl(manifest.name, manifest.version);
const registryLatestUrl = `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/latest`;

async function fetchMetadata(
  url: string,
  endpoint: "latest" | "version",
): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache", "User-Agent": "oh-release" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  return registryVersionMetadata(response, publicPackageName, manifest.version as string, endpoint);
}

type CompleteRelease = Readonly<{ latest: NpmReleaseCoordinate; version: NpmReleaseCoordinate }>;

async function lookupCompleteRelease(): Promise<CompleteRelease | null> {
  const versionPayload = await fetchMetadata(registryUrl, "version");
  if (versionPayload === null) return null;
  const latestPayload = await fetchMetadata(registryLatestUrl, "latest");
  if (latestPayload === null) throw new Error(`${coordinate} exists but npm latest is missing.`);
  return Object.freeze({
    latest: parseNpmRelease(latestPayload, manifest.version as string),
    version: parseNpmRelease(versionPayload, manifest.version as string),
  });
}

async function drainBounded(stream: ReadableStream<Uint8Array>, kill: () => void): Promise<boolean> {
  const reader = stream.getReader();
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) return true;
      length += item.value.byteLength;
      if (length > 256 * 1_024) {
        kill();
        return false;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function publishTarball(): Promise<number> {
  const environment = trustedPublishingEnvironment({
    CI: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false",
    NPM_CONFIG_PROVENANCE: "true", NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
  });
  const child = Bun.spawn([
    "npm", "publish", tarball, "--access", "public", "--ignore-scripts", "--provenance",
  ], { env: environment, stderr: "pipe", stdout: "pipe" });
  let timedOut = false;
  const kill = () => child.kill(9);
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, 120_000);
  try {
    const [exitCode, stdoutWithinBound, stderrWithinBound] = await Promise.all([
      child.exited,
      drainBounded(child.stdout, kill),
      drainBounded(child.stderr, kill),
    ]);
    if (timedOut) console.error(`npm publish exceeded its two-minute bound for ${coordinate}.`);
    if (!stdoutWithinBound || !stderrWithinBound) {
      console.error(`npm publish output exceeded its private-output bound for ${coordinate}.`);
    }
    return exitCode;
  } finally {
    clearTimeout(timer);
  }
}

function requireExact(actual: CompleteRelease): void {
  if (
    actual.version.integrity !== expectedIntegrity
    || actual.version.shasum !== expectedShasum
    || actual.latest.integrity !== expectedIntegrity
    || actual.latest.shasum !== expectedShasum
  ) throw new Error(`${coordinate} exists without the exact immutable npm latest bytes.`);
}

const existing = await lookupCompleteRelease();
const plan = planNpmPublication({
  currentAttempt: runAttempt,
  currentRunId: runId,
  exactVersionExists: existing !== null,
  preflightAttempt,
  preflightRunId,
  preflightState: preNpmState as NpmRetryState,
});
if (plan.action === "verify") {
  if (existing === null) throw new Error(`${coordinate} disappeared after its exact retry admission.`);
  requireExact(existing);
  console.log(`${coordinate} already contains the exact MIT trusted-publisher npm latest tarball.`);
} else {
  const publishExitCode = await publishTarball();
  let observed: CompleteRelease | null = null;
  let lookupFailure: unknown;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await Bun.sleep(3_000);
    try {
      const candidate = await lookupCompleteRelease();
      if (candidate !== null) {
        requireExact(candidate);
        observed = candidate;
        break;
      }
    } catch (error) {
      lookupFailure = error;
    }
  }
  if (observed === null) {
    const detail = lookupFailure instanceof Error ? ` Last registry error: ${lookupFailure.message}` : "";
    throw new Error(`npm publish did not produce a verifiable provenance-bearing ${coordinate}.${detail}`);
  }
  if (publishExitCode !== 0) {
    throw new Error(`${coordinate} appeared after npm rejected publication; refusing ambiguous same-attempt provenance.`);
  }
  console.log(`${coordinate} is publicly readable as npm latest with exact bytes.`);
}

await Bun.write(output,
  `provenance_run_id=${plan.provenance.runId}\n`
  + `provenance_attempt_mode=${plan.provenance.mode}\n`
  + `provenance_attempt=${String(plan.provenance.attempt)}\n`);
console.log(`${coordinate} is ready for separate read-only cryptographic provenance admission.`);
