import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { OH_AUTHOR_LOG_LIMITS_V1, renderOhAuthorLogV1, type OhAuthorLogRenderingV1 } from "../../src/author-log";
import { OH_RECALL_LIMITS_V1 } from "../../src/recall";
import type { OhSemanticSearchBackendV1 } from "../../src/semantic";
import type { Corpus } from "./datasets";
import { prepareEvolutionCorpus } from "./evolution-retrieval";
import { fuseOhNativeRanksV1, projectOhEvidenceTurnsV1, type OhEvidenceDependencyV1, type OhEvidenceProjectedTurnV1,
  type OhEvidenceSourcePositionV1, type OhEvidenceSourceProjectionV1, type OhFusedAnchorV1, type OhNativeRankListV1 } from "./oh-evidence-context";

/** Author-log reader context that keeps working when the complete log no longer fits: native ranks are fused before
 * any clipping, each anchor brings its same-session neighbors and explicit sources, and one declared byte budget bounds
 * the rendering. When the author's complete log exceeds the budget, the renderer's ranked mode admits the author's
 * messages in this order, then by recency, and labels the log partial. Existing contexts and protocols are unchanged. */
export const OH_AUTHOR_LOG_CONTEXT_PROTOCOL_V1 = "oh.author-log-context.v1" as const;
export const OH_AUTHOR_LOG_CONTEXT_LIMITS_V1 = Object.freeze({ anchors: 400, neighborTurns: 8, rankedRecords: OH_RECALL_LIMITS_V1.maximumRenderedResults });
export type OhAuthorLogContextOptionsV1 = Readonly<{ asOf: string | null; budgetBytes: number; retrievedBytes: number;
  logReserveBytes: number; topK: number; previousTurns: number; nextTurns: number; rrfK: number }>;
export type OhAuthorLogContextV1 = Readonly<{
  protocol: typeof OH_AUTHOR_LOG_CONTEXT_PROTOCOL_V1; options: OhAuthorLogContextOptionsV1;
  context: string; contextBytes: number; contextSha256: string; keys: readonly string[];
  log: OhAuthorLogRenderingV1["log"]; retrieved: OhAuthorLogRenderingV1["retrieved"]; sharedTimestamp: boolean;
  anchors: readonly OhFusedAnchorV1[]; rankedTurnIds: readonly string[];
}>;

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`Invalid author-log context ${label}.`);
  }
  return value as number;
}
/** Check every bound before retrieval or rendering can do work. */
export function checkOhAuthorLogContextOptionsV1(input: OhAuthorLogContextOptionsV1): OhAuthorLogContextOptionsV1 {
  const budget = OH_RECALL_LIMITS_V1.maximumBudgetBytes, neighbors = OH_AUTHOR_LOG_CONTEXT_LIMITS_V1.neighborTurns;
  if (input.asOf !== null && typeof input.asOf !== "string") throw new TypeError("Invalid author-log context question date.");
  const options = Object.freeze({ asOf: input.asOf, budgetBytes: integer(input.budgetBytes, 1, budget, "budget"),
    retrievedBytes: integer(input.retrievedBytes, 0, budget, "retrieved budget"), logReserveBytes: integer(input.logReserveBytes, 0, budget, "log reserve"),
    topK: integer(input.topK, 1, OH_AUTHOR_LOG_CONTEXT_LIMITS_V1.anchors, "anchor limit"),
    previousTurns: integer(input.previousTurns, 0, neighbors, "previous turns"), nextTurns: integer(input.nextTurns, 0, neighbors, "next turns"),
    rrfK: integer(input.rrfK, 1, 1_000_000, "fusion constant") });
  if (options.logReserveBytes > options.budgetBytes || options.retrievedBytes > options.budgetBytes) throw new RangeError("Author-log context reserves exceed the budget.");
  return options;
}

