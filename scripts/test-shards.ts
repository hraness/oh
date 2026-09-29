// Runs `bun test` as several concurrent `--shard=i/N` processes, each a plain
// serial runner, and prints every shard's output once it finishes. Separate
// processes keep the default runner's behavior; `bun test --parallel` implies
// `--isolate`, which reuses a worker across files and hung tests in CI.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

const requested = Number(process.env.OH_TEST_SHARDS ?? "4");
if (!Number.isInteger(requested) || requested < 1) {
  throw new Error("OH_TEST_SHARDS must be a positive integer.");
}
const shards = Math.min(requested, Math.max(1, availableParallelism()));
const args = process.argv.slice(2);
const directory = await mkdtemp(join(tmpdir(), "oh-test-shards-"));

try {
  const runs = Array.from({ length: shards }, async (_, index) => {
    const log = join(directory, `shard-${index + 1}.log`);
    const command = shards === 1 ? ["bun", "test", ...args] : ["bun", "test", `--shard=${index + 1}/${shards}`, ...args];
    const child = Bun.spawn(command, { stdin: "ignore", stdout: Bun.file(log), stderr: "pipe" });
    const stderr = await new Response(child.stderr).text();
    const exitCode = await child.exited;
    return { exitCode, index, output: `${await readFile(log, "utf8")}${stderr}` };
  });
  let failed = 0;
  for (const run of runs) {
    const { exitCode, index, output } = await run;
    process.stdout.write(`\n==> bun test shard ${index + 1}/${shards} (exit ${exitCode})\n${output}`);
    if (exitCode !== 0) failed += 1;
  }
  if (failed > 0) {
    process.stderr.write(`${failed} of ${shards} bun test shards failed.\n`);
    process.exitCode = 1;
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
