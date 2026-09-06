export declare const OH_OPERATION_SIZE_ERROR_CODE_V1: "oh.operation-size.v1";
/**
 * Recognizes this precommit refusal across separately bundled Oh entrypoints.
 * Native Error identity plus immutable branded fields excludes copied plain
 * objects while preserving one stable discriminator for package consumers.
 */
export declare function isOhOperationSizeError(value: unknown): value is OhOperationSizeError;
export declare class OhOperationSizeError extends RangeError {
    readonly code: typeof OH_OPERATION_SIZE_ERROR_CODE_V1;
    readonly maximumOperationBytes: number;
    readonly operationBytes: number;
    static [Symbol.hasInstance](value: unknown): boolean;
    constructor(operationBytes: number, maximumOperationBytes: number);
}
//# sourceMappingURL=errors.d.ts.map