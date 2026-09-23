import { type Sha256Hex } from "./canonical";
import type { OhRecordCodec } from "./contract";
import { type KnowledgeGraphRecordV1 } from "./graph";
import type { OhOperationV1 } from "./operation";
import type { OhCommitInputV1, OhHeadV1 } from "./store";
export declare const OH_OBSERVATION_FORMAT_V1: "oh.observation.v1";
export declare const OH_OBSERVATION_ACTIVITY_FORMAT_V1: "oh.observation-activity.v1";
export declare const OH_OBSERVATION_KEY_PREFIX_V1: "edition:obs-";
export declare const OH_OBSERVATION_ACTIVITY_KEY_PREFIX_V1: "activity:observe-";
export declare const OH_OBSERVATION_LIMITS_V1: Readonly<{
    facetChars: 48;
    observationsPerSession: 48;
    promptBytes: number;
    resolvedFromBytes: 256;
    responseBytes: number;
    sessionTurns: 512;
    sourcesPerObservation: 16;
    speakerBytes: 64;
    statedAtBytes: 256;
    supersessionCandidates: 100;
    supersessionChain: 8192;
    textBytes: 1024;
    turnTextBytes: number;
    valueBytes: number;
}>;
export declare const OH_OBSERVATION_KINDS_V1: readonly ["event", "fact", "plan", "preference", "update"];
export type OhObservationKindV1 = (typeof OH_OBSERVATION_KINDS_V1)[number];
/**
 * The frozen extraction instruction. It is corpus-general: it names no
 * dataset, question, answer, category, or label, and every rule is justified
 * by the profile it fills (absolute dates with the relative expression kept,
 * verbatim quantities and proper nouns, explicit speaker attribution, one
 * event per line, "changed from X to Y" for updates). Changing one byte is a
 * new instruction with a new digest; version it, never edit it in place.
 */
