/** Immutable local checkpoints. The caller owns the directory and drains children before close(). */
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath, unlink, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalJson, isPlainRecord, sha256Hex } from "../../src/canonical";
import { CLAUDE_SUBSCRIPTION_PROFILE, parseClaudeCompletion, type ClaudeInvocation } from "./claude-subscription";

const PROFILE = "oh.claude-study-store.v1";
const MAX_STDOUT = 16 * 1024 * 1024, MAX_STDERR = 1024 * 1024, MAX_RESULT = 4 * 1024 * 1024;
const MESSAGES = {
  "invalid-input": "Invalid Claude study store input.", locked: "Claude study store is already locked.",
  closed: "Claude study store is closed.", binding: "Claude study checkpoint binding mismatch.",
  evidence: "Invalid Claude study checkpoint evidence.", incomplete: "Claude study job already exists; automatic retry is prohibited.",
  custody: "Claude study store ownership changed.", io: "Claude study checkpoint I/O failed.",
} as const;
export class ClaudeStudyStoreError extends Error {
  constructor(readonly code: keyof typeof MESSAGES) { super(MESSAGES[code]); this.name = "ClaudeStudyStoreError"; }
}
export type ClaudeStudyLookup = Readonly<{ state: "missing" }>
  | Readonly<{ state: "incomplete"; reason: "pending" }>
  | Readonly<{ state: "incomplete"; reason: "transport"; invocation: ClaudeInvocation }>
  | Readonly<{ state: "completed"; invocation: ClaudeInvocation }>;
export type ClaudeStudyStore = Readonly<{
  lookup(jobKey: string, requestSha256: string, expectedModel: string): Promise<ClaudeStudyLookup>;
  begin(jobKey: string, requestSha256: string): Promise<Readonly<{ stdoutPath: string; stderrPath: string }>>;
  complete(jobKey: string, requestSha256: string, invocation: ClaudeInvocation): Promise<void>;
  close(): Promise<void>;
}>;
type Identity = Readonly<{ dev: number; ino: number }>;
type Facts = Omit<ClaudeInvocation, "completion" | "status">;
function fail(code: keyof typeof MESSAGES): never { throw new ClaudeStudyStoreError(code); }
function code(error: unknown): unknown { return isPlainRecord(error) ? error.code : error instanceof Error && "code" in error ? error.code : undefined; }
function digest(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("invalid-input"); return value; }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("evidence");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) fail("evidence");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("evidence");
  }
  return value;
}
function bytesFact(value: unknown, maximum: number): Readonly<{ bytes: number; sha256: string }> {
  const data = record(value, ["bytes", "sha256"]);
  if (typeof data.bytes !== "number" || !Number.isSafeInteger(data.bytes) || data.bytes < 0
    || Object.is(data.bytes, -0) || data.bytes > maximum) fail("evidence");
  return Object.freeze({ bytes: data.bytes, sha256: digest(data.sha256) });
}
function facts(value: unknown, fullInvocation: boolean): Facts {
  const keys = ["protocol", "requestSha256", "exitCode", "timedOut", "outputBoundExceeded", "stdout", "stderr"];
  const data = record(value, fullInvocation ? [...keys, "completion", "status"] : keys);
  if (data.protocol !== CLAUDE_SUBSCRIPTION_PROFILE || typeof data.exitCode !== "number"
    || !Number.isSafeInteger(data.exitCode) || Object.is(data.exitCode, -0)
    || data.exitCode < -255 || data.exitCode > 255 || typeof data.timedOut !== "boolean"
    || typeof data.outputBoundExceeded !== "boolean") fail("evidence");
  return Object.freeze({ protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: digest(data.requestSha256),
    exitCode: data.exitCode, timedOut: data.timedOut, outputBoundExceeded: data.outputBoundExceeded,
    stdout: bytesFact(data.stdout, MAX_STDOUT), stderr: bytesFact(data.stderr, MAX_STDERR) });
}
function owned(stat: Stats, directory: boolean): void {
  if (!(directory ? stat.isDirectory() : stat.isFile()) || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)
    || (!directory && stat.nlink !== 1) || (process.getuid && stat.uid !== process.getuid())) fail("custody");
}
function same(left: Identity, right: Identity): boolean { return left.dev === right.dev && left.ino === right.ino; }
async function directoryIdentity(path: string): Promise<Identity> {
  const info = await lstat(path); owned(info, true); return { dev: info.dev, ino: info.ino };
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeExclusive(path: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(canonicalJson(value) + "\n");
  if (bytes.length > MAX_RESULT) fail("evidence");
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.write(bytes, offset, bytes.length - offset);
      if (result.bytesWritten <= 0) fail("io");
      offset += result.bytesWritten;
    }
    await handle.sync();
  } finally { await handle.close(); }
}
/** Read only a fixed derived file, with a bound checked before allocating or decoding. */
async function readBounded(path: string, maximum: number): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat(); owned(before, false);
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maximum) fail("evidence");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead <= 0) fail("evidence");
      offset += result.bytesRead;
    }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, offset);
    const after = await handle.stat();
    if (extra.bytesRead !== 0 || !same(before, after) || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail("custody");
    return bytes;
  } finally { await handle.close(); }
}
async function readJson(path: string, maximum = MAX_RESULT): Promise<unknown> {
  const raw = await readBounded(path, maximum);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { return fail("evidence"); }
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if (code(error) === "ENOENT") return false; throw error; }
}
async function safe<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) { if (error instanceof ClaudeStudyStoreError) throw error; return fail("io"); }
}

