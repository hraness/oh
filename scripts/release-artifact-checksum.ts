import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const MAXIMUM_ARTIFACT_BYTES = 64 * 1_024 * 1_024;

export async function artifactChecksumLine(path: string): Promise<string> {
  const information = await stat(path);
  if (!information.isFile() || information.size <= 0 || information.size > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error("Release artifact must be one finite regular file within the public size bound.");
  }
  const bytes = await readFile(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${digest}  ${basename(path)}\n`;
}

async function main(): Promise<void> {
  const [mode, artifactArgument, manifestArgument, extra] = process.argv.slice(2);
  if (
    (mode !== "write" && mode !== "check")
    || artifactArgument === undefined
    || manifestArgument === undefined
    || extra !== undefined
  ) {
    throw new Error("Usage: release-artifact-checksum.ts <write|check> ARTIFACT SHA256SUMS");
  }
  const artifact = resolve(artifactArgument);
  const manifest = resolve(manifestArgument);
  const line = await artifactChecksumLine(artifact);
  if (mode === "write") {
    await writeFile(manifest, line, { encoding: "utf8", mode: 0o644 });
    console.log(`Wrote SHA-256 for ${basename(artifact)}.`);
    return;
  }
  const information = await stat(manifest);
  if (!information.isFile() || information.size > 256) {
    throw new Error("SHA256SUMS is not one bounded regular file.");
  }
  if (await readFile(manifest, "utf8") !== line) {
    throw new Error(`SHA-256 mismatch for ${basename(artifact)}.`);
  }
  console.log(`Verified SHA-256 for ${basename(artifact)}.`);
}

if (import.meta.main) await main();