export declare const OH_OBSERVATION_INSTRUCTION_V1: string;
export declare const OH_OBSERVATION_INSTRUCTION_SHA256_V1: Sha256Hex;
export type OhObservationSourceV1 = Readonly<{
    key: string;
    recordSha256: Sha256Hex;
    v: 1;
}>;
export type OhObservationValueV1 = Readonly<{
    eventAt: string | null;
    facet: string | null;
    format: typeof OH_OBSERVATION_FORMAT_V1;
    kind: OhObservationKindV1;
    orderingConflict: boolean;
    resolvedFrom: string | null;
    sources: readonly OhObservationSourceV1[];
    speaker: string;
    statedAt: string;
    supersedes: string | null;
    text: string;
    v: 1;
}>;
export type OhObservationActivityValueV1 = Readonly<{
    /** Observation keys of this session whose supersession candidate set hit the lookup bound. */
    candidatesTruncated: readonly string[];
    format: typeof OH_OBSERVATION_ACTIVITY_FORMAT_V1;
    instructionSha256: Sha256Hex;
    modelId: string;
    observationCount: number;
    observedAt: string;
    promptSha256: Sha256Hex;
    responseSha256: Sha256Hex;
    sessionIndex: number | null;
    sessionSha256: Sha256Hex;
    sources: readonly OhObservationSourceV1[];
    v: 1;
}>;
export type OhObservationRecordV1 = Omit<KnowledgeGraphRecordV1, "kind" | "value"> & Readonly<{
    kind: "edition";
    value: OhObservationValueV1;
}>;
export type OhObservationSessionTurnV1 = Readonly<{
    alias: string;
    date: string;
    key: string;
    recordSha256: Sha256Hex;
    sessionId: string;
    sessionIndex: number | null;
    speaker: string;
    text: string;
    turnId: string;
}>;
export type OhObservationSessionV1 = Readonly<{
    date: string;
    sessionId: string;
    sessionIndex: number | null;
    sessionSha256: Sha256Hex;
    turns: readonly OhObservationSessionTurnV1[];
}>;
export type OhObservationMessageV1 = Readonly<{
    content: string;
    role: "system" | "user";
}>;
export type OhObservationPromptV1 = Readonly<{
    instructionSha256: Sha256Hex;
    messages: readonly [OhObservationMessageV1, OhObservationMessageV1];
    promptSha256: Sha256Hex;
    sessionSha256: Sha256Hex;
}>;
/** A caller-owned model boundary. The library never dispatches a provider call itself. */
export type OhObserverV1 = Readonly<{
    modelId: string;
    observe(prompt: OhObservationPromptV1): Promise<string> | string;
}>;
export type OhObserveStoreV1 = Readonly<{
    commit(input: OhCommitInputV1): OhOperationV1;
    get(key: string): KnowledgeGraphRecordV1 | null;
    head(): OhHeadV1;
    searchKeyword(query: string, limit?: number): readonly Readonly<{
        key: string;
        recordSha256: Sha256Hex;
    }>[];
}>;
export declare const OH_OBSERVATION_REJECTIONS_V1: readonly ["response-too-large", "response-not-json", "response-duplicate-key", "response-shape", "observation-shape", "observation-count", "text", "speaker", "speaker-attribution", "kind", "event-at", "resolved-from", "facet", "sources", "source-alias", "duplicate-text"];
export type OhObservationRejectionV1 = (typeof OH_OBSERVATION_REJECTIONS_V1)[number];
export type OhObservationDraftV1 = Readonly<{
    eventAt: string | null;
    facet: string | null;
    kind: OhObservationKindV1;
    resolvedFrom: string | null;
    sources: readonly OhObservationSourceV1[];
    speaker: string;
    text: string;
}>;
export type OhObservationParseResultV1 = Readonly<{
    observations: readonly OhObservationDraftV1[];
    ok: true;
}> | Readonly<{
    index: number | null;
    ok: false;
    rejection: OhObservationRejectionV1;
}>;
export type OhObserveResultV1 = Readonly<{
    activityKey: string;
    candidatesTruncated: readonly string[];
    instructionSha256: Sha256Hex;
    observationKeys: readonly string[];
    operation: OhOperationV1 | null;
    responseSha256: Sha256Hex | null;
    sessionSha256: Sha256Hex;
    status: "committed" | "existing";
}> | Readonly<{
    index: number | null;
    rejection: OhObservationRejectionV1;
    responseSha256: Sha256Hex;
    sessionSha256: Sha256Hex;
    status: "rejected";
}>;
/** A calendar date as `YYYY-MM-DD` that the proleptic Gregorian calendar reproduces exactly. */
export declare function parseOhObservationDateV1(value: unknown): string | null;
export declare function parseOhObservationFacetV1(value: unknown): string | null;
/** Parses only the exact, bounded `oh.observation.v1` profile value. */
export declare function parseOhObservationValueV1(value: unknown): OhObservationValueV1 | null;
export declare function parseOhObservationActivityValueV1(value: unknown): OhObservationActivityValueV1 | null;
export declare function parseOhObservationRecordV1(value: unknown): OhObservationRecordV1 | null;
/**
 * Register this only in a store whose `edition` kind is reserved for the
 * observation profile. A codec registry keeps one parser per kind, so in any
 * store that also holds turn records (or other `edition` values) registering
 * this codec makes `parseRequired("edition", turnValue)` return `null` and
 * those turns fail to parse. The library never registers it by default.
 */
export declare const OH_OBSERVATION_RECORD_CODEC_V1: OhRecordCodec;
/** Binds ordered current turn records to one dated session; the session digest covers content, not keys. */
export declare function parseOhObservationSessionV1(records: readonly KnowledgeGraphRecordV1[]): OhObservationSessionV1;
export declare function ohObservationKeyV1(sessionSha256: Sha256Hex, index: number): string;
/** Reads the response index back out of one of the session's observation keys, or `null` for any other value. */
export declare function ohObservationIndexV1(key: unknown, sessionSha256: Sha256Hex): number | null;
export declare function ohObservationActivityKeyV1(sessionSha256: Sha256Hex): string;
/** The exact model input: instruction plus the session's date, speakers, and text. No question, label, or gold. */
export declare function makeOhObservationPromptV1(session: OhObservationSessionV1): OhObservationPromptV1;
/**
 * Bounded response parser: exact keys, at most 48 observations, verbatim
 * bounds, source aliases resolved to current turn keys and digests, and the
 * speaker required to be a cited turn's speaker label.
 */
