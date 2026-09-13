declare const sha256HexBrand: unique symbol;
export type Sha256Hex = string & {
    readonly [sha256HexBrand]: "Sha256Hex";
};
export declare const SPONGE_SHA256_HEX_PATTERN: RegExp;
export declare const SPONGE_CANONICAL_INSTANT_PATTERN: RegExp;
/** Locale-independent UTF-16 code-unit order for canonical collections. */
export declare function compareUtf16CodeUnits(left: string, right: string): number;
export declare function parseSha256Hex(value: unknown): Sha256Hex | null;
export declare function parseCanonicalInstantV1(value: unknown): string | null;
export declare function utf8ByteLength(value: string): number;
export declare function sha256Hex(bytes: Uint8Array): Promise<Sha256Hex>;
export declare function sha256Text(value: string): Promise<Sha256Hex>;
export {};
//# sourceMappingURL=integrity-domain.d.ts.map