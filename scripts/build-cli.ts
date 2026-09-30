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
const updaterFiles: Readonly<Record<string, string>> = {
  "package.json": "9c42b76bf94596e94fcc43694b9e31377e67910ecd5932d026ce2537ea8a80dd",
  "LICENSE": "74b69bf37c8f340c9c2a54d431a15218738d9c463d0e014fa6a8bb8edce4e539",
  "dist/src/index.js": "a5c9b94675dde012a51ed78582510727a6dcb70e88e6dcadc9784b5b351d1394",
  "dist/src/install.js": "19109fdb97bf8bd98b70d0deeafc019d3bf0fb905712ca5409e0472e0a31454d",
  "dist/src/provider.js": "2dddce9bd2f78f284a45dcef3d45be122cd63397f49eb3815f549e5a2dfd66ea",
  "dist/src/runtime.js": "a1d4b5cc70553cbbd54add72d5c10432e05fb0b0556fe400056525e5805dd504",
  "dist/src/semver.js": "732ac7c8a7033ddd0e0405f0760033faeeb864810cf2e94d234a9e5b69160788",
  "dist/src/state.js": "4faef8a78415972d7bc4d31e2646d0cd03e199591d7f8673ce8b2ec6547f2256"
};
if (manifest.devDependencies?.["@hraness/cli-update"] !== "https://github.com/hraness/cli-update/releases/download/v0.1.0/hraness-cli-update-0.1.0.tgz") {
  throw new Error("The CLI updater must match the reviewed immutable release.");
}
for (const [path, expected] of Object.entries(updaterFiles)) {
  const source = resolve(root, "node_modules/@hraness/cli-update", path);
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) throw new Error("Invalid CLI updater input.");
  if (createHash("sha256").update(await readFile(source)).digest("hex") !== expected) throw new Error(`Unreviewed CLI updater ${path}.`);
}
const result = await Bun.build({ entrypoints: [resolve(root, "src/cli-entry.ts")], target: "bun", format: "esm", external: ["bun:sqlite"], outdir: resolve(root, "dist"), naming: "cli.js", metafile: true });
if (!result.success || result.outputs.length !== 1) throw new Error(`Oh CLI build failed: ${result.logs.map(String).join("\n")}`);
const supportInputs = Object.keys(result.metafile?.inputs ?? {}).filter(path => path.includes("node_modules/@hraness/support-foundation/"));
if (supportInputs.length !== 1 || !supportInputs[0]!.endsWith("node_modules/@hraness/support-foundation/dist/node.js")) {
  throw new Error("The bundled support runtime has unreviewed entrypoints.");
}

const updaterInputs = Object.keys(result.metafile?.inputs ?? {})
  .filter(path => path.includes("node_modules/@hraness/cli-update/"))
  .map(path => path.split("node_modules/@hraness/cli-update/").at(-1));
const expectedUpdaterInputs = Object.keys(updaterFiles).filter(path => path.endsWith(".js"));
if (JSON.stringify(updaterInputs.sort()) !== JSON.stringify(expectedUpdaterInputs.sort())) {
  throw new Error("The bundled CLI updater has unreviewed entrypoints.");
}
