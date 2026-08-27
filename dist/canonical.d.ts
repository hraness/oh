export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export type JsonObject = Readonly<{
    [key: string]: JsonValue;
}>;
declare const sha256HexBrand: unique symbol;
export type Sha256Hex = string & {
    readonly [sha256HexBrand]: "Sha256Hex";
};
export declare class OhValidationError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
export declare function isPlainRecord(value: unknown): value is Record<string, unknown>;
export declare function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean;
/** RFC 8785-style canonical JSON for the JSON subset accepted by Oh. */
export declare function canonicalJson(value: unknown): string;
export declare function parseCanonicalJson(text: string, maximumBytes?: number): JsonValue;
export declare function utf8ByteLength(value: string): number;
export declare function sha256Hex(value: string | Uint8Array): Sha256Hex;
export declare function canonicalSha256(value: unknown): Sha256Hex;
export declare function parseSha256Hex(value: unknown): Sha256Hex | null;
export declare function parseCanonicalInstantV1(value: unknown): string | null;
export declare function canonicalNow(): string;
export declare function opaqueId(prefix: string): string;
export declare function safeCode(value: unknown, maximumLength?: number): string | null;
export declare function boundedText(value: unknown, maximumBytes?: number): string | null;
export declare function orderedUnique<T>(values: readonly T[], key: (value: T) => string): boolean;
export declare function sortUnique<T>(values: readonly T[], key: (value: T) => string): readonly T[];
export {};
//# sourceMappingURL=canonical.d.ts.map