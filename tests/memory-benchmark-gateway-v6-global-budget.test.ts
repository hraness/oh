import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { parseGatewayV6GlobalBudgetReservation, verifyGatewayV6GlobalBudgetPreparation, verifyGatewayV6GlobalBudgetReplay,
  type GatewayV6GlobalBudgetPin } from "../scripts/benchmark-audit/gateway-v6-global-budget";

const h = (value: string) => sha256Hex(value), hash = "a".repeat(64), head = "b".repeat(40);
const event = (id: string, kind: "reserved" | "settled", micros: number) => ({ v: 1, id, kind, micros });
const lines = (...values: unknown[]) => values.map(value => JSON.stringify(value) + "\n").join("");
function fixture() {
  const files = new Map<string, Uint8Array>();
  const put = (path: string, value: string | object): GatewayV6GlobalBudgetPin => {
    const raw = Buffer.from(typeof value === "string" ? value : JSON.stringify(value)); const pin = { path, sha256: sha256Hex(raw) };
    files.set(path, raw); return pin;
  };
  const authority = put("/synthetic/authority.json", "authority");
  const original = put("/synthetic/original.jsonl", "original\n");
  const old = put("/synthetic/old.jsonl", lines(event("old", "reserved", 25_744_095)));
  const targetPath = "/synthetic/v6/ledger.jsonl", freeze = { path: "/synthetic/v6/freeze.json", sha256: h("freeze") };
  const descriptor = put("/synthetic/budget.json", { authority, ledgers: [{ ...old, bytes: files.get(old.path)!.length }], expectedExposureMicros: 25_744_095, absentLedgerPaths: [targetPath] });
  const bound = { remainingReaders: 28, readerMicros: 170570, knownCompletedReaders: 331, knownTerminalReaders: 1, knownPhysicalJudgeRequests: 205,
    knownJudgeMicros: 2566092, unknownJudgeMaximumRequests: 28, unknownJudgeMaximumEachMicros: 323840, unknownJudgeMicros: 9067520,
    totalMicros: 11804182, totalSha256: "bb3bec2510cb6eb532e1812a66fde32e90afe9b342b09fe07f368fa631a71968" };
  const reservation = put("/synthetic/reservation.json", { protocol: "oh.gateway-v6-global-budget-reservation.v1", recordedAt: "2026-09-09T00:00:00.000Z", freeze,
    sourceSha256: hash, sourceGitHead: head, budgetInput: descriptor, priorExposureMicros: 25744095, maximumNewExposureMicros: 11804182, capMicros: 40000000, bound });
  const context = { freeze, authority, sourceSha256: hash, sourceGitHead: head, v6LedgerPath: targetPath, requiredAncestryLedgers: [old, old, old] as const };
  const read = async (pin: GatewayV6GlobalBudgetPin, maximum: number) => {
    const raw = files.get(pin.path); if (!raw || raw.length > maximum) throw new Error("missing"); return raw;
  };
  const verifyAuthority = async (pin: GatewayV6GlobalBudgetPin) => { expect(pin).toEqual(authority); return { ...original, bytes: files.get(original.path)!.length, exposureMicros: 21_655_385 }; };
  return { files, put, authority, descriptor, reservation, context, read, verifyAuthority };
}

test("pins the fixed external envelope and uses the native absent-ledger verifier before preparation", async () => {
  const f = fixture(); let calls = 0;
  const result = await verifyGatewayV6GlobalBudgetPreparation(f.reservation, f.context, f.read, async pin => {
    calls++; expect(pin).toEqual(f.descriptor); return { auth: {} as never, priorExposureMicros: 25_744_095, fingerprint: canonicalSha256(pin), async recheck() { calls++; } };
  });
  expect(calls).toBe(2); expect(result.globalExposureMicros).toBe(25_744_095); expect(result.nativeExposureMicros).toBe(0);
  expect(parseGatewayV6GlobalBudgetReservation(JSON.parse(new TextDecoder().decode(f.files.get(f.reservation.path)!))).bound.totalMicros).toBe(11_804_182);
});

test("replays known ancestry and permits only bounded v6 exposure after its declared absence", async () => {
  const f = fixture(); const native = f.put(f.context.v6LedgerPath, lines(event("native", "reserved", 100), event("native", "settled", 30)));
  const result = await verifyGatewayV6GlobalBudgetReplay(f.reservation, f.context, native, f.read, async paths => expect(paths).toEqual([]), f.verifyAuthority);
  expect(result.nativeExposureMicros).toBe(30); expect(result.globalExposureMicros).toBe(25_744_125); expect(result.pins).toContainEqual(native);
});

test("rejects tampered fixed values, authority/source mismatch, ancestry id reuse and a native prefix over the reservation", async () => {
  const f = fixture(); const reservationValue = JSON.parse(new TextDecoder().decode(f.files.get(f.reservation.path)!));
  expect(() => parseGatewayV6GlobalBudgetReservation({ ...reservationValue, maximumNewExposureMicros: 1 })).toThrow("constants");
  await expect(verifyGatewayV6GlobalBudgetReplay(f.reservation, { ...f.context, sourceGitHead: "c".repeat(40) }, { path: f.context.v6LedgerPath, sha256: h("none") }, f.read, async () => {}, f.verifyAuthority)).rejects.toThrow("source");
  const duplicate = f.put("/synthetic/second.jsonl", lines(event("old", "reserved", 1)));
  const descriptorValue = JSON.parse(new TextDecoder().decode(f.files.get(f.descriptor.path)!)); descriptorValue.ledgers.push({ ...duplicate, bytes: f.files.get(duplicate.path)!.length });
  const changedDescriptor = f.put(f.descriptor.path, descriptorValue), changedReservation = { ...reservationValue, budgetInput: changedDescriptor };
  const resealed = f.put(f.reservation.path, changedReservation);
  await expect(verifyGatewayV6GlobalBudgetReplay(resealed, f.context, { path: f.context.v6LedgerPath, sha256: h("none") }, f.read, async () => {}, f.verifyAuthority)).rejects.toThrow("cross-ledger reservation reuse");
  const g = fixture(); const tooLarge = g.put(g.context.v6LedgerPath, lines(event("native", "reserved", 11_804_183)));
  await expect(verifyGatewayV6GlobalBudgetReplay(g.reservation, g.context, tooLarge, g.read, async () => {}, g.verifyAuthority)).rejects.toThrow("reserved global prefix");
});
