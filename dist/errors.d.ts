export declare const OH_OPERATION_SIZE_ERROR_CODE_V1: "oh.operation-size.v1";
/** Recognizes a compare-and-swap conflict across separately bundled Oh entrypoints. */
export declare function isOhConflictError(value: unknown): value is OhConflictError;
export declare class OhConflictError extends Error {
    static [Symbol.hasInstance](value: unknown): boolean;
    constructor(message: string);
}
/** Recognizes an authority-integrity failure across separately bundled Oh entrypoints. */
export declare function isOhIntegrityError(value: unknown): value is OhIntegrityError;
export declare class OhIntegrityError extends Error {
    static [Symbol.hasInstance](value: unknown): boolean;
    constructor(message: string);
}
/** Recognizes a missing-dependency failure across separately bundled Oh entrypoints. */
export declare function isOhDependencyError(value: unknown): value is OhDependencyError;
export declare class OhDependencyError extends Error {
    static [Symbol.hasInstance](value: unknown): boolean;
    constructor(message: string);
}
/** Recognizes a store-profile refusal across separately bundled Oh entrypoints. */
export declare function isOhProfileError(value: unknown): value is OhProfileError;
export declare class OhProfileError extends Error {
    static [Symbol.hasInstance](value: unknown): boolean;
    constructor(message: string);
}
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