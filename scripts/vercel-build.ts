import { $ } from "bun";

// Vercel's repo-root deployment runs `vercel-build` before falling back to
// `build`. The stock build image has no Rust toolchain, so provision the same
// stable + wasm32 + wasm-pack setup CI uses, then run the ordinary build.

const cargoBin = `${process.env.HOME ?? ""}/.cargo/bin`;
process.env.PATH = `${cargoBin}:${process.env.PATH ?? ""}`;

async function has(command: string): Promise<boolean> {
  return (await $`command -v ${command}`.quiet().nothrow()).exitCode === 0;
}

if (!(await has("cargo"))) {
  await $`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown`;
}
if (!(await has("wasm-pack"))) {
  await $`curl --proto '=https' --tlsv1.2 -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh`;
}

await $`bun run build`;
