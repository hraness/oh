import { type JsonValue } from "./document-domain";
import { type Sha256Hex } from "./integrity-domain";
/** An offline, unadmitted evidence preview. Provider metadata is caller asserted. */
export declare const KNOWLEDGE_WIKIDATA_IMPORTER_V1 = "sponge.wikidata-json-import.v1";
export declare const KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1: Readonly<{
    readonly maxEntities: 100;
    readonly maxStatements: 1000;
    readonly maxRecords: 4096;
    readonly maxSourceBytes: number;
}>;
export type KnowledgeWikidataImportBoundsV1 = Readonly<{
    maxEntities: number;
    maxStatements: number;
    maxRecords: number;
    maxSourceBytes: number;
}>;
export type KnowledgeWikidataImportResultV1<T> = Readonly<{
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
export type KnowledgeWikidataSourceCoverageV1 = Readonly<{
    kind: "complete-entity";
}> | Readonly<{
    kind: "selected-properties";
    properties: readonly string[];
}> | Readonly<{
    kind: "partial";
    reason: string;
}>;
export type KnowledgeWikidataCaptureInputV1 = Readonly<{
    requestedId: string;
    resolvedId: string;
    sourceUri: string;
    capturedAt: string;
    body: string;
    redirects: readonly Readonly<{
        from: string;
        to: string;
    }>[];
    coverage: KnowledgeWikidataSourceCoverageV1;
}>;
export type KnowledgeWikidataImportInputV1 = Readonly<{
    v: 1;
    captures: readonly KnowledgeWikidataCaptureInputV1[];
    properties: readonly string[];
    mappingVersion: string;
    bounds?: KnowledgeWikidataImportBoundsV1;
}>;
export type KnowledgeWikidataSelectorV1 = Readonly<{
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
export type KnowledgeWikidataPreservedValueV1 = Readonly<{
    kind: "absence";
    state: "somevalue" | "novalue";
    captureSha256: Sha256Hex;
    occurrence: KnowledgeWikidataSelectorV1;
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
export type KnowledgeWikidataRecordV1 = Readonly<{
    captureSha256: Sha256Hex;
    selector: KnowledgeWikidataSelectorV1;
    raw: JsonValue;
}> & (Readonly<{
    kind: "metadata";
}> | Readonly<{
    kind: "statement";
    rank: "normal" | "preferred" | "deprecated";
}> | Readonly<{
    kind: "snak";
    value: KnowledgeWikidataPreservedValueV1;
}>);
export type KnowledgeWikidataMappingCandidateV1 = Readonly<{
    captureSha256: Sha256Hex;
    selector: KnowledgeWikidataSelectorV1;
    propertyId: string;
    status: "requires-property-mapping" | "unsupported-value";
    value: KnowledgeWikidataPreservedValueV1;
    normalization: "none";
    eligibleForAdmission: false;
    diagnostics: readonly ("property-mapping-required" | "unsupported-source-value" | "time-normalization-unsupported" | "coordinate-normalization-unsupported" | "quantity-unit-mapping-required")[];
}>;
export type KnowledgeWikidataOmissionV1 = Readonly<{
    captureIndex: number;
    entityId: string;
    propertyId: string | null;
    reason: "entity-bound" | "source-byte-bound" | "statement-bound" | "record-bound" | "property-not-selected" | "invalid-statement-group" | "invalid-metadata";
    count: number;
}>;
export type KnowledgeWikidataCoverageV1 = Readonly<{
    captureSha256: Sha256Hex;
    entityId: string;
    propertyId: string;
    observedStatements: number;
    retainedStatements: number;
    status: "complete-in-asserted-source" | "incomplete";
    sourceCoverage: "caller-asserted";
    definitiveAnswer: false;
}>;
export type KnowledgeWikidataSourceReceiptV1 = KnowledgeWikidataCaptureInputV1 & Readonly<{
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
export type KnowledgeWikidataImportPreviewV1 = Readonly<{
    v: 1;
    kind: "wikidata-import-preview";
    provider: "wikidata";
    importerVersion: typeof KNOWLEDGE_WIKIDATA_IMPORTER_V1;
    mappingVersion: string;
    status: "unadmitted";
    disclosure: "private";
    identityResolution: "candidate-only";
    properties: readonly string[];
    bounds: KnowledgeWikidataImportBoundsV1;
    sources: readonly KnowledgeWikidataSourceReceiptV1[];
    identityCandidates: readonly Readonly<{
        requestedId: string;
        resolvedId: string;
        revision: number;
        captureSha256: Sha256Hex;
        redirects: KnowledgeWikidataCaptureInputV1["redirects"];
        localIdentity: null;
    }>[];
    records: readonly KnowledgeWikidataRecordV1[];
    mappingCandidates: readonly KnowledgeWikidataMappingCandidateV1[];
    coverage: readonly KnowledgeWikidataCoverageV1[];
    omissions: readonly KnowledgeWikidataOmissionV1[];
    cursor: Readonly<{
        kind: "retry-with-selection";
        captureIndices: readonly number[];
    }> | null;
    previewSha256: Sha256Hex;
}>;
export declare function isKnowledgeWikidataEntityIdV1(value: unknown): value is string;
export declare function parseKnowledgeWikidataImportInputV1(value: unknown): KnowledgeWikidataImportInputV1 | null;
export declare function createKnowledgeWikidataImportPreviewV1(foreign: unknown): Promise<KnowledgeWikidataImportResultV1<KnowledgeWikidataImportPreviewV1>>;
/** Canonical transport preserves raw captures as strings; it grants no admission or disclosure rights. */
export declare function canonicalKnowledgeWikidataImportPreviewV1(value: KnowledgeWikidataImportPreviewV1): string;
/** Rebuild from the original import request, including source bodies omitted by selected bounds. */
export declare function verifyKnowledgeWikidataImportPreviewV1(foreign: unknown, input: unknown): Promise<KnowledgeWikidataImportResultV1<KnowledgeWikidataImportPreviewV1>>;
//# sourceMappingURL=knowledge-wikidata-import-v1.d.ts.map