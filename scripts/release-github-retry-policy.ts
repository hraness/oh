import { createHash } from "node:crypto";

import {
  publicRepository,
  publicRepositoryId,
  releaseArchiveName,
} from "./release-policy";

type JsonRecord = Record<string, unknown>;

const RELEASE_IDENTITY_SCHEMA = "https://oh.computer/release-identity/v1";
const RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml";
const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,19}$/u;
const MAXIMUM_RELEASE_INVENTORY_PAGE = 100;
const GITHUB_ACTIONS_BOT_ID = 41_898_282;
const GITHUB_ACTIONS_BOT_LOGIN = "github-actions[bot]";
const MAXIMUM_API_HEADERS_BYTES = 64 * 1_024;
const GITHUB_RELEASE_JOB_NAME = "Publish immutable GitHub Release";
const GITHUB_RELEASE_STEP_NAME = "Create and prove immutable GitHub Release from the exact bytes";

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label} must be a positive decimal string.`);
  }
  return value;
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`${label} has unexpected fields.`);
  }
}

function requiredEnvironment(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (value === undefined || value.length === 0) throw new Error(`GitHub Release recovery requires ${name}.`);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type ExactReleaseAsset = Readonly<{
  bytes: Uint8Array;
  digest: string;
  name: string;
  size: number;
}>;

export function assertExactReleaseAssetBytes(asset: ExactReleaseAsset, value: Uint8Array): void {
  if (
    value.byteLength !== asset.size
    || sha256(value) !== asset.digest
    || !Buffer.from(value).equals(Buffer.from(asset.bytes))
  ) throw new Error(`Downloaded GitHub asset ${asset.name} has different bytes.`);
}

export function exactReleaseAssets(
  version: string,
  tarballBytes: Uint8Array,
  checksumBytes: Uint8Array,
): readonly ExactReleaseAsset[] {
  const tarballName = releaseArchiveName(version);
  if (tarballBytes.byteLength <= 0 || tarballBytes.byteLength > 64 * 1_024 * 1_024) {
    throw new Error("The exact release tarball is outside its public byte bound.");
  }
  if (checksumBytes.byteLength <= 0 || checksumBytes.byteLength > 256) {
    throw new Error("The exact release checksum is outside its public byte bound.");
  }
  const tarballDigest = sha256(tarballBytes);
  const checksumText = new TextDecoder("utf-8", { fatal: true }).decode(checksumBytes);
  if (checksumText !== `${tarballDigest}  ${tarballName}\n`) {
    throw new Error("SHA256SUMS does not describe the exact release tarball.");
  }
  return Object.freeze([
    Object.freeze({ bytes: checksumBytes, digest: sha256(checksumBytes), name: "SHA256SUMS", size: checksumBytes.byteLength }),
    Object.freeze({ bytes: tarballBytes, digest: tarballDigest, name: tarballName, size: tarballBytes.byteLength }),
  ]);
}

export type GitHubReleaseRun = Readonly<{
  attempt: number;
  repositoryId: string;
  runId: string;
  workflowRef: string;
}>;

export function githubReleaseRun(
  tag: string,
  source: NodeJS.ProcessEnv = process.env,
): GitHubReleaseRun {
  const runId = decimal(requiredEnvironment(source, "RELEASE_RUN_ID"), "RELEASE_RUN_ID");
  const attemptText = decimal(requiredEnvironment(source, "RELEASE_RUN_ATTEMPT"), "RELEASE_RUN_ATTEMPT");
  const attempt = Number(attemptText);
  if (!Number.isSafeInteger(attempt)) throw new Error("RELEASE_RUN_ATTEMPT is outside its safe bound.");
  const repositoryId = requiredEnvironment(source, "RELEASE_REPOSITORY_ID");
  const workflowRef = requiredEnvironment(source, "RELEASE_WORKFLOW_REF");
  const expectedWorkflowRef = `${publicRepository}/${RELEASE_WORKFLOW_PATH}@refs/tags/${tag}`;
  if (
    source.GITHUB_RUN_ID !== runId
    || source.GITHUB_RUN_ATTEMPT !== attemptText
    || source.GITHUB_REPOSITORY !== publicRepository
    || source.GITHUB_REPOSITORY_ID !== repositoryId
    || repositoryId !== publicRepositoryId
    || source.GITHUB_WORKFLOW_REF !== workflowRef
    || workflowRef !== expectedWorkflowRef
    || source.GITHUB_EVENT_NAME !== "push"
    || source.GITHUB_REF !== `refs/tags/${tag}`
    || source.GITHUB_REF_NAME !== tag
    || source.GITHUB_REF_TYPE !== "tag"
  ) throw new Error("GitHub Release recovery is not bound to this exact tag workflow run.");
  return Object.freeze({ attempt, repositoryId, runId, workflowRef });
}

type ReleaseIdentity = Readonly<{
  artifacts: readonly Readonly<{ name: string; sha256: string; size: number }>[];
  commitSha: string;
  createdAttempt: number;
  publishedAttempt: number | null;
  repository: string;
  repositoryId: string;
  runId: string;
  schema: string;
  tag: string;
  tagObjectSha: string;
  workflowRef: string;
}>;

export type ReleaseIdentityInput = Readonly<{
  assets: readonly ExactReleaseAsset[];
  commitSha: string;
  run: GitHubReleaseRun;
  tag: string;
  tagObjectSha: string;
}>;

function releaseIdentity(
  input: ReleaseIdentityInput,
  createdAttempt: number,
  publishedAttempt: number | null,
): ReleaseIdentity {
  if (!SHA.test(input.commitSha) || !SHA.test(input.tagObjectSha)) {
    throw new Error("GitHub Release identity requires exact tag and commit objects.");
  }
  return Object.freeze({
    artifacts: Object.freeze(input.assets.map((asset) => Object.freeze({
      name: asset.name,
      sha256: asset.digest,
      size: asset.size,
    }))),
    commitSha: input.commitSha,
    createdAttempt,
    publishedAttempt,
    repository: publicRepository,
    repositoryId: input.run.repositoryId,
    runId: input.run.runId,
    schema: RELEASE_IDENTITY_SCHEMA,
    tag: input.tag,
    tagObjectSha: input.tagObjectSha,
    workflowRef: input.run.workflowRef,
  });
}

function renderIdentity(identity: ReleaseIdentity): string {
  return `<!-- oh-release-identity:v1\n${JSON.stringify(identity)}\n-->`;
}

export function draftReleaseBody(input: ReleaseIdentityInput): string {
  return renderIdentity(releaseIdentity(input, input.run.attempt, null));
}

export function publishedReleaseBody(input: ReleaseIdentityInput, createdAttempt: number): string {
  return renderIdentity(releaseIdentity(input, createdAttempt, input.run.attempt));
}

function parseIdentityBody(
  value: unknown,
  input: ReleaseIdentityInput,
  expectedState: "draft" | "published",
): ReleaseIdentity {
  if (typeof value !== "string" || value.length > 4_096) throw new Error("GitHub Release identity body is invalid.");
  const prefix = "<!-- oh-release-identity:v1\n";
  const suffix = "\n-->";
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    throw new Error("GitHub Release identity body is missing or edited.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(prefix.length, -suffix.length)) as unknown;
  } catch {
    throw new Error("GitHub Release identity body is malformed.");
  }
  const identity = record(parsed, "GitHub Release identity");
  exactKeys(identity, [
    "artifacts", "commitSha", "createdAttempt", "publishedAttempt", "repository",
    "repositoryId", "runId", "schema", "tag", "tagObjectSha", "workflowRef",
  ], "GitHub Release identity");
  const createdAttempt = positiveInteger(identity.createdAttempt, "GitHub Release creation attempt");
  const publishedAttempt = identity.publishedAttempt === null
    ? null
    : positiveInteger(identity.publishedAttempt, "GitHub Release publication attempt");
  if (
    createdAttempt > input.run.attempt
    || (expectedState === "draft" && publishedAttempt !== null)
    || (expectedState === "published" && (
      publishedAttempt === null
      || publishedAttempt < createdAttempt
      || publishedAttempt > input.run.attempt
    ))
  ) throw new Error("GitHub Release identity has invalid workflow-attempt ordering.");
  if (
    identity.repository !== publicRepository
    || identity.repositoryId !== input.run.repositoryId
    || identity.runId !== input.run.runId
    || identity.workflowRef !== input.run.workflowRef
    || identity.schema !== RELEASE_IDENTITY_SCHEMA
    || identity.tag !== input.tag
    || identity.tagObjectSha !== input.tagObjectSha
    || identity.commitSha !== input.commitSha
  ) throw new Error("GitHub Release identity belongs to another release authority.");
  if (!Array.isArray(identity.artifacts) || identity.artifacts.length !== input.assets.length) {
    throw new Error("GitHub Release identity has the wrong artifact set.");
  }
  const artifacts = identity.artifacts.map((value, index) => {
    const asset = record(value, `GitHub Release identity artifact ${String(index)}`);
    exactKeys(asset, ["name", "sha256", "size"], "GitHub Release identity artifact");
    if (typeof asset.name !== "string" || typeof asset.sha256 !== "string" || !SHA256.test(asset.sha256)) {
      throw new Error("GitHub Release identity artifact is malformed.");
    }
    return Object.freeze({ name: asset.name, sha256: asset.sha256, size: positiveInteger(asset.size, "GitHub Release identity artifact size") });
  });
  const expectedArtifacts = input.assets.map((asset) => ({ name: asset.name, sha256: asset.digest, size: asset.size }));
  if (JSON.stringify(artifacts) !== JSON.stringify(expectedArtifacts)) {
    throw new Error("GitHub Release identity describes different artifact bytes.");
  }
  const canonical = releaseIdentity(input, createdAttempt, publishedAttempt);
  if (value !== renderIdentity(canonical)) throw new Error("GitHub Release identity body is not canonical.");
  return canonical;
}

export type ReleaseInventoryPage = Readonly<{
  candidateIds: readonly number[];
  complete: boolean;
}>;

export function parseReleaseInventoryPage(value: unknown, tag: string): ReleaseInventoryPage {
  if (!Array.isArray(value) || value.length > MAXIMUM_RELEASE_INVENTORY_PAGE) {
    throw new Error("GitHub Release inventory page is not bounded.");
  }
  const candidateIds: number[] = [];
  for (const item of value) {
    const release = record(item, "GitHub Release inventory item");
    exactKeys(release, ["draft", "id", "tag_name"], "GitHub Release inventory item");
    if (typeof release.draft !== "boolean" || typeof release.tag_name !== "string") {
      throw new Error("GitHub Release inventory item is malformed.");
    }
    const id = positiveInteger(release.id, "GitHub Release inventory identifier");
    if (release.draft && release.tag_name === tag) candidateIds.push(id);
  }
  return Object.freeze({
    candidateIds: Object.freeze(candidateIds),
    complete: value.length < MAXIMUM_RELEASE_INVENTORY_PAGE,
  });
}

export type ReleaseTagLookup = Readonly<
  | { state: "missing" }
  | { release: JsonRecord; state: "draft" | "published" }
>;

export function parseReleaseTagLookup(value: Uint8Array): Readonly<{ body: unknown; status: number }> {
  if (value.byteLength <= 0 || value.byteLength > 640 * 1_024) {
    throw new Error("GitHub Release lookup response is outside its byte bound.");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  const crlf = text.indexOf("\r\n\r\n");
  const lf = text.indexOf("\n\n");
  const separator = crlf >= 0 && (lf < 0 || crlf <= lf) ? crlf : lf;
  const width = separator === crlf ? 4 : 2;
  if (separator <= 0 || separator > MAXIMUM_API_HEADERS_BYTES) {
    throw new Error("GitHub Release lookup has malformed or excessive headers.");
  }
  const header = text.slice(0, separator);
  const lines = header.split(/\r?\n/u);
  const statusMatch = /^HTTP\/(?:1\.1|2(?:\.0)?) ([0-9]{3})(?: .*)?$/u.exec(lines[0] ?? "");
  if (statusMatch === null) throw new Error("GitHub Release lookup has no exact HTTP status.");
  const contentTypes = lines.slice(1)
    .filter((line) => /^content-type:/iu.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim().split(";", 1)[0]?.toLowerCase());
  if (contentTypes.length !== 1 || contentTypes[0] !== "application/json") {
    throw new Error("GitHub Release lookup did not return one JSON content type.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text.slice(separator + width)) as unknown;
  } catch {
    throw new Error("GitHub Release lookup returned malformed JSON.");
  }
  return Object.freeze({ body, status: Number(statusMatch[1]) });
}

export function classifyReleaseTagLookup(status: number, value: unknown): ReleaseTagLookup {
  if (status === 404) {
    const missing = record(value, "Missing GitHub Release response");
    if (missing.message !== "Not Found") throw new Error("GitHub Release lookup returned an inexact missing response.");
    return Object.freeze({ state: "missing" });
  }
  if (status !== 200) throw new Error(`GitHub Release lookup returned HTTP ${String(status)}.`);
  const release = record(value, "GitHub Release lookup");
  if (typeof release.draft !== "boolean") throw new Error("GitHub Release lookup has no exact draft state.");
  return Object.freeze({ release, state: release.draft ? "draft" : "published" });
}

export type ReleaseRecoveryPlan = Readonly<
  | { state: "create" | "published" }
  | { draftId: number; state: "recover" }
>;

export function classifyCreatedDraftInventory(
  draftIds: readonly number[],
  createdId: number,
): "exact" | "pending" {
  const expected = positiveInteger(createdId, "Created GitHub Release draft identifier");
  const identifiers = draftIds.map((id) => positiveInteger(id, "GitHub Release draft identifier"));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("GitHub Release draft inventory contains duplicate identifiers.");
  }
  if (identifiers.length === 0) return "pending";
  if (identifiers.length === 1 && identifiers[0] === expected) return "exact";
  throw new Error("Created GitHub Release draft is not uniquely identified by inventory.");
}

export function classifyPublishedDraftInventory(
  draftIds: readonly number[],
  publishedId: number,
): "exact" | "pending" {
  const expected = positiveInteger(publishedId, "Published GitHub Release identifier");
  const identifiers = draftIds.map((id) => positiveInteger(id, "GitHub Release draft identifier"));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("GitHub Release draft inventory contains duplicate identifiers.");
  }
  if (identifiers.length === 0) return "exact";
  if (identifiers.length === 1 && identifiers[0] === expected) return "pending";
  throw new Error("Published GitHub Release has an ambiguous residual draft inventory.");
}

export type LaterAttemptDraftInventory = Readonly<
  | { state: "pending" }
  | { draftId: number; state: "recover" }
>;

export function classifyLaterAttemptDraftInventory(
  draftIds: readonly number[],
): LaterAttemptDraftInventory {
  const identifiers = draftIds.map((id) => positiveInteger(id, "GitHub Release draft identifier"));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("GitHub Release draft inventory contains duplicate identifiers.");
  }
  if (identifiers.length === 0) return Object.freeze({ state: "pending" });
  if (identifiers.length === 1) {
    return Object.freeze({ draftId: identifiers[0] as number, state: "recover" });
  }
  throw new Error("GitHub Release has ambiguous residual drafts.");
}

export function priorAttemptProvesNoDraftCreation(
  value: unknown,
  input: Readonly<{ attempt: number; commitSha: string; runId: string }>,
): boolean {
  const expectedAttempt = positiveInteger(input.attempt, "Prior GitHub workflow attempt");
  if (!SHA.test(input.commitSha)) throw new Error("Prior GitHub workflow commit is invalid.");
  const expectedRunId = decimal(input.runId, "Prior GitHub workflow run ID");
  const expectedRunUrl = `https://api.github.com/repos/${publicRepository}/actions/runs/${expectedRunId}`;
  const response = record(value, "Prior GitHub workflow jobs");
  exactKeys(response, ["jobs", "total_count"], "Prior GitHub workflow jobs");
  if (!Array.isArray(response.jobs) || response.jobs.length > 32) {
    throw new Error("Prior GitHub workflow jobs are incomplete or unbounded.");
  }
  if (!Number.isSafeInteger(response.total_count) || response.total_count !== response.jobs.length) {
    throw new Error("Prior GitHub workflow job count is inconsistent.");
  }
  const writers: JsonRecord[] = [];
  for (const value of response.jobs) {
    const job = record(value, "Prior GitHub workflow job");
    exactKeys(job, [
      "conclusion", "head_sha", "id", "name", "run_attempt", "run_id", "run_url",
      "status", "steps", "workflow_name",
    ], "Prior GitHub workflow job");
    if (
      !Number.isSafeInteger(job.id)
      || Number(job.id) <= 0
      || typeof job.name !== "string"
      || job.run_attempt !== expectedAttempt
      || !Number.isSafeInteger(job.run_id)
      || String(job.run_id) !== expectedRunId
      || job.run_url !== expectedRunUrl
      || job.workflow_name !== "Release"
      || job.head_sha !== input.commitSha
      || typeof job.status !== "string"
      || (typeof job.conclusion !== "string" && job.conclusion !== null)
      || !Array.isArray(job.steps)
      || job.steps.length > 100
    ) throw new Error("Prior GitHub workflow job is malformed.");
    for (const stepValue of job.steps) {
      const step = record(stepValue, "Prior GitHub workflow step");
      exactKeys(step, ["conclusion", "name", "status"], "Prior GitHub workflow step");
      if (
        typeof step.name !== "string"
        || typeof step.status !== "string"
        || (typeof step.conclusion !== "string" && step.conclusion !== null)
      ) throw new Error("Prior GitHub workflow step is malformed.");
    }
    if (job.name === GITHUB_RELEASE_JOB_NAME) writers.push(job);
  }
  if (writers.length !== 1) {
    throw new Error("Prior GitHub workflow does not contain one exact Release writer job.");
  }
  const writer = writers[0] as JsonRecord;
  if (writer.status !== "completed") throw new Error("Prior GitHub Release writer is not complete.");
  const steps = writer.steps as JsonRecord[];
  if (writer.conclusion === "skipped") {
    if (steps.length !== 0) throw new Error("Skipped prior GitHub Release writer unexpectedly contains steps.");
    return true;
  }
  if (!new Set(["cancelled", "failure", "timed_out"]).has(String(writer.conclusion))) return false;
  const publicationSteps = steps.filter((step) => step.name === GITHUB_RELEASE_STEP_NAME);
  if (publicationSteps.length !== 1) {
    throw new Error("Prior GitHub Release writer does not contain one exact publication step.");
  }
  const publication = publicationSteps[0] as JsonRecord;
  return publication.status === "completed" && publication.conclusion === "skipped";
}

