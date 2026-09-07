import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import type { Corpus } from "../scripts/benchmarks/datasets";
import { createRetrievers, renderTurn } from "../scripts/benchmarks/retrieval";

const LIMIT = 64 * 1024;
const encoder = new TextEncoder();
let readLines: typeof import("../scripts/benchmarks/stress-sqlite-crash").readLines;
let importsVerified = false;

beforeAll(async () => {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const spawnDescriptor = Object.getOwnPropertyDescriptor(Bun, "spawn");
  const spawnSyncDescriptor = Object.getOwnPropertyDescriptor(Bun, "spawnSync");
  if (fetchDescriptor === undefined || spawnDescriptor === undefined || spawnSyncDescriptor === undefined) {
    throw new Error("The import-isolation test requires the native fetch and spawn properties.");
  }
  for (const [name, descriptor] of [
    ["fetch", fetchDescriptor], ["Bun.spawn", spawnDescriptor], ["Bun.spawnSync", spawnSyncDescriptor],
  ] as const) {
    if (!("value" in descriptor) || descriptor.writable !== true) {
      throw new Error(`Import-isolation is blocked: ${name} is not a writable native data property.`);
    }
  }
  const exitCodeBefore = process.exitCode;
  let networkCalls = 0;
  let spawnCalls = 0;
  const denyFetch: typeof fetch = () => {
    networkCalls += 1;
    throw new Error("A stress helper attempted network access while being imported.");
  };
  const denySpawn: typeof Bun.spawn = () => {
    spawnCalls += 1;
    throw new Error("A stress helper attempted to spawn while being imported.");
  };
  const denySpawnSync: typeof Bun.spawnSync = () => {
    spawnCalls += 1;
    throw new Error("A stress helper attempted to spawn synchronously while being imported.");
  };
  const checkImportState = () => {
    expect(globalThis.fetch).toBe(denyFetch);
    expect(Bun.spawn).toBe(denySpawn);
    expect(Bun.spawnSync).toBe(denySpawnSync);
    expect(process.exitCode).toBe(exitCodeBefore);
    expect(networkCalls).toBe(0);
    expect(spawnCalls).toBe(0);
  };
  try {
    Object.defineProperty(globalThis, "fetch", { ...fetchDescriptor, value: denyFetch });
    Object.defineProperty(Bun, "spawn", { ...spawnDescriptor, value: denySpawn });
    Object.defineProperty(Bun, "spawnSync", { ...spawnSyncDescriptor, value: denySpawnSync });
    const nonce = randomUUID();
    const sqliteUrl = new URL("../scripts/benchmarks/stress-sqlite-crash.ts", import.meta.url);
    const retrievalUrl = new URL("../scripts/benchmarks/stress-retrieval.ts", import.meta.url);
    sqliteUrl.searchParams.set("import-isolation", nonce);
    retrievalUrl.searchParams.set("import-isolation", nonce);
    const sqliteStress = await import(sqliteUrl.href) as typeof import("../scripts/benchmarks/stress-sqlite-crash");
    checkImportState();
    const retrievalStress: unknown = await import(retrievalUrl.href);
    checkImportState();
    expect(typeof sqliteStress.readLines).toBe("function");
    expect(typeof retrievalStress).toBe("object");
    readLines = sqliteStress.readLines;
    importsVerified = true;
  } finally {
    Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    Object.defineProperty(Bun, "spawn", spawnDescriptor);
    Object.defineProperty(Bun, "spawnSync", spawnSyncDescriptor);
    process.exitCode = exitCodeBefore;
  }
});

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("stress helpers are inert on import", () => {
  test("fresh imports preserve fetch, spawn and exit state without calling network or spawn", () => {
    expect(importsVerified).toBe(true);
  });
});

