import { describe, expect, test } from "bun:test";
import { runLabPaidQueue } from "../scripts/benchmarks/lab-paid-queue";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const jobs = (count: number) => Array.from({ length: count }, (_, index) => ({ key: `job-${index}`, index }));

describe("paid development work-conserving queue", () => {
  test("refills a released slot before a slow sibling finishes and never exceeds its ceiling", async () => {
    const input = jobs(4), gates = input.map(() => deferred<string>()), started = input.map(() => deferred<void>());
    const order: string[] = []; let inflight = 0, peak = 0;
    const running = runLabPaidQueue(input, { concurrency: 2, async execute(job) {
      order.push(job.key); inflight++; peak = Math.max(peak, inflight); started[job.index]!.resolve();
      try { return await gates[job.index]!.promise; } finally { inflight--; }
    } });
    await Promise.all([started[0]!.promise, started[1]!.promise]);
    expect(inflight).toBe(2);
    gates[1]!.resolve("second"); await started[2]!.promise;
    expect(order).toEqual(["job-0", "job-1", "job-2"]);
    expect(inflight).toBe(2);
    gates[2]!.resolve("third"); await started[3]!.promise;
    expect(order).toEqual(input.map(job => job.key));
    gates[3]!.resolve("fourth"); gates[0]!.resolve("first");
    const result = await running;
    expect({ inflight, peak }).toEqual({ inflight: 0, peak: 2 });
    expect([...result.results]).toEqual([["job-0", "first"], ["job-1", "second"], ["job-2", "third"], ["job-3", "fourth"]]);
    expect(result.errors).toEqual([]);
    expect(result.pendingKeys).toEqual([]);
  });

  test("an observed error halts new starts but waits for and retains every admitted sibling", async () => {
    const input = jobs(5), gates = input.map(() => deferred<number>()), allStarted = deferred<void>();
    const failure = new Error("synthetic execute failure"); let calls = 0, resolved = false;
    const running = runLabPaidQueue(input, { concurrency: 3, execute(job) {
      if (++calls === 3) allStarted.resolve();
      return gates[job.index]!.promise;
    } });
    const observed = running.then(() => { resolved = true; });
    await allStarted.promise;
    gates[1]!.reject(failure);
    // One microtask processes the rejection; two additional checkpoints let an incorrect early
    // return propagate to observed. Neither pending successful sibling is released by this step.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(calls).toBe(3);
    expect(resolved).toBe(false);
    gates[2]!.resolve(22); gates[0]!.resolve(0);
    const result = await running; await observed;
    expect(result.startedKeys).toEqual(["job-0", "job-1", "job-2"]);
    expect([...result.results]).toEqual([["job-0", 0], ["job-2", 22]]);
    expect(result.errors).toEqual([{ key: "job-1", error: failure }]);
    expect(result.errors[0]!.error).toBe(failure);
    expect(result.pendingKeys).toEqual(["job-3", "job-4"]);
    expect(calls).toBe(3);
  });

  test("external stop blocks further admission and drains already-started work", async () => {
    const input = jobs(4), gates = input.map(() => deferred<string>()); let calls = 0, stop = false;
    const running = runLabPaidQueue(input, { concurrency: 2, stopped: () => stop, execute(job) {
      calls++; return gates[job.index]!.promise;
    } });
    expect(calls).toBe(2);
    stop = true;
    gates[1]!.resolve("one"); gates[0]!.resolve("zero");
    const result = await running;
    expect(result.startedKeys).toEqual(["job-0", "job-1"]);
    expect([...result.results]).toEqual([["job-0", "zero"], ["job-1", "one"]]);
    expect(result.pendingKeys).toEqual(["job-2", "job-3"]);
    expect(result.errors).toEqual([]);
    expect(calls).toBe(2);
    expect((await runLabPaidQueue(input, { concurrency: 2, stopped: () => true, async execute() { calls++; return "unexpected"; } })).pendingKeys)
      .toEqual(input.map(job => job.key));
    expect(calls).toBe(2);
  });

  test("rejects duplicate keys and invalid concurrency before executing anything", async () => {
    let calls = 0;
    const execute = async () => { calls++; return 1; };
    for (const concurrency of [0, 13, 1.5, NaN, Infinity]) {
      await expect(runLabPaidQueue(jobs(2), { concurrency, execute })).rejects.toThrow("concurrency");
    }
    await expect(runLabPaidQueue([{ key: "same" }, { key: "same" }], { concurrency: 2, execute })).rejects.toThrow("unique");
    expect(calls).toBe(0);
    const empty = await runLabPaidQueue([], { concurrency: 12, execute });
    expect(empty.startedKeys).toEqual([]); expect(empty.results.size).toBe(0);
    expect(empty.errors).toEqual([]); expect(empty.pendingKeys).toEqual([]);
    expect(calls).toBe(0);
  });

  test("mixed out-of-order successes and failures keep deterministic collections, including undefined values", async () => {
    const input = jobs(5), gates = input.map(() => deferred<number | undefined>());
    const running = runLabPaidQueue(input, { concurrency: 4, execute: job => gates[job.index]!.promise });
    gates[3]!.reject("late-input failure"); await Promise.resolve();
    gates[2]!.resolve(undefined); gates[1]!.reject(undefined); gates[0]!.resolve(10);
    const result = await running;
    expect(result.startedKeys).toEqual(["job-0", "job-1", "job-2", "job-3"]);
    expect([...result.results]).toEqual([["job-0", 10], ["job-2", undefined]]);
    expect(result.results.has("job-2")).toBe(true);
    expect(result.errors).toEqual([{ key: "job-1", error: undefined }, { key: "job-3", error: "late-input failure" }]);
    expect(result.pendingKeys).toEqual(["job-4"]);
  });

  test("a throwing stop callback drains admitted work before propagating its original error", async () => {
    const gate = deferred<number>(), failure = new Error("broken stop signal"); let checks = 0, calls = 0, rejected = false;
    const running = runLabPaidQueue(jobs(3), { concurrency: 2, stopped() { if (++checks === 2) throw failure; return false; },
      execute() { calls++; return gate.promise; } });
    const observed = running.catch(error => { rejected = true; return error; });
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toBe(1); expect(rejected).toBe(false);
    gate.resolve(1);
    expect(await observed).toBe(failure);
    expect(calls).toBe(1);
  });
});
