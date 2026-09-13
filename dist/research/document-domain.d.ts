/** Portable canonical JSON primitives. The legacy error literal is retained for parser compatibility. */
export type Parsed<T> = Readonly<{
    ok: true;
    value: T;
}> | Readonly<{
    ok: false;
    error: "invalid-title";
}>;
export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | Readonly<{
    [key: string]: JsonValue;
}>;
export declare function parseJsonValue(value: unknown, limits?: Readonly<{
    maxDepth?: number;
    maxNodes?: number;
}>): Parsed<JsonValue>;
export declare function canonicalJson(value: JsonValue): string;
//# sourceMappingURL=document-domain.d.ts.map