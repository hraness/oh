/** Explicit parent process duration policy; independent of provider/cache identity. */
import { canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
export type Mem0DurationPolicy = Readonly<{ protocol: "oh.memory.mem0-duration.v1"; lifecycleMs: number; commandMs: number; shutdownGraceMs: number; killGraceMs: number; drainMs: number }>;
function fail(): never { throw new TypeError("Mem0 duration: invalid bounded policy."); }
const integer = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= max;
export function validateMem0DurationPolicy(value: unknown): Mem0DurationPolicy {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "lifecycleMs", "commandMs", "shutdownGraceMs", "killGraceMs", "drainMs"])
    || value.protocol !== "oh.memory.mem0-duration.v1" || !integer(value.lifecycleMs, 1_800_000) || !integer(value.commandMs, value.lifecycleMs)
    || !integer(value.shutdownGraceMs, 10_000) || !integer(value.killGraceMs, 10_000) || !integer(value.drainMs, 600_000)) fail();
  return Object.freeze({ protocol: value.protocol, lifecycleMs: value.lifecycleMs, commandMs: value.commandMs, shutdownGraceMs: value.shutdownGraceMs, killGraceMs: value.killGraceMs, drainMs: value.drainMs });
}
export const MEM0_QUALIFICATION_DURATION_POLICY = validateMem0DurationPolicy({ protocol: "oh.memory.mem0-duration.v1", lifecycleMs: 120_000, commandMs: 120_000, shutdownGraceMs: 2_000, killGraceMs: 2_000, drainMs: 600_000 });
export const MEM0_ONE_CORPUS_DURATION_POLICY = validateMem0DurationPolicy({ protocol: "oh.memory.mem0-duration.v1", lifecycleMs: 1_800_000, commandMs: 180_000, shutdownGraceMs: 2_000, killGraceMs: 2_000, drainMs: 60_000 });
/** Injected monotonic clock is a pure test seam; each new command gets a fresh
 * command window while the absolute lifecycle deadline never moves. */
export function createMem0DurationClock(value: unknown, now: () => number = () => performance.now()) {
  const policy = validateMem0DurationPolicy(value), started = now(); let commandDeadline = started + policy.commandMs;
  if (!Number.isFinite(started)) fail();
  const remaining = () => { const current = now(); if (!Number.isFinite(current) || current < started) fail(); return Math.max(0, Math.min(started + policy.lifecycleMs, commandDeadline) - current); };
  return Object.freeze({ policy, policySha256: canonicalSha256(policy), beginCommand: () => { const current = now(); if (!Number.isFinite(current) || current < started) fail(); commandDeadline = current + policy.commandMs; return remaining(); }, remaining });
}
