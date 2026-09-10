import type { KnowledgeGraphRecordV1 } from "./graph";
import { type OhSearchModeV1 } from "./search";
import type { OhSemanticSearchBackend } from "./semantic";
import type { OhSqliteStore } from "./sqlite/store";
/** Recall composes bounded V1 searches; it never widens the 1..100 search limit. */
export declare const OH_RECALL_LIMITS_V1: Readonly<{
    maximumQueries: 6;
    maximumQueryBytes: 16384;
    maximumLimit: 100;
    maximumRenderedResults: 8192;
    maximumBudgetBytes: 4000000;
    maximumScannedRecords: 65536;
    rrfConstant: 60;
    v: 1;
}>;
export declare const OH_RECALL_RENDERER_V1: "oh.recall-render.v1";
export type OhRecallWindowV1 = Readonly<{
    since: string;
    until: string;
    v: 1;
}>;
export type OhRecallDiagnosticV1 = Readonly<{
    code: "semantic-unavailable" | "window-unavailable";
    message: string;
    v: 1;
}>;
export type OhRecallRecordViewV1 = Readonly<{
    instant: string | null;
    order: number | null;
    session: string;
    text: string;
}>;
export type OhRecallViewV1 = (record: KnowledgeGraphRecordV1) => OhRecallRecordViewV1;
export type OhRecallEvidenceV1 = Readonly<{
    lane: "query" | "window";
    query: number | null;
    rank: number;
    score: number;
    v: 1;
}>;
export type OhRecallResultV1 = Readonly<{
    evidence: readonly OhRecallEvidenceV1[];
    record: KnowledgeGraphRecordV1;
    score: number;
    v: 1;
}>;
export type OhRecallResponseV1 = Readonly<{
    asOf: string | null;
    diagnostics: readonly OhRecallDiagnosticV1[];
    mode: OhSearchModeV1;
    queries: readonly string[];
    results: readonly OhRecallResultV1[];
    window: OhRecallWindowV1 | null;
    v: 1;
}>;
export type OhRecallRenderingV1 = Readonly<{
    bytes: number;
    keys: readonly string[];
    omitted: number;
    renderer: typeof OH_RECALL_RENDERER_V1;
    text: string;
    v: 1;
}>;
export type OhRecallDateWindowV1 = Readonly<{
    expression: string;
    rule: string;
    since: string;
    until: string;
    v: 1;
}>;
/**
 * The relative-date grammar is a frozen rule table. Every rule maps one
 * matched expression to a UTC calendar-day window anchored on the question
 * instant. Unknown or ambiguous expressions resolve to nothing; recall never
 * guesses a window. `day` windows name one day at an offset; `around` windows
 * surround the day one unit count away with a symmetric tolerance; `week`,
 * `month`, and `year` windows are whole calendar periods (weeks start on
 * Monday); `weekday` windows name one weekday relative to the question day;
 * `weekend` windows name the Saturday and Sunday of a calendar week; `past`
 * windows run from one unit count before the question day up to that day.
 * When one expression contains another ("in the last month" contains "last
 * month"), only the containing expression counts. An expression whose prefix
 * ends in an anchor word ("the day before yesterday", "since last week") is a
 * bound, not a window, and is excluded; the article numbers `a` and `an`
 * pair only with a singular unit.
 */
