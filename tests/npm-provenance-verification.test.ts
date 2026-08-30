import { describe, expect, test } from "bun:test";

import { parseVerifiedNpmProvenance } from "../scripts/npm-provenance-verification";

const version = "1.2.3";
const verifiedTag = `v${version}`;
const verifiedSha = "b".repeat(40);
const sha512 = "a".repeat(128);

function audit(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ digest: { sha512 }, name: `pkg:npm/%40hraness/oh@${version}` }],
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: { workflow: {
          path: ".github/workflows/release.yml",
          ref: `refs/tags/${verifiedTag}`,
          repository: "https://github.com/hraness/oh",
        } },
        internalParameters: { github: { event_name: "push", repository_id: "1348230462" } },
        resolvedDependencies: [{
          digest: { gitCommit: verifiedSha },
          uri: `git+https://github.com/hraness/oh@refs/tags/${verifiedTag}`,
        }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: "https://github.com/hraness/oh/actions/runs/123/attempts/2" },
      },
    },
    ...overrides,
  };
  return {
    invalid: [],
    missing: [],
    verified: [{
      name: "@hraness/oh",
      version,
      location: "node_modules/@hraness/oh",
      registry: "https://registry.npmjs.org/",
      attestations: {
        url: `https://registry.npmjs.org/-/npm/v1/attestations/@hraness%2foh@${version}`,
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      },
      attestationBundles: [{
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: {
          mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64"),
            payloadType: "application/vnd.in-toto+json",
            signatures: [{ sig: "verified-by-npm" }],
          },
        },
      }],
    }],
  };
}

const coordinate = Object.freeze({ maximumAttempt: 3, requiredRunId: "123", sha512, verifiedSha, verifiedTag, version });

describe("npm provenance verification", () => {
  test("binds the verified Sigstore result to Oh's exact workflow, tag, commit, and tarball", () => {
    expect(() => parseVerifiedNpmProvenance(audit(), coordinate)).not.toThrow();
  });

  test("rejects a different reviewed commit", () => {
    const wrong = audit({
      predicate: {
        buildDefinition: {
          buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
          externalParameters: { workflow: {
            path: ".github/workflows/release.yml",
            ref: `refs/tags/${verifiedTag}`,
            repository: "https://github.com/hraness/oh",
          } },
          internalParameters: { github: { event_name: "push", repository_id: "1348230462" } },
          resolvedDependencies: [{
            digest: { gitCommit: "c".repeat(40) },
            uri: `git+https://github.com/hraness/oh@refs/tags/${verifiedTag}`,
          }],
        },
        runDetails: {
          builder: { id: "https://github.com/actions/runner/github-hosted" },
          metadata: { invocationId: "https://github.com/hraness/oh/actions/runs/123/attempts/2" },
        },
      },
    });
    expect(() => parseVerifiedNpmProvenance(wrong, coordinate)).toThrow("reviewed Git commit");
  });

  test("rejects missing and ambiguous npm verification results", () => {
    expect(() => parseVerifiedNpmProvenance({
      ...(audit() as Record<string, unknown>),
      missing: [{ name: "@hraness/oh" }],
    }, coordinate)).toThrow("exactly one provenance-bearing package");
    expect(() => parseVerifiedNpmProvenance({
      ...(audit() as Record<string, unknown>),
      verified: [],
    }, coordinate)).toThrow("exactly one provenance-bearing package");
  });

  test("rejects another run or a future attempt while read-only admission can omit that restriction", () => {
    expect(() => parseVerifiedNpmProvenance(audit(), { ...coordinate, requiredRunId: "999" })).toThrow("run attempt");
    expect(() => parseVerifiedNpmProvenance(audit(), { ...coordinate, maximumAttempt: 1 })).toThrow("run attempt");
    expect(() => parseVerifiedNpmProvenance(audit(), { sha512, verifiedSha, verifiedTag, version })).not.toThrow();
  });
});