/** Fuse once, then list each anchor followed by its not-yet-listed support in source order. */
export function rankOhAuthorLogEvidenceV1(projection: OhEvidenceSourceProjectionV1, rankings: readonly OhNativeRankListV1[],
  options: Pick<OhAuthorLogContextOptionsV1, "topK" | "previousTurns" | "nextTurns" | "rrfK">) {
  const fused = fuseOhNativeRanksV1(rankings, options.rrfK);
  for (const anchor of fused) if (!projection.byTurnId.has(anchor.turnId)) throw new TypeError("Native rank names an unknown source turn.");
  const anchors = Object.freeze(fused.slice(0, options.topK)), sessions = new Map<string, OhEvidenceProjectedTurnV1[]>(), positions = new Map<string, number>();
  for (const item of projection.turns) {
    const members = sessions.get(item.session) ?? [];
    positions.set(item.turn.id, members.length); members.push(item); sessions.set(item.session, members);
  }
  const ranked: string[] = [], listed = new Set<string>();
  for (const anchor of anchors) {
    const item = projection.byTurnId.get(anchor.turnId)!, members = sessions.get(item.session)!, position = positions.get(anchor.turnId)!;
    const support = new Set<string>(), pending = [anchor.turnId, ...members.slice(Math.max(0, position - options.previousTurns),
      position + options.nextTurns + 1).map(member => member.turn.id)];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (support.has(id)) continue;
      support.add(id); pending.push(...projection.byTurnId.get(id)!.dependencies);
    }
    for (const id of [anchor.turnId, ...projection.turns.filter(source => support.has(source.turn.id)).map(source => source.turn.id)]) {
      if (!listed.has(id)) { listed.add(id); ranked.push(id); }
    }
  }
  if (ranked.length > OH_AUTHOR_LOG_CONTEXT_LIMITS_V1.rankedRecords) throw new RangeError("Author-log context support exceeds the rendering limit.");
  return Object.freeze({ anchors, rankedTurnIds: Object.freeze(ranked) });
}

export function composeOhAuthorLogContextV1(input: Readonly<{ projection: OhEvidenceSourceProjectionV1; rankings: readonly OhNativeRankListV1[] }>,
  optionsInput: OhAuthorLogContextOptionsV1): OhAuthorLogContextV1 {
  const options = checkOhAuthorLogContextOptionsV1(optionsInput), { projection } = input;
  const { anchors, rankedTurnIds } = rankOhAuthorLogEvidenceV1(projection, input.rankings, options);
  const rendering = renderOhAuthorLogV1({ ranked: rankedTurnIds.map(id => ({ record: projection.byTurnId.get(id)!.record })), records: projection.records },
    { asOf: options.asOf, budgetBytes: options.budgetBytes, retrievedBytes: options.retrievedBytes, logReserveBytes: options.logReserveBytes,
      view: projection.view, sessionOrder: projection.sessionOrder });
  return Object.freeze({ protocol: OH_AUTHOR_LOG_CONTEXT_PROTOCOL_V1, options, context: rendering.text, contextBytes: rendering.bytes,
    contextSha256: sha256Hex(rendering.text), keys: Object.freeze([...rendering.keys]), log: Object.freeze({ ...rendering.log }),
    retrieved: Object.freeze({ ...rendering.retrieved }), sharedTimestamp: rendering.sharedTimestamp, anchors, rankedTurnIds });
}

export type OhAuthorLogContextRunOptionsV1 = Readonly<{ asOf: string | null; budgetBytes?: number; retrievedBytes?: number;
  logReserveBytes?: number; topK?: number; previousTurns?: number; nextTurns?: number; rrfK?: number; vector?: boolean;
  /** Opt-in: clip every non-author message to its first N bytes, so the retrieved part holds more of the other side of each
   * exchange. Unset leaves record text verbatim and the run payload unchanged. */
  otherTextBytes?: number }>;

/** Clip one message to at most `max` bytes at a word boundary, marking the cut. */
export function clipOhOtherTextV1(text: string, max: number): string {
  if (Buffer.byteLength(text) <= max) return text;
  let clipped = Buffer.from(text).subarray(0, max).toString("utf8").replace(/\uFFFD+$/u, "");
  const space = clipped.lastIndexOf(" ");
  if (space > max / 2) clipped = clipped.slice(0, space);
  return `${clipped} …[clipped]`;
}

