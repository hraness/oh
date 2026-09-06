import { Effect } from "effect";
import { safeCode } from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { createOhSyncBundleV1, parseOhSyncBundleV1, parseOhSyncHeadV1,
  type OhSyncHeadV1, type OhSyncResultV1 } from "./sync-model";
import { SyncStore, SyncTransport, type SyncFailure } from "./sync-platform";

export type SyncOptions = Readonly<{ batchSize?: number; maximumRounds?: number; remoteId?: string }>;

/** Only the store adapter can enter the synchronous SQLite transaction. */
export function synchronize(options: SyncOptions = {}):
  Effect.Effect<OhSyncResultV1, SyncFailure, SyncStore | SyncTransport> {
  return Effect.gen(function* () {
    const store = yield* SyncStore;
    const transport = yield* SyncTransport;
    const batchSize = options.batchSize ?? 100;
    const maximumRounds = options.maximumRounds ?? 100;
    const remoteId = safeCode(options.remoteId ?? "default");
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000
      || !Number.isSafeInteger(maximumRounds) || maximumRounds < 1 || maximumRounds > 10_000
      || remoteId === null) return yield* Effect.fail({ _tag: "ValidationFailure", cause: new TypeError("Invalid sync options.") } satisfies SyncFailure);
    yield* transport.handshake(OH_CONTRACT_MANIFEST_V1);
    let pulled = 0;
    let pushed = 0;
    const settled = (head: OhSyncHeadV1, rounds: number): Effect.Effect<OhSyncResultV1, SyncFailure> => Effect.gen(function* () {
      yield* store.updateSyncState(remoteId, { pulledSequence: head.sequence,
        pushedSequence: head.sequence, remoteHeadSha256: head.operationSha256 });
      return { head, pulled, pushed, rounds, v: 1 };
    });
    for (let round = 1; round <= maximumRounds; round += 1) {
      const remote = parseOhSyncHeadV1(yield* transport.head(store.spaceId));
      if (remote === null) return yield* Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport returned an invalid head.") } satisfies SyncFailure);
      const local = (yield* store.head);
      if (local.sequence === remote.sequence) {
        if (local.operationSha256 !== remote.operationSha256) {
          return yield* Effect.fail({ _tag: "SyncConflict", cause: new Error("Sync conflict: equal sequence numbers have different heads.") } satisfies SyncFailure);
        }
        return yield* settled(remote, round);
      }
      if (local.sequence < remote.sequence) {
        const bundle = parseOhSyncBundleV1(yield* transport.pull(store.spaceId, local.sequence, batchSize));
        const terminal = bundle?.operations.at(-1);
        if (bundle === null || bundle.operations.length === 0
          || bundle.operations.length > batchSize
          || bundle.spaceId !== store.spaceId
          || bundle.operations[0]?.sequence !== local.sequence + 1
          || bundle.operations[0]?.parentOperationSha256 !== local.operationSha256
          || terminal === undefined || terminal.sequence > remote.sequence
          || (terminal.sequence === remote.sequence
            && terminal.operationSha256 !== remote.operationSha256)) {
          return yield* Effect.fail({ _tag: "SyncConflict", cause: new Error("Sync conflict: remote history does not extend the local head.") } satisfies SyncFailure);
        }
        yield* store.importOperations({
          expectedHead: {
            operationSha256: local.operationSha256,
            sequence: local.sequence,
          },
          operations: bundle.operations,
        });
        pulled += bundle.operations.length;
        const afterPull = (yield* store.head);
        if (afterPull.sequence === remote.sequence
          && afterPull.operationSha256 === remote.operationSha256) {
          const confirmed = parseOhSyncHeadV1(yield* transport.head(store.spaceId));
          if (confirmed === null) return yield* Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport returned an invalid head.") } satisfies SyncFailure);
          const confirmedLocal = (yield* store.head);
          if (confirmed.sequence === remote.sequence
            && confirmed.operationSha256 === remote.operationSha256
            && confirmedLocal.sequence === confirmed.sequence
            && confirmedLocal.operationSha256 === confirmed.operationSha256) {
            return yield* settled(confirmed, round);
          }
        }
      } else {
        const candidates = (yield* store.changesSince({
          operationSha256: remote.operationSha256,
          sequence: remote.sequence,
        }, {
          limit: batchSize,
          through: {
            operationSha256: local.operationSha256,
            sequence: local.sequence,
          },
        })).operations;
        if (candidates.length === 0 || candidates[0]?.sequence !== remote.sequence + 1
          || candidates[0]?.parentOperationSha256 !== remote.operationSha256) {
          return yield* Effect.fail({ _tag: "SyncConflict", cause: new Error("Sync conflict: local history does not extend the remote head.") } satisfies SyncFailure);
        }
        const bundle = createOhSyncBundleV1(store.spaceId, candidates, {
          largestFittingPrefix: true,
        });
        const operations = bundle.operations;
        const head = parseOhSyncHeadV1(yield* transport.push(bundle));
        if (head === null) return yield* Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport returned an invalid push head.") } satisfies SyncFailure);
        if (head.sequence !== operations.at(-1)?.sequence
          || head.operationSha256 !== operations.at(-1)?.operationSha256) {
          return yield* Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport acknowledged a different head.") } satisfies SyncFailure);
        }
        pushed += operations.length;
        const afterPush = (yield* store.head);
        if (afterPush.sequence === head.sequence
          && afterPush.operationSha256 === head.operationSha256) {
          const confirmed = parseOhSyncHeadV1(yield* transport.head(store.spaceId));
          if (confirmed === null) return yield* Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport returned an invalid head.") } satisfies SyncFailure);
          const confirmedLocal = (yield* store.head);
          if (confirmed.sequence === head.sequence
            && confirmed.operationSha256 === head.operationSha256
            && confirmedLocal.sequence === confirmed.sequence
            && confirmedLocal.operationSha256 === confirmed.operationSha256) {
            return yield* settled(confirmed, round);
          }
        }
      }
    }
    return yield* Effect.fail({ _tag: "RoundLimit", cause: new Error("Sync did not settle within maximumRounds.") } satisfies SyncFailure);
  });
}
