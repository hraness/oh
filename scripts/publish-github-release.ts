import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  assertExactReleaseAssetBytes,
  assertPublishedReleaseIdentity,
  classifyCreatedDraftInventory,
  classifyLaterAttemptDraftInventory,
  classifyPublishedDraftInventory,
  classifyReleaseTagLookup,
  draftReleaseBody,
  exactReleaseAssets,
  githubReleaseRun,
  parseRecoverableDraft,
  parseReleaseTagLookup,
  parseReleaseInventoryPage,
  planReleaseRecovery,
  priorAttemptProvesNoDraftCreation,
  publishedReleaseBody,
  type ExactReleaseAsset,
  type RecoverableDraft,
  type ReleaseIdentityInput,
  type ReleaseTagLookup,
} from "./release-github-retry-policy";
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
const releaseTag = tagArgument;
const releaseVersion = manifest.version;
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
const assets = exactReleaseAssets(manifest.version, tarballBytes, checksumBytes);
const paths = new Map([
  [basename(tarball), tarball],
  [basename(checksum), checksum],
]);
const runIdentity = githubReleaseRun(tagArgument);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function run(
  command: string[],
  options: Readonly<{ stdoutBytes?: number; timeoutMs?: number }> = {},
): Promise<BoundedProcessResult> {
  const result = await runBoundedProcess(command, {
    env: githubReleaseEnvironment(),
    stderrBytes: 128 * 1_024,
    stdoutBytes: options.stdoutBytes ?? 512 * 1_024,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  if (result.exitCode !== 0) throw new Error(`Command failed: ${command.slice(0, 3).join(" ")}`);
  return result;
}

async function runJson(command: string[]): Promise<unknown> {
  const result = await run(command);
  try {
    return JSON.parse(result.stdout.toString("utf8")) as unknown;
  } catch {
    throw new Error("GitHub API returned malformed JSON during release publication.");
  }
}

async function readReleaseTagLookup(): Promise<ReleaseTagLookup> {
  const process = await runBoundedProcess([
    "gh", "api", "--include", `/repos/${publicRepository}/releases/tags/${tagArgument}`,
  ], {
    env: githubReleaseEnvironment(),
    stderrBytes: 128 * 1_024,
    stdoutBytes: 640 * 1_024,
    timeoutMs: 30_000,
  });
  const response = parseReleaseTagLookup(process.stdout);
  if ((response.status === 200) !== (process.exitCode === 0)) {
    throw new Error("GitHub Release lookup exit state does not match its HTTP status.");
  }
  return classifyReleaseTagLookup(response.status, response.body);
}

async function readRelease(id: number): Promise<unknown> {
  return await runJson(["gh", "api", `/repos/${publicRepository}/releases/${String(id)}`]);
}

async function matchingDraftIds(): Promise<readonly number[]> {
  const identifiers: number[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const projection = await runJson([
      "gh", "api", `/repos/${publicRepository}/releases?per_page=100&page=${String(page)}`,
      "--jq", "[.[] | {id: .id, draft: .draft, tag_name: .tag_name}]",
    ]);
    const inventory = parseReleaseInventoryPage(projection, releaseTag);
    identifiers.push(...inventory.candidateIds);
    if (inventory.complete) {
      const unique = new Set(identifiers);
      if (unique.size !== identifiers.length) throw new Error("GitHub Release draft inventory contains duplicate identifiers.");
      return Object.freeze(identifiers);
    }
  }
  throw new Error("GitHub Release draft inventory exceeded its ten-page recovery bound.");
}

async function assertUniqueDraftId(id: number): Promise<void> {
  const identifiers = await matchingDraftIds();
  if (identifiers.length !== 1 || identifiers[0] !== id) {
    throw new Error(`GitHub Release ${releaseTag} draft is no longer uniquely identified.`);
  }
}

async function waitForCreatedDraftInventory(id: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = classifyCreatedDraftInventory(await matchingDraftIds(), id);
    if (state === "exact") return;
    if (Date.now() >= deadline) {
      throw new Error(`GitHub Release ${releaseTag} draft did not become visible in bounded inventory.`);
    }
    await Bun.sleep(1_000);
  }
}

async function assertConvergingPublishedIdentity(id: number, input: ReleaseIdentityInput): Promise<void> {
  const value = await readRelease(id);
  try {
    if (assertPublishedReleaseIdentity(value, input) !== id) {
      throw new Error("Published GitHub Release changed numeric identity.");
    }
    return;
  } catch {
    const draft = parseRecoverableDraft(value, input);
    if (draft.id !== id || draft.assetIds.size !== assets.length) {
      throw new Error(`GitHub Release ${releaseTag} is neither the exact draft nor exact publication.`);
    }
    await assertRemoteAssetBytes(draft);
  }
}

async function waitForPublishedDraftInventory(id: number, input: ReleaseIdentityInput): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = classifyPublishedDraftInventory(await matchingDraftIds(), id);
    if (state === "exact") return;
    await assertConvergingPublishedIdentity(id, input);
    if (Date.now() >= deadline) {
      throw new Error(`GitHub Release ${releaseTag} retained a draft inventory entry beyond its bound.`);
    }
    await Bun.sleep(1_000);
  }
}

