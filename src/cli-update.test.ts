import { expect, test } from "bun:test";
import { runOhEntrypoint } from "./cli-entry";

test("the executable holds its update lease until product work completes", async () => {
  const order: string[] = [];
  await runOhEntrypoint(["put", "--key", "version"], {

    update: async options => {
      expect(options.effectFree).toBe(false);
      expect(options.packageName).toBe("@hraness/oh");
      order.push("update");
      return { handled: false, exitCode: 0, release: async () => { order.push("release"); } };
    },
    main: async () => { order.push("main"); await Promise.resolve(); order.push("completed"); },
  });
  expect(order).toEqual(["update", "main", "completed", "release"]);
});

test("a handled update never enters product work", async () => {
  const prior = process.exitCode;
  try {
    await runOhEntrypoint(["update", "status"], {

      update: async () => ({ handled: true, exitCode: 1, release: async () => { throw new Error("already handled"); } }),
      main: async () => { throw new Error("product work must not start"); },
    });
    expect(process.exitCode).toBe(1);
  } finally { process.exitCode = prior ?? 0; }
});

test("a product failure still releases its installation", async () => {
  let released = false;
  await expect(runOhEntrypoint(["put", "--key", "version"], {

    update: async () => ({ handled: false, exitCode: 0, release: async () => { released = true; } }),
    main: async () => { throw new Error("product failed"); },
  })).rejects.toThrow("product failed");
  expect(released).toBe(true);
});

import { ohUpdatePolicy } from "./cli-update-policy";

test("Oh help is effect-free and research stays offline without dropping its lease", () => {
  for (const argv of [[], ["--help"], ["help", "put"], ["put", "--help"], ["version", "--json"], ["research", "--help"]]) {
    expect(ohUpdatePolicy(argv).effectFree).toBe(true);
  }
  expect(ohUpdatePolicy(["get", "version"])).toEqual({ effectFree: false, offline: false });
  expect(ohUpdatePolicy(["research", "collect", "version"])).toEqual({ effectFree: false, offline: true });
  expect(ohUpdatePolicy(["research", "collect", "--help"])).toEqual({ effectFree: false, offline: true });
});