/** Opt-in development generator. Defaults reproduce the renderer budgets of the historical 100K author-log arm with
 * native top-100 lists; a different budget scales the retrieved and reserve defaults proportionally. The vector list
 * needs an explicit semantic backend. Makes no provider calls. */
export async function createOhAuthorLogContextGeneratorV1(corpus: Corpus, options: Readonly<{
  positions?: readonly OhEvidenceSourcePositionV1[]; dependencies?: readonly OhEvidenceDependencyV1[];
  semanticBackend?: OhSemanticSearchBackendV1; semanticCacheDirectory?: string;
}> = {}) {
  const projection = projectOhEvidenceTurnsV1(corpus.turns, options);
  const prepared = await prepareEvolutionCorpus(corpus, options);
  const sourceProjectionSha256 = canonicalSha256(projection.records);
  return Object.freeze({ projection, identity: prepared.identity, sourceProjectionSha256,
    async generate(question: string, input: OhAuthorLogContextRunOptionsV1) {
      if (typeof question !== "string" || question.length === 0 || Buffer.byteLength(question) > 16_384) throw new TypeError("Invalid author-log context question.");
      const vector = input.vector ?? false;
      if (typeof vector !== "boolean") throw new RangeError("Invalid author-log context ranking configuration.");
      // Unset reserves keep the default budget's proportions, so a scaled budget stays in the same log/retrieval regime.
      const budgetBytes = input.budgetBytes ?? OH_AUTHOR_LOG_LIMITS_V1.defaultBudgetBytes;
      const scaled = (value: number) => Number.isSafeInteger(budgetBytes) ? Math.floor(budgetBytes * value / OH_AUTHOR_LOG_LIMITS_V1.defaultBudgetBytes) : value;
      const context = checkOhAuthorLogContextOptionsV1({ asOf: input.asOf, budgetBytes,
        retrievedBytes: input.retrievedBytes ?? scaled(OH_AUTHOR_LOG_LIMITS_V1.defaultRetrievedBytes),
        logReserveBytes: input.logReserveBytes ?? scaled(OH_AUTHOR_LOG_LIMITS_V1.defaultLogReserveBytes),
        topK: input.topK ?? 100, previousTurns: input.previousTurns ?? 1, nextTurns: input.nextTurns ?? 1, rrfK: input.rrfK ?? 60 });
      if (vector && context.topK > 100) throw new RangeError("Invalid author-log context ranking configuration.");
      const config = Object.freeze({ ...context, vector });
      const requests = [prepared.nativeRanks(question, { source: "bm25-native", kind: "lexical", topK: config.topK })];
      if (config.vector) requests.push(prepared.nativeRanks(question, { source: "oh-vector-native", kind: "vector", topK: config.topK }));
      const rankings = Object.freeze(await Promise.all(requests));
      const otherTextBytes = input.otherTextBytes;
      if (otherTextBytes !== undefined) integer(otherTextBytes, 64, OH_RECALL_LIMITS_V1.maximumBudgetBytes, "other-speaker text bound");
      const view = otherTextBytes === undefined ? projection.view : (record: Parameters<typeof projection.view>[0]) => {
        const viewed = projection.view(record);
        return viewed.speaker === OH_AUTHOR_LOG_LIMITS_V1.defaultAuthor ? viewed : { ...viewed, text: clipOhOtherTextV1(viewed.text, otherTextBytes) };
      };
      const rendering = composeOhAuthorLogContextV1({ projection: otherTextBytes === undefined ? projection : { ...projection, view }, rankings }, context);
      const payload = { protocol: "oh.author-log-context-run.v1" as const, preparedSha256: prepared.identity.preparedSha256,
        sourceProjectionSha256, querySha256: sha256Hex(question), config: otherTextBytes === undefined ? config : { ...config, otherTextBytes }, rankings, rendering };
      return Object.freeze({ ...payload, runSha256: canonicalSha256(payload) });
    },
    close: () => prepared.close(),
  });
}
