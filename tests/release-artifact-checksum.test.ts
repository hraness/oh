import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../scripts/release-artifact-checksum.ts");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("exact package consumer rejects a substituted archive and matching adjacent checksum", async () => {
  const root = await mkdtemp(join(tmpdir(), "oh-release-bytes-"));
  try {
    const archive = join(root, "package.tgz");
    const manifest = join(root, "SHA256SUMS");
    const original = "original signed package";
    const originalManifest = `${hash(original)}  package.tgz\n`;
    const env = { ...process.env, RELEASE_REQUIRE_EXPECTED_HASHES: "1",
      EXPECTED_PACKAGE_SHA256: hash(original), EXPECTED_CHECKSUM_SHA256: hash(originalManifest) };
    async function check() {
      const child = Bun.spawn([process.execPath, script, "check", archive, manifest], { env, stdout: "ignore", stderr: "ignore" });
      return child.exited;
    }
    await writeFile(archive, original);
    await writeFile(manifest, originalManifest);
    expect(await check()).toBe(0);
    const replacement = "other package with unsigned helpers";
    await writeFile(archive, replacement);
    await writeFile(manifest, `${hash(replacement)}  package.tgz\n`);
    expect(await check()).not.toBe(0);
    env.EXPECTED_PACKAGE_SHA256 = "";
    expect(await check()).not.toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
