import { Cause, Effect, Exit, Option } from "effect";
import { canonicalJson, canonicalSha256, isPlainRecord, hasExactKeys } from "./canonical";
import { canonicalKnowledgeGraphChangesV1, type KnowledgeGraphChangeV1 } from "./graph";
import { parseOhOperationV1 } from "./operation";
import { OH_DEPENDENCY_CLOSURE_LIMITS_V1, OhConflictError, OhIntegrityError, OhProfileError,
  parseOhHeadRefV1, parseOhHeadV1, type OhHeadV1, type OhStoreBindingV1 } from "./store";
import { OH_MEMORY_LIMITS_V1, OH_MEMORY_AUTHORITY_LIMITS_V1, immutableClone, exactHead, headRef,
  parseDetachedStoreSnapshot, datasetForSnapshot, parseMemoryAuthorityHead, detachCanonicalData,
  parseCanonicalAdvanceRequest, parseAdoptionRequest, canonicalAdvanceReceipt, adoptionReceipt,
  adoptionDifferences, unauthorizedAdoptionDifferences, assertAdoptionSnapshotCapacity, adoptionConflict,
  type LaneSnapshot, type OhMemoryCanonicalAdvanceReceiptV1, type OhMemoryAdoptionReceiptV1,
  type OhMemoryAdoptionConflictEntryV1 } from "./memory-core";
import { CanonicalMemoryStore, WorkingMemorySource, MemoryAuthorityConfig, memoryValue, memoryFailure, type CanonicalMemoryStoreService,
  type MemoryFailure } from "./memory-authority-platform";

type CanonicalAuthority = Readonly<{ authorityId: string; binding: OhStoreBindingV1;
  store: CanonicalMemoryStoreService }>;

function readLane(authority: CanonicalAuthority, lane: "canonical", expectedHead: OhHeadV1):
  Effect.Effect<LaneSnapshot, MemoryFailure> {
  return Effect.gen(function* () {
    const head = immutableClone(expectedHead);
    const returnedSnapshot = yield* authority.store.snapshot({
      head: { operationSha256: head.operationSha256, sequence: head.sequence },
      maximumRecords: OH_MEMORY_LIMITS_V1.maximumRecordsPerLane,
    });
    return yield* memoryValue(() => {
      const parsed = parseDetachedStoreSnapshot(returnedSnapshot, `The ${lane} store`, head, authority.binding.spaceId);
      const projected = datasetForSnapshot(authority.binding, parsed.snapshot, parsed.projectionSnapshot);
      return Object.freeze({ authorityId: authority.authorityId, binding: authority.binding,
        dataset: projected.dataset, lane, projectionSnapshot: projected.projectionSnapshot, snapshot: parsed.snapshot });
    });
  });
}