type LaterAttemptProviderState = Readonly<{
  draftIds: readonly number[];
  lookup: ReleaseTagLookup;
}>;

async function waitForLaterAttemptProviderState(input: ReleaseIdentityInput): Promise<LaterAttemptProviderState> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const lookup = await readReleaseTagLookup();
    const draftIds = await matchingDraftIds();
    if (lookup.state === "published") {
      const id = assertPublishedReleaseIdentity(lookup.release, input);
      const state = classifyPublishedDraftInventory(draftIds, id);
      if (state === "exact") return Object.freeze({ draftIds: Object.freeze([]), lookup });
      await assertConvergingPublishedIdentity(id, input);
    } else if (lookup.state === "draft") {
      const draft = parseRecoverableDraft(lookup.release, input);
      const state = classifyCreatedDraftInventory(draftIds, draft.id);
      if (state === "exact") return Object.freeze({ draftIds: Object.freeze([draft.id]), lookup });
    } else {
      const state = classifyLaterAttemptDraftInventory(draftIds);
      if (state.state === "recover") {
        return Object.freeze({ draftIds: Object.freeze([state.draftId]), lookup });
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Later attempt cannot prove the provider state for GitHub Release ${releaseTag}.`);
    }
    await Bun.sleep(1_000);
  }
}

async function currentAttemptCanCreateDraft(input: ReleaseIdentityInput): Promise<boolean> {
  if (process.env.GITHUB_SHA !== input.commitSha) {
    throw new Error("GitHub Release retry history is not bound to the verified workflow commit.");
  }
  if (input.run.attempt === 1) return true;
  if (input.run.attempt > 51) throw new Error("GitHub Release recovery exceeded its workflow-attempt bound.");
  for (let attempt = 1; attempt < input.run.attempt; attempt += 1) {
    const jobs = await runJson([
      "gh", "api",
      `/repos/${publicRepository}/actions/runs/${input.run.runId}/attempts/${String(attempt)}/jobs?filter=all&per_page=100`,
      "--jq",
      "{total_count, jobs: [.jobs[] | {id: .id, run_id: .run_id, run_url: .run_url, workflow_name: .workflow_name, head_sha: .head_sha, run_attempt: .run_attempt, name: .name, status: .status, conclusion: .conclusion, steps: [.steps[]? | {name: .name, status: .status, conclusion: .conclusion}]}]}",
    ]);
    if (!priorAttemptProvesNoDraftCreation(jobs, {
      attempt,
      commitSha: input.commitSha,
      runId: input.run.runId,
    })) return false;
  }
  return true;
}

async function assertRemoteAssetBytes(draft: RecoverableDraft): Promise<void> {
  for (const asset of assets) {
    const id = draft.assetIds.get(asset.name);
    if (id === undefined) continue;
    const result = await run([
      "gh", "api", `/repos/${publicRepository}/releases/assets/${String(id)}`,
      "--header", "Accept: application/octet-stream",
    ], { stdoutBytes: asset.size, timeoutMs: 60_000 });
    assertExactReleaseAssetBytes(asset, result.stdout);
  }
}

async function assertRemoteAuthority(input: ReleaseIdentityInput): Promise<void> {
  const authority = await verifyRemoteReleaseAuthority();
  if (authority.tagObjectSha !== input.tagObjectSha) {
    throw new Error("Remote annotated tag object changed during GitHub Release recovery.");
  }
}

async function createDraft(input: ReleaseIdentityInput): Promise<RecoverableDraft> {
  if (!(await currentAttemptCanCreateDraft(input))) {
    throw new Error("A prior workflow attempt may already have created the GitHub Release draft.");
  }
  await assertRemoteAuthority(input);
  const freshLookup = await readReleaseTagLookup();
  const freshPlan = planReleaseRecovery(freshLookup, await matchingDraftIds());
  if (freshPlan.state !== "create") {
    throw new Error("GitHub Release provider state changed before draft creation.");
  }
  const value = await runJson([
    "gh", "api", "--method", "POST", `/repos/${publicRepository}/releases`,
    "--raw-field", `tag_name=${tagArgument}`,
    "--raw-field", `name=Oh ${tagArgument}`,
    "--raw-field", `body=${draftReleaseBody(input)}`,
    "--field", "draft=true",
    "--field", "prerelease=false",
    "--field", "generate_release_notes=false",
  ]);
  const draft = parseRecoverableDraft(value, input);
  await waitForCreatedDraftInventory(draft.id);
  await assertRemoteAssetBytes(draft);
  return draft;
}

async function recoverDraft(id: number, input: ReleaseIdentityInput): Promise<RecoverableDraft> {
  const draft = parseRecoverableDraft(await readRelease(id), input);
  if (draft.id !== id) throw new Error("GitHub Release draft identifier changed during recovery.");
  await assertRemoteAssetBytes(draft);
  return draft;
}

async function uploadMissingAsset(
  draft: RecoverableDraft,
  asset: ExactReleaseAsset,
  input: ReleaseIdentityInput,
): Promise<RecoverableDraft> {
  if (draft.assetIds.has(asset.name)) return draft;
  await assertRemoteAuthority(input);
  await assertUniqueDraftId(draft.id);
  const current = await recoverDraft(draft.id, input);
  if (current.assetIds.has(asset.name)) return current;
  const path = paths.get(asset.name);
  if (path === undefined) throw new Error(`No local path exists for exact release asset ${asset.name}.`);
  await run([
    "gh", "api", "--method", "POST",
    "--header", "Accept: application/vnd.github+json",
    "--header", "Content-Type: application/octet-stream",
    "--input", path,
    `https://uploads.github.com/repos/${publicRepository}/releases/${String(current.id)}/assets?name=${encodeURIComponent(asset.name)}`,
  ]);
  const recovered = await recoverDraft(draft.id, input);
  if (!recovered.assetIds.has(asset.name)) {
    throw new Error(`GitHub did not retain exact release asset ${asset.name}.`);
  }
  return recovered;
}

