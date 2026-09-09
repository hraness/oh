import { afterEach, expect, test } from "bun:test";
import { chmod, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import { createLabPaidBudgetVerifier, verifyLabPaidBudgetInput, type LabPaidBudgetInput } from "../scripts/benchmarks/lab-paid-budget";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const auth = { method: "project-oidc", project: "synthetic-project", scope: "synthetic-scope", environment: "development" } as const;
const event = (id: string, kind: "reserved" | "settled", micros: number) => ({ v: 1, id, kind, micros });
const lines = (...values: unknown[]) => values.map(v => JSON.stringify(v) + "\n").join("");
async function fixture(contents = [lines(event("first", "reserved", 500), event("first", "settled", 100)), lines(event("pending", "reserved", 300))]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lab-budget-test-"))); roots.push(root);
  async function file(name: string, text: string) {
    const path = join(root, name), raw = Buffer.from(text); await writeFile(path, raw, { mode: 0o600 });
    return { path, sha256: sha256Hex(raw), bytes: raw.length };
  }
  const authorityFile = await file("authority.json", "{\"synthetic\":true}\n");
  const authority = { path: authorityFile.path, sha256: authorityFile.sha256 };
  const original = { ...await file("original.jsonl", "synthetic historical anchor\n"), exposureMicros: 21_655_385 };
  const ledgers = await Promise.all(contents.map((text, i) => file(`native-${i}.jsonl`, text)));
  const input: LabPaidBudgetInput = { authority, ledgers, expectedExposureMicros: 400, absentLedgerPaths: [join(root, "v6.jsonl")] };
  const calls: string[] = [];
  const verifier = createLabPaidBudgetVerifier({
    async verifyAuthority(pin) { calls.push("authority"); expect(pin).toEqual(authority); return original; },
    async readAuth(pin) { calls.push("auth"); expect(pin).toEqual(authority); return auth; },
  });
  return { root, file, input, verifier, original, calls };
}

test("carries settled and unresolved native exposure once while excluding the original authority ledger", async () => {
  const f = await fixture(), result = await f.verifier.verifyLabPaidBudgetInput(f.input);
  expect(result.auth).toEqual(auth); expect(result.priorExposureMicros).toBe(400);
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect((await f.verifier.verifyLabPaidBudgetInput(f.input)).fingerprint).toBe(result.fingerprint);
  await result.recheck(); expect(f.calls).toEqual(["authority", "auth", "authority", "auth", "authority", "auth"]);
  await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, expectedExposureMicros: 100 })).rejects.toThrow("recomputed exposure");
});

test("binds descriptor bytes and retains a detached budget input for recheck", async () => {
  const f = await fixture(), descriptor = await f.file("budget.json", JSON.stringify(f.input));
  const descriptorPin = { path: descriptor.path, sha256: descriptor.sha256 };
  const result = await f.verifier.verifyPinnedLabPaidBudgetInput(descriptorPin);
  expect(result.priorExposureMicros).toBe(400); await result.recheck();
  await writeFile(descriptor.path, JSON.stringify(f.input) + " ");
  await expect(result.recheck()).rejects.toThrow("pinned file bytes");
  await expect(f.verifier.verifyPinnedLabPaidBudgetInput(descriptorPin)).rejects.toThrow("pinned file bytes");
  const detached = await f.verifier.verifyLabPaidBudgetInput(f.input);
  Object.assign(f.input, { expectedExposureMicros: 0, absentLedgerPaths: [] });
  await detached.recheck(); expect(detached.priorExposureMicros).toBe(400);
});

test("rejects changed ledger hashes, lengths and private custody", async () => {
  const f = await fixture(), first = f.input.ledgers[0]!;
  await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, ledgers: [{ ...first, bytes: first.bytes + 1 }, f.input.ledgers[1]!] })).rejects.toThrow("pinned file bytes");
  const result = await f.verifier.verifyLabPaidBudgetInput(f.input);
  await writeFile(first.path, lines(event("first", "reserved", 100)));
  await expect(result.recheck()).rejects.toThrow("pinned file bytes");
  await chmod(first.path, 0o644);
  await expect(f.verifier.verifyLabPaidBudgetInput(f.input)).rejects.toThrow("custody");
});

test("pins the authority and original ledger separately and rejects descriptor changes during verification", async () => {
  const f = await fixture(), result = await f.verifier.verifyLabPaidBudgetInput(f.input);
  await writeFile(f.original.path, "changed historical anchor\n");
  await expect(result.recheck()).rejects.toThrow("pinned file bytes");
  const g = await fixture(), checked = await g.verifier.verifyLabPaidBudgetInput(g.input);
  await writeFile(g.input.authority.path, "{\"synthetic\":false}\n");
  await expect(checked.recheck()).rejects.toThrow("pinned file bytes");
  const h = await fixture(), descriptor = await h.file("budget.json", JSON.stringify(h.input));
  const changing = createLabPaidBudgetVerifier({ async verifyAuthority() { return h.original; }, async readAuth() {
    await writeFile(descriptor.path, JSON.stringify(h.input) + " "); return auth;
  } });
  await expect(changing.verifyPinnedLabPaidBudgetInput({ path: descriptor.path, sha256: descriptor.sha256 })).rejects.toThrow("pinned file bytes");
});

