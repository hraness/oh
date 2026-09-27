import { type KnowledgeGraphRecordV1 } from "./graph";
import { type OhRecallDateWindowV1 } from "./recall";
/**
 * Opt-in memory configurations built on recall. The author log shows every
 * message one author wrote, in order, beside fused retrieval of everything
 * else; the session zoom shows whole sessions for a second reading after a
 * reader declines. Both are pure, deterministic, and make no model calls.
 */
export declare const OH_AUTHOR_LOG_RENDERER_V1: "oh.recall-render.author-log.v1";
export declare const OH_SESSION_ZOOM_RENDERER_V1: "oh.recall-render.session-zoom.v1";
export declare const OH_AUTHOR_LOG_LIMITS_V1: Readonly<{
    defaultAuthor: "user";
    defaultBudgetBytes: 180000;
    defaultRetrievedBytes: 96000;
    defaultLogReserveBytes: 24000;
    defaultZoomBudgetBytes: 100000;
    defaultZoomMessageChars: 12000;
    maximumAuthorBytes: 64;
    maximumRecords: 65536;
    zoomDateSessions: 4;
    zoomLexicalSessions: 3;
    zoomPadDays: 3;
    v: 1;
}>;
/** A neutral description of the author-log layout for a reader instruction. It contains no examples. */
export declare const OH_AUTHOR_LOG_READER_NOTE_V1: string;
/** A neutral description of the session-zoom layout for a second reading. It contains no examples. */
export declare const OH_SESSION_ZOOM_READER_NOTE_V1: string;
export type OhAuthorLogRecordViewV1 = Readonly<{
    instant: string | null;
    order: number | null;
    session: string;
    speaker: string | null;
    text: string;
}>;
export type OhAuthorLogViewV1 = (record: KnowledgeGraphRecordV1) => OhAuthorLogRecordViewV1;
export type OhAuthorLogRenderingV1 = Readonly<{
    bytes: number;
    keys: readonly string[];
    log: Readonly<{
        bytes: number;
        included: number;
        mode: "complete" | "ranked";
        total: number;
    }>;
    renderer: typeof OH_AUTHOR_LOG_RENDERER_V1;
    retrieved: Readonly<{
        bytes: number;
        included: number;
        omitted: number;
    }>;
    sharedTimestamp: boolean;
    text: string;
    v: 1;
}>;
export type OhSessionZoomRenderingV1 = Readonly<{
    bytes: number;
    keys: readonly string[];
    renderer: typeof OH_SESSION_ZOOM_RENDERER_V1;
    sessions: readonly string[];
    text: string;
    window: OhRecallDateWindowV1 | null;
    v: 1;
}>;
type RankedInput = readonly Readonly<{
    record: KnowledgeGraphRecordV1;
}>[];
/**
 * Reads `observedAt` (or a canonical instant or `YYYY-MM-DD` in `date`) as the
 * instant, `sessionId` as the session, `sessionIndex` or `turnIndex` as the
 * order within it, `speaker` or `role` as the speaker, and `text` as the text.
 * Observed turn records and recall records both fit. Any other value renders
 * as canonical JSON under its own key with no speaker.
 */
export declare function defaultOhAuthorLogViewV1(record: KnowledgeGraphRecordV1): OhAuthorLogRecordViewV1;
/**
 * Renders the complete log of one author's messages beside fused retrieval
 * of every other record, under a total byte budget.
 *
 * The log holds every record whose view speaker equals `author`, verbatim,
 * chronological, grouped by session, each message followed by rule-resolved
 * dates for its relative time expressions. When the complete log exceeds
 * `budgetBytes - logReserveBytes`, the log admits the author's messages in
 * `ranked` order and then newest first until that budget is full, still
 * rendered chronologically, and its heading says it is partial. The retrieved
 * part then admits the other speakers' records in `ranked` order under
 * `retrievedBytes` and the remaining total budget. Record text is never altered.
 */
export declare function renderOhAuthorLogV1(input: Readonly<{
    ranked: RankedInput;
    records: readonly KnowledgeGraphRecordV1[];
}>, options: Readonly<{
    asOf: string | null;
    author?: string;
    budgetBytes?: number;
    logReserveBytes?: number;
    retrievedBytes?: number;
    view?: OhAuthorLogViewV1;
}>): OhAuthorLogRenderingV1;
/** True when an English answer says the memory lacks the information: the trigger for a second, wider reading. */
export declare function isOhDeclineAnswerV1(answer: string): boolean;
/**
 * Whole sessions for a second reading: up to four sessions dated within three
 * days of the single relative date window the question names, then the three
 * sessions whose messages contain the most question content words (scaled by
 * 1 / sqrt(messages + 1)), then sessions in `ranked` order, admitted while
 * they fit the budget and rendered chronologically. A message longer than
 * `messageChars` is cut and marked. The date window is skipped when every
 * session shares one day.
 */
export declare function renderOhSessionZoomV1(input: Readonly<{
    question: string;
    ranked: RankedInput;
    records: readonly KnowledgeGraphRecordV1[];
}>, options: Readonly<{
    asOf: string | null;
    budgetBytes?: number;
    messageChars?: number;
    view?: OhAuthorLogViewV1;
}>): OhSessionZoomRenderingV1;
export {};
//# sourceMappingURL=author-log.d.ts.map