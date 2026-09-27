import { type Sha256Hex } from "./canonical";
import { type KnowledgeGraphRecordV1 } from "./graph";
import { type OhRecallDateWindowV1 } from "./recall";
export declare const OH_EVIDENCE_VIEW_LIMITS_V1: Readonly<{
    records: 2048;
    mentions: 128;
    links: 256;
    sourceBytes: number;
    quoteBytes: 4096;
    idBytes: 512;
    indexBytes: number;
    dateTextBytes: 4096;
    dateScanBytes: number;
}>;
export type OhEvidenceCitationV1 = Readonly<{
    key: string;
    recordSha256: Sha256Hex;
    quote: string;
}>;
export type OhEvidenceMentionV1 = Readonly<{
    id: string;
    kind: "event" | "state" | "plan" | "suggestion" | "unclear";
    source: OhEvidenceCitationV1;
    timeExpression: string | null;
}>;
export type OhEvidenceLinkV1 = Readonly<{
    id: string;
    kind: "supersedes" | "cancels" | "reactivates" | "same-event" | "distinct-event" | "before";
    from: string;
    to: string;
    source: OhEvidenceCitationV1;
}>;
export type OhEvidenceSourceProjectionV1 = Readonly<{
    text: string;
    statedAt: string | null;
    speaker: string | null;
}>;
export type OhEvidenceSupportV1 = "supported" | "missing-source" | "stale-source" | "quote-mismatch" | "missing-mention";
export type OhEvidenceIntervalV1 = Readonly<{
    since: string;
    until: string;
    basis: "literal-date" | "recall-grammar";
}>;
export type OhEvidenceResolvedMentionV1 = OhEvidenceMentionV1 & Readonly<{
    support: OhEvidenceSupportV1;
    statedAt: string | null;
    interval: OhEvidenceIntervalV1 | null;
    timeStatus: "resolved" | "unknown" | "ambiguous" | "unsupported";
}>;
export type OhEvidenceSourceV1 = OhEvidenceSourceProjectionV1 & Readonly<{
    record: KnowledgeGraphRecordV1;
    dateExpressions: readonly OhRecallDateWindowV1[];
    dateStatus: "expressions" | "no-expression" | "missing-statement-time" | "scan-limit";
}>;
export type OhEvidenceViewV1 = Readonly<{
    format: "oh.evidence-view.v1";
    coverage: "partial";
    relationMeaning: "caller-asserted";
    sources: readonly OhEvidenceSourceV1[];
    mentions: readonly OhEvidenceResolvedMentionV1[];
    links: readonly (OhEvidenceLinkV1 & Readonly<{
        support: OhEvidenceSupportV1;
    }>)[];
}>;
/** This projection reads statement metadata only; it never treats it as the event date. */
export declare function defaultOhEvidenceSourceV1(record: KnowledgeGraphRecordV1): OhEvidenceSourceProjectionV1;
/**
 * Pure opt-in projection over current records, including native ranked {record} results.
 * Quotes and digests are checked; relationship meaning remains the caller's assertion.
 * Unusable pointers stay in the result with their support status. No observation is inferred.
 */
export declare function buildOhEvidenceViewV1(input: Readonly<{
    records: readonly (KnowledgeGraphRecordV1 | Readonly<{
        record: KnowledgeGraphRecordV1;
    }>)[];
    mentions?: readonly OhEvidenceMentionV1[];
    links?: readonly OhEvidenceLinkV1[];
    sourceView?: (record: KnowledgeGraphRecordV1) => OhEvidenceSourceProjectionV1;
}>): OhEvidenceViewV1;
export type OhEvidenceOrderV1 = Readonly<{
    relation: "before" | "after" | "unknown" | "conflict" | "unsupported";
    mentions: readonly OhEvidenceResolvedMentionV1[];
    links: readonly OhEvidenceViewV1["links"][number][];
}>;
/** Only disjoint event intervals or explicit before links establish an order. */
export declare function compareOhEvidenceEventsV1(view: OhEvidenceViewV1, leftId: string, rightId: string): OhEvidenceOrderV1;
export type OhEvidenceStateV1 = Readonly<{
    status: "supported" | "unresolved" | "unsupported";
    current: readonly Readonly<{
        mention: OhEvidenceResolvedMentionV1;
        state: "active" | "cancelled";
    }>[];
    history: readonly OhEvidenceResolvedMentionV1[];
    links: readonly OhEvidenceViewV1["links"][number][];
    reasons: readonly string[];
}>;
/** `asOf` asks what was stated by that instant. It does not infer when a state took effect. */
export declare function currentOhEvidenceStateV1(view: OhEvidenceViewV1, mentionId: string, asOf?: string | null): OhEvidenceStateV1;
/** Groups only caller-linked mentions. Group count is not an event count or completeness claim. */
export declare function groupOhEvidenceEventsV1(view: OhEvidenceViewV1): Readonly<{
    groups: readonly (readonly string[])[];
    conflicts: readonly string[];
    unlinked: readonly string[];
}>;
export type OhEvidenceIndexRenderingV1 = Readonly<{
    text: string;
    bytes: number;
    omitted: Readonly<{
        sources: number;
        mentions: number;
        links: number;
    }>;
}>;
/** Bounded supplementary index. The caller keeps the raw context; this index never replaces it. */
export declare function renderOhEvidenceViewIndexV1(view: OhEvidenceViewV1, maximumBytes?: number): OhEvidenceIndexRenderingV1;
//# sourceMappingURL=evidence-view.d.ts.map