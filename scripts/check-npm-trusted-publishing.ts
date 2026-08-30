import { publicReleaseEnvironment } from "./release-process-environment";
import { runBoundedProcess } from "./run-bounded-process";

const result = await runBoundedProcess(["npm", "--version"], {
  env: publicReleaseEnvironment(), stderrBytes: 1_024, stdoutBytes: 128, timeoutMs: 10_000,
});
if (result.exitCode !== 0) throw new Error("npm --version failed with diagnostics redacted.");
const version = result.stdout.toString("utf8").trim();
const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/u.exec(version);
if (match === null) throw new Error(`npm returned an invalid version: ${version}`);
const [, majorText, minorText, patchText] = match;
const [major, minor, patch] = [majorText, minorText, patchText].map(Number) as [number, number, number];
const supported = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
if (!supported) throw new Error(`npm ${version} is too old for trusted publishing; require >=11.5.1.`);
console.log(`npm ${version} supports trusted publishing.`);
