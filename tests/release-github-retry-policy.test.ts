import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

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
  parseReleaseInventoryPage,
  parseReleaseTagLookup,
  planReleaseRecovery,
  priorAttemptProvesNoDraftCreation,
  publishedReleaseBody,
  type ExactReleaseAsset,
  type GitHubReleaseRun,
  type ReleaseIdentityInput,
} from "../scripts/release-github-retry-policy";

const tag = "v0.2.3";
const commitSha = "1".repeat(40);
const tagObjectSha = "2".repeat(40);
const tarballBytes = Buffer.from("exact Oh tarball bytes");
const tarballDigest = createHash("sha256").update(tarballBytes).digest("hex");
const checksumBytes = Buffer.from(`${tarballDigest}  hraness-oh-0.2.3.tgz\n`);
const assets = exactReleaseAssets("0.2.3", tarballBytes, checksumBytes);

function environment(runId = "70000000001", attempt = "1"): NodeJS.ProcessEnv {
  const workflowRef = `hraness/oh/.github/workflows/release.yml@refs/tags/${tag}`;
  return {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: `refs/tags/${tag}`,
    GITHUB_REF_NAME: tag,
    GITHUB_REF_TYPE: "tag",
    GITHUB_REPOSITORY: "hraness/oh",
    GITHUB_REPOSITORY_ID: "1348230462",
    GITHUB_RUN_ATTEMPT: attempt,
    GITHUB_RUN_ID: runId,
    GITHUB_WORKFLOW_REF: workflowRef,
    RELEASE_REPOSITORY_ID: "1348230462",
    RELEASE_RUN_ATTEMPT: attempt,
    RELEASE_RUN_ID: runId,
    RELEASE_WORKFLOW_REF: workflowRef,
  };
}

function input(run: GitHubReleaseRun): ReleaseIdentityInput {
  return Object.freeze({ assets, commitSha, run, tag, tagObjectSha });
}

const actionsBot = Object.freeze({ id: 41_898_282, login: "github-actions[bot]", type: "Bot" });

function assetRecord(asset: ExactReleaseAsset, id: number): Record<string, unknown> {
  return {
    browser_download_url: "deliberately-ignored-presentation-url",
    content_type: "application/gzip",
    digest: `sha256:${asset.digest}`,
    id,
    label: "deliberately ignored presentation label",
    name: asset.name,
    size: asset.size,
    state: "uploaded",
    uploader: actionsBot,
  };
}

function draftRecord(
  body: string,
  releaseAssets: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    assets: releaseAssets,
    author: actionsBot,
    body,
    draft: true,
    id: 901,
    immutable: false,
    name: `Oh ${tag}`,
    prerelease: false,
    published_at: null,
    tag_name: tag,
    target_commitish: "main-is-explicitly-not-authority",
  };
}

function publishedRecord(body: string): Record<string, unknown> {
  return {
    ...draftRecord(body, assets.map((asset, index) => assetRecord(asset, 1_000 + index))),
    draft: false,
    immutable: true,
    published_at: "2026-08-30T12:00:00Z",
  };
}

describe("exact GitHub Release artifact policy", () => {
  test("requires one exact checksum for the exact tarball bytes", () => {
    expect(assets.map((asset) => asset.name)).toEqual(["SHA256SUMS", "hraness-oh-0.2.3.tgz"]);
    expect(() => exactReleaseAssets("0.2.3", tarballBytes, Buffer.from("wrong\n"))).toThrow("does not describe");
    expect(() => assertExactReleaseAssetBytes(assets[1] as ExactReleaseAsset, tarballBytes)).not.toThrow();
    expect(() => assertExactReleaseAssetBytes(assets[1] as ExactReleaseAsset, Buffer.from("other bytes"))).toThrow("different bytes");
  });

  test("binds custom workflow inputs to the actual GitHub run and attempt", () => {
    expect(githubReleaseRun(tag, environment())).toEqual({
      attempt: 1,
      repositoryId: "1348230462",
      runId: "70000000001",
      workflowRef: `hraness/oh/.github/workflows/release.yml@refs/tags/${tag}`,
    });
    expect(() => githubReleaseRun(tag, { ...environment(), RELEASE_RUN_ID: "70000000002" })).toThrow("exact tag workflow run");
    expect(() => githubReleaseRun(tag, { ...environment(), RELEASE_RUN_ATTEMPT: "2" })).toThrow("exact tag workflow run");
    expect(() => githubReleaseRun(tag, { ...environment(), GITHUB_WORKFLOW_REF: "hraness/oh/.github/workflows/other.yml@refs/tags/v0.2.3" })).toThrow("exact tag workflow run");
  });
});

