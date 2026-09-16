import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const supportCommit = "b32c1c81bb2444f50509ed54388758ecfab1f1c0";
const files: Readonly<Record<string, string>> = {
  "dist/node.js": "e5867b56351d8ebdf3d6a8de3dd8a992dd59aedfde930d1cc96adc806962de95",
  "package.json": "999a8120e720a45f18de70cbe3aac23b94f553d5b4d3dce1f4ee9f111c4b0b44",
  "LICENSE": "74b69bf37c8f340c9c2a54d431a15218738d9c463d0e014fa6a8bb8edce4e539",
};

const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { devDependencies?: Record<string, string> };
if (manifest.devDependencies?.["@hraness/support-foundation"] !== `github:hraness/support-foundation#${supportCommit}`) {
  throw new Error("The CLI support runtime must match the reviewed immutable release.");
}
for (const [path, expected] of Object.entries(files)) {
  const source = resolve(root, "node_modules/@hraness/support-foundation", path);
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) throw new Error("Invalid support runtime input.");
  if (createHash("sha256").update(await readFile(source)).digest("hex") !== expected) throw new Error(`Unreviewed support runtime ${path}.`);
}
const result = await Bun.build({ entrypoints: [resolve(root, "src/cli.ts")], target: "bun", format: "esm", external: ["bun:sqlite"], outdir: resolve(root, "dist"), metafile: true });
if (!result.success || result.outputs.length !== 1) throw new Error(`Oh CLI build failed: ${result.logs.map(String).join("\n")}`);
const supportInputs = Object.keys(result.metafile?.inputs ?? {}).filter(path => path.includes("node_modules/@hraness/support-foundation/"));
if (supportInputs.length !== 1 || !supportInputs[0]!.endsWith("node_modules/@hraness/support-foundation/dist/node.js")) {
  throw new Error("The bundled support runtime has unreviewed entrypoints.");
}
