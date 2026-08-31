import { describe, expect, test } from "bun:test";
import {
  fulcioV2CertificateOIDValue,
  releaseSignerIdentity,
} from "../scripts/verify-npm-provenance-signer.mjs";

function derUtf8String(value) {
  return `${String.fromCharCode(0x0c, Buffer.byteLength(value, "ascii"))}${value}`;
}

describe("npm Sigstore signer policy", () => {
  test("pins Fulcio identity, certificate OIDs, CT, and Rekor", () => {
    const sha = "a".repeat(40); const tag = "v1.2.3"; const ref = `refs/tags/${tag}`;
    const invocation = "https://github.com/hraness/oh/actions/runs/123/attempts/2";
    const policy = releaseSignerIdentity(tag, sha, invocation);
    expect(policy.options.certificateIssuer).toBe("https://token.actions.githubusercontent.com");
    expect(policy.options.certificateOIDs).toEqual({
      "1.3.6.1.4.1.57264.1.2": "push",
      "1.3.6.1.4.1.57264.1.3": sha,
      "1.3.6.1.4.1.57264.1.5": "hraness/oh",
      "1.3.6.1.4.1.57264.1.6": ref,
      "1.3.6.1.4.1.57264.1.11": derUtf8String("github-hosted"),
      "1.3.6.1.4.1.57264.1.12": derUtf8String("https://github.com/hraness/oh"),
      "1.3.6.1.4.1.57264.1.13": derUtf8String(sha),
      "1.3.6.1.4.1.57264.1.14": derUtf8String(ref),
      "1.3.6.1.4.1.57264.1.15": derUtf8String("1348230462"),
      "1.3.6.1.4.1.57264.1.18": derUtf8String(`https://github.com/hraness/oh/.github/workflows/release.yml@${ref}`),
      "1.3.6.1.4.1.57264.1.19": derUtf8String(sha),
      "1.3.6.1.4.1.57264.1.20": derUtf8String("push"),
      "1.3.6.1.4.1.57264.1.21": derUtf8String(invocation),
      "1.3.6.1.4.1.57264.1.22": derUtf8String("public"),
      "1.3.6.1.4.1.57264.1.24":
        derUtf8String(`repo:hraness@307125679/oh@1348230462:ref:${ref}`),
    });
    const subjectClaim = Buffer.from(policy.options.certificateOIDs["1.3.6.1.4.1.57264.1.24"]);
    expect([...subjectClaim.subarray(0, 2)]).toEqual([0x0c, subjectClaim.byteLength - 2]);
    expect(subjectClaim.subarray(2).toString("ascii"))
      .toBe(`repo:hraness@307125679/oh@1348230462:ref:${ref}`);
    expect(policy.options.ctLogThreshold).toBe(1);
    expect(policy.options.tlogThreshold).toBe(1);
  });

  test("encodes only bounded canonical short-form DER UTF8String values", () => {
    expect(Buffer.from(fulcioV2CertificateOIDValue("a".repeat(127))))
      .toEqual(Buffer.concat([Buffer.from([0x0c, 127]), Buffer.from("a".repeat(127))]));
    expect(() => fulcioV2CertificateOIDValue("")).toThrow("nonempty printable ASCII");
    expect(() => fulcioV2CertificateOIDValue("café")).toThrow("nonempty printable ASCII");
    expect(() => fulcioV2CertificateOIDValue("a".repeat(128))).toThrow("short-form bound");
  });
});
