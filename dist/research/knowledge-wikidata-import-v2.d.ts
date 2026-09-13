import { type JsonValue } from "./document-domain";
import { type Sha256Hex } from "./integrity-domain";
/** V2 adds all-present selection and source-addressed assertions; the published V1 engine stays frozen.
 * Provider metadata remains caller asserted. EntitySchema references are preserved; EntitySchema documents are not Wikibase entity JSON. */
export declare const KNOWLEDGE_WIKIDATA_IMPORTER_V2 = "sponge.wikidata-json-import.v2";
export declare const KNOWLEDGE_WIKIDATA_DATATYPES_V2: readonly ["commonsMedia", "entity-schema", "external-id", "geo-shape", "globe-coordinate", "math", "monolingualtext", "musical-notation", "quantity", "string", "tabular-data", "time", "url", "wikibase-form", "wikibase-item", "wikibase-lexeme", "wikibase-property", "wikibase-sense"];
/** This classifies preservation support only, never semantic completeness or truth. */
export declare function knowledgeWikidataDatatypeSupportV2(datatype: string): "typed-source-value" | "opaque-source-value";
export declare const KNOWLEDGE_WIKIDATA_PROPERTY_GROUP_LIMIT_V2 = 4096;
export declare const KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2: Readonly<{
    readonly maxBytes: number;
    readonly maxDepth: 64;
    readonly maxNodes: 1000000;
    readonly maxArrayItems: 250000;
}>;
/** Accessor-safe raw JSON transport, with the same budget used before creating and verifying previews. */
export declare function boundedKnowledgeWikidataPreviewJsonV2(value: unknown): JsonValue | undefined;
export declare const KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2: Readonly<{
    readonly maxEntities: 100;
    readonly maxStatements: 1000;
    readonly maxRecords: 4096;
    readonly maxSourceBytes: number;
}>;
export type KnowledgeWikidataImportBoundsV2 = Readonly<{
    maxEntities: number;
    maxStatements: number;
    maxRecords: number;
    maxSourceBytes: number;
}>;
export type KnowledgeWikidataImportResultV2<T> = Readonly<{
    ok: true;
    value: T;
}> | Readonly<{
    ok: false;
    error: Readonly<{
        code: "invalid-input" | "invalid-source" | "input-bound" | "integrity-mismatch";
        field: string;
        retryable: false;
    }>;
}>;
export type KnowledgeWikidataSourceCoverageV2 = Readonly<{
    kind: "complete-entity";
}> | Readonly<{
    kind: "selected-properties";
    properties: readonly string[];
}> | Readonly<{
    kind: "partial";
    reason: string;
}>;
export type KnowledgeWikidataCaptureInputV2 = Readonly<{
    requestedId: string;
    resolvedId: string;
    sourceUri: string;
    capturedAt: string;
    body: string;
    redirects: readonly Readonly<{
        from: string;
        to: string;
    }>[];
    coverage: KnowledgeWikidataSourceCoverageV2;
}>;
export type KnowledgeWikidataImportInputV2 = Readonly<{
    v: 2;
    captures: readonly KnowledgeWikidataCaptureInputV2[];
    properties: readonly string[] | "all-present";
    mappingVersion: string;
    bounds?: KnowledgeWikidataImportBoundsV2;
}>;
export type KnowledgeWikidataSelectorV2 = Readonly<{
    kind: "metadata";
    entityId: string;
    path: readonly (string | number)[];
}> | Readonly<{
    kind: "statement";
    entityId: string;
    propertyId: string;
    statementId: string;
    statementIndex: number;
    location: Readonly<{
        kind: "statement";
    }> | Readonly<{
        kind: "main";
    }> | Readonly<{
        kind: "qualifier";
        propertyId: string;
        snakIndex: number;
    }> | Readonly<{
        kind: "reference";
        referenceIndex: number;
        referenceHash: string | null;
        propertyId: string;
        snakIndex: number;
    }>;
}>;
export type KnowledgeWikidataPreservedValueV2 = Readonly<{
    kind: "absence";
    state: "somevalue" | "novalue";
    captureSha256: Sha256Hex;
    occurrence: KnowledgeWikidataSelectorV2;
}> | Readonly<{
    kind: "typed-source-value";
    datatype: string;
    datavalue: JsonValue;
}> | Readonly<{
    kind: "unsupported";
    reason: "unknown-datatype" | "invalid-datavalue";
    datatype: string | null;
    raw: JsonValue;
}>;
export type KnowledgeWikidataRecordV2 = Readonly<{
    captureSha256: Sha256Hex;
    selector: KnowledgeWikidataSelectorV2;
    raw: JsonValue;
}> & (Readonly<{
    kind: "metadata";
}> | Readonly<{
    kind: "statement";
    rank: "normal" | "preferred" | "deprecated";
}> | Readonly<{
    kind: "snak";
    value: KnowledgeWikidataPreservedValueV2;
}>);
export type KnowledgeWikidataMappingCandidateV2 = Readonly<{
    captureSha256: Sha256Hex;
    selector: KnowledgeWikidataSelectorV2;
    propertyId: string;
    status: "requires-property-mapping" | "unsupported-value";
    value: KnowledgeWikidataPreservedValueV2;
    normalization: "none";
    eligibleForAdmission: false;
    diagnostics: readonly ("property-mapping-required" | "unsupported-source-value" | "time-normalization-unsupported" | "coordinate-normalization-unsupported" | "quantity-unit-mapping-required")[];
}>;
export type KnowledgeWikidataOmissionV2 = Readonly<{
    captureIndex: number;
    entityId: string;
    propertyId: string | null;
    reason: "entity-bound" | "source-byte-bound" | "statement-bound" | "record-bound" | "property-not-selected" | "invalid-statement-group" | "invalid-metadata";
    count: number;
}>;
export type KnowledgeWikidataCoverageV2 = Readonly<{
    captureSha256: Sha256Hex;
    entityId: string;
    propertyId: string;
    observedStatements: number;
    retainedStatements: number;
    status: "complete-in-asserted-source" | "incomplete";
    sourceCoverage: "caller-asserted";
    definitiveAnswer: false;
}>;
export type KnowledgeWikidataSourceReceiptV2 = KnowledgeWikidataCaptureInputV2 & Readonly<{
    captureSha256: Sha256Hex;
    sourceBytes: number;
    revision: number;
    serialization: "wikibase-json-v1";
    provenanceStatus: "caller-asserted";
    license: Readonly<{
        id: "CC0-1.0";
        scope: "wikidata-structured-data-only";
        uri: "https://creativecommons.org/publicdomain/zero/1.0/";
    }>;
}>;
/** A foreign predicate remains addressable without being mapped to any local vocabulary. */
export type KnowledgeWikidataSourceAssertionV2 = Readonly<{
    subject: Readonly<{
        entityId: string;
        uri: string;
    }>;
    predicate: Readonly<{
        propertyId: string;
        uri: string;
    }>;
    captureSha256: Sha256Hex;
    selector: Extract<KnowledgeWikidataSelectorV2, {
        kind: "statement";
    }>;
    rank: "normal" | "preferred" | "deprecated";
    rawStatement: JsonValue;
    interpretation: "source-asserted";
    eligibleForAdmission: false;
}>;
export type KnowledgeWikidataImportPreviewV2 = Readonly<{
    v: 2;
    kind: "wikidata-import-preview";
    provider: "wikidata";
    importerVersion: typeof KNOWLEDGE_WIKIDATA_IMPORTER_V2;
    mappingVersion: string;
    status: "unadmitted";
    disclosure: "private";
    identityResolution: "candidate-only";
    properties: readonly string[] | "all-present";
    bounds: KnowledgeWikidataImportBoundsV2;
    sources: readonly KnowledgeWikidataSourceReceiptV2[];
    identityCandidates: readonly Readonly<{
        requestedId: string;
        resolvedId: string;
        revision: number;
        captureSha256: Sha256Hex;
        redirects: KnowledgeWikidataCaptureInputV2["redirects"];
        localIdentity: null;
    }>[];
    records: readonly KnowledgeWikidataRecordV2[];
    mappingCandidates: readonly KnowledgeWikidataMappingCandidateV2[];
    sourceAssertions: readonly KnowledgeWikidataSourceAssertionV2[];
    coverage: readonly KnowledgeWikidataCoverageV2[];
    omissions: readonly KnowledgeWikidataOmissionV2[];
    cursor: Readonly<{
        kind: "retry-with-selection";
        captureIndices: readonly number[];
    }> | null;
    previewSha256: Sha256Hex;
}>;
export declare function isKnowledgeWikidataEntityIdV2(value: unknown): value is string;
export declare function parseKnowledgeWikidataImportInputV2(value: unknown): KnowledgeWikidataImportInputV2 | null;
export declare function createKnowledgeWikidataImportPreviewV2(foreign: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataImportPreviewV2>>;
/** Canonical transport preserves raw captures as strings; it grants no admission or disclosure rights. */
export declare function canonicalKnowledgeWikidataImportPreviewV2(value: KnowledgeWikidataImportPreviewV2): string;
/** Rebuild from the original import request, including source bodies omitted by selected bounds. */
export declare function verifyKnowledgeWikidataImportPreviewV2(foreign: unknown, input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataImportPreviewV2>>;
//# sourceMappingURL=knowledge-wikidata-import-v2.d.ts.map