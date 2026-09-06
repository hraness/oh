import { Effect } from "effect";
import { parseCanonicalAdvanceRequest, parseAdoptionRequest, type OhMemoryCanonicalAdvanceReceiptV1, type OhMemoryAdoptionReceiptV1 } from "./memory-core";
import { CanonicalMemoryStore, WorkingMemorySource, MemoryAuthorityConfig, type MemoryFailure } from "./memory-authority-platform";
/** One FIFO for trusted host changes; agent calls retain their captured immutable pin.
 * After admission the operation retains its permit through actual foreign settlement
 * and pin publication. Native commit/CAS remains authoritative; there is no retry. */
export declare const makeMemoryAuthority: Effect.Effect<{
    readonly agent: import("./memory-core").OhMemoryAgentV2;
    advanceCanonical: (request: ReturnType<typeof parseCanonicalAdvanceRequest>) => Effect.Effect<OhMemoryCanonicalAdvanceReceiptV1, MemoryFailure>;
    adoptNomination: (request: ReturnType<typeof parseAdoptionRequest>) => Effect.Effect<OhMemoryAdoptionReceiptV1, MemoryFailure>;
}, Readonly<{
    _tag: "MemoryConflict" | "MemoryIntegrity" | "MemoryProfile" | "MemoryValidation" | "MemoryCapacity" | "MemoryForeign";
    cause: unknown;
}>, CanonicalMemoryStore | WorkingMemorySource | MemoryAuthorityConfig>;
//# sourceMappingURL=memory-authority-program.d.ts.map