export function planReleaseRecovery(
  lookup: ReleaseTagLookup,
  draftIds: readonly number[],
): ReleaseRecoveryPlan {
  const identifiers = draftIds.map((id) => positiveInteger(id, "GitHub Release draft identifier"));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("GitHub Release draft inventory contains duplicate identifiers.");
  }
  if (lookup.state === "published") {
    if (identifiers.length !== 0) throw new Error("Published GitHub Release has ambiguous residual drafts.");
    return Object.freeze({ state: "published" });
  }
  if (identifiers.length > 1) throw new Error("GitHub Release has ambiguous residual drafts.");
  if (lookup.state === "draft") {
    const directId = positiveInteger(lookup.release.id, "Direct GitHub Release draft identifier");
    if (identifiers.length !== 1 || identifiers[0] !== directId) {
      throw new Error("Direct GitHub Release draft is not uniquely confirmed by inventory.");
    }
    return Object.freeze({ draftId: directId, state: "recover" });
  }
  return identifiers.length === 0
    ? Object.freeze({ state: "create" })
    : Object.freeze({ draftId: identifiers[0] as number, state: "recover" });
}

export type RecoverableDraft = Readonly<{
  assetIds: ReadonlyMap<string, number>;
  createdAttempt: number;
  id: number;
}>;

