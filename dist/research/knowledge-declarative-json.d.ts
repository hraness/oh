import { type JsonValue } from "./document-domain";
/** Copy bounded JSON data without invoking accessors or user-defined serialization. */
export declare function knowledgeDeclarativeJson(value: unknown, maximumBytes?: number, options?: Readonly<{
    preserveStrings?: boolean;
    maxDepth?: number;
    maxNodes?: number;
    /** Raw JSON evidence may contain these keys. Copies always have a null prototype. Default remains strict. */
    preserveObjectKeys?: boolean;
    maxArrayItems?: number;
}>): JsonValue | undefined;
export declare function freezeKnowledgeDeclaration<T>(value: T): T;
//# sourceMappingURL=knowledge-declarative-json.d.ts.map