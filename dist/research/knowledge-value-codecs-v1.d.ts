import { type Sha256Hex } from "./integrity-domain";
import { type KnowledgeOntologyResult, type KnowledgeValueV1 } from "./knowledge-ontology-v1";
export type KnowledgePreservedValuePayloadV1 = Readonly<{
    captureSha256: Sha256Hex;
    kind: "missing-value";
    occurrence: string;
    state: "somevalue" | "novalue";
    v: 1;
}> | Readonly<{
    kind: "language-text";
    language: string;
    text: string;
    v: 1;
}> | Readonly<{
    after: number;
    before: number;
    calendarmodel: string;
    kind: "wikibase-time";
    precision: number;
    serialization: "wikibase-json-v1";
    time: string;
    timezone: number;
    v: 1;
}> | Readonly<{
    altitude: string | null;
    globe: string;
    kind: "globe-coordinate";
    latitude: string;
    longitude: string;
    precision: string | null;
    serialization: "wikibase-json-v1";
    v: 1;
}>;
export type KnowledgePreservedExtensionV1 = Extract<KnowledgeValueV1, {
    kind: "extension";
}>;
/** BCP 47 syntactic profile; spelling is retained, and registry membership or preferred aliases are not inferred. */
export declare function isKnowledgeLanguageTagV1(value: unknown): value is string;
/** Source-preservation payloads deliberately do not normalize BCE numbering, calendars, angle units, or language aliases. */
export declare function parseKnowledgePreservedValuePayloadV1(value: unknown): KnowledgeOntologyResult<KnowledgePreservedValuePayloadV1>;
export declare function createKnowledgePreservedValueV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgePreservedExtensionV1>>;
export declare function parseKnowledgePreservedValueV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgePreservedValuePayloadV1>>;
//# sourceMappingURL=knowledge-value-codecs-v1.d.ts.map