async function publishDraft(draft: RecoverableDraft, input: ReleaseIdentityInput): Promise<unknown> {
  await assertRemoteAuthority(input);
  await assertUniqueDraftId(draft.id);
  const current = await recoverDraft(draft.id, input);
  if (current.assetIds.size !== assets.length) {
    throw new Error("GitHub draft is not complete enough to publish.");
  }
  return await runJson([
    "gh", "api", "--method", "PATCH", `/repos/${publicRepository}/releases/${String(draft.id)}`,
    "--raw-field", `name=Oh ${tagArgument}`,
    "--raw-field", `body=${publishedReleaseBody(input, current.createdAttempt)}`,
    "--field", "draft=false",
    "--field", "prerelease=false",
    "--raw-field", "make_latest=true",
  ]);
}

async function assertPublished(value: unknown, input: ReleaseIdentityInput): Promise<number> {
  const releaseId = assertPublishedReleaseIdentity(value, input);
  const coordinate = parseGitHubRelease(value, releaseVersion);
  assertReleaseAssetBytes(coordinate, tarballBytes, checksumBytes, sha256);
  const identifiers = new Map([
    [coordinate.tarball.name, coordinate.tarball.id],
    [coordinate.checksum.name, coordinate.checksum.id],
  ]);
  for (const asset of assets) {
    const id = identifiers.get(asset.name);
    if (id === undefined) throw new Error(`Published GitHub Release is missing ${asset.name}.`);
    const result = await run([
      "gh", "api", `/repos/${publicRepository}/releases/assets/${String(id)}`,
      "--header", "Accept: application/octet-stream",
    ], { stdoutBytes: asset.size, timeoutMs: 60_000 });
    assertExactReleaseAssetBytes(asset, result.stdout);
  }
  await assertRemoteAuthority(input);
  return releaseId;
}