function proveCanonicalDescendant(
  authority: CanonicalAuthority,
  priorHead: OhHeadV1,
  nextHead: OhHeadV1,
  requiredFirstHead?: OhHeadV1,
): Effect.Effect<LaneSnapshot, MemoryFailure> {
  return Effect.gen(function* () {
    if (nextHead.sequence <= priorHead.sequence) {
      return yield* Effect.fail(memoryFailure(new OhConflictError("The next canonical memory head is not a descendant of the current pin.")));
    }
    const distance = nextHead.sequence - priorHead.sequence;
    if (distance > OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalAdvanceOperations
      || Math.ceil(distance / OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalChangeFeedPage)
        > OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalAdvancePages) {
      return yield* Effect.fail(memoryFailure(new RangeError("The canonical memory advance exceeds its total proof bound; advance in host-reviewed chunks.")));
    }
    const through = headRef(nextHead);
    let cursor = headRef(priorHead);
    let pageCount = 0;
    let reachedHead: OhHeadV1 | null = null;
    let firstHead: OhHeadV1 | null = null;
    while (cursor.sequence < through.sequence) {
      if (pageCount >= OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalAdvancePages) {
        return yield* Effect.fail(memoryFailure(new RangeError("The canonical memory advance exceeded its page proof bound; advance in host-reviewed chunks.")));
      }
      pageCount += 1;
      const remaining = through.sequence - cursor.sequence;
      const limit = Math.min(remaining, OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalChangeFeedPage);
      const page = yield* authority.store.changesSince(cursor, { limit, through });
      const returnedData = (yield* memoryValue(() => detachCanonicalData(
        page,
        "The canonical change-feed page",
        OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalChangeFeedPageBytes,
      ))).value;
      const returned = returnedData as Record<string, unknown>;
      if (!isPlainRecord(returned) || !hasExactKeys(returned,
        ["from", "hasMore", "operations", "through", "to", "v"])
        || returned.v !== 1 || typeof returned.hasMore !== "boolean"
        || !Array.isArray(returned.operations) || returned.operations.length > limit) {
        return yield* Effect.fail(memoryFailure(new OhIntegrityError("The canonical change feed returned an invalid page envelope.")));
      }
      const from = parseOhHeadRefV1(returned.from);
      const returnedThrough = parseOhHeadV1(returned.through);
      const returnedTo = parseOhHeadRefV1(returned.to);
      if (from === null || returnedThrough === null || returnedTo === null
        || canonicalJson(from) !== canonicalJson(cursor)
        || !exactHead(returnedThrough, nextHead)) {
        return yield* Effect.fail(memoryFailure(new OhIntegrityError("The canonical change feed changed its pinned bounds.")));
      }
      let reached = cursor;
      for (const value of returned.operations) {
        const operation = parseOhOperationV1(value);
        if (operation === null || operation.spaceId !== authority.binding.spaceId
          || operation.sequence !== reached.sequence + 1
          || operation.parentOperationSha256 !== reached.operationSha256) {
          return yield* Effect.fail(memoryFailure(new OhIntegrityError("The canonical change feed contains a gap or different authority.")));
        }
        reached = Object.freeze({ operationSha256: operation.operationSha256,
          sequence: operation.sequence });
        reachedHead = immutableClone({ generation: operation.sequence,
          graphRevisionSha256: operation.graphRevisionSha256,
          operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
          sequence: operation.sequence, v: 1 });
        firstHead ??= reachedHead;
      }
      if (canonicalJson(reached) !== canonicalJson(returnedTo)
        || (returned.hasMore && returned.operations.length === 0)
        || (returned.hasMore && reached.sequence >= through.sequence)
        || reached.sequence > through.sequence
        || (!returned.hasMore && canonicalJson(reached) !== canonicalJson(through))) {
        return yield* Effect.fail(memoryFailure(new OhIntegrityError("The canonical change feed did not prove the requested descendant.")));
      }
      cursor = reached;
    }
    if (reachedHead === null || !exactHead(reachedHead, nextHead)) {
      return yield* Effect.fail(memoryFailure(new OhIntegrityError("The canonical change feed did not prove the requested full head.")));
    }
    if (requiredFirstHead !== undefined
      && (firstHead === null || !exactHead(firstHead, requiredFirstHead))) {
      return yield* Effect.fail(memoryFailure(new OhIntegrityError("The returned adoption operation is not on the current canonical path.")));
    }
    return yield* readLane(authority, "canonical", nextHead);
  });
}

/** One FIFO for trusted host changes; agent calls retain their captured immutable pin.
 * After admission the operation retains its permit through actual foreign settlement
 * and pin publication. Native commit/CAS remains authoritative; there is no retry. */
