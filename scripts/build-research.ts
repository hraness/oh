import { rm } from "node:fs/promises";

// One split build preserves the private preparation registry across both entries.
// Only this build owns the directory, including stale content-addressed chunks.
const outdir = new URL("../dist/research-runtime/", import.meta.url).pathname;
await rm(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [new URL("../src/research.ts", import.meta.url).pathname,
    new URL("../src/research-store.ts", import.meta.url).pathname],
  outdir, target: "node", format: "esm", splitting: true,
});
if (!result.success) throw new AggregateError(result.logs, "Research profile build failed.");
