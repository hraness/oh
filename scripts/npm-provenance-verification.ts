import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { publicPackageName, publicRepository, publicRepositoryId } from "./release-policy";
import { publicReleaseEnvironment } from "./release-process-environment";

const REGISTRY = "https://registry.npmjs.org/";
const SLSA_PREDICATE = "https://slsa.dev/provenance/v1";
const WORKFLOW_BUILD_TYPE = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const SHA = /^[0-9a-f]{40}$/u;
const SHA512 = /^[0-9a-f]{128}$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAXIMUM_AUDIT_BYTES = 4 * 1_024 * 1_024;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function text(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function exactAttestationUrl(version: string): string {
  return `${REGISTRY}-/npm/v1/attestations/@hraness%2foh@${version}`;
}

function decodePayload(value: unknown): JsonRecord {
  const encoded = text(value, BASE64, "npm provenance DSSE payload");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > 256 * 1_024 || bytes.toString("base64") !== encoded) {
    throw new Error("npm provenance DSSE payload is not canonical bounded base64.");
  }
  try {
    return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "npm provenance statement");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("npm provenance statement")) throw error;
    throw new Error("npm provenance DSSE payload is not canonical UTF-8 JSON.");
  }
}

export type NpmProvenanceCoordinate = Readonly<{
  maximumAttempt?: number;
  requiredAttempt?: number;
  requiredRunId?: string;
  sha512: string;
  verifiedSha: string;
  verifiedTag: string;
  version: string;
}>;

