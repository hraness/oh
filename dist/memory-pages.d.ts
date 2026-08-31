import { type Sha256Hex } from "./canonical";
import type { OhRecordCodec } from "./contract";
import { type KnowledgeGraphRecordV1 } from "./graph";
export declare const OH_MEMORY_PAGE_FORMAT_V1: "oh.memory-page.v1";
export declare const OH_MEMORY_PAGE_MARKDOWN_EXTENSION_V1: ".oh.md";
export declare const OH_MEMORY_PAGE_LIMITS_V1: Readonly<{
    bodyBytes: number;
    fileBytes: number;
    frontmatterLines: number;
    languageBytes: 255;
    sourceTitleBytes: 1024;
    sourceUrlBytes: 4096;
    sources: 128;
    summaryBytes: 8192;
    titleBytes: 512;
    valueBytes: number;
}>;
export type OhMemoryPageSourceV1 = Readonly<{
    contentSha256: Sha256Hex;
    observedAt: string;
    title: string;
    url: string;
    v: 1;
}>;
/**
 * A pointer to a host-owned attestation receipt. Parsing confirms the receipt
 * identity, not the receipt's existence, signature, or authorization.
 */
export type OhMemoryPageProvenanceV1 = Readonly<{
    actorId: string;
    attestationSha256: Sha256Hex;
    attestedAt: string;
    kind: "host-attested";
    v: 1;
}>;
export type OhMemoryPageValueV1 = Readonly<{
    body: string;
    createdAt: string;
    format: typeof OH_MEMORY_PAGE_FORMAT_V1;
    language: string | null;
    provenance: OhMemoryPageProvenanceV1;
    sources: readonly OhMemoryPageSourceV1[];
    summary: string;
    title: string;
    updatedAt: string;
    v: 1;
}>;
export type OhMemoryPageRecordV1 = Omit<KnowledgeGraphRecordV1, "kind" | "value"> & Readonly<{
    kind: "edition";
    value: OhMemoryPageValueV1;
}>;
export type OhMemoryPageRecordInputV1 = Readonly<{
    dependencies: readonly string[];
    key: string;
    value: OhMemoryPageValueV1;
}>;
/** Parses only the exact, bounded, model-neutral V1 page value. */
export declare function parseOhMemoryPageValueV1(value: unknown): OhMemoryPageValueV1 | null;
export declare function createOhMemoryPageValueV1(value: OhMemoryPageValueV1): OhMemoryPageValueV1;
/** Creates an ordinary content-addressed Oh `edition` record. */
export declare function createOhMemoryPageRecordV1(input: OhMemoryPageRecordInputV1): OhMemoryPageRecordV1;
export declare function parseOhMemoryPageRecordV1(value: unknown): OhMemoryPageRecordV1 | null;
/** Register this only where `edition` is reserved for the memory-page profile. */
export declare const OH_MEMORY_PAGE_RECORD_CODEC_V1: OhRecordCodec;
/**
 * Renders a self-contained record transport. Oh bundles remain the
 * authoritative multi-record and operation transport.
 */
export declare function renderOhMemoryPageMarkdownV1(value: OhMemoryPageRecordV1): string;
/**
 * Parses the exact `.oh.md` scalar subset and recomputes the graph record
 * digest. Comments, aliases, tags, duplicate keys, alternate key order,
 * alternate scalar spellings, and CRLF are rejected.
 */
export declare function parseOhMemoryPageMarkdownV1(text: unknown): OhMemoryPageRecordV1 | null;
//# sourceMappingURL=memory-pages.d.ts.map