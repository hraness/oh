import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { chmodSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertVerifiedMacSidecar, MacOsSidecarSignatureError, verifyMacSidecar, verifyMacSidecarSync } from "./macos-sidecar-signature";

let directory: string;
let binary: string;
const restorers: (() => void)[] = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "mac-signature-test-"));
  binary = join(directory, "helper");
  writeFileSync(binary, "synthetic executable", { mode: 0o755 });
});
afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
  rmSync(directory, { recursive: true, force: true });
});

function successfulVerifier() {
  const mock = spyOn(childProcess, "spawnSync").mockReturnValue({
    pid: 1, output: [], stdout: null, stderr: null, status: 0, signal: null,
  } as unknown as ReturnType<typeof childProcess.spawnSync>);
  restorers.push(() => mock.mockRestore());
  return mock;
}

test("verifies fixed Developer ID identity using a bounded system verifier", () => {
  const mock = successfulVerifier();
  const identity = verifyMacSidecarSync(binary);
  expect(identity.size).toBe(20n);
  const [command, args, options] = mock.mock.calls[0]!;
  expect(command).toBe("/usr/bin/codesign");
  expect(args).toContain("--strict");
  expect(args).toContain("--all-architectures");
  expect(String(args)).toContain('identifier "dev.hraness.oh.sqlite-cli"');
  expect(String(args)).toContain('subject.OU] = "8AAP53VTW3"');
  expect(String(args)).toContain("1.2.840.113635.100.6.1.13");
  expect(options).toMatchObject({ timeout: 10_000, killSignal: "SIGKILL", stdio: "ignore" });
  expect(options?.env).toEqual({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" });
});

test("replacement and mutation after verification are rejected", () => {
  successfulVerifier();
  const first = verifyMacSidecarSync(binary);
  writeFileSync(binary, "changed");
  expect(() => assertVerifiedMacSidecar(binary, first)).toThrow(MacOsSidecarSignatureError);
  const second = verifyMacSidecarSync(binary);
  renameSync(binary, join(directory, "old"));
  writeFileSync(binary, "changed", { mode: 0o755 });
  expect(() => assertVerifiedMacSidecar(binary, second)).toThrow(MacOsSidecarSignatureError);
});

test("a file replaced during codesign is rejected", () => {
  const mock = successfulVerifier();
  mock.mockImplementation((() => {
    writeFileSync(binary, "replacement");
    return { pid: 1, output: [], stdout: null, stderr: null, status: 0, signal: null } as unknown as ReturnType<typeof childProcess.spawnSync>;
  }) as typeof childProcess.spawnSync);
  expect(() => verifyMacSidecarSync(binary)).toThrow(MacOsSidecarSignatureError);
});

test("symlinks, non-executables, and missing files fail before codesign", () => {
  const mock = successfulVerifier();
  const link = join(directory, "link");
  symlinkSync(binary, link);
  expect(() => verifyMacSidecarSync(link)).toThrow(MacOsSidecarSignatureError);
  chmodSync(binary, 0o600);
  expect(() => verifyMacSidecarSync(binary)).toThrow(MacOsSidecarSignatureError);
  expect(() => verifyMacSidecarSync(join(directory, "absent"))).toThrow(MacOsSidecarSignatureError);
  expect(mock).not.toHaveBeenCalled();
});

test("codesign failures and exceptions never expose diagnostics", () => {
  const mock = successfulVerifier();
  mock.mockImplementation(() => { throw new Error("secret diagnostic"); });
  expect(() => verifyMacSidecarSync(binary)).toThrow(MacOsSidecarSignatureError);
  expect(() => verifyMacSidecarSync(binary)).not.toThrow("secret diagnostic");
});

test("asynchronous verifier returns the same sanitized error on launch failure", async () => {
  const mock = spyOn(childProcess, "execFile").mockImplementation((() => { throw new Error("secret diagnostic"); }) as unknown as typeof childProcess.execFile);
  restorers.push(() => mock.mockRestore());
  await expect(verifyMacSidecar(binary)).rejects.toBeInstanceOf(MacOsSidecarSignatureError);
});

test("asynchronous verifier rejects wrong team or unsigned helpers", async () => {
  const mock = spyOn(childProcess, "execFile").mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null) => void;
    callback(new Error("wrong signer secret diagnostic"));
    return {} as childProcess.ChildProcess;
  }) as unknown as typeof childProcess.execFile);
  restorers.push(() => mock.mockRestore());
  await expect(verifyMacSidecar(binary)).rejects.toBeInstanceOf(MacOsSidecarSignatureError);
});
