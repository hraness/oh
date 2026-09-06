import { Context, Effect, Layer } from "effect";
import { safeCode } from "./canonical";
import { OH_OPERATION_MAX_BYTES_V1 } from "./operation";
import { OhConflictError, OhIntegrityError, OhProfileError,
  type OhHeadV1, type OhStoreV1 } from "./store";
import {
  authorityId, bindingFor, continuationKeyV2, createOhMemoryAgentV2WithRuntime,
  createOhMemoryRuntimeV2, immutableClone, parseMemoryAuthorityHead,
  resolveExtractors, resolveNominationRoutes, resolveProgramsV2,
  type OhMemoryAuthorityOptionsV1,
} from "./memory-core";

export type MemoryFailure = Readonly<{
  _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
  cause: unknown;
}>;

export function memoryFailure(cause: unknown): MemoryFailure {
  return { _tag: cause instanceof OhConflictError ? "MemoryConflict"
    : cause instanceof OhIntegrityError ? "MemoryIntegrity"
    : cause instanceof OhProfileError ? "MemoryProfile"
    : cause instanceof TypeError ? "MemoryValidation"
    : cause instanceof RangeError ? "MemoryCapacity" : "MemoryForeign", cause };
}

/** Validation may reject hostile values; unrelated generator defects are not caught. */
export function memoryValue<A>(evaluate: () => A): Effect.Effect<A, MemoryFailure> {
  return Effect.try({ try: evaluate, catch: memoryFailure });
}

function memoryCall<A>(operation: () => Promise<A>): Effect.Effect<A, MemoryFailure> {
  return Effect.tryPromise({ try: operation, catch: memoryFailure });
}

function readStore(store: OhStoreV1) {
  return {
    binding: store.binding,
    head: memoryCall(() => store.head()),
    snapshot: (options: Parameters<OhStoreV1["snapshot"]>[0]) => memoryCall(() => store.snapshot(options)),
    changesSince: (from: Parameters<OhStoreV1["changesSince"]>[0], options: Parameters<OhStoreV1["changesSince"]>[1]) =>
      memoryCall(() => store.changesSince(from, options)),
  };
}

/** Canonical commit is provided only to the trusted host authority composition. */
export class CanonicalMemoryStore extends Context.Tag("@hraness/oh/CanonicalMemoryStore")<
  CanonicalMemoryStore, ReturnType<typeof canonicalStorePort>
>() {}

function canonicalStorePort(store: OhStoreV1) {
  return { ...readStore(store),
    commit: (input: Parameters<OhStoreV1["commit"]>[0]) => memoryCall(() => store.commit(input)),
  };
}

export type CanonicalMemoryStoreService = ReturnType<typeof canonicalStorePort>;

/** The host adoption program borrows only the working closure read capability. */
export class WorkingMemorySource extends Context.Tag("@hraness/oh/WorkingMemorySource")<
  WorkingMemorySource, {
    readonly exportDependencyClosure: (input: Parameters<OhStoreV1["exportDependencyClosure"]>[0]) =>
      Effect.Effect<Awaited<ReturnType<OhStoreV1["exportDependencyClosure"]>>, MemoryFailure>;
  }
>() {}

