import { Context, Effect, Layer } from "effect";
import { type OhHeadV1, type OhStoreV1 } from "./store";
import { type OhMemoryAuthorityOptionsV1 } from "./memory-core";
export type MemoryFailure = Readonly<{
    _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
    cause: unknown;
}>;
export declare function memoryFailure(cause: unknown): MemoryFailure;
/** Validation may reject hostile values; unrelated generator defects are not caught. */
export declare function memoryValue<A>(evaluate: () => A): Effect.Effect<A, MemoryFailure>;
declare const CanonicalMemoryStore_base: Context.TagClass<CanonicalMemoryStore, "@hraness/oh/CanonicalMemoryStore", {
    commit: (input: Parameters<OhStoreV1["commit"]>[0]) => Effect.Effect<import("./operation").OhOperationV1, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
    binding: Readonly<{
        bindingSha256: import("./canonical").Sha256Hex;
        contractSha256: import("./canonical").Sha256Hex;
        profile: import("./store").OhStoreProfileV1;
        realmId: string;
        spaceId: string;
        v: 1;
    }>;
    head: Effect.Effect<Readonly<{
        generation: number;
        graphRevisionSha256: import("./canonical").Sha256Hex | null;
        operationSha256: import("./canonical").Sha256Hex | null;
        recordsSha256: import("./canonical").Sha256Hex;
        sequence: number;
        v: 1;
    }>, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
    snapshot: (options: Parameters<OhStoreV1["snapshot"]>[0]) => Effect.Effect<Readonly<{
        head: OhHeadV1;
        records: readonly import("./graph").KnowledgeGraphRecordV1[];
        v: 1;
    }>, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
    changesSince: (from: Parameters<OhStoreV1["changesSince"]>[0], options: Parameters<OhStoreV1["changesSince"]>[1]) => Effect.Effect<Readonly<{
        from: import("./store").OhHeadRefV1;
        hasMore: boolean;
        operations: readonly import("./operation").OhOperationV1[];
        through: OhHeadV1;
        to: import("./store").OhHeadRefV1;
        v: 1;
    }>, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
}>;
/** Canonical commit is provided only to the trusted host authority composition. */
export declare class CanonicalMemoryStore extends CanonicalMemoryStore_base {
}
declare function canonicalStorePort(store: OhStoreV1): {
    commit: (input: Parameters<OhStoreV1["commit"]>[0]) => Effect.Effect<import("./operation").OhOperationV1, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
    binding: Readonly<{
        bindingSha256: import("./canonical").Sha256Hex;
        contractSha256: import("./canonical").Sha256Hex;
        profile: import("./store").OhStoreProfileV1;
        realmId: string;
        spaceId: string;
        v: 1;
    }>;
    head: Effect.Effect<Readonly<{
        generation: number;
        graphRevisionSha256: import("./canonical").Sha256Hex | null;
        operationSha256: import("./canonical").Sha256Hex | null;
        recordsSha256: import("./canonical").Sha256Hex;
        sequence: number;
        v: 1;
    }>, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
    snapshot: (options: Parameters<OhStoreV1["snapshot"]>[0]) => Effect.Effect<Readonly<{
        head: OhHeadV1;
        records: readonly import("./graph").KnowledgeGraphRecordV1[];
        v: 1;
    }>, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
    changesSince: (from: Parameters<OhStoreV1["changesSince"]>[0], options: Parameters<OhStoreV1["changesSince"]>[1]) => Effect.Effect<Readonly<{
        from: import("./store").OhHeadRefV1;
        hasMore: boolean;
        operations: readonly import("./operation").OhOperationV1[];
        through: OhHeadV1;
        to: import("./store").OhHeadRefV1;
        v: 1;
    }>, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
};
export type CanonicalMemoryStoreService = ReturnType<typeof canonicalStorePort>;
declare const WorkingMemorySource_base: Context.TagClass<WorkingMemorySource, "@hraness/oh/WorkingMemorySource", {
    readonly exportDependencyClosure: (input: Parameters<OhStoreV1["exportDependencyClosure"]>[0]) => Effect.Effect<Awaited<ReturnType<OhStoreV1["exportDependencyClosure"]>>, MemoryFailure>;
}>;
/** The host adoption program borrows only the working closure read capability. */
export declare class WorkingMemorySource extends WorkingMemorySource_base {
}
declare const MemoryAuthorityConfig_base: Context.TagClass<MemoryAuthorityConfig, "@hraness/oh/MemoryAuthorityConfig", Omit<{
    adoptionActorId: string;
    canonicalAuthorityId: string;
    workingAuthorityId: string;
    canonicalBinding: Readonly<{
        bindingSha256: import("./canonical").Sha256Hex;
        contractSha256: import("./canonical").Sha256Hex;
        profile: import("./store").OhStoreProfileV1;
        realmId: string;
        spaceId: string;
        v: 1;
    }>;
    workingBinding: Readonly<{
        bindingSha256: import("./canonical").Sha256Hex;
        contractSha256: import("./canonical").Sha256Hex;
        profile: import("./store").OhStoreProfileV1;
        realmId: string;
        spaceId: string;
        v: 1;
    }>;
    initialCanonicalHead: Readonly<{
        generation: number;
        graphRevisionSha256: import("./canonical").Sha256Hex | null;
        operationSha256: import("./canonical").Sha256Hex | null;
        recordsSha256: import("./canonical").Sha256Hex;
        sequence: number;
        v: 1;
    }>;
    maximumCanonicalOperationBytes: number;
    createAgentAt: (expectedHead: OhHeadV1) => Effect.Effect<import("./memory-core").OhMemoryAgentV2, Readonly<{
        _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
        cause: unknown;
    }>, never>;
    routesById: Map<string, Readonly<{
        destinationPurpose: string;
        nominationId: string;
    }>>;
    canonical: {
        commit: (input: Parameters<OhStoreV1["commit"]>[0]) => Effect.Effect<import("./operation").OhOperationV1, Readonly<{
            _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
            cause: unknown;
        }>, never>;
        binding: Readonly<{
            bindingSha256: import("./canonical").Sha256Hex;
            contractSha256: import("./canonical").Sha256Hex;
            profile: import("./store").OhStoreProfileV1;
            realmId: string;
            spaceId: string;
            v: 1;
        }>;
        head: Effect.Effect<Readonly<{
            generation: number;
            graphRevisionSha256: import("./canonical").Sha256Hex | null;
            operationSha256: import("./canonical").Sha256Hex | null;
            recordsSha256: import("./canonical").Sha256Hex;
            sequence: number;
            v: 1;
        }>, Readonly<{
            _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
            cause: unknown;
        }>, never>;
        snapshot: (options: Parameters<OhStoreV1["snapshot"]>[0]) => Effect.Effect<Readonly<{
            head: OhHeadV1;
            records: readonly import("./graph").KnowledgeGraphRecordV1[];
            v: 1;
        }>, Readonly<{
            _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
            cause: unknown;
        }>, never>;
        changesSince: (from: Parameters<OhStoreV1["changesSince"]>[0], options: Parameters<OhStoreV1["changesSince"]>[1]) => Effect.Effect<Readonly<{
            from: import("./store").OhHeadRefV1;
            hasMore: boolean;
            operations: readonly import("./operation").OhOperationV1[];
            through: OhHeadV1;
            to: import("./store").OhHeadRefV1;
            v: 1;
        }>, Readonly<{
            _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
            cause: unknown;
        }>, never>;
    };
    working: {
        exportDependencyClosure: (input: Parameters<OhStoreV1["exportDependencyClosure"]>[0]) => Effect.Effect<Readonly<{
            binding: import("./store").OhStoreBindingV1;
            closureSha256: import("./canonical").Sha256Hex;
            head: OhHeadV1;
            records: readonly import("./graph").KnowledgeGraphRecordV1[];
            roots: readonly string[];
            v: 1;
        }>, Readonly<{
            _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
            cause: unknown;
        }>, never>;
    };
}, "canonical" | "working">>;
export declare class MemoryAuthorityConfig extends MemoryAuthorityConfig_base {
}
/** Preparation captures caller-owned options before the first foreign wait. Stores
 * are borrowed; these Layers cannot close or purge either physical authority. */
export declare function memoryAuthorityLive(options: OhMemoryAuthorityOptionsV1): Layer.Layer<MemoryAuthorityConfig | CanonicalMemoryStore | WorkingMemorySource, MemoryFailure>;
export {};
//# sourceMappingURL=memory-authority-platform.d.ts.map