export const makeMemoryAuthority = Effect.gen(function* () {
  const { initialCanonicalHead, createAgentAt, canonicalAuthorityId, workingAuthorityId,
    canonicalBinding, workingBinding, routesById, adoptionActorId, maximumCanonicalOperationBytes } = yield* MemoryAuthorityConfig;
  const canonicalStore = yield* CanonicalMemoryStore;
  const workingStore = yield* WorkingMemorySource;
  const hostOrder = yield* Effect.makeSemaphore(1);
  let activeCanonicalHead = initialCanonicalHead;
  let activeAgent = yield* createAgentAt(activeCanonicalHead);
  const canonicalAuthority = Object.freeze({ authorityId: canonicalAuthorityId, binding: canonicalBinding, store: canonicalStore });
  const installCanonicalHead = (head: OhHeadV1) => Effect.gen(function* () {
    const nextAgent = yield* createAgentAt(head);
    // Publish both references together only after the next snapshot is verified.
    activeAgent = nextAgent;
    activeCanonicalHead = immutableClone(head);
  });
  const readPhysicalCanonicalHead = () => canonicalStore.head.pipe(
    Effect.flatMap(head => memoryValue(() => parseMemoryAuthorityHead(head, "physical canonical"))));
  const advanceCanonical = (request: ReturnType<typeof parseCanonicalAdvanceRequest>): Effect.Effect<OhMemoryCanonicalAdvanceReceiptV1, MemoryFailure> =>
    hostOrder.withPermits(1)(Effect.uninterruptible(Effect.gen(function* () {
      const priorHead = activeCanonicalHead;
      if (!exactHead(request.expectedHead, priorHead)) {
        return yield* Effect.fail(memoryFailure(new OhConflictError("The expected canonical memory head does not match the current pin.")));
      }
      if (exactHead(request.nextHead, priorHead)) {
        return canonicalAdvanceReceipt(canonicalAuthorityId, canonicalBinding.bindingSha256,
          priorHead, priorHead, "unchanged");
      }
      yield* proveCanonicalDescendant(canonicalAuthority, priorHead, request.nextHead);
      yield* installCanonicalHead(request.nextHead);
      return canonicalAdvanceReceipt(canonicalAuthorityId, canonicalBinding.bindingSha256,
        priorHead, request.nextHead, "advanced");
    })));

  const adoptNomination = (request: ReturnType<typeof parseAdoptionRequest>): Effect.Effect<OhMemoryAdoptionReceiptV1, MemoryFailure> =>
    hostOrder.withPermits(1)(Effect.uninterruptible(Effect.gen(function* () {
      const route = routesById.get(request.nomination.nominationId);
      if (route === undefined || route.destinationPurpose !== request.nomination.destinationPurpose) {
        return yield* Effect.fail(memoryFailure(new OhProfileError("The memory nomination is not bound to this adoption route.")));
      }
      if (request.nomination.source.authorityId !== workingAuthorityId
        || request.nomination.source.bindingSha256 !== workingBinding.bindingSha256
        || request.nomination.closure.binding.bindingSha256 !== workingBinding.bindingSha256) {
        return yield* Effect.fail(memoryFailure(new OhProfileError("The memory nomination is not from the bound working authority.")));
      }
      const returnedReexport = yield* workingStore.exportDependencyClosure({
        head: headRef(request.nomination.source.head),
        maximumRecords: OH_DEPENDENCY_CLOSURE_LIMITS_V1.records,
        roots: request.nomination.closure.roots,
      });
      const reexported = yield* memoryValue(() => detachCanonicalData(returnedReexport, "The working re-exported nomination",
        OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes));
      if (reexported.canonical !== canonicalJson(request.nomination.closure)) {
        return yield* Effect.fail(memoryFailure(new OhIntegrityError("The working authority did not re-export the nominated closure exactly.")));
      }

      const priorHead = activeCanonicalHead;
      const physicalHead = yield* readPhysicalCanonicalHead();
      const replacementConflictsAt = (currentLane: LaneSnapshot): Effect.Effect<readonly OhMemoryAdoptionConflictEntryV1[], MemoryFailure> => Effect.gen(function* () {
        if (request.replacements.length === 0) return [];
        const reviewedLane = exactHead(request.expectedCanonicalHead, currentLane.snapshot.head)
          ? currentLane
          : yield* readLane(canonicalAuthority, "canonical", request.expectedCanonicalHead);
        return unauthorizedAdoptionDifferences(reviewedLane.snapshot, currentLane.snapshot,
          request.nomination.closure.records, request.replacements);
      });
      if (!exactHead(physicalHead, priorHead)) {
        const physicalLane = yield* proveCanonicalDescendant(canonicalAuthority, priorHead, physicalHead);
        const physicalDifferences = adoptionDifferences(physicalLane.snapshot,
          request.nomination.closure.records);
        if (physicalDifferences.length === 0) {
          const replacementConflicts = yield* replacementConflictsAt(physicalLane);
          if (replacementConflicts.length > 0) {
            return yield* Effect.fail(memoryFailure(adoptionConflict(request.expectedCanonicalHead, physicalHead, replacementConflicts)));
          }
          yield* installCanonicalHead(physicalHead);
          return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
            canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
            priorHead, physicalHead, "already-present");
        }
        return yield* Effect.fail(memoryFailure(adoptionConflict(request.expectedCanonicalHead, physicalHead, physicalDifferences)));
      }

      const lane = yield* readLane(canonicalAuthority, "canonical", priorHead);
      const differences = adoptionDifferences(lane.snapshot, request.nomination.closure.records);
      if (!exactHead(request.expectedCanonicalHead, priorHead)) {
        if (differences.length === 0) {
          const replacementConflicts = yield* replacementConflictsAt(lane);
          if (replacementConflicts.length > 0) {
            return yield* Effect.fail(memoryFailure(adoptionConflict(request.expectedCanonicalHead, priorHead, replacementConflicts)));
          }
          return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
            canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
            priorHead, priorHead, "already-present");
        }
        return yield* Effect.fail(memoryFailure(adoptionConflict(request.expectedCanonicalHead, priorHead, differences)));
      }
      if (differences.length === 0) {
        const replacementConflicts = yield* replacementConflictsAt(lane);
        if (replacementConflicts.length > 0) {
          return yield* Effect.fail(memoryFailure(adoptionConflict(request.expectedCanonicalHead, priorHead, replacementConflicts)));
        }
        return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
          canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
          priorHead, priorHead, "already-present");
      }
      const unauthorized = unauthorizedAdoptionDifferences(lane.snapshot, lane.snapshot,
        request.nomination.closure.records, request.replacements);
      if (unauthorized.length > 0) {
        return yield* Effect.fail(memoryFailure(adoptionConflict(request.expectedCanonicalHead, priorHead, unauthorized)));
      }
      const changedKeys = new Set(differences.map(({ key }) => key));
      const changedRecords = request.nomination.closure.records
        .filter(({ key }) => changedKeys.has(key));
      if (changedRecords.length === 0) {
        return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
          canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
          priorHead, priorHead, "already-present");
      }
      yield* memoryValue(() => assertAdoptionSnapshotCapacity(lane.snapshot, changedRecords));
      const changes = canonicalKnowledgeGraphChangesV1(changedRecords
        .map((record): KnowledgeGraphChangeV1 => ({ kind: "put", record, v: 1 })));
      const operationId = `memory_adopt_${canonicalSha256({ actorId: adoptionActorId,
        bindingSha256: canonicalBinding.bindingSha256,
        nominationSha256: request.nomination.nominationSha256,
        priorHead, v: 1 }).slice(0, 48)}`;
      const committed = yield* Effect.exit(canonicalStore.commit({ actorId: adoptionActorId, changes,
          expectedHead: { generation: priorHead.generation,
            operationSha256: priorHead.operationSha256 },
          maximumOperationBytes: maximumCanonicalOperationBytes,
          operationId }));
      if (Exit.isFailure(committed)) {
        const error = Cause.failureOption(committed.cause);
        if (Option.isNone(error) || error.value._tag !== "MemoryConflict") return yield* Effect.failCause(committed.cause);
        const actualHead = yield* readPhysicalCanonicalHead();
        const actualLane = exactHead(actualHead, priorHead)
          ? yield* readLane(canonicalAuthority, "canonical", actualHead)
          : yield* proveCanonicalDescendant(canonicalAuthority, priorHead, actualHead);
        const actualDifferences = adoptionDifferences(actualLane.snapshot,
          request.nomination.closure.records);
        if (actualDifferences.length === 0) {
          if (!exactHead(actualHead, priorHead)) {
            yield* installCanonicalHead(actualHead);
          }
          return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
            canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
            priorHead, actualHead, "already-present");
        }
        return yield* Effect.fail(memoryFailure(adoptionConflict(request.expectedCanonicalHead, actualHead, actualDifferences)));
      }
      const operation = yield* memoryValue(() => parseOhOperationV1(detachCanonicalData(committed.value,
        "The returned canonical adoption operation",
        OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalChangeFeedPageBytes).value));
      if (operation === null || operation.actorId !== adoptionActorId
        || operation.operationId !== operationId || operation.spaceId !== canonicalBinding.spaceId
        || operation.parentOperationSha256 !== priorHead.operationSha256
        || operation.sequence !== priorHead.sequence + 1
        || canonicalJson(operation.changes) !== canonicalJson(changes)) {
        return yield* Effect.fail(memoryFailure(new OhIntegrityError("The canonical authority returned a different adoption operation.")));
      }
      const head: OhHeadV1 = immutableClone({ generation: operation.sequence,
        graphRevisionSha256: operation.graphRevisionSha256,
        operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
        sequence: operation.sequence, v: 1 });
      const actualHead = yield* readPhysicalCanonicalHead();
      if (!exactHead(actualHead, head)) {
        const actualLane = exactHead(actualHead, priorHead)
          ? yield* readLane(canonicalAuthority, "canonical", actualHead)
          : yield* proveCanonicalDescendant(canonicalAuthority, priorHead, actualHead, head);
        const actualDifferences = adoptionDifferences(actualLane.snapshot,
          request.nomination.closure.records);
        if (actualDifferences.length !== 0) {
          return yield* Effect.fail(memoryFailure(adoptionConflict(request.expectedCanonicalHead, actualHead, actualDifferences)));
        }
        yield* installCanonicalHead(actualHead);
        return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
          canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
          priorHead, actualHead, "already-present");
      }
      yield* installCanonicalHead(actualHead);
      return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
        canonicalBinding.bindingSha256, request.nomination.nominationSha256,
        operation.operationSha256, priorHead, actualHead, "adopted");
    })));

  return { get agent() { return activeAgent; }, advanceCanonical, adoptNomination };
});