function prepareAuthority(options: OhMemoryAuthorityOptionsV1) {
  const maximumCanonicalOperationBytes = options.maximumCanonicalOperationBytes ?? OH_OPERATION_MAX_BYTES_V1;
  if (!Number.isSafeInteger(maximumCanonicalOperationBytes) || maximumCanonicalOperationBytes < 1
    || maximumCanonicalOperationBytes > OH_OPERATION_MAX_BYTES_V1) {
    throw new TypeError("Invalid canonical memory operation byte bound.");
  }
  const memoryActorId = safeCode(options.actorId, 128);
  const adoptionActorId = safeCode(options.adoptionActorId, 128);
  if (memoryActorId === null || adoptionActorId === null) throw new TypeError("Invalid host-bound memory authority actor ID.");
  const canonicalStore = options.canonical.store;
  const workingStore = options.working.store;
  const canonicalAuthorityId = authorityId(options.canonical.authorityId);
  const workingAuthorityId = authorityId(options.working.authorityId);
  if (canonicalAuthorityId === workingAuthorityId) throw new OhProfileError("Working and canonical memory must be distinct physical authorities.");
  const canonicalBinding = bindingFor(canonicalStore, options.canonical.expectedBindingSha256, "canonical");
  const workingBinding = bindingFor(workingStore, options.working.expectedBindingSha256, "working");
  const initialCanonicalHead = parseMemoryAuthorityHead(options.canonical.expectedHead, "initial canonical");
  const workingCodecs = options.working.codecs;
  const explainCapabilityLifetimeMs = options.explainCapabilityLifetimeMs;
  const monotonicNow = options.monotonicNow;
  const now = options.now;
  const continuationKey = continuationKeyV2(options.continuationKey);
  const programs = Object.freeze([...resolveProgramsV2(options.programs).values()].map((program) =>
    immutableClone({ evaluation: program.evaluation, maximumPageBytes: program.maximumPageBytes,
      maximumRows: program.maximumRows, pageSize: program.pageSize, parameters: program.parameters,
      programId: program.programId, purpose: program.purpose, query: program.query,
      rulePack: program.rulePack, v: 2 as const })));
  const extractors = resolveExtractors(options.extractors ?? []);
  const nominationRoutes = Object.freeze([...resolveNominationRoutes(options.nominationRoutes ?? []).values()]);
  const runtime = createOhMemoryRuntimeV2(options);
  const createAgentAt = (expectedHead: OhHeadV1) => memoryCall(() => createOhMemoryAgentV2WithRuntime({
    actorId: memoryActorId,
    canonical: { authorityId: canonicalAuthorityId, expectedBindingSha256: canonicalBinding.bindingSha256,
      expectedHead, store: canonicalStore },
    continuationKey,
    ...(explainCapabilityLifetimeMs === undefined ? {} : { explainCapabilityLifetimeMs }),
    extractors,
    ...(monotonicNow === undefined ? {} : { monotonicNow }),
    nominationRoutes,
    ...(now === undefined ? {} : { now }),
    programs,
    working: { authorityId: workingAuthorityId, codecs: workingCodecs,
      expectedBindingSha256: workingBinding.bindingSha256, store: workingStore },
  }, runtime));
  return { adoptionActorId, canonicalAuthorityId, workingAuthorityId, canonicalBinding, workingBinding,
    initialCanonicalHead, maximumCanonicalOperationBytes, createAgentAt,
    routesById: new Map(nominationRoutes.map((route) => [route.nominationId, route])),
    canonical: canonicalStorePort(canonicalStore),
    working: { exportDependencyClosure: (input: Parameters<OhStoreV1["exportDependencyClosure"]>[0]) =>
      memoryCall(() => workingStore.exportDependencyClosure(input)) },
  };
}

export class MemoryAuthorityConfig extends Context.Tag("@hraness/oh/MemoryAuthorityConfig")<
  MemoryAuthorityConfig, Omit<ReturnType<typeof prepareAuthority>, "canonical" | "working">
>() {}

/** Preparation captures caller-owned options before the first foreign wait. Stores
 * are borrowed; these Layers cannot close or purge either physical authority. */
export function memoryAuthorityLive(options: OhMemoryAuthorityOptionsV1):
  Layer.Layer<MemoryAuthorityConfig | CanonicalMemoryStore | WorkingMemorySource, MemoryFailure> {
  return Layer.unwrapEffect(memoryValue(() => prepareAuthority(options)).pipe(Effect.map(prepared => {
    const { canonical, working, ...config } = prepared;
    return Layer.mergeAll(Layer.succeed(MemoryAuthorityConfig, config),
      Layer.succeed(CanonicalMemoryStore, canonical),
      Layer.succeed(WorkingMemorySource, working));
  })));
}
