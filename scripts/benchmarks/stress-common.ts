// Shared offline guard for the repository stress helpers.
//
// Importing this module must not run a suite, touch a database, spawn a child, change global fetch,
// read process.argv, or set process exit state. Only Node built-ins and type-only repository imports
// are static; io.codeIdentity is loaded at runtime after the network tripwire is installed.
import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type StressCodeIdentity = Awaited<ReturnType<typeof import("./io").codeIdentity>>;
export type StressArguments = Readonly<{ expectedSourceSha256: string; outputPath: string }>;
export type StressRun = Readonly<{
  root: string;
  outputPath: string;
  expectedSourceSha256: string;
  identityBefore: StressCodeIdentity;
  helperSha256Before: string;
  networkAttempts: () => number;
  restoreFetch: () => void;
}>;
export type StressFinish = Readonly<{
  identityAfter: StressCodeIdentity;
  helperSha256After: string;
  networkAttempts: number;
}>;

const MAX_REPORT_BYTES = 128 * 1024 * 1024;
const EXPECTED_SHA256 = /^[a-f0-9]{64}$/u;

type SessionState = {
  helperPath: string;
  originalFetch: typeof fetch;
  guard: typeof fetch | null;
  attempts: number;
  restored: boolean;
};

// Private session state: one guard session per process, never exposed through the public types.
let activeSession: SessionState | null = null;
const sessionsByRun = new WeakMap<StressRun, SessionState>();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (error as { code?: unknown }).code === "ENOENT";
}

function outsideRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

export function parseStressArguments(argv: readonly string[]): StressArguments {
  let expectedSourceSha256: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--expected-source-sha256" && flag !== "--output") {
      throw new Error(`unknown or positional argument: ${String(flag)}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--") || value.includes("\u0000")) {
      throw new Error(`${flag} requires one nonempty value`);
    }
    if (flag === "--expected-source-sha256") {
      if (expectedSourceSha256 !== undefined) throw new Error("--expected-source-sha256 was supplied more than once");
      expectedSourceSha256 = value;
    } else {
      if (outputPath !== undefined) throw new Error("--output was supplied more than once");
      outputPath = value;
    }
    index += 1;
  }
  if (expectedSourceSha256 === undefined || !EXPECTED_SHA256.test(expectedSourceSha256)) {
    throw new Error("--expected-source-sha256 is required and must be 64 lowercase hex digits");
  }
  if (outputPath === undefined || !isAbsolute(outputPath) || !outputPath.endsWith(".json")) {
    throw new Error("--output is required and must be an absolute path to a new .json file");
  }
  return { expectedSourceSha256, outputPath: resolve(outputPath) };
}

// Resolves the output's existing real parent and refuses any destination that already exists,
// is inside the repository, or is a dangling symlink. It never creates directories or files.
async function resolveDestination(root: string, outputPath: string): Promise<string> {
  const name = basename(outputPath);
  if (name.length === 0 || name === "." || name === "..") throw new Error("output must name a new file");
  const parent = await realpath(dirname(outputPath));
  const parentStat = await stat(parent);
  if (!parentStat.isDirectory()) throw new Error("output parent must be an existing directory");
  const destination = join(parent, name);
  if (!outsideRoot(root, destination)) throw new Error("output must be outside the repository root");
  const exists = await lstat(destination).then(() => true, (error: unknown) => {
    if (isMissing(error)) return false;
    throw error;
  });
  if (exists) throw new Error("output destination already exists");
  return destination;
}

export async function beginStressRun(helperUrl: URL, args: StressArguments): Promise<StressRun> {
  if (activeSession !== null) throw new Error("a stress guard session is already active in this process");
  const state: SessionState = {
    helperPath: "", originalFetch: globalThis.fetch, guard: null, attempts: 0, restored: false,
  };
  activeSession = state;
  const restoreFetch = () => {
    if (state.restored) return;
    state.restored = true;
    if (activeSession === state) {
      globalThis.fetch = state.originalFetch;
      activeSession = null;
    }
  };
  try {
    const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
    const helperPath = await realpath(fileURLToPath(helperUrl));
    const helperStat = await stat(helperPath);
    if (!helperStat.isFile() || outsideRoot(root, helperPath) || helperPath === root) {
      throw new Error("the helper must be a real file inside the repository");
    }
    state.helperPath = helperPath;
    const outputPath = await resolveDestination(root, args.outputPath);

    const guard = ((): never => {
      state.attempts += 1;
      throw new Error("offline stress helper: global network access is disabled");
    }) as unknown as typeof fetch;
    state.guard = guard;
    globalThis.fetch = guard;

    const io = await import("./io");
    const identityBefore = await io.codeIdentity();
    if (identityBefore.sourceSha256 !== args.expectedSourceSha256) {
      throw new Error("repository source digest does not match the supplied expected hash before the run");
    }
    const helperSha256Before = sha256(await readFile(helperPath));
    const run: StressRun = {
      root,
      outputPath,
      expectedSourceSha256: args.expectedSourceSha256,
      identityBefore,
      helperSha256Before,
      networkAttempts: () => state.attempts,
      restoreFetch,
    };
    sessionsByRun.set(run, state);
    return run;
  } catch (error) {
    restoreFetch();
    throw error;
  }
}

export async function finishStressRun(run: StressRun): Promise<StressFinish> {
  const state = sessionsByRun.get(run);
  if (state === undefined) throw new Error("finishStressRun received an unknown stress run");
  const assertGuardActive = () => {
    if (activeSession !== state || state.restored || state.guard === null || globalThis.fetch !== state.guard) {
      throw new Error("the stress network guard must remain active until finish completes");
    }
  };
  assertGuardActive();
  const io = await import("./io");
  const identityAfter = await io.codeIdentity();
  const helperSha256After = sha256(await readFile(state.helperPath));
  assertGuardActive();
  if (run.identityBefore.sourceSha256 !== run.expectedSourceSha256
    || identityAfter.sourceSha256 !== run.expectedSourceSha256) {
    throw new Error("repository source digest is not identical to the expected hash before and after the run");
  }
  if (helperSha256After !== run.helperSha256Before) {
    throw new Error("the helper file digest changed during its own run");
  }
  const networkAttempts = run.networkAttempts();
  if (networkAttempts !== 0) {
    throw new Error(`${networkAttempts} global fetch attempt(s) were blocked during the run`);
  }
  return { identityAfter, helperSha256After, networkAttempts };
}

export async function writeStressReport(run: StressRun, report: unknown): Promise<void> {
  const destination = await resolveDestination(run.root, run.outputPath);
  if (destination !== run.outputPath) throw new Error("the output destination changed during the run");
  const json = JSON.stringify(report, null, 2);
  if (typeof json !== "string") throw new TypeError("the stress report is not JSON serializable");
  const bytes = Buffer.from(`${json}\n`, "utf8");
  if (bytes.byteLength > MAX_REPORT_BYTES) throw new RangeError("the stress report exceeds 128 MiB");
  const handle = await open(destination, "wx", 0o600);
  try {
    let written = 0;
    while (written < bytes.byteLength) {
      const result = await handle.write(bytes, written, bytes.byteLength - written);
      if (result.bytesWritten <= 0) throw new Error("the stress report write made no progress");
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}