describe("bounded provider lookup", () => {
  const response = (status: number, body: unknown, contentType = "application/json; charset=utf-8") => Buffer.from(
    `HTTP/2.0 ${String(status)} Result\r\ncontent-type: ${contentType}\r\nx-github-request-id: exact\r\n\r\n${JSON.stringify(body)}`,
  );

  test("distinguishes authenticated draft, published, and exact missing states", () => {
    const draft = parseReleaseTagLookup(response(200, { draft: true, id: 901 }));
    expect(classifyReleaseTagLookup(draft.status, draft.body)).toEqual({ state: "draft", release: { draft: true, id: 901 } });
    const published = parseReleaseTagLookup(response(200, { draft: false, id: 901 }));
    expect(classifyReleaseTagLookup(published.status, published.body).state).toBe("published");
    const missing = parseReleaseTagLookup(response(404, { message: "Not Found" }));
    expect(classifyReleaseTagLookup(missing.status, missing.body)).toEqual({ state: "missing" });
  });

  test("rejects a published release plus any matching residual draft", () => {
    const published = classifyReleaseTagLookup(200, { draft: false, id: 901 });
    expect(planReleaseRecovery(published, [])).toEqual({ state: "published" });
    expect(() => planReleaseRecovery(published, [902])).toThrow("ambiguous residual drafts");
    const draft = classifyReleaseTagLookup(200, { draft: true, id: 901 });
    expect(planReleaseRecovery(draft, [901])).toEqual({ draftId: 901, state: "recover" });
    expect(() => planReleaseRecovery(draft, [])).toThrow("not uniquely confirmed");
    expect(() => planReleaseRecovery(draft, [902])).toThrow("not uniquely confirmed");
    const missing = classifyReleaseTagLookup(404, { message: "Not Found" });
    expect(planReleaseRecovery(missing, [])).toEqual({ state: "create" });
    expect(planReleaseRecovery(missing, [901])).toEqual({ draftId: 901, state: "recover" });
    expect(() => planReleaseRecovery(missing, [901, 902])).toThrow("ambiguous residual drafts");
  });

  test("rejects auth/provider failures and malformed status or content", () => {
    expect(() => classifyReleaseTagLookup(403, { message: "Resource not accessible" })).toThrow("HTTP 403");
    expect(() => classifyReleaseTagLookup(404, { message: "release not found later" })).toThrow("inexact missing");
    expect(() => parseReleaseTagLookup(response(200, {}, "text/plain"))).toThrow("JSON content type");
    expect(() => parseReleaseTagLookup(Buffer.from("not HTTP\n\n{}"))).toThrow("HTTP status");
  });

  test("accepts only projected, bounded, exhaustively paged inventory", () => {
    expect(parseReleaseInventoryPage([
      { draft: false, id: 1, tag_name: tag },
      { draft: true, id: 2, tag_name: "v0.2.2" },
      { draft: true, id: 3, tag_name: tag },
    ], tag)).toEqual({ candidateIds: [3], complete: true });
    expect(parseReleaseInventoryPage(Array.from({ length: 100 }, (_, index) => ({
      draft: false,
      id: index + 1,
      tag_name: `v0.1.${String(index)}`,
    })), tag).complete).toBe(false);
    expect(() => parseReleaseInventoryPage([{ draft: true, id: 3, tag_name: tag, unprojected: true }], tag)).toThrow("unexpected fields");
  });

  test("waits only for the exact newly-created draft inventory identity", () => {
    expect(classifyCreatedDraftInventory([], 901)).toBe("pending");
    expect(classifyCreatedDraftInventory([901], 901)).toBe("exact");
    expect(() => classifyCreatedDraftInventory([902], 901)).toThrow("not uniquely identified");
    expect(() => classifyCreatedDraftInventory([901, 902], 901)).toThrow("not uniquely identified");
    expect(() => classifyCreatedDraftInventory([901, 901], 901)).toThrow("duplicate identifiers");
  });

  test("converges a delayed later-attempt view from draft without inventory to publication", () => {
    expect(classifyCreatedDraftInventory([], 901)).toBe("pending");
    expect(classifyPublishedDraftInventory([], 901)).toBe("exact");
  });

  test("admits only exact bounded draft convergence before recovery and after publication", () => {
    expect(classifyLaterAttemptDraftInventory([])).toEqual({ state: "pending" });
    expect(classifyLaterAttemptDraftInventory([901])).toEqual({ draftId: 901, state: "recover" });
    expect(() => classifyLaterAttemptDraftInventory([901, 902])).toThrow("ambiguous residual drafts");
    expect(classifyPublishedDraftInventory([901], 901)).toBe("pending");
    expect(classifyPublishedDraftInventory([], 901)).toBe("exact");
    expect(() => classifyPublishedDraftInventory([902], 901)).toThrow("ambiguous residual draft inventory");
    expect(() => classifyPublishedDraftInventory([901, 901], 901)).toThrow("duplicate identifiers");
  });

  test("uses prior job metadata only to prove the Release writer never entered its mutation step", () => {
    const runId = "70000000001";
    const input = { attempt: 1, commitSha, runId };
    const job = (
      conclusion: string,
      publicationConclusion: string | undefined,
      overrides: Readonly<Record<string, unknown>> = {},
    ) => ({
      conclusion,
      head_sha: commitSha,
      id: 901,
      name: "Publish immutable GitHub Release",
      run_attempt: 1,
      run_id: Number(runId),
      run_url: `https://api.github.com/repos/hraness/oh/actions/runs/${runId}`,
      status: "completed",
      steps: publicationConclusion === undefined ? [] : [{
        conclusion: publicationConclusion,
        name: "Create and prove immutable GitHub Release from the exact bytes",
        status: "completed",
      }],
      workflow_name: "Release",
      ...overrides,
    });
    const response = (writer: unknown, extra: readonly unknown[] = []) => ({
      jobs: [writer, ...extra],
      total_count: 1 + extra.length,
    });

    expect(priorAttemptProvesNoDraftCreation(response(job("skipped", undefined)), input)).toBe(true);
    for (const conclusion of ["failure", "cancelled", "timed_out"]) {
      expect(priorAttemptProvesNoDraftCreation(response(job(conclusion, "skipped")), input)).toBe(true);
    }
    expect(priorAttemptProvesNoDraftCreation(response(job("failure", "failure")), input)).toBe(false);
    expect(priorAttemptProvesNoDraftCreation(response(job("success", "skipped")), input)).toBe(false);
    expect(() => priorAttemptProvesNoDraftCreation(
      response(job("skipped", undefined, { head_sha: "f".repeat(40) })),
      input,
    )).toThrow("malformed");
    expect(() => priorAttemptProvesNoDraftCreation(
      response(job("skipped", undefined), [job("skipped", undefined, { id: 902 })]),
      input,
    )).toThrow("one exact Release writer job");
    expect(() => priorAttemptProvesNoDraftCreation(
      { jobs: [job("skipped", undefined)], total_count: 2 },
      input,
    )).toThrow("count is inconsistent");
  });
});