function assertActionsAuthor(value: unknown, label: string): void {
  const author = record(value, label);
  if (
    author.id !== GITHUB_ACTIONS_BOT_ID
    || author.login !== GITHUB_ACTIONS_BOT_LOGIN
    || author.type !== "Bot"
  ) throw new Error(`${label} is not the GitHub Actions bot.`);
}

function releaseIdentifier(value: JsonRecord): number {
  const id = positiveInteger(value.id, "GitHub Release identifier");
  assertActionsAuthor(value.author, "GitHub Release author");
  return id;
}

function parseDraftAssets(value: unknown, input: ReleaseIdentityInput): ReadonlyMap<string, number> {
  if (!Array.isArray(value) || value.length > input.assets.length) {
    throw new Error("Recoverable GitHub draft has extra assets.");
  }
  const expected = new Map(input.assets.map((asset) => [asset.name, asset] as const));
  const found = new Map<string, number>();
  for (const item of value) {
    const asset = record(item, "GitHub draft asset");
    if (typeof asset.name !== "string" || found.has(asset.name)) {
      throw new Error("Recoverable GitHub draft has duplicate or malformed asset names.");
    }
    const expectation = expected.get(asset.name);
    if (expectation === undefined) throw new Error("Recoverable GitHub draft has an unexpected asset.");
    const id = positiveInteger(asset.id, `GitHub draft asset ${asset.name} identifier`);
    if (
      asset.state !== "uploaded"
      || asset.size !== expectation.size
      || asset.digest !== `sha256:${expectation.digest}`
    ) throw new Error(`GitHub draft asset ${asset.name} does not match the exact expected bytes.`);
    assertActionsAuthor(asset.uploader, `GitHub draft asset ${asset.name} uploader`);
    found.set(asset.name, id);
  }
  return found;
}