test("rejects partial, malformed and invalid native event streams", async () => {
  const invalid = [JSON.stringify(event("a", "reserved", 1)), "\n", lines({ ...event("a", "reserved", 1), extra: true }),
    lines(event("a", "settled", 1)), lines(event("a", "reserved", 1), event("a", "settled", 2)),
    lines(event("a", "reserved", 1), event("a", "reserved", 1)), lines({ ...event("a", "reserved", 1), v: 2 })];
  for (const content of invalid) {
    const f = await fixture([content]);
    await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, expectedExposureMicros: 1 })).rejects.toThrow();
  }
});

test("rejects physical reservation reuse across individually valid ledgers and cross-ledger settlements", async () => {
  const f = await fixture([lines(event("same", "reserved", 100), event("same", "settled", 0)), lines(event("same", "reserved", 400))]);
  await expect(f.verifier.verifyLabPaidBudgetInput(f.input)).rejects.toThrow("duplicate physical reservation");
  const g = await fixture([lines(event("a", "reserved", 500)), lines(event("a", "settled", 400))]);
  await expect(g.verifier.verifyLabPaidBudgetInput(g.input)).rejects.toThrow("settlement");
});

test("checks combined historical prefixes including unresolved carry, even when final sums fit", async () => {
  const f = await fixture([lines(event("prior", "reserved", 39_999_950)), lines(event("new", "reserved", 100), event("new", "settled", 0))]);
  await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, expectedExposureMicros: 39_999_950 })).rejects.toThrow("combined historical prefix");
  const g = await fixture([lines(event("a", "reserved", 20_000_000)), lines(event("b", "reserved", 20_000_001))]);
  await expect(g.verifier.verifyLabPaidBudgetInput({ ...g.input, expectedExposureMicros: 40_000_000 })).rejects.toThrow("combined historical prefix");
  const h = await fixture([lines(event("a", "reserved", 40_000_000))]);
  expect((await h.verifier.verifyLabPaidBudgetInput({ ...h.input, expectedExposureMicros: 40_000_000 })).priorExposureMicros).toBe(40_000_000);
});

test("rejects duplicate canonical paths, symlink aliases, hard links and original-ledger inclusion", async () => {
  const f = await fixture(), first = f.input.ledgers[0]!;
  await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, ledgers: [first, first] })).rejects.toThrow("duplicate paths");
  await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, ledgers: [{ ...first, path: f.root + "/./native-0.jsonl" }] })).rejects.toThrow("noncanonical");
  const alias = join(f.root, "alias.jsonl"); await symlink(first.path, alias);
  await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, ledgers: [{ ...first, path: alias }] })).rejects.toThrow("path alias");
  await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, ledgers: [f.original] })).rejects.toThrow("invalid ledger pin");
  const { exposureMicros: _exposure, ...originalPin } = f.original;
  await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, ledgers: [originalPin] })).rejects.toThrow("must remain separate");
  await link(first.path, join(f.root, "hardlink.jsonl"));
  await expect(f.verifier.verifyLabPaidBudgetInput(f.input)).rejects.toThrow("custody");
});

test("checks absent ledgers before verification, at its end and on recheck, including dangling symlinks", async () => {
  const f = await fixture(), result = await f.verifier.verifyLabPaidBudgetInput(f.input);
  await symlink(join(f.root, "missing-target"), f.input.absentLedgerPaths[0]!);
  await expect(result.recheck()).rejects.toThrow("absent ledger exists");
  const g = await fixture();
  const racing = createLabPaidBudgetVerifier({ async verifyAuthority() { return g.original; }, async readAuth() {
    await writeFile(g.input.absentLedgerPaths[0]!, "", { mode: 0o600 }); return auth;
  } });
  await expect(racing.verifyLabPaidBudgetInput(g.input)).rejects.toThrow("absent ledger exists");
});

test("bounds descriptor work before reading ledgers and never bypasses authority verification", async () => {
  const f = await fixture(), first = f.input.ledgers[0]!;
  for (const changed of [{ expectedExposureMicros: 40_000_001 }, { expectedExposureMicros: -0 }, { absentLedgerPaths: [] },
    { ledgers: Array.from({ length: 17 }, () => first) },
    { ledgers: [{ ...first, bytes: 32 * 1024 * 1024 }, { ...f.input.ledgers[1]!, bytes: 1 }] }]) {
    await expect(f.verifier.verifyLabPaidBudgetInput({ ...f.input, ...changed })).rejects.toThrow();
  }
  expect(f.calls).toEqual([]);
  await expect(verifyLabPaidBudgetInput(f.input)).rejects.toThrow("authority");
  const originalBefore = await readFile(f.original.path);
  const denied = createLabPaidBudgetVerifier({ async verifyAuthority() { throw new Error("authority denied"); }, async readAuth() { throw new Error("must not run"); } });
  await expect(denied.verifyLabPaidBudgetInput(f.input)).rejects.toThrow("authority denied");
  expect(await readFile(f.original.path)).toEqual(originalBefore);
});
