import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const site = resolve(import.meta.dir, "..");
const result = await Bun.build({
  entrypoints: [resolve(site, "browser/theme-bootstrap.ts")],
  target: "browser", format: "iife", minify: true, env: "disable",
});
assert(result.success, `Appearance bootstrap failed: ${result.logs.join("\n")}`);
assert.equal(result.outputs.length, 1);
await mkdir(resolve(site, "public"), { recursive: true });
const output = result.outputs[0];
assert(output, "Appearance bootstrap output is missing");
await Bun.write(resolve(site, "public/theme-bootstrap.js"), await output.text());
