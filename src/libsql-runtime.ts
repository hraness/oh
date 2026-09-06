import { Cause, Effect, Exit, Option } from "effect";
import type { OhLibSqlClientV1, OhLibSqlStoreAuthorityOptionsV1 } from "./libsql-model";
import type { OhStoreAuthorityV1, OhStoreV1, OhStoreHostControlV1, OhSpacePurgeReceiptV1 } from "./store";
import { bootstrapAuthority, createAuthority, openExistingAuthority, purgeWorkingSpace,
  makeLibSqlOwner, type LibSqlStoreProgram } from "./libsql-program";
import { LibSqlAuthorityClient, libSqlAuthorityClientLive, type LibSqlFailure } from "./libsql-platform";

function unwrap<A>(exit: Exit.Exit<A, LibSqlFailure>): A {
  if (Exit.isSuccess(exit)) return exit.value;
  const expected = Cause.failureOption(exit.cause);
  if (Option.isSome(expected)) throw expected.value.cause;
  throw Cause.squash(exit.cause);
}

function run<A>(program: Effect.Effect<A, LibSqlFailure, never>): Promise<A> {
  return Effect.runPromiseExit(Effect.uninterruptible(program)).then(unwrap);
}

function bindAuthority(authority: LibSqlStoreProgram, closeClient: Effect.Effect<void, LibSqlFailure>): OhStoreAuthorityV1 {
  const owner = Effect.runSync(makeLibSqlOwner);
  let closing: Promise<void> | undefined;
  const operation = <A>(program: Effect.Effect<A, LibSqlFailure>): Promise<A> => {
    if (!Effect.runSync(owner.admit)) return Promise.reject(authority.closedFailure().cause);
    return run(owner.complete(program));
  };
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    // No await before the fence. Already-admitted operations retain access until
    // their whole workflow settles, including reconciliation after a batch error.
    Effect.runSync(owner.beginClose);
    // Install the shared Promise before native close can synchronously reenter.
    closing = run(Effect.yieldNow().pipe(Effect.andThen(owner.drained), Effect.andThen(closeClient)));
    return closing;
  };
  return Object.freeze({
    store: Object.freeze<OhStoreV1>({
      binding: authority.binding,
      changesSince: (from, options) => operation(authority.changesSince(from, options)),
      close,
      commit: input => operation(authority.commit(input)),
      exportDependencyClosure: input => operation(authority.exportDependencyClosure(input)),
      head: () => operation(authority.head()),
      snapshot: options => operation(authority.snapshot(options)),
      verify: () => operation(authority.verify()),
    }),
    host: Object.freeze<OhStoreHostControlV1>({
      binding: authority.binding,
      purgeWorkingSpace: input => operation(authority.purgeFromHost(input)),
    }),
  });
}

export function bootstrapOhLibSqlAuthorityV1(client: OhLibSqlClientV1):
  Promise<Readonly<{ schemaSha256: import("./canonical").Sha256Hex; schemaVersion: 1; v: 1 }>> {
  return run(Effect.gen(function* () {
    return yield* bootstrapAuthority(yield* LibSqlAuthorityClient);
  }).pipe(Effect.provide(libSqlAuthorityClientLive(client))));
}

function open(client: OhLibSqlClientV1, options: OhLibSqlStoreAuthorityOptionsV1, existing: boolean): Promise<OhStoreAuthorityV1> {
  return run(Effect.gen(function* () {
    const port = yield* LibSqlAuthorityClient;
    const authority = yield* (existing ? openExistingAuthority(port, options) : createAuthority(port, options));
    return bindAuthority(authority, options.closeClient ? port.close : Effect.void);
  }).pipe(Effect.provide(libSqlAuthorityClientLive(client))));
}

export function createOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1,
  options: OhLibSqlStoreAuthorityOptionsV1 = {}): Promise<OhStoreAuthorityV1> {
  return open(client, options, false);
}

export function openExistingOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1,
  options: OhLibSqlStoreAuthorityOptionsV1 = {}): Promise<OhStoreAuthorityV1> {
  return open(client, options, true);
}

export function purgeOhLibSqlWorkingSpaceV1(client: OhLibSqlClientV1,
  options: OhLibSqlStoreAuthorityOptionsV1 & Readonly<{ purgedAt?: string }> = {}): Promise<OhSpacePurgeReceiptV1> {
  return run(Effect.gen(function* () {
    const port = yield* LibSqlAuthorityClient;
    const closeClient = options.closeClient ?? false;
    const result = yield* Effect.exit(purgeWorkingSpace(port, options));
    // As in the original try/finally facade, a native close failure wins over
    // the operation's rejection; otherwise replay its exact success/failure/defect.
    if (closeClient) yield* port.close;
    return yield* result;
  }).pipe(Effect.provide(libSqlAuthorityClientLive(client))));
}
