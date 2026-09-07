import { describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "../src/canonical";
import { CLAUDE_SUBSCRIPTION_PROFILE, parseClaudeCompletion, type ClaudeInvocation } from "../scripts/benchmarks/claude-subscription";
import { ClaudeStudyStoreError, openClaudeStudyStore, type ClaudeStudyStore } from "../scripts/benchmarks/claude-study-store";

const MODEL = "claude-opus-5", FREEZE = sha256Hex("synthetic-freeze"), JOB = sha256Hex("synthetic-job"), REQUEST = sha256Hex("synthetic-request");
const SESSION = "00000000-0000-4000-8000-000000000001";
function stdout(): Uint8Array {
  const usage = { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  return Buffer.from([
    { type: "system", subtype: "init", session_id: SESSION, model: MODEL, claude_code_version: "2.1.263", apiKeySource: "none", tools: [], mcp_servers: [] },
    { type: "assistant", session_id: SESSION, parent_tool_use_id: null, message: { model: MODEL, content: [{ type: "text", text: "synthetic π" }] } },
    { type: "result", subtype: "success", is_error: false, terminal_reason: "completed", stop_reason: "end_turn", session_id: SESSION,
      result: "synthetic π", num_turns: 1, duration_ms: 7, permission_denials: [], usage,
      modelUsage: { [MODEL]: { inputTokens: 3, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } },
  ].map((value) => JSON.stringify(value)).join("\n") + "\n");
}
function invocation(raw = stdout(), stderr = Buffer.from("synthetic stderr π")): ClaudeInvocation {
  return { protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: REQUEST, status: "completed", exitCode: 0,
    timedOut: false, outputBoundExceeded: false,
    stdout: { bytes: raw.length, sha256: sha256Hex(raw) }, stderr: { bytes: stderr.length, sha256: sha256Hex(stderr) },
    completion: parseClaudeCompletion(raw, MODEL) };
}
async function owned(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-claude-store-")));
  await chmod(directory, 0o700);
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function withStore(run: (store: ClaudeStudyStore, directory: string) => Promise<void>): Promise<void> {
  await owned(async (directory) => {
    const store = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
    try { await run(store, directory); } finally { await store.close(); }
  });
}
async function persist(store: ClaudeStudyStore, value = invocation()) {
  const paths = await store.begin(JOB, REQUEST);
  await writeFile(paths.stdoutPath, stdout(), { mode: 0o600, flag: "wx" });
  await writeFile(paths.stderrPath, "synthetic stderr π", { mode: 0o600, flag: "wx" });
  await store.complete(JOB, REQUEST, value);
  return paths;
}
async function rejectsCode(result: Promise<unknown>, code: ClaudeStudyStoreError["code"]) {
  try { await result; throw new Error("Expected failure"); }
  catch (error) { expect(error).toBeInstanceOf(ClaudeStudyStoreError); expect((error as ClaudeStudyStoreError).code).toBe(code); }
}
async function absent(path: string): Promise<boolean> {
  try { await lstat(path); return false; } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
    throw error;
  }
}

describe("Claude study durable checkpoints", () => {
  test("pending receipt precedes stream creation; reopened cache reparses full raw Unicode evidence", async () => {
    await owned(async (directory) => {
      const store = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
      expect(await store.lookup(JOB, REQUEST, MODEL)).toEqual({ state: "missing" });
      const paths = await store.begin(JOB, REQUEST);
      expect(paths).toEqual({ stdoutPath: join(directory, "jobs", JOB, "stdout.jsonl"), stderrPath: join(directory, "jobs", JOB, "stderr.txt") });
      expect(await absent(paths.stdoutPath)).toBe(true);
      expect(await absent(paths.stderrPath)).toBe(true);
      const pending = JSON.parse(await readFile(join(dirname(paths.stdoutPath), "pending.json"), "utf8"));
      expect(pending).toEqual({ protocol: "oh.claude-study-store.v1", freezeSha256: FREEZE, jobKey: JOB, requestSha256: REQUEST });
      expect(await store.lookup(JOB, REQUEST, MODEL)).toEqual({ state: "incomplete", reason: "pending" });
      await writeFile(paths.stdoutPath, stdout(), { mode: 0o600, flag: "wx" });
      await writeFile(paths.stderrPath, "synthetic stderr π", { mode: 0o600, flag: "wx" });
      // Neither a caller's semantic text nor its status is persisted as cache authority.
      await store.complete(JOB, REQUEST, { ...invocation(), status: "incomplete", completion: { ...invocation().completion!, prediction: "fabricated saved text" } });
      for (const path of [join(directory, "active.lock"), join(directory, "store.json"), join(dirname(paths.stdoutPath), "pending.json"),
        join(dirname(paths.stdoutPath), "result.json"), paths.stdoutPath, paths.stderrPath]) expect((await lstat(path)).mode & 0o777).toBe(0o600);
      for (const path of [directory, join(directory, "jobs"), dirname(paths.stdoutPath)]) expect((await lstat(path)).mode & 0o777).toBe(0o700);
      const saved = await readFile(join(dirname(paths.stdoutPath), "result.json"), "utf8");
      expect(saved).not.toContain("fabricated saved text"); expect(saved).not.toContain('"completion"'); expect(saved).not.toContain('"status"');
      await store.close(); await store.close();
      expect(await absent(join(directory, "active.lock"))).toBe(true);
      const reopened = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
      try {
        expect(await reopened.lookup(JOB, REQUEST, MODEL)).toEqual({ state: "completed", invocation: invocation() });
        await rejectsCode(reopened.begin(JOB, REQUEST), "incomplete");
      } finally { await reopened.close(); }
    });
  });

  test("exclusive lock cannot be stolen and an existing stale lock is preserved", async () => {
    await withStore(async (_store, directory) => {
      const before = await readFile(join(directory, "active.lock"));
      await rejectsCode(openClaudeStudyStore({ directory, freezeSha256: FREEZE }), "locked");
      expect(await readFile(join(directory, "active.lock"))).toEqual(before);
    });
    await owned(async (directory) => {
      await writeFile(join(directory, "active.lock"), "synthetic stale lock", { mode: 0o600, flag: "wx" });
      await rejectsCode(openClaudeStudyStore({ directory, freezeSha256: FREEZE }), "locked");
      expect(await readFile(join(directory, "active.lock"), "utf8")).toBe("synthetic stale lock");
    });
  });

  test("pending and pre-receipt crash directories remain blocked after reopening", async () => {
    await owned(async (directory) => {
      const store = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
      const paths = await store.begin(JOB, REQUEST);
      await writeFile(paths.stdoutPath, "partial", { mode: 0o600, flag: "wx" });
      const other = sha256Hex("crashed before pending receipt");
      await mkdir(join(directory, "jobs", other), { mode: 0o700 });
      await store.close();
      const reopened = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
      try {
        for (const key of [JOB, other]) {
          expect(await reopened.lookup(key, REQUEST, MODEL)).toEqual({ state: "incomplete", reason: "pending" });
          await rejectsCode(reopened.begin(key, REQUEST), "incomplete");
          await rejectsCode(reopened.complete(key, REQUEST, invocation()), "incomplete");
        }
        expect(await readFile(paths.stdoutPath, "utf8")).toBe("partial");
      } finally { await reopened.close(); }
    });
  });

  test("freeze, pending request, and saved job bindings are enforced", async () => {
    await owned(async (directory) => {
      const store = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
      const paths = await persist(store);
      await rejectsCode(store.lookup(JOB, sha256Hex("different request"), MODEL), "binding");
      const path = join(dirname(paths.stdoutPath), "result.json");
      const saved = JSON.parse(await readFile(path, "utf8"));
      await writeFile(path, JSON.stringify({ ...saved, jobKey: sha256Hex("different job") }));
      await rejectsCode(store.lookup(JOB, REQUEST, MODEL), "binding");
      await store.close();
      await rejectsCode(openClaudeStudyStore({ directory, freezeSha256: sha256Hex("different freeze") }), "binding");
      expect(await absent(join(directory, "active.lock"))).toBe(true);
      expect(await readFile(path, "utf8")).toContain(sha256Hex("different job"));
    });
  });

  for (const stream of ["stdoutPath", "stderrPath"] as const) test(`rejects changed ${stream} bytes`, async () => {
    await withStore(async (store) => {
      const paths = await persist(store);
      const bytes = await readFile(paths[stream]); bytes[0] = (bytes[0]! + 1) % 256;
      await writeFile(paths[stream], bytes);
      await rejectsCode(store.lookup(JOB, REQUEST, MODEL), "evidence");
    });
  });

  test("self-consistent saved hashes cannot make malformed raw stdout a completed cache hit", async () => {
    await withStore(async (store) => {
      const paths = await persist(store), path = join(dirname(paths.stdoutPath), "result.json");
      const saved = JSON.parse(await readFile(path, "utf8"));
      const torn = stdout().subarray(0, stdout().length - 1);
      await writeFile(paths.stdoutPath, torn);
      saved.invocation.stdout = { bytes: torn.length, sha256: sha256Hex(torn) };
      await writeFile(path, JSON.stringify(saved));
      const loaded = await store.lookup(JOB, REQUEST, MODEL);
      expect(loaded.state).toBe("incomplete");
      expect("invocation" in loaded && loaded.invocation.completion).toBeNull();
      await rejectsCode(store.begin(JOB, REQUEST), "incomplete");
    });
  });

  test("wrong expected model cannot reuse a completed raw result", async () => {
    await withStore(async (store) => {
      await persist(store);
      const loaded = await store.lookup(JOB, REQUEST, "claude-sonnet-5");
      expect(loaded.state).toBe("incomplete"); expect("invocation" in loaded && loaded.invocation.completion).toBeNull();
    });
  });

  test("nonzero exit, timeout, and exceeded bounds stay incomplete even with valid raw text", async () => {
    for (const change of [{ exitCode: 7 }, { timedOut: true }, { outputBoundExceeded: true }]) await withStore(async (store) => {
      await persist(store, { ...invocation(), ...change });
      const loaded = await store.lookup(JOB, REQUEST, MODEL);
      expect(loaded.state).toBe("incomplete");
      expect("invocation" in loaded && loaded.invocation.completion?.prediction).toBe("synthetic π");
    });
  });

  test("raw and result file bounds reject oversized sparse files", async () => {
    for (const [name, maximum] of [["stdout.jsonl", 16 * 1024 * 1024], ["stderr.txt", 1024 * 1024], ["result.json", 4 * 1024 * 1024]] as const) {
      await withStore(async (store) => {
        const paths = await persist(store), file = await open(join(dirname(paths.stdoutPath), name), "r+");
        try { await file.truncate(maximum + 1); } finally { await file.close(); }
        await rejectsCode(store.lookup(JOB, REQUEST, MODEL), "evidence");
      });
    }
  });

  test("symlink evidence and a substituted lock are not followed or removed", async () => {
    await withStore(async (store, directory) => {
      const paths = await persist(store), target = join(directory, "unrelated.txt");
      await writeFile(target, stdout(), { mode: 0o600, flag: "wx" });
      await unlink(paths.stdoutPath); await symlink(target, paths.stdoutPath);
      await rejectsCode(store.lookup(JOB, REQUEST, MODEL), "evidence");
      expect(await readFile(target)).toEqual(Buffer.from(stdout()));
    });
    await owned(async (directory) => {
      const store = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
      const path = join(directory, "active.lock");
      await unlink(path); await writeFile(path, "other owner's lock", { mode: 0o600, flag: "wx" });
      await rejectsCode(store.close(), "custody");
      expect(await readFile(path, "utf8")).toBe("other owner's lock");
    });
  });

  test("concurrent admissions serialize and close drains submitted I/O", async () => {
    await owned(async (directory) => {
      const store = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
      const first = store.begin(JOB, REQUEST), second = store.begin(JOB, REQUEST), closed = store.close();
      await first; await rejectsCode(second, "incomplete"); await closed;
      await rejectsCode(store.lookup(JOB, REQUEST, MODEL), "closed");
      expect(await absent(join(directory, "active.lock"))).toBe(true);
      expect(await absent(join(directory, "jobs", JOB, "pending.json"))).toBe(false);
    });
  });

  test("unsafe paths and accessor inputs are rejected without invoking getters", async () => {
    await owned(async (directory) => {
      await rejectsCode(openClaudeStudyStore({ directory: directory + "/../elsewhere", freezeSha256: FREEZE }), "invalid-input");
      let reads = 0;
      const options = Object.defineProperty({ freezeSha256: FREEZE, directory }, "directory", { enumerable: true, get() { reads++; return directory; } });
      await rejectsCode(openClaudeStudyStore(options), "evidence");
      expect(reads).toBe(0);
      const store = await openClaudeStudyStore({ directory, freezeSha256: FREEZE });
      try {
        await rejectsCode(store.begin("../escape", REQUEST), "invalid-input");
        const paths = await store.begin(JOB, REQUEST);
        await writeFile(paths.stdoutPath, stdout(), { mode: 0o600, flag: "wx" });
        await writeFile(paths.stderrPath, "synthetic stderr π", { mode: 0o600, flag: "wx" });
        const value = Object.defineProperty({ ...invocation() }, "exitCode", { enumerable: true, get() { reads++; return 0; } });
        await rejectsCode(store.complete(JOB, REQUEST, value), "evidence");
        expect(reads).toBe(0);
        expect(await absent(join(dirname(paths.stdoutPath), "result.json"))).toBe(true);
      } finally { await store.close(); }
    });
  });
});
