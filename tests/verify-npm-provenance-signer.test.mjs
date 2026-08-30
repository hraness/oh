import { describe, expect, test } from "bun:test";
import { releaseSignerIdentity } from "../scripts/verify-npm-provenance-signer.mjs";

describe("npm Sigstore signer policy", () => {
  test("pins Fulcio identity, certificate OIDs, CT, and Rekor", () => {
    const sha = "a".repeat(40); const tag = "v1.2.3"; const ref = `refs/tags/${tag}`;
    const invocation = "https://github.com/hraness/oh/actions/runs/123/attempts/2";
    const policy = releaseSignerIdentity(tag, sha, invocation);
    expect(policy.options.certificateIssuer).toBe("https://token.actions.githubusercontent.com");
    expect(policy.options.certificateOIDs["1.3.6.1.4.1.57264.1.15"]).toBe("1348230462");
    expect(policy.options.certificateOIDs["1.3.6.1.4.1.57264.1.14"]).toBe(ref);
    expect(policy.options.certificateOIDs["1.3.6.1.4.1.57264.1.21"]).toBe(invocation);
    expect(policy.options.ctLogThreshold).toBe(1);
    expect(policy.options.tlogThreshold).toBe(1);
  });
});
