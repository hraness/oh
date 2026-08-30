import { pathToFileURL } from "node:url";

const PACKAGE_REPOSITORY = "hraness/oh";
const REPOSITORY_ID = "1348230462";
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const SHA = /^[0-9a-f]{40}$/u;
const STABLE_TAG = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const RUN_INVOCATION = /^https:\/\/github\.com\/hraness\/oh\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*$/u;
const MAXIMUM_BUNDLE_BYTES = 4 * 1_024 * 1_024;

function escapeRegularExpression(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

export function releaseSignerIdentity(tag, sha, invocation) {
  if (!STABLE_TAG.test(tag) || !SHA.test(sha) || !RUN_INVOCATION.test(invocation)) {
    throw new Error("Sigstore release signer coordinates are invalid.");
  }
  const ref = `refs/tags/${tag}`;
  const identity = `https://github.com/${PACKAGE_REPOSITORY}/.github/workflows/release.yml@${ref}`;
  return Object.freeze({
    identity,
    options: Object.freeze({
      certificateIdentityURI: `^${escapeRegularExpression(identity)}$`,
      certificateIssuer: GITHUB_OIDC_ISSUER,
      certificateOIDs: Object.freeze({
        "1.3.6.1.4.1.57264.1.2": "push", "1.3.6.1.4.1.57264.1.3": sha,
        "1.3.6.1.4.1.57264.1.5": PACKAGE_REPOSITORY, "1.3.6.1.4.1.57264.1.6": ref,
        "1.3.6.1.4.1.57264.1.11": "github-hosted",
        "1.3.6.1.4.1.57264.1.12": `https://github.com/${PACKAGE_REPOSITORY}`,
        "1.3.6.1.4.1.57264.1.13": sha, "1.3.6.1.4.1.57264.1.14": ref,
        "1.3.6.1.4.1.57264.1.15": REPOSITORY_ID, "1.3.6.1.4.1.57264.1.18": identity,
        "1.3.6.1.4.1.57264.1.19": sha, "1.3.6.1.4.1.57264.1.20": "push",
        "1.3.6.1.4.1.57264.1.21": invocation, "1.3.6.1.4.1.57264.1.22": "public",
        "1.3.6.1.4.1.57264.1.24": `repo:${PACKAGE_REPOSITORY}:ref:${ref}`,
      }),
      ctLogThreshold: 1, tlogThreshold: 1, timeout: 10_000,
    }),
  });
}

async function readBoundedStandardInput() {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.byteLength;
    if (length > MAXIMUM_BUNDLE_BYTES) throw new Error("Sigstore bundle input exceeded its bound.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

async function main() {
  const [tag, sha, invocation, cachePath] = process.argv.slice(2);
  if (!tag || !sha || !invocation || !cachePath) throw new Error("Usage: signer TAG SHA INVOCATION CACHE_PATH");
  const policy = releaseSignerIdentity(tag, sha, invocation);
  let bundle;
  try { bundle = JSON.parse((await readBoundedStandardInput()).toString("utf8")); }
  catch { throw new Error("Sigstore bundle input is not JSON."); }
  const { verify } = await import("sigstore");
  const signer = await verify(bundle, { ...policy.options, tufCachePath: cachePath, tufForceCache: true });
  if (signer.identity?.subjectAlternativeName !== policy.identity || signer.identity?.extensions?.issuer !== GITHUB_OIDC_ISSUER) {
    throw new Error("Sigstore verified the wrong release signer identity.");
  }
  process.stdout.write("verified\n");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  try { await main(); } catch { process.stderr.write("Sigstore release signer verification failed.\n"); process.exitCode = 1; }
}
