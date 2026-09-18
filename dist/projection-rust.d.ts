import { type OhProjectionDatasetV1, type OhProjectionEvaluationOptionsV1, type OhProjectionQueryV1, type OhProjectionResultV1, type OhProjectionRulePackV1, type OhProjectionSnapshotV1 } from "./projection";
export declare const OH_PROJECTION_RUST_ENGINE_V1: "oh.projection.rust.v1";
export interface ProjectionRustEngineV1 {
    readonly engine: typeof OH_PROJECTION_RUST_ENGINE_V1;
    evaluate(input: Readonly<{
        dataset: OhProjectionDatasetV1;
        options?: OhProjectionEvaluationOptionsV1;
        query: OhProjectionQueryV1;
        rulePack: OhProjectionRulePackV1;
        snapshot: OhProjectionSnapshotV1;
    }>): OhProjectionResultV1;
}
/** Load the Rust WASM positive-Datalog engine behind Oh's result envelope. */
export declare function loadProjectionRustEngineV1(): Promise<ProjectionRustEngineV1 | null>;
//# sourceMappingURL=projection-rust.d.ts.map