describe("the SQLite helper stream reader", () => {
  test("joins a UTF-8 sequence split across chunk boundaries", async () => {
    const line = encoder.encode("café ☕ barrier\n");
    const split = 7; // inside the multi-byte ☕ sequence
    const reader = readLines(streamOf([line.slice(0, split), line.slice(split)]), LIMIT);
    try {
      await expect(reader.next(1_000)).resolves.toBe("café ☕ barrier");
      await expect(reader.drain(1_000)).resolves.toBe(true);
      expect(reader.completed()).toBe(true);
      expect(reader.lineCount()).toBe(1);
      expect(reader.fragment()).toBe("");
      expect(reader.readErrors()).toBe(0);
      expect(reader.overflowed()).toBe(false);
    } finally {
      await reader.cancel();
    }
  });

  test("records a fatal decode error for malformed bytes while keeping complete lines", async () => {
    const reader = readLines(streamOf([
      encoder.encode("first complete line\n"),
      Uint8Array.from([0xff, 0xfe, 0x0a]),
    ]), LIMIT);
    try {
      await expect(reader.drain(1_000)).resolves.toBe(false);
      expect(reader.lineCount()).toBe(1);
      expect(reader.readErrors()).toBe(1);
      expect(reader.completed()).toBe(false);
    } finally {
      await reader.cancel();
    }
  });

  test("reports a truncated final fragment without counting it as a line", async () => {
    const reader = readLines(streamOf([encoder.encode("complete\ntrunc")]), LIMIT);
    try {
      await expect(reader.drain(1_000)).resolves.toBe(true);
      expect(reader.lineCount()).toBe(1);
      expect(reader.fragment()).toBe("trunc");
      expect(reader.completed()).toBe(true);
    } finally {
      await reader.cancel();
    }
  });

  test("marks an oversized stream as overflowed and never settles clean", async () => {
    const reader = readLines(streamOf([encoder.encode(`${"x".repeat(64)}\n`)]), 8);
    try {
      await expect(reader.drain(1_000)).resolves.toBe(false);
      expect(reader.overflowed()).toBe(true);
      expect(reader.completed()).toBe(false);
    } finally {
      await reader.cancel();
    }
  });

  test("an absent stream drains cleanly with no lines", async () => {
    const reader = readLines(null, LIMIT);
    await expect(reader.drain(1_000)).resolves.toBe(true);
    expect(reader.lineCount()).toBe(0);
    expect(reader.fragment()).toBe("");
    await expect(reader.cancel()).resolves.toBe(true);
  });
});

describe("the retrieval stress UTF-8 first-item byte boundary", () => {
  const corpus: Corpus = { id: "stress-boundary", groupId: "stress-boundary", turns: [
    { id: "b0", sessionId: "sess-a", sessionIndex: 0, date: "2026-01-01", speaker: "Ada",
      text: "UNIQUEMARKERZZ café ☕ 😀 opening remark." },
    { id: "b1", sessionId: "sess-b", sessionIndex: 0, date: "2026-01-02", speaker: "Bea",
      text: "An unrelated filler reply about nothing durable." },
  ] };

  test("admits the exact first item and omits it one byte below", async () => {
    const first = corpus.turns[0]!;
    const reference = renderTurn(first);
    const referenceBytes = Buffer.byteLength(reference);
    expect([...first.text].some((character) => (character.codePointAt(0) ?? 0) > 127)).toBe(true);
    const retrievers = createRetrievers(corpus);
    try {
      const exact = await retrievers.retrieve("oh-window", "UNIQUEMARKERZZ",
        { topK: 1, contextBytes: referenceBytes });
      expect(exact.context).toBe(reference);
      expect(exact.turnIds).toEqual([first.id]);
      expect(exact.sessionIds).toEqual([first.sessionId]);
      expect(exact.omittedForBudget).toBe(0);

      const below = await retrievers.retrieve("oh-window", "UNIQUEMARKERZZ",
        { topK: 1, contextBytes: referenceBytes - 1 });
      expect(below.context).not.toContain(reference);
      expect(below.turnIds).not.toContain(first.id);
      expect(below.omittedForBudget).toBeGreaterThan(0);
    } finally {
      retrievers.close();
    }
  });
});