export declare const OH_RECALL_DATE_GRAMMAR_V1: Readonly<{
    id: "oh.recall-date-grammar.v1";
    timeZone: "UTC";
    weekStart: "monday";
    numbers: Readonly<{
        a: 1;
        an: 1;
        one: 1;
        two: 2;
        three: 3;
        four: 4;
        five: 5;
        six: 6;
        seven: 7;
        eight: 8;
        nine: 9;
        ten: 10;
        eleven: 11;
        twelve: 12;
    }>;
    articles: readonly ["a", "an"];
    weekdays: readonly ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    exclusions: readonly [{
        readonly id: "anchored";
        readonly scope: "prefix";
        readonly pattern: "\\b(?:before|after|since|until|prior to|following)\\s+$";
    }];
    rules: readonly [{
        readonly id: "today";
        readonly pattern: "\\btoday\\b";
        readonly kind: "day";
        readonly offset: 0;
    }, {
        readonly id: "yesterday";
        readonly pattern: "\\byesterday\\b";
        readonly kind: "day";
        readonly offset: -1;
    }, {
        readonly id: "tomorrow";
        readonly pattern: "\\btomorrow\\b";
        readonly kind: "day";
        readonly offset: 1;
    }, {
        readonly id: "days-ago";
        readonly pattern: "\\b(NUMBER) days? ago\\b";
        readonly kind: "around";
        readonly unit: "day";
        readonly sign: -1;
        readonly toleranceDays: 0;
    }, {
        readonly id: "weeks-ago";
        readonly pattern: "\\b(NUMBER) weeks? ago\\b";
        readonly kind: "around";
        readonly unit: "week";
        readonly sign: -1;
        readonly toleranceDays: 3;
    }, {
        readonly id: "months-ago";
        readonly pattern: "\\b(NUMBER) months? ago\\b";
        readonly kind: "around";
        readonly unit: "month";
        readonly sign: -1;
        readonly toleranceDays: 15;
    }, {
        readonly id: "years-ago";
        readonly pattern: "\\b(NUMBER) years? ago\\b";
        readonly kind: "around";
        readonly unit: "year";
        readonly sign: -1;
        readonly toleranceDays: 45;
    }, {
        readonly id: "in-days";
        readonly pattern: "\\bin (NUMBER) days?\\b";
        readonly kind: "around";
        readonly unit: "day";
        readonly sign: 1;
        readonly toleranceDays: 0;
    }, {
        readonly id: "in-weeks";
        readonly pattern: "\\bin (NUMBER) weeks?\\b";
        readonly kind: "around";
        readonly unit: "week";
        readonly sign: 1;
        readonly toleranceDays: 3;
    }, {
        readonly id: "in-months";
        readonly pattern: "\\bin (NUMBER) months?\\b";
        readonly kind: "around";
        readonly unit: "month";
        readonly sign: 1;
        readonly toleranceDays: 15;
    }, {
        readonly id: "in-years";
        readonly pattern: "\\bin (NUMBER) years?\\b";
        readonly kind: "around";
        readonly unit: "year";
        readonly sign: 1;
        readonly toleranceDays: 45;
    }, {
        readonly id: "last-week";
        readonly pattern: "\\blast week\\b";
        readonly kind: "week";
        readonly offset: -1;
    }, {
        readonly id: "this-week";
        readonly pattern: "\\bthis week\\b";
        readonly kind: "week";
        readonly offset: 0;
    }, {
        readonly id: "next-week";
        readonly pattern: "\\bnext week\\b";
        readonly kind: "week";
        readonly offset: 1;
    }, {
        readonly id: "last-month";
        readonly pattern: "\\blast month\\b";
        readonly kind: "month";
        readonly offset: -1;
    }, {
        readonly id: "this-month";
        readonly pattern: "\\bthis month\\b";
        readonly kind: "month";
        readonly offset: 0;
    }, {
        readonly id: "next-month";
        readonly pattern: "\\bnext month\\b";
        readonly kind: "month";
        readonly offset: 1;
    }, {
        readonly id: "last-year";
        readonly pattern: "\\blast year\\b";
        readonly kind: "year";
        readonly offset: -1;
    }, {
        readonly id: "this-year";
        readonly pattern: "\\bthis year\\b";
        readonly kind: "year";
        readonly offset: 0;
    }, {
        readonly id: "next-year";
        readonly pattern: "\\bnext year\\b";
        readonly kind: "year";
        readonly offset: 1;
    }, {
        readonly id: "last-weekend";
        readonly pattern: "\\blast weekend\\b";
        readonly kind: "weekend";
        readonly offset: -1;
    }, {
        readonly id: "this-weekend";
        readonly pattern: "\\bthis weekend\\b";
        readonly kind: "weekend";
        readonly offset: 0;
    }, {
        readonly id: "next-weekend";
        readonly pattern: "\\bnext weekend\\b";
        readonly kind: "weekend";
        readonly offset: 1;
    }, {
        readonly id: "past-span";
        readonly pattern: "\\b(?:in|over|during|within) the (?:last|past) (?:(NUMBER) )?(UNIT)s?\\b";
        readonly kind: "past";
    }, {
        readonly id: "last-weekday";
        readonly pattern: "\\blast (WEEKDAY)\\b";
        readonly kind: "weekday";
        readonly offset: -1;
    }, {
        readonly id: "this-weekday";
        readonly pattern: "\\bthis (WEEKDAY)\\b";
        readonly kind: "weekday";
        readonly offset: 0;
    }, {
        readonly id: "next-weekday";
        readonly pattern: "\\bnext (WEEKDAY)\\b";
        readonly kind: "weekday";
        readonly offset: 1;
    }];
    v: 1;
}>;
export type OhRecallDateRuleV1 = typeof OH_RECALL_DATE_GRAMMAR_V1.rules[number];
/**
 * The default view reads a record value's `observedAt` as the canonical
 * instant, `sessionId` as the session, and `text` as the raw text. Any other
 * value renders as its canonical JSON under the record key.
 */
export declare function defaultOhRecallViewV1(record: KnowledgeGraphRecordV1): OhRecallRecordViewV1;
/**
 * Fused, bounded recall over `searchOhV1`. Each query runs as one ordinary V1
 * search whose results are already rejoined to the current record digest.
 * Lanes fuse by reciprocal rank, 1 / (60 + rank), over every query and, when
 * a window is given, over the window lane: the current records whose viewed
 * instant lies inside the window, in instant order. The response holds at
 * most (queries + 1) x limit results and never widens any lane past 100.
 */
export declare function recallOhV1(input: Readonly<{
    asOf: string | null;
    backend?: OhSemanticSearchBackend;
    limit?: number;
    mode?: OhSearchModeV1;
    queries: readonly string[];
    store: OhSqliteStore;
    view?: OhRecallViewV1;
    window?: OhRecallWindowV1 | null;
}>): Promise<OhRecallResponseV1>;
/**
 * Pure, rule-based resolution of one relative date expression against the
 * question instant. Returns `null` for no match and for more than one distinct
 * match; the grammar table above is the complete vocabulary.
 */
export declare function resolveRelativeDateWindowV1(query: string, asOf: string): OhRecallDateWindowV1 | null;
/**
 * Chronological rendering with question-relative session headers, gap
 * markers, and a UTF-8 byte budget. Results are admitted in their given
 * (fused rank) order; a result whose admission would exceed the budget is
 * omitted while later, smaller results may still fit. Record text is never
 * altered. Without a question instant the text is the plain rank-ordered list.
 */
export declare function renderOhRecallV1(input: Readonly<{
    results: readonly Readonly<{
        record: KnowledgeGraphRecordV1;
    }>[];
}>, options: Readonly<{
    asOf: string | null;
    budgetBytes: number;
    view?: OhRecallViewV1;
}>): OhRecallRenderingV1;
//# sourceMappingURL=recall.d.ts.map