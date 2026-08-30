import { describe, expect, test } from "bun:test";
import { githubReleaseEnvironment, publicReleaseEnvironment, trustedPublishingEnvironment } from "../scripts/release-process-environment";

const source = {
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc", ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.test/oidc",
  GH_TOKEN: "github", GITHUB_REF: "refs/tags/v1.2.3", GITHUB_REPOSITORY: "hraness/oh",
  GITHUB_REPOSITORY_ID: "1348230462", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "123",
  GITHUB_SERVER_URL: "https://github.com", GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_REF: "hraness/oh/.github/workflows/release.yml@refs/tags/v1.2.3",
  NODE_AUTH_TOKEN: "npm-secret", PATH: "/usr/bin:/bin", RUNNER_ENVIRONMENT: "github-hosted",
  PRIVATE_SECRET: "private",
} satisfies NodeJS.ProcessEnv;

describe("release subprocess environments", () => {
  test("public commands receive no ambient credentials", () => {
    expect(publicReleaseEnvironment({ CI: "true" }, source)).toEqual({ CI: "true", PATH: "/usr/bin:/bin" });
  });
  test("npm OIDC and GitHub write authority remain separate", () => {
    const npm = trustedPublishingEnvironment({}, source);
    expect(npm.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBe("oidc");
    expect(npm.GH_TOKEN).toBeUndefined();
    expect(npm.NODE_AUTH_TOKEN).toBeUndefined();
    const github = githubReleaseEnvironment({}, source);
    expect(github.GH_TOKEN).toBe("github");
    expect(github.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
    expect(github.PRIVATE_SECRET).toBeUndefined();
  });
});
