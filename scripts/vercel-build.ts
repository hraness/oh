import { $ } from "bun";

// Vercel's repo-root deployment runs `vercel-build` before falling back to
// `build`. The build image ships a standalone non-rustup Rust at /rust/bin
// (CARGO_HOME=/rust) with no wasm32 target, so provision rustup + the wasm32
// target + wasm-pack the way CI does, then run the ordinary build. The
// rustup shims land in $CARGO_HOME/bin and shadow the standalone binaries.

const home = process.env.HOME ?? "";
const cargoHome = process.env.CARGO_HOME ?? `${home}/.cargo`;
process.env.PATH = `${cargoHome}/bin:${home}/.cargo/bin:${process.env.PATH ?? ""}`;

async function has(command: string): Promise<boolean> {
  return (await $`command -v ${command}`.quiet().nothrow()).exitCode === 0;
}

if (await has("rustup")) {
  await $`rustup target add wasm32-unknown-unknown`;
} else {
  await $`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown`;
}
if (!(await has("wasm-pack"))) {
  await $`curl --proto '=https' --tlsv1.2 -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh`;
}

await $`bun run build`;

// The repo-root project deploys as Framework "Other", which requires a
// `public/` output directory once a build command runs. Publish the built
// runtime (JS bundles + generated Rust/WASM artifacts) exactly as `dist/`
// laid it out.
const { cp, rm } = await import("node:fs/promises");
const root = new URL("..", import.meta.url).pathname;
await rm(`${root}public`, { recursive: true, force: true });
await cp(`${root}dist`, `${root}public`, { recursive: true });