/** Existing caller-owned directory only. No stale-lock repair, retry, file replacement, or child-process custody. */
export async function openClaudeStudyStore(input: Readonly<{ directory: string; freezeSha256: string }>): Promise<ClaudeStudyStore> {
  return safe(async () => {
    const data = record(input, ["directory", "freezeSha256"]);
    const directory = data.directory, freezeSha256 = digest(data.freezeSha256);
    if (typeof directory !== "string" || !isAbsolute(directory) || resolve(directory) !== directory
      || directory.includes("\u0000") || await realpath(directory) !== directory) fail("invalid-input");
    const rootIdentity = await directoryIdentity(directory);
    const lockPath = join(directory, "active.lock"), jobs = join(directory, "jobs");
    let lock: FileHandle;
    try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (code(error) === "EEXIST") fail("locked"); throw error; }
    let lockIdentity: Identity;
    try { lockIdentity = await lock.stat(); } catch (error) { await lock.close(); throw error; }
    let closing: Promise<void> | undefined;
    let closingRequested = false;
    let queue: Promise<unknown> = Promise.resolve();
    const live = async (): Promise<void> => {
      if (!same(rootIdentity, await directoryIdentity(directory))) fail("custody");
      const current = await lstat(lockPath); owned(current, false);
      if (!same(lockIdentity, current)) fail("custody");
    };
    const release = async (): Promise<void> => {
      let valid = false;
      try { await live(); valid = true; } finally { await lock.close(); }
      if (valid) { await unlink(lockPath); await syncDirectory(directory); }
    };
    let jobsIdentity: Identity;
    try {
      const lockBytes = Buffer.from(canonicalJson({ protocol: PROFILE, freezeSha256, owner: randomUUID() }) + "\n");
      let offset = 0;
      while (offset < lockBytes.length) {
        const wrote = await lock.write(lockBytes, offset, lockBytes.length - offset);
        if (wrote.bytesWritten <= 0) fail("io");
        offset += wrote.bytesWritten;
      }
      await lock.sync(); await syncDirectory(directory);
      const headerPath = join(directory, "store.json");
      if (!await exists(headerPath)) await writeExclusive(headerPath, { protocol: PROFILE, freezeSha256 });
      const header = record(await readJson(headerPath, 1024), ["protocol", "freezeSha256"]);
      if (header.protocol !== PROFILE || header.freezeSha256 !== freezeSha256) fail("binding");
      if (!await exists(jobs)) await mkdir(jobs, { mode: 0o700 });
      jobsIdentity = await directoryIdentity(jobs); await syncDirectory(directory);
    } catch (error) { try { await release(); } catch { /* Preserve the original safe failure and any unremoved lock. */ } throw error; }
    const admitted = new Map<string, string>();
    function serialized<T>(run: () => Promise<T>): Promise<T> {
      if (closingRequested) return Promise.reject(new ClaudeStudyStoreError("closed"));
      const result = queue.then(() => safe(async () => {
        await live();
        if (!same(jobsIdentity, await directoryIdentity(jobs))) fail("custody");
        return run();
      }));
      queue = result.then(() => undefined, () => undefined);
      return result;
    }
    const paths = (jobKey: string) => {
      const job = join(jobs, digest(jobKey));
      return { job, pending: join(job, "pending.json"), result: join(job, "result.json"),
        stdoutPath: join(job, "stdout.jsonl"), stderrPath: join(job, "stderr.txt") };
    };
    async function binding(path: string, jobKey: string, requestSha256: string): Promise<void> {
      const pending = record(await readJson(path, 2048), ["protocol", "freezeSha256", "jobKey", "requestSha256"]);
      if (pending.protocol !== PROFILE || pending.freezeSha256 !== freezeSha256
        || pending.jobKey !== jobKey || pending.requestSha256 !== requestSha256) fail("binding");
    }
    async function evidence(p: ReturnType<typeof paths>, saved: Facts): Promise<Uint8Array> {
      // Both files are closed even when either read fails; never leave a rejected sibling unobserved.
      const result = await Promise.allSettled([readBounded(p.stdoutPath, MAX_STDOUT), readBounded(p.stderrPath, MAX_STDERR)]);
      const stdout = result[0], stderr = result[1];
      if (stdout?.status !== "fulfilled" || stderr?.status !== "fulfilled") fail("evidence");
      if (stdout.value.length !== saved.stdout.bytes || stderr.value.length !== saved.stderr.bytes
        || sha256Hex(stdout.value) !== saved.stdout.sha256 || sha256Hex(stderr.value) !== saved.stderr.sha256) fail("evidence");
      return stdout.value;
    }
    return Object.freeze({
      lookup(jobKey: string, requestSha256: string, expectedModel: string): Promise<ClaudeStudyLookup> {
        return serialized(async () => {
          digest(requestSha256);
          if (typeof expectedModel !== "string" || expectedModel.length > 128 || !/^claude-[a-z0-9.-]+$/.test(expectedModel)) fail("invalid-input");
          const p = paths(jobKey);
          if (!await exists(p.job)) return Object.freeze({ state: "missing" as const });
          await directoryIdentity(p.job);
          // Even a crash before the pending receipt finished is occupied, never a new admission.
          if (!await exists(p.pending)) return Object.freeze({ state: "incomplete" as const, reason: "pending" as const });
          await binding(p.pending, jobKey, requestSha256);
          if (!await exists(p.result)) return Object.freeze({ state: "incomplete" as const, reason: "pending" as const });
          const envelope = record(await readJson(p.result), ["protocol", "freezeSha256", "jobKey", "requestSha256", "invocation"]);
          if (envelope.protocol !== PROFILE || envelope.freezeSha256 !== freezeSha256
            || envelope.jobKey !== jobKey || envelope.requestSha256 !== requestSha256) fail("binding");
          const saved = facts(envelope.invocation, false);
          if (saved.requestSha256 !== requestSha256) fail("binding");
          const raw = await evidence(p, saved);
          let completion: ClaudeInvocation["completion"] = null;
          try { completion = parseClaudeCompletion(raw, expectedModel); } catch { /* Raw evidence remains authoritative and retained. */ }
          const success = saved.exitCode === 0 && !saved.timedOut && !saved.outputBoundExceeded && completion !== null;
          const invocation: ClaudeInvocation = Object.freeze({ ...saved, status: success ? "completed" : "incomplete", completion });
          return success ? Object.freeze({ state: "completed" as const, invocation })
            : Object.freeze({ state: "incomplete" as const, reason: "transport" as const, invocation });
        });
      },
      begin(jobKey: string, requestSha256: string) {
        return serialized(async () => {
          digest(requestSha256);
          const p = paths(jobKey);
          try { await mkdir(p.job, { mode: 0o700 }); }
          catch (error) { if (code(error) === "EEXIST") fail("incomplete"); throw error; }
          await writeExclusive(p.pending, { protocol: PROFILE, freezeSha256, jobKey, requestSha256 });
          await syncDirectory(p.job); await syncDirectory(jobs);
          admitted.set(jobKey, requestSha256);
          return Object.freeze({ stdoutPath: p.stdoutPath, stderrPath: p.stderrPath });
        });
      },
      complete(jobKey: string, requestSha256: string, invocation: ClaudeInvocation) {
        return serialized(async () => {
          digest(requestSha256);
          const p = paths(jobKey);
          if (admitted.get(jobKey) !== requestSha256) fail("incomplete");
          await directoryIdentity(p.job); await binding(p.pending, jobKey, requestSha256);
          const saved = facts(invocation, true);
          if (saved.requestSha256 !== requestSha256) fail("binding");
          await evidence(p, saved);
          // Store only transport facts. Semantic completion/status are re-derived by lookup's native parser.
          await writeExclusive(p.result, { protocol: PROFILE, freezeSha256, jobKey, requestSha256, invocation: saved });
          await syncDirectory(p.job);
          admitted.delete(jobKey);
        });
      },
      close(): Promise<void> {
        if (!closing) { closingRequested = true; closing = queue.then(() => safe(release)); }
        return closing;
      },
    });
  });
}
