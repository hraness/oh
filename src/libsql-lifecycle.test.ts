import { expect, test } from "bun:test";
import { Cause, Effect, Exit, Fiber } from "effect";
import { LibSqlStoreProgram, makeLibSqlOwner } from "./libsql-program";
import { LibSqlAuthorityClient, libSqlAuthorityClientLive } from "./libsql-platform";
import { createOhStoreBindingV1, emptyOhHeadV1, OH_CANONICAL_STORE_PROFILE_V1 } from "./store";

test("interrupting an admitted operation cannot complete drain before the native transaction settles", async () => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let settle!: () => void;
  const held = new Promise<void>(resolve => { settle = resolve; });
  const events: string[] = [];
  const owner = Effect.runSync(makeLibSqlOwner);
  expect(Effect.runSync(owner.admit)).toBe(true);
  const operation = Effect.gen(function* () {
    const client = yield* LibSqlAuthorityClient;
    yield* client.batch([{ sql: "native transaction" }], "write");
    yield* Effect.sync(() => { events.push("reconciled"); });
  }).pipe(Effect.provide(libSqlAuthorityClientLive({
    execute: async () => ({ rows: [] }),
    batch: async () => {
      entered();
      await held;
      events.push("native-settled");
      return [{ rows: [] }];
    },
  })));
  const fiber = Effect.runFork(owner.complete(operation));
  await started;
  Effect.runSync(owner.beginClose);
  expect(Effect.runSync(owner.admit)).toBe(false);
  let drained = false;
  const drain = Effect.runPromise(owner.drained).then(() => { drained = true; });
  const interruption = Effect.runPromise(Fiber.interrupt(fiber));
  await Promise.resolve();
  expect(drained).toBe(false);
  expect(events).toEqual([]);
  settle();
  const exit = await interruption;
  await drain;
  expect(Exit.isFailure(exit) && Cause.isInterrupted(exit.cause)).toBe(true);
  expect(events).toEqual(["native-settled", "reconciled"]);
  expect(drained).toBe(true);
});


test("expected row and input failures stay typed while an unrelated response defect remains a defect", async () => {
  const binding = createOhStoreBindingV1({ profile: OH_CANONICAL_STORE_PROFILE_V1,
    realmId: "realm:typed-failures", spaceId: "typed-failures", v: 1 });
  const program = new LibSqlStoreProgram({
    execute: () => Effect.succeed({ rows: [{}] }),
    batch: () => Effect.succeed([]), close: Effect.void, currentInstant: Effect.succeed("2026-09-06T12:00:00.000Z"),
  }, binding);
  for (const [operation, tag] of [
    [program.head().pipe(Effect.asVoid), "LibSqlIntegrity"],
    [program.commit({ actorId: "", operationId: "", changes: [], expectedHead: emptyOhHeadV1() }).pipe(Effect.asVoid), "LibSqlValidation"],
  ] as const) {
    const exit = await Effect.runPromiseExit(operation);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Array.from(Cause.defects(exit.cause))).toEqual([]);
      expect(Array.from(Cause.failures(exit.cause)).map(failure => failure._tag)).toEqual([tag]);
    }
  }
  const defect = Object.freeze({ kind: "unexpected-provider-getter" });
  const defective = new LibSqlStoreProgram({
    execute: () => Effect.succeed({ get rows(): [] { throw defect; } }),
    batch: () => Effect.succeed([]), close: Effect.void, currentInstant: Effect.succeed("2026-09-06T12:00:00.000Z"),
  }, binding);
  const exit = await Effect.runPromiseExit(defective.head());
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Array.from(Cause.failures(exit.cause))).toEqual([]);
    expect(Array.from(Cause.defects(exit.cause))).toEqual([defect]);
  }
});
