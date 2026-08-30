import { publicRepository } from "./release-policy";
import { githubReleaseEnvironment } from "./release-process-environment";
import { runBoundedProcess } from "./run-bounded-process";

type JsonRecord = Record<string, unknown>;

function required(name: string, pattern: RegExp): string {
  const value = process.env[name];
  if (value === undefined || !pattern.test(value)) throw new Error(`Release authority requires valid ${name}.`);
  return value;
}

async function runJson(endpoint: string): Promise<JsonRecord> {
  const result = await runBoundedProcess(["gh", "api", endpoint], {
    env: githubReleaseEnvironment(),
    stderrBytes: 64 * 1_024,
    stdoutBytes: 256 * 1_024,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) throw new Error(`GitHub authority lookup failed for ${endpoint}.`);
  const value = JSON.parse(result.stdout.toString()) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`GitHub authority lookup returned no object for ${endpoint}.`);
  }
  return value as JsonRecord;
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

export function releaseTagObjectSha(value: unknown, tag: string): string {
  const reference = record(value, `GitHub tag ref ${tag}`);
  const tagObject = record(reference.object, `GitHub tag ref ${tag} object`);
  const expectedObjectUrl = `https://api.github.com/repos/${publicRepository}/git/tags/${String(tagObject.sha)}`;
  if (
    reference.ref !== `refs/tags/${tag}`
    || tagObject.type !== "tag"
    || typeof tagObject.sha !== "string"
    || !/^[0-9a-f]{40}$/u.test(tagObject.sha)
    || tagObject.url !== expectedObjectUrl
  ) throw new Error(`GitHub release ref ${tag} is not one exact annotated tag object.`);
  return tagObject.sha;
}

export function assertRemoteReleaseAuthority(
  annotatedValue: unknown,
  headValue: unknown,
  comparisonValue: unknown,
  input: Readonly<{ branch: string; sha: string; tag: string }>,
): void {
  const annotated = record(annotatedValue, `GitHub annotated tag ${input.tag}`);
  const target = record(annotated.object, `GitHub annotated tag ${input.tag} target`);
  if (annotated.tag !== input.tag || target.type !== "commit" || target.sha !== input.sha) {
    throw new Error(`GitHub annotated tag ${input.tag} does not target ${input.sha}.`);
  }
  const head = record(headValue, `GitHub branch ${input.branch}`);
  const headObject = record(head.object, `GitHub branch ${input.branch} object`);
  if (
    head.ref !== `refs/heads/${input.branch}`
    || headObject.type !== "commit"
    || typeof headObject.sha !== "string"
  ) throw new Error(`GitHub branch ${input.branch} is invalid.`);
  const comparison = record(comparisonValue, `GitHub ${input.branch} ancestry comparison`);
  const base = record(comparison.base_commit, "GitHub comparison base");
  const mergeBase = record(comparison.merge_base_commit, "GitHub comparison merge base");
  const comparisonHead = record(comparison.head_commit, "GitHub comparison head");
  if (
    !["ahead", "identical"].includes(String(comparison.status))
    || base.sha !== input.sha
    || mergeBase.sha !== input.sha
    || comparisonHead.sha !== headObject.sha
  ) throw new Error(`Reviewed release commit ${input.sha} is not an ancestor of current ${input.branch}.`);
}

export type RemoteReleaseAuthority = Readonly<{ tagObjectSha: string }>;

export async function verifyRemoteReleaseAuthority(): Promise<RemoteReleaseAuthority> {
  if (process.env.GITHUB_REPOSITORY !== publicRepository) {
    throw new Error(`Release authority must run in ${publicRepository}.`);
  }
  const sha = required("VERIFIED_SHA", /^[0-9a-f]{40}$/u);
  const tag = required("VERIFIED_TAG", /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u);
  const branch = required("DEFAULT_BRANCH", /^[A-Za-z0-9._/-]+$/u);
  const reference = await runJson(`/repos/${publicRepository}/git/ref/tags/${tag}`);
  const tagObjectSha = releaseTagObjectSha(reference, tag);
  const annotated = await runJson(`/repos/${publicRepository}/git/tags/${tagObjectSha}`);
  const head = await runJson(`/repos/${publicRepository}/git/ref/heads/${branch}`);
  const comparison = await runJson(`/repos/${publicRepository}/compare/${sha}...${branch}`);
  assertRemoteReleaseAuthority(annotated, head, comparison, { branch, sha, tag });
  console.log(`Verified remote annotated ${tag} at ${sha} remains in current ${branch} history.`);
  return Object.freeze({ tagObjectSha });
}

if (import.meta.main) await verifyRemoteReleaseAuthority();
