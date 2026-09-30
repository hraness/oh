import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test.skipIf(process.platform !== "darwin")("default unsigned Mac helper is rejected before execution or output creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "oh-signature-integration-"));
  const prior = process.env.HRANESS_OH_SQLITE_CLI_PATH;
  try {
    await mkdir(join(root, "src"));
    for (const name of ["sqlite-snapshot.ts", "macos-sidecar-signature.ts"]) {
      await cp(join(import.meta.dir, name), join(root, "src", name));
    }
    const folder = join(root, "dist/rust-artifacts/oh-sqlite", `darwin-${process.arch}`);
    await mkdir(folder, { recursive: true });
    const marker = join(root, "executed");
    await writeFile(join(folder, "oh-sqlite-cli"), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    delete process.env.HRANESS_OH_SQLITE_CLI_PATH;
    const snapshot = await import(pathToFileURL(join(root, "src/sqlite-snapshot.ts")).href) as typeof import("./sqlite-snapshot");
    const options = { sourcePath: join(root, "source.sqlite"), outputDirectory: join(root, "output") };
    await expect(snapshot.snapshotDatabase(options)).rejects.toBeInstanceOf(snapshot.MacOsSidecarSignatureError);
    expect(() => snapshot.snapshotDatabaseSync(options)).toThrow(snapshot.MacOsSidecarSignatureError);
    expect(await stat(marker).catch(() => null)).toBeNull();
    expect(await stat(options.outputDirectory).catch(() => null)).toBeNull();
  } finally {
    if (prior === undefined) delete process.env.HRANESS_OH_SQLITE_CLI_PATH;
    else process.env.HRANESS_OH_SQLITE_CLI_PATH = prior;
    await rm(root, { recursive: true, force: true });
  }
});