export declare function parseOhObservationResponseV1(raw: unknown, session: OhObservationSessionV1): OhObservationParseResultV1;
/** Extracts the first calendar date (and optional clock time) from a free-form session date. */
export declare function parseOhObservationStatedAtInstantV1(statedAt: string): number | null;
/**
 * Session order of an observation: its receipt's session index, then the
 * receipt instant, then the key. A `null` index is incomparable: two orders
 * compare by index only when both carry one, otherwise by instant.
 */
export type OhObservationOrderV1 = readonly [sessionIndex: number | null, instant: string, key: string];
export type OhSupersessionLinkV1 = Readonly<{
    candidatesTruncated: boolean;
    orderingConflict: boolean;
    supersedes: string | null;
}>;
/** What the resolver knows about the observation being linked; `order` is its own session position when known. */
export type OhSupersessionDraftV1 = Readonly<{
    facet: string | null;
    order?: OhObservationOrderV1;
    speaker: string;
    statedAt: string;
}>;
/**
 * Finds the latest current observation with the same facet and speaker. The
 * keyword lane is queried with the phrase `facet-<facet>-format`, which only an
 * observation value renders adjacently, then filtered by the parsed profile.
 * Candidates in `exclude`, and candidates whose own supersession chain leads
 * to an excluded key, are skipped so that re-linking a record can never close
 * a cycle. The head is the latest candidate in session order (the receipt's
 * session index, then its instant, then the key). The link carries
 * `orderingConflict` when the head sits strictly later in session order than
 * the draft's own `order`, or when both statement stamps parse and the head's
 * is later; rendering then keeps both dates. Nothing here picks a value.
 * `candidatesTruncated` reports that the keyword lookup hit its bound, in
 * which case the true head may lie outside the examined set.
 */
export declare function resolveOhSupersessionV1(store: OhObserveStoreV1, draft: OhSupersessionDraftV1, exclude?: ReadonlySet<string>): OhSupersessionLinkV1;
/**
 * The minimum a supersession read needs: a synchronous `get`, because a read
 * never commits. `OhSqliteStore` and the SDK store satisfy it today. The async
 * `OhStoreV1` port does not, and neither does a snapshot or a change feed, so
 * this widens nothing yet; it states the actual requirement rather than a store.
 */
export type OhObservationReadStoreV1 = Readonly<{
    get(key: string): KnowledgeGraphRecordV1 | null;
}>;
/**
 * How far one observation's `supersedes` chain reaches, counted by following the
 * link from `key` toward the oldest record.
 *
 * It counts recorded links, not restatements. A link is produced by
 * `resolveOhSupersessionV1`, which matches on facet and speaker over a bounded
 * candidate lookup, so a fact whose extracted facet changed between sessions
 * starts a fresh chain and reads a lower depth than it was restated. `depth` is
 * therefore a statement about the link graph the store holds.
 *
 * It is the churn a per-record revision count cannot see. A revision count
 * reports rewrites of one key, and this profile records a correction as a new
 * key. The two are not independent: `applySupersessionPolicyV1` re-puts a record
 * when its link changes, so a key linked by that path reads one revision, while
 * a key linked during `observeOhV1({ supersession: true })` is written once and
 * reads none. Neither number subsumes the other.
 *
 * `depth` is the number of links followed, so a first statement reads 0.
 * `resolved` is true only when the walk ended at a record that supersedes
 * nothing, and only then does `origin` name the oldest record and `depth` equal
 * the distance to it. It says nothing about whether the link graph is complete:
 * a chain the linker never joined still resolves.
 *
 * `candidateLookup` reports what the walked records' receipts recorded about
 * the bounded lookup their link was chosen from, and it is three-valued because
 * the honest answer has three cases.
 *
 * `"named"` means a receipt named one of the walked records, so its lookup
 * saturated, the chain may be short by an unknown amount even though the walk
 * completed, and `depth` is not a floor on the links that exist.
 *
 * `"unreadable"` means some receipt could not be read as one, so nothing is
 * known. A boolean would have to report that state as one of the other two, and
 * reporting it as the absence of saturation would be asserting a fact this read
 * never established.
 *
 * `"none-recorded"` means every walked record's receipt was readable and named
 * none of them. It is deliberately not called complete. A receipt records the
 * lookup performed when the observation was extracted; `applySupersessionPolicyV1`
 * re-links an already committed record against its original receipt and never
 * writes one, so a link that policy chose from a saturated lookup is recorded
 * nowhere this read can see. `"none-recorded"` therefore rules out recorded
 * saturation and nothing more. A facet that drifted between sessions leaves no
 * signal this read can report either.
 *
 * When `resolved` is false the walk stopped on a cycle, on the record bound, or
 * on a record that is absent or is not a well-formed observation. `depth` then
 * counts one link past the last record it could read, so it exceeds the distance
 * to `origin` by one, and `origin` is merely the oldest readable key. `missing`
 * names the key that could not be read, and `missing === key` is the case where
 * nothing was read at all. `loop` reports a cycle found inside the bound; a
 * cycle that closes beyond it reports `truncated` instead. A damaged chain is
 * reported, never repaired and never silently completed.
 *
 * At most 8192 observation records are read, so the longest chain that can
 * resolve carries 8191 links. Each one also costs a receipt read, memoised per
 * session, so a chain whose links all come from different sessions performs up
 * to 16384 reads in total.
 *
 * The count carries no meaning. A long chain may be contested, progressively
 * refined, or simply a subject discussed often; whether that warrants review is
 * the application's decision.
 */
