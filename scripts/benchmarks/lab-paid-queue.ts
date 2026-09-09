export type LabPaidQueueResult<R> = Readonly<{
  startedKeys: readonly string[];
  results: ReadonlyMap<string, R>;
  errors: readonly Readonly<{ key: string; error: unknown }>[];
  pendingKeys: readonly string[];
}>;

/** Bounded, work-conserving execution. Stop affects admission only: every started job drains.
 * All returned collections use input order, independent of response completion order.
 * The caller owns budgets, durable request identity and any provider operations. */
export async function runLabPaidQueue<T extends { key: string }, R>(jobs: readonly T[], options: Readonly<{
  concurrency: number; execute(job: T): Promise<R>; stopped?: () => boolean;
}>): Promise<LabPaidQueueResult<R>> {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 12) {
    throw new RangeError("Paid queue concurrency must be an integer from 1 through 12.");
  }
  const entries = jobs.map(job => ({ job, key: job.key }));
  if (entries.some(entry => typeof entry.key !== "string") || new Set(entries.map(entry => entry.key)).size !== entries.length) {
    throw new TypeError("Paid queue requires unique string keys.");
  }
  if (typeof options.execute !== "function" || options.stopped !== undefined && typeof options.stopped !== "function") {
    throw new TypeError("Invalid paid queue callbacks.");
  }
  const startedKeys: string[] = [], results = new Map<string, R>(), failures = new Map<string, unknown>();
  let cursor = 0, halted = false, controlFailed = false, controlError: unknown;
  async function worker() {
    while (!halted && cursor < entries.length) {
      try { if (options.stopped?.()) { halted = true; return; } }
      catch (error) { halted = true; controlFailed = true; controlError = error; return; }
      const entry = entries[cursor++]!;
      startedKeys.push(entry.key);
      try { results.set(entry.key, await options.execute(entry.job)); }
      catch (error) { failures.set(entry.key, error); halted = true; return; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, entries.length) }, worker));
  // A broken stop callback also drains admitted work before its original failure is propagated.
  if (controlFailed) throw controlError;
  return {
    startedKeys: Object.freeze(startedKeys),
    results: new Map(entries.filter(entry => results.has(entry.key)).map(entry => [entry.key, results.get(entry.key)!])),
    errors: Object.freeze(entries.filter(entry => failures.has(entry.key)).map(entry => Object.freeze({ key: entry.key, error: failures.get(entry.key) }))),
    pendingKeys: Object.freeze(entries.slice(cursor).map(entry => entry.key)),
  };
}