describe("same-run draft recovery", () => {
  const firstRun = githubReleaseRun(tag, environment("70000000001", "1"));
  const secondRun = githubReleaseRun(tag, environment("70000000001", "2"));
  const firstInput = input(firstRun);
  const secondInput = input(secondRun);
  const body = draftReleaseBody(firstInput);

  test("resumes zero-, one-, or two-asset drafts on a later attempt", () => {
    expect(parseRecoverableDraft(draftRecord(body), secondInput)).toMatchObject({ id: 901, createdAttempt: 1 });
    expect(parseRecoverableDraft(draftRecord(body, [assetRecord(assets[0] as ExactReleaseAsset, 1_000)]), secondInput).assetIds.size).toBe(1);
    expect(parseRecoverableDraft(draftRecord(body, assets.map((asset, index) => assetRecord(asset, 1_000 + index))), secondInput).assetIds.size).toBe(2);
  });

  test("does not use target_commitish as authority or presentation metadata as bytes", () => {
    const release = draftRecord(body, [assetRecord(assets[0] as ExactReleaseAsset, 1_000)]);
    release.target_commitish = "a-different-branch-or-display-value";
    expect(() => parseRecoverableDraft(release, secondInput)).not.toThrow();
  });

  test("rejects another run, future attempt, tag object, commit, or edited marker", () => {
    const otherRun = githubReleaseRun(tag, environment("70000000002", "2"));
    expect(() => parseRecoverableDraft(draftRecord(body), input(otherRun))).toThrow("another release authority");
    expect(() => parseRecoverableDraft(draftRecord(draftReleaseBody(secondInput)), firstInput)).toThrow("attempt ordering");
    expect(() => parseRecoverableDraft(draftRecord(body), { ...secondInput, tagObjectSha: "3".repeat(40) })).toThrow("another release authority");
    expect(() => parseRecoverableDraft(draftRecord(body), { ...secondInput, commitSha: "4".repeat(40) })).toThrow("another release authority");
    expect(() => parseRecoverableDraft({ ...draftRecord(body), body: `${body} edited` }, secondInput)).toThrow("missing or edited");
  });

  test("rejects ambiguous, extra, duplicate, partial, wrong-digest, or wrong-uploader assets", () => {
    const checksum = assets[0] as ExactReleaseAsset;
    const exact = assetRecord(checksum, 1_000);
    expect(() => parseRecoverableDraft(draftRecord(body, [exact, exact]), secondInput)).toThrow("duplicate");
    expect(() => parseRecoverableDraft(draftRecord(body, [{ ...exact, name: "unexpected" }]), secondInput)).toThrow("unexpected asset");
    expect(() => parseRecoverableDraft(draftRecord(body, [{ ...exact, state: "new" }]), secondInput)).toThrow("does not match");
    expect(() => parseRecoverableDraft(draftRecord(body, [{ ...exact, digest: `sha256:${"0".repeat(64)}` }]), secondInput)).toThrow("does not match");
    expect(() => parseRecoverableDraft(draftRecord(body, [{ ...exact, uploader: { ...actionsBot, id: 1 } }]), secondInput)).toThrow("Actions bot");
    expect(() => parseRecoverableDraft(draftRecord(body, [...assets.map((asset, index) => assetRecord(asset, 1_000 + index)), { ...exact, id: 2_000 }]), secondInput)).toThrow("extra assets");
  });

  test("admits only immutable exact same-run publication with monotonic attempt identity", () => {
    const publishedBody = publishedReleaseBody(firstInput, 1);
    expect(() => assertPublishedReleaseIdentity(publishedRecord(publishedBody), secondInput)).not.toThrow();
    expect(() => assertPublishedReleaseIdentity({ ...publishedRecord(publishedBody), immutable: false }, secondInput)).toThrow("mutable, edited, or inexact");
    expect(() => assertPublishedReleaseIdentity({ ...publishedRecord(publishedBody), name: "edited" }, secondInput)).toThrow("mutable, edited, or inexact");
    const wrongUploader = publishedRecord(publishedBody);
    wrongUploader.assets = assets.map((asset, index) => ({
      ...assetRecord(asset, 1_000 + index),
      uploader: { ...actionsBot, id: 1 },
    }));
    expect(() => assertPublishedReleaseIdentity(wrongUploader, secondInput)).toThrow("Actions bot");
    expect(() => assertPublishedReleaseIdentity(publishedRecord(publishedReleaseBody(secondInput, 1)), firstInput)).toThrow("attempt ordering");
  });
});