/**
 * What the walked records' receipts recorded about their candidate lookup.
 * `"named"` beats `"unreadable"`, which beats `"none-recorded"`: a lookup known
 * to have saturated is reported even when another receipt could not be read.
 */
export type OhObservationCandidateLookupV1 = "named" | "none-recorded" | "unreadable";
export type OhObservationSupersessionV1 = Readonly<{
    candidateLookup: OhObservationCandidateLookupV1;
    depth: number;
    key: string;
    loop: boolean;
    missing: string | null;
    origin: string;
    resolved: boolean;
    truncated: boolean;
    v: 1;
}>;
export declare function ohObservationSupersessionV1(store: OhObservationReadStoreV1, key: string): OhObservationSupersessionV1;
export type OhObserveInputV1 = Readonly<{
    actorId: string;
    instant: string;
    observer: OhObserverV1;
    operationId?: string;
    sessionRecordKeys: readonly string[];
    store: OhObserveStoreV1;
    supersession?: boolean;
}>;
/**
 * Distills one session, question-blind, into `oh.observation.v1` edition
 * records plus one `activity:observe-<sessionSha256>` receipt, in one
 * operation. Idempotent by session content: an existing receipt returns
 * without calling the observer. A rejected response commits nothing.
 */
export declare function observeOhV1(input: OhObserveInputV1): Promise<OhObserveResultV1>;
export type OhSupersessionPolicyInputV1 = Readonly<{
    actorId: string;
    instant: string;
    observationKeys: readonly string[];
    operationId?: string;
    store: OhObserveStoreV1;
}>;
export type OhSupersessionPolicyResultV1 = Readonly<{
    links: readonly Readonly<{
        key: string;
    } & OhSupersessionLinkV1>[];
    operation: OhOperationV1 | null;
}>;
/**
 * Links already committed observations to the current chain head with the
 * same facet and speaker, re-putting only records whose link changed. The
 * batch is processed in session order (the receipt's index, then instant,
 * then key), whatever order the caller lists the keys in, so batch order can
 * never decide chain direction; `links` come back in that session order.
 * Same-facet, same-speaker records of one batch chain to one another in
 * session order ahead of the store's head, with the ordinary conflict rule.
 * Re-running it is safe: a record's own successors are never candidates for
 * it, so an existing chain is left as it is. Declared product rule: a conflict
 * between session order and statement timestamps is recorded, never resolved
 * by picking a value.
 */
export declare function applySupersessionPolicyV1(input: OhSupersessionPolicyInputV1): OhSupersessionPolicyResultV1;
/** A bounded lexical recommendation detector; not a category router. */
export declare function isOhRecommendationQueryV1(query: string): boolean;
export type OhObservationRenderInputV1 = Readonly<{
    observations: readonly OhObservationRecordV1[];
    query: string;
    turns: readonly string[];
}>;
/**
 * Renders derived observations ahead of raw turns for a retrieval context.
 * This is the derived-item renderer the `oh.evolution-retrieval.v2` validator
 * re-runs from pinned observation records; it uses no model and no question
 * beyond the bounded recommendation pattern. Turns arrive already rendered.
 */
export declare function renderOhObservationContextV1(input: OhObservationRenderInputV1): string;
//# sourceMappingURL=observe.d.ts.map