export function parseRecoverableDraft(value: unknown, input: ReleaseIdentityInput): RecoverableDraft {
  const release = record(value, "Recoverable GitHub draft");
  const id = releaseIdentifier(release);
  if (
    release.tag_name !== input.tag
    || release.name !== `Oh ${input.tag}`
    || release.draft !== true
    || release.prerelease !== false
    || release.immutable !== false
    || release.published_at !== null
  ) throw new Error("GitHub draft release identity or state was edited.");
  const identity = parseIdentityBody(release.body, input, "draft");
  return Object.freeze({
    assetIds: parseDraftAssets(release.assets, input),
    createdAttempt: identity.createdAttempt,
    id,
  });
}

export function assertPublishedReleaseIdentity(value: unknown, input: ReleaseIdentityInput): number {
  const release = record(value, "Published GitHub Release");
  const id = releaseIdentifier(release);
  if (
    release.tag_name !== input.tag
    || release.name !== `Oh ${input.tag}`
    || release.draft !== false
    || release.prerelease !== false
    || release.immutable !== true
    || typeof release.published_at !== "string"
  ) throw new Error("Published GitHub Release identity is mutable, edited, or inexact.");
  parseIdentityBody(release.body, input, "published");
  if (parseDraftAssets(release.assets, input).size !== input.assets.length) {
    throw new Error("Published GitHub Release is missing an exact expected asset.");
  }
  return id;
}
