import { Effect, Exit, FiberSet, Ref } from "effect";
import type { KnowledgeGraphRecordV1 } from "./graph";
import { type OhSemanticSearchResultV1 } from "./semantic-model";
import { SemanticPlatform, type SemanticFailure } from "./semantic-platform";
import type { OhSqliteStore } from "./sqlite/store";
export interface SemanticLifecycle {
    readonly closed: Ref.Ref<boolean>;
    readonly operations: FiberSet.FiberSet<Exit.Exit<unknown, SemanticFailure>, never>;
    readonly close: Effect.Effect<void, SemanticFailure>;
    index(records: readonly KnowledgeGraphRecordV1[]): Effect.Effect<Readonly<{
        indexed: number;
        v: 1;
    }>, SemanticFailure>;
    search(query: string, limit: number, authority: OhSqliteStore): Effect.Effect<readonly OhSemanticSearchResultV1[], SemanticFailure>;
}
/** One owner scope holds the optional store until all admitted operations settle. */
export declare const makeSemanticLifecycle: Effect.Effect<SemanticLifecycle, never, SemanticPlatform>;
//# sourceMappingURL=semantic-program.d.ts.map