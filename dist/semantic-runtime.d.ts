import type { OhSemanticSearchBackendV1 } from "./semantic-model";
import { type SemanticOptions } from "./semantic-platform";
type SemanticBoundary = Omit<OhSemanticSearchBackendV1, "profile">;
export declare function makeSemanticBoundary(options: SemanticOptions): SemanticBoundary;
export {};
//# sourceMappingURL=semantic-runtime.d.ts.map