export function parseVerifiedNpmProvenance(
  value: unknown,
  coordinate: NpmProvenanceCoordinate,
): Readonly<{ bundle: JsonRecord; invocation: string }> {
  if (
    !SEMVER.test(coordinate.version)
    || !SHA512.test(coordinate.sha512)
    || !SHA.test(coordinate.verifiedSha)
    || coordinate.verifiedTag !== `v${coordinate.version}`
    || (coordinate.requiredRunId !== undefined && !/^[1-9][0-9]*$/u.test(coordinate.requiredRunId))
    || (coordinate.maximumAttempt !== undefined && (!Number.isSafeInteger(coordinate.maximumAttempt) || coordinate.maximumAttempt < 1))
    || (coordinate.requiredAttempt !== undefined && (!Number.isSafeInteger(coordinate.requiredAttempt) || coordinate.requiredAttempt < 1))
  ) throw new Error("npm provenance verification coordinate is invalid.");

  const audit = record(value, "npm audit signatures result");
  const missing = array(audit.missing, "npm audit signatures missing");
  const invalid = array(audit.invalid, "npm audit signatures invalid");
  const verified = array(audit.verified, "npm audit signatures verified");
  if (missing.length !== 0 || invalid.length !== 0 || verified.length !== 1) {
    throw new Error("npm did not cryptographically verify exactly one provenance-bearing package.");
  }

  const packageResult = record(verified[0], "npm verified package");
  if (
    packageResult.name !== publicPackageName
    || packageResult.version !== coordinate.version
    || packageResult.location !== "node_modules/@hraness/oh"
    || packageResult.registry !== REGISTRY
  ) throw new Error("npm verified the wrong package coordinate.");
  const attestations = record(packageResult.attestations, "npm verified package attestations");
  const provenance = record(attestations.provenance, "npm verified package provenance");
  if (attestations.url !== exactAttestationUrl(coordinate.version)
    || provenance.predicateType !== SLSA_PREDICATE) {
    throw new Error("npm verified package provenance metadata is not exact.");
  }

  const bundles = array(packageResult.attestationBundles, "npm verified package attestation bundles");
  const slsaBundles = bundles.filter((item) =>
    record(item, "npm attestation bundle").predicateType === SLSA_PREDICATE
  );
  if (slsaBundles.length !== 1) throw new Error("npm did not verify exactly one SLSA provenance bundle.");
  const bundle = record(record(slsaBundles[0], "npm SLSA provenance bundle").bundle, "npm SLSA Sigstore bundle");
  if (bundle.mediaType !== "application/vnd.dev.sigstore.bundle.v0.3+json") {
    throw new Error("npm SLSA provenance used the wrong Sigstore bundle format.");
  }
  const envelope = record(bundle.dsseEnvelope, "npm SLSA DSSE envelope");
  if (envelope.payloadType !== "application/vnd.in-toto+json") {
    throw new Error("npm SLSA provenance used the wrong DSSE payload type.");
  }
  if (array(envelope.signatures, "npm SLSA DSSE signatures").length !== 1) {
    throw new Error("npm SLSA provenance signature count is not exact.");
  }

  const statement = decodePayload(envelope.payload);
  if (statement._type !== "https://in-toto.io/Statement/v1" || statement.predicateType !== SLSA_PREDICATE) {
    throw new Error("npm provenance statement identity is invalid.");
  }
  const subjects = array(statement.subject, "npm provenance subject");
  if (subjects.length !== 1) throw new Error("npm provenance must bind exactly one subject.");
  const subject = record(subjects[0], "npm provenance subject");
  const subjectDigest = record(subject.digest, "npm provenance subject digest");
  if (
    subject.name !== `pkg:npm/%40hraness/oh@${coordinate.version}`
    || subjectDigest.sha512 !== coordinate.sha512
  ) throw new Error("npm provenance subject does not bind the exact package tarball.");

  const predicate = record(statement.predicate, "npm provenance predicate");
  const definition = record(predicate.buildDefinition, "npm provenance build definition");
  const external = record(definition.externalParameters, "npm provenance external parameters");
  const workflow = record(external.workflow, "npm provenance workflow");
  if (
    definition.buildType !== WORKFLOW_BUILD_TYPE
    || workflow.ref !== `refs/tags/${coordinate.verifiedTag}`
    || workflow.repository !== `https://github.com/${publicRepository}`
    || workflow.path !== ".github/workflows/release.yml"
  ) throw new Error("npm provenance does not bind the exact release workflow and tag.");
  const internal = record(definition.internalParameters, "npm provenance internal parameters");
  const github = record(internal.github, "npm provenance GitHub parameters");
  if (github.event_name !== "push" || String(github.repository_id) !== publicRepositoryId) {
    throw new Error("npm provenance does not bind the exact GitHub repository event.");
  }
  const dependencies = array(definition.resolvedDependencies, "npm provenance dependencies");
  if (dependencies.length !== 1) throw new Error("npm provenance must bind one source dependency.");
  const source = record(dependencies[0], "npm provenance source dependency");
  const sourceDigest = record(source.digest, "npm provenance source digest");
  if (
    source.uri !== `git+https://github.com/${publicRepository}@refs/tags/${coordinate.verifiedTag}`
    || sourceDigest.gitCommit !== coordinate.verifiedSha
  ) throw new Error("npm provenance does not bind the exact reviewed Git commit.");

  const runDetails = record(predicate.runDetails, "npm provenance run details");
  const builder = record(runDetails.builder, "npm provenance builder");
  const metadata = record(runDetails.metadata, "npm provenance run metadata");
  const invocation = text(
    metadata.invocationId,
    /^https:\/\/github\.com\/hraness\/oh\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*$/u,
    "npm provenance invocation",
  );
  if (builder.id !== "https://github.com/actions/runner/github-hosted" || invocation.length > 256) {
    throw new Error("npm provenance builder or invocation is invalid.");
  }
  const invocationMatch = /^https:\/\/github\.com\/hraness\/oh\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/u.exec(invocation);
  if (invocationMatch === null) throw new Error("npm provenance invocation is invalid.");
  const [, runId, attemptText] = invocationMatch;
  const attempt = Number(attemptText);
  if (
    (coordinate.requiredRunId !== undefined && runId !== coordinate.requiredRunId)
    || (coordinate.maximumAttempt !== undefined && attempt > coordinate.maximumAttempt)
    || (coordinate.requiredAttempt !== undefined && attempt !== coordinate.requiredAttempt)
  ) throw new Error("npm provenance is not bound to an allowed workflow run attempt.");
  return Object.freeze({ bundle, invocation });
}

async function verifyReleaseSigner(
  bundle: JsonRecord,
  input: Readonly<{ invocation: string; verifiedSha: string; verifiedTag: string }>,
  tufCachePath: string,
): Promise<void> {
  const serialized = JSON.stringify(bundle);
  if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_AUDIT_BYTES) throw new Error("npm Sigstore bundle exceeded its process-input bound.");
  const child = Bun.spawn([
    "node", resolve(import.meta.dir, "verify-npm-provenance-signer.mjs"),
    input.verifiedTag, input.verifiedSha, input.invocation, tufCachePath,
  ], { env: publicReleaseEnvironment(), stderr: "pipe", stdin: "pipe", stdout: "pipe" });
  child.stdin.write(serialized);
  child.stdin.end();
  let timedOut = false;
  const kill = () => child.kill(9);
  const timer = setTimeout(() => { timedOut = true; kill(); }, 60_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, boundedProcessOutput(child.stdout, kill), boundedProcessOutput(child.stderr, kill),
    ]);
    if (timedOut) throw new Error("npm Sigstore signer verification timed out.");
    if (exitCode !== 0 || stdout.toString("utf8") !== "verified\n" || stderr.byteLength !== 0) {
      throw new Error("npm Sigstore signer identity verification failed.");
    }
  } finally { clearTimeout(timer); }
}

async function boundedProcessOutput(stream: ReadableStream<Uint8Array>, kill: () => void): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAXIMUM_AUDIT_BYTES) {
        kill();
        throw new Error("npm provenance verification output exceeded its bound.");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function runNpm(command: string[], cwd: string, environment: Record<string, string | undefined>): Promise<string> {
  const child = Bun.spawn(["npm", ...command], { cwd, env: environment, stderr: "pipe", stdout: "pipe" });
  let timedOut = false;
  const kill = () => child.kill(9);
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, 120_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      boundedProcessOutput(child.stdout, kill),
      boundedProcessOutput(child.stderr, kill),
    ]);
    if (timedOut) throw new Error(`npm ${command[0] ?? "command"} timed out during provenance verification.`);
    if (exitCode !== 0) {
      const diagnostic = stderr.byteLength === 0 ? "without diagnostics" : "with redacted diagnostics";
      throw new Error(`npm ${command[0] ?? "command"} failed during provenance verification ${diagnostic}.`);
    }
    return stdout.toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyNpmProvenance(
  tarballBytes: Uint8Array,
  input: Readonly<{ maximumAttempt?: number; requiredAttempt?: number; requiredRunId?: string; verifiedSha: string; verifiedTag: string; version: string }>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "oh-npm-provenance-"));
  try {
    const npmrc = join(directory, ".npmrc");
    const cache = join(directory, "cache");
    const globalNpmrc = join(directory, "global.npmrc");
    await Promise.all([
      writeFile(npmrc, `registry=${REGISTRY}\naudit=false\nfund=false\n`, { mode: 0o600 }),
      writeFile(globalNpmrc, "", { mode: 0o600 }),
      writeFile(join(directory, "package.json"), `${JSON.stringify({
        dependencies: { [publicPackageName]: input.version },
        private: true,
        type: "module",
      }, null, 2)}\n`, { mode: 0o600 }),
    ]);
    const environment = publicReleaseEnvironment({
      CI: "true", NPM_CONFIG_CACHE: cache, NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
      NPM_CONFIG_REGISTRY: REGISTRY, NPM_CONFIG_USERCONFIG: npmrc,
    });
    await runNpm([
      "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact",
      `${publicPackageName}@${input.version}`,
    ], directory, environment);
    const output = await runNpm([
      "audit", "signatures", "--json", "--include-attestations",
    ], directory, environment);
    if (Buffer.byteLength(output, "utf8") > MAXIMUM_AUDIT_BYTES) {
      throw new Error("npm provenance verification result exceeded its bound.");
    }
    let audit: unknown;
    try {
      audit = JSON.parse(output) as unknown;
    } catch {
      throw new Error("npm provenance verification did not return JSON.");
    }
    const provenance = parseVerifiedNpmProvenance(audit, {
      sha512: createHash("sha512").update(tarballBytes).digest("hex"),
      ...(input.maximumAttempt === undefined ? {} : { maximumAttempt: input.maximumAttempt }),
      ...(input.requiredAttempt === undefined ? {} : { requiredAttempt: input.requiredAttempt }),
      ...(input.requiredRunId === undefined ? {} : { requiredRunId: input.requiredRunId }),
      verifiedSha: input.verifiedSha,
      verifiedTag: input.verifiedTag,
      version: input.version,
    });
    await verifyReleaseSigner(provenance.bundle, {
      invocation: provenance.invocation,
      verifiedSha: input.verifiedSha,
      verifiedTag: input.verifiedTag,
    }, cache);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