const initialAuthority = await verifyRemoteReleaseAuthority();
const identityInput: ReleaseIdentityInput = Object.freeze({
  assets,
  commitSha: verifiedSha,
  run: runIdentity,
  tag: tagArgument,
  tagObjectSha: initialAuthority.tagObjectSha,
});
let lookup = await readReleaseTagLookup();
let initialDraftIds = await matchingDraftIds();
const priorMayHaveMutated = runIdentity.attempt > 1
  && !(await currentAttemptCanCreateDraft(identityInput));
if (priorMayHaveMutated) {
  const later = await waitForLaterAttemptProviderState(identityInput);
  lookup = later.lookup;
  initialDraftIds = later.draftIds;
} else if (lookup.state === "draft") {
  const direct = parseRecoverableDraft(lookup.release, identityInput);
  await waitForCreatedDraftInventory(direct.id);
  initialDraftIds = [direct.id];
} else if (lookup.state === "published") {
  const publishedId = assertPublishedReleaseIdentity(lookup.release, identityInput);
  await waitForPublishedDraftInventory(publishedId, identityInput);
  initialDraftIds = [];
}
const plan = planReleaseRecovery(lookup, initialDraftIds);
if (plan.state === "published") {
  if (lookup.state !== "published") throw new Error("GitHub Release recovery plan lost its published response.");
  await assertPublished(lookup.release, identityInput);
  console.log(`GitHub Release ${tagArgument} already contains the exact immutable same-run artifacts.`);
} else {
  let draft: RecoverableDraft;
  if (plan.state === "recover") {
    draft = await recoverDraft(plan.draftId, identityInput);
  } else if (lookup.state === "draft") {
    const direct = parseRecoverableDraft(lookup.release, identityInput);
    throw new Error(`GitHub Release ${tagArgument} draft ${String(direct.id)} was not planned for recovery.`);
  } else {
    draft = await createDraft(identityInput);
  }
  for (const asset of assets) draft = await uploadMissingAsset(draft, asset, identityInput);
  const publication = await publishDraft(draft, identityInput);
  if (assertPublishedReleaseIdentity(publication, identityInput) !== draft.id) {
    throw new Error(`GitHub published a different Release than exact draft ${String(draft.id)}.`);
  }
  await waitForPublishedDraftInventory(draft.id, identityInput);
  if (await assertPublished(await readRelease(draft.id), identityInput) !== draft.id) {
    throw new Error(`GitHub Release ${tagArgument} changed identifiers after publication.`);
  }
  const tagged = await runJson(["gh", "api", `/repos/${publicRepository}/releases/tags/${tagArgument}`]);
  if (assertPublishedReleaseIdentity(tagged, identityInput) !== draft.id) {
    throw new Error(`GitHub tag lookup does not resolve exact published Release ${String(draft.id)}.`);
  }
  console.log(`Created immutable GitHub Release ${tagArgument} from exact same-run artifact bytes.`);
}
const latest = await runJson(["gh", "api", `/repos/${publicRepository}/releases/latest`]);
if (latest === null || typeof latest !== "object" || Array.isArray(latest) || (latest as Record<string, unknown>).tag_name !== tagArgument) {
  throw new Error(`Latest GitHub Release is not ${tagArgument}.`);
}
if ((await matchingDraftIds()).length !== 0) {
  throw new Error(`GitHub Release ${tagArgument} has an ambiguous residual draft at final admission.`);
}
await assertRemoteAuthority(identityInput);
