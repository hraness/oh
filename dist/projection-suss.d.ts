import { type OhProjectionDatasetV1, type OhProjectionEvaluationOptionsV1, type OhProjectionQueryV1, type OhProjectionResultV1, type OhProjectionRulePackV1, type OhProjectionSnapshotV1 } from "./projection";
export declare const OH_PROJECTION_SUSS_VERSION_V1: "0.20.0";
export declare const OH_PROJECTION_SUSS_ENGINE_V1: "suss.datalog.v0-20-0.equivalence";
/**
 * Evaluates the positive rule pack with Suss 0.20.0, then requires its complete
 * relation sets to equal Oh's bounded reference semantics before returning the
 * canonical derived-only result. The conservative admission check keeps Suss,
 * whose public evaluator has no execution-budget hook, inside Oh's tuple bound.
 */
export declare function evaluateOhProjectionWithSussV1(input: Readonly<{
    dataset: OhProjectionDatasetV1;
    options?: OhProjectionEvaluationOptionsV1;
    query: OhProjectionQueryV1;
    rulePack: OhProjectionRulePackV1;
    snapshot: OhProjectionSnapshotV1;
}>): OhProjectionResultV1;
//# sourceMappingURL=projection-suss.d.ts.map