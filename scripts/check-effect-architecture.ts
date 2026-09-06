import { resolve } from "node:path";
import { createArchitectureProgram, inspectEffectArchitecture } from "./effect-architecture";

const root = resolve(import.meta.dir, "..");
const findings = inspectEffectArchitecture(createArchitectureProgram(resolve(root, "tsconfig.json")), {
  root,
  modules: ["src/semantic-platform.ts", "src/semantic-program.ts", "src/semantic-runtime.ts",
    "src/sync-platform.ts", "src/sync-program.ts", "src/sync-libsql-program.ts", "src/sync-runtime.ts"],
  adapters: ["src/semantic-platform.ts", "src/sync-platform.ts"],
  runtimeRoots: ["src/semantic-runtime.ts", "src/sync-runtime.ts"],
  ignoredDirectories: ["scripts", "tests/fixtures"],
});
for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule}: ${finding.message}`);
if (findings.length) process.exitCode = 1;
