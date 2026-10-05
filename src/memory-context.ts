/**
 * Progressive-detail reading over Oh's append-only operation log. A capture
 * pairs each log change with its record digest, lane, and pinned heads; a
 * reader then offers a small overview with recent detail, expandable
 * host-supplied summaries for older ranges, and exact record reads and search
 * underneath. Summaries are navigation aids supplied by host code; they are
 * never Oh records, query premises, or evidence of fact.
 *
 * Reads are read-only. They perform no canonical commit, no working-store
 * write, and no host pin advance. Every call re-checks the store binding, the
 * captured head's presence in the live operation log, and the host's current
 * access decision, so a purged working space, a rebound store, a revoked or
 * narrowed grant, and an expired continuation deny the read instead of
 * exposing a cached body.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  orderedUnique,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  utf8ByteLength,
  type Sha256Hex,
} from "./canonical";
import { OhIntegrityError } from "./errors";
import {
  OH_GRAPH_LIMITS_V1,
  parseKnowledgeGraphRecordV1,
  type KnowledgeGraphRecordV1,
} from "./graph";
import type { OhOperationV1 } from "./operation";
import {
  parseOhHeadRefV1,
  parseOhHeadV1,
  type OhHeadRefV1,
  type OhHeadV1,
  type OhStoreV1,
} from "./store";

export const OH_MEMORY_CONTEXT_FORMAT_VERSION_V1 = 1 as const;
export const OH_MEMORY_CONTEXT_LANES_V1 = Object.freeze(["canonical", "working"] as const);
export type OhMemoryContextLaneV1 = (typeof OH_MEMORY_CONTEXT_LANES_V1)[number];

export const OH_MEMORY_CONTEXT_LIMITS_V1 = Object.freeze({
  bindings: 2,
  changeFeedPage: 1_000,
  continuationBytes: 4 * 1024,
  continuationKeyBytes: 32,
  detailedIndices: 1_024,
  leafFetchesPerRead: 128,
  leaves: 4_096,
  pageBytes: 1024 * 1024,
  pageItems: 64,
  poolBytes: 8 * 1024 * 1024,
  scannedBytes: 8 * 1024 * 1024,
  searchMatches: 256,
  searchPatternBytes: 512,
  summariesPerGeneration: 2_048,
  summaryBodyBytes: 32 * 1024,
  summaryChildren: 2,
} as const);

export const OH_MEMORY_CONTEXT_CONTINUATION_LIFETIME_MS_V1 = 15 * 60 * 1000;

export type OhMemoryContextDenialReasonV1 =
  "authorization" | "availability" | "budget" | "integrity" | "stale";

/** A denied or inconsistent progressive-memory read; the original class survives bundling. */
export class OhMemoryContextError extends OhIntegrityError {
  declare readonly reason: OhMemoryContextDenialReasonV1;

  constructor(reason: OhMemoryContextDenialReasonV1, message: string) {
    super(message);
    this.name = "OhMemoryContextError";
    Object.defineProperty(this, "reason", {
      configurable: false, enumerable: true, value: reason, writable: false,
    });
  }
}

export type OhMemoryContextContinuationReasonV1 =
  "authentication" | "encoding" | "expired" | "identity";

/** A caller-supplied continuation cannot be decoded, authenticated, or rebound exactly. */
export class OhMemoryContextContinuationError extends OhIntegrityError {
  declare readonly code: "memory-context-continuation";
  declare readonly reason: OhMemoryContextContinuationReasonV1;

  constructor(reason: OhMemoryContextContinuationReasonV1, message: string) {
    super(message);
    this.name = "OhMemoryContextContinuationError";
    Object.defineProperties(this, {
      code: { configurable: false, enumerable: true, value: "memory-context-continuation", writable: false },
      reason: { configurable: false, enumerable: true, value: reason, writable: false },
    });
  }
}

function contextError(reason: OhMemoryContextDenialReasonV1, message: string): never {
  throw new OhMemoryContextError(reason, message);
}

function laneOf(value: unknown): OhMemoryContextLaneV1 | null {
  return value === "canonical" || value === "working" ? value : null;
}

function positiveInt(value: unknown, maximum: number, minimum = 0): number | null {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number : null;
}

function digestList(value: unknown, maximum: number): readonly Sha256Hex[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const digests: Sha256Hex[] = [];
  for (const entry of value) {
    const digest = parseSha256Hex(entry);
    if (digest === null) return null;
    digests.push(digest);
  }
  return digests;
}

/** One log change: the record a put wrote, or the digest a tombstone removed. */
export type OhMemoryContextLeafV1 = Readonly<{
  changeIndex: number;
  instant: string;
  key: string;
  kind: "put" | "tombstone";
  lane: OhMemoryContextLaneV1;
  /** Whether the record still exists at the captured head with this digest. */
  live: boolean;
  operationSha256: Sha256Hex;
  parentOperationSha256: Sha256Hex | null;
  recordSha256: Sha256Hex;
  sequence: number;
  v: 1;
}>;

function parseLeaf(value: unknown, label: string): OhMemoryContextLeafV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["changeIndex", "instant", "key", "kind",
    "lane", "live", "operationSha256", "parentOperationSha256", "recordSha256", "sequence", "v"])
    || value.v !== 1 || (value.kind !== "put" && value.kind !== "tombstone")
    || typeof value.live !== "boolean") {
    throw new TypeError(`${label} is not a memory-context leaf.`);
  }
  const instant = parseCanonicalInstantV1(value.instant);
  const key = safeCode(value.key, 512);
  const lane = laneOf(value.lane);
  const operationSha256 = parseSha256Hex(value.operationSha256);
  const parentOperationSha256 = value.parentOperationSha256 === null
    ? null : parseSha256Hex(value.parentOperationSha256);
  const recordSha256 = parseSha256Hex(value.recordSha256);
  const changeIndex = positiveInt(value.changeIndex, OH_GRAPH_LIMITS_V1.changesPerOperation - 1);
  const sequence = positiveInt(value.sequence, Number.MAX_SAFE_INTEGER, 1);
  if (instant === null || key === null || lane === null || operationSha256 === null
    || recordSha256 === null || changeIndex === null || sequence === null
    || (value.parentOperationSha256 === null) !== (sequence === 1)) {
    throw new TypeError(`${label} has an invalid identity.`);
  }
  return Object.freeze({ changeIndex, instant, key, kind: value.kind, lane,
    live: value.live, operationSha256, parentOperationSha256, recordSha256, sequence, v: 1 });
}

export function ohMemoryContextLeafSha256V1(leaf: OhMemoryContextLeafV1): Sha256Hex {
  return canonicalSha256(leaf);
}

/** The captured binding and pinned head for one lane. */
export type OhMemoryContextLaneBindingV1 = Readonly<{
  bindingSha256: Sha256Hex;
  head: OhHeadV1;
  lane: OhMemoryContextLaneV1;
}>;

function parseLaneBinding(value: unknown): OhMemoryContextLaneBindingV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["bindingSha256", "head", "lane"])) {
    throw new TypeError("A lane binding must carry exactly bindingSha256, head, and lane.");
  }
  const bindingSha256 = parseSha256Hex(value.bindingSha256);
  const head = parseOhHeadV1(value.head);
  const lane = laneOf(value.lane);
  if (bindingSha256 === null || head === null || lane === null) {
    throw new TypeError("Invalid memory-context lane binding.");
  }
  return Object.freeze({ bindingSha256, head, lane });
}

/**
 * A captured, ordered list of log changes across one or both lanes. The
 * capture is self-describing: it carries the bindings and heads it was taken
 * against, so a later reader can detect a rebound store or a rolled-back log.
 * Leaves are ordered by each operation's recorded instant, then lane,
 * sequence, and change index — a deterministic merge, not a permission claim.
 */
export type OhMemoryContextHistoryV1 = Readonly<{
  bindings: readonly OhMemoryContextLaneBindingV1[];
  leaves: readonly OhMemoryContextLeafV1[];
  v: 1;
}>;

function leafOrder(leaf: OhMemoryContextLeafV1): string {
  return `${leaf.instant} ${leaf.lane} ${String(leaf.sequence).padStart(16, "0")} `
    + `${String(leaf.changeIndex).padStart(8, "0")}`;
}

export function ohMemoryContextHistorySha256V1(history: OhMemoryContextHistoryV1): Sha256Hex {
  return canonicalSha256(history);
}

export function parseOhMemoryContextHistoryV1(value: unknown): OhMemoryContextHistoryV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["bindings", "leaves", "v"]) || value.v !== 1
    || !Array.isArray(value.bindings) || !Array.isArray(value.leaves)
    || value.bindings.length < 1 || value.bindings.length > OH_MEMORY_CONTEXT_LIMITS_V1.bindings
    || value.leaves.length > OH_MEMORY_CONTEXT_LIMITS_V1.leaves) {
    throw new TypeError("Invalid memory-context history envelope.");
  }
  const bindings = value.bindings.map(parseLaneBinding);
  if (!orderedUnique(bindings, (binding) => binding.lane)) {
    throw new TypeError("Memory-context lane bindings must be unique and ordered.");
  }
  const lanes = new Set(bindings.map((binding) => binding.lane));
  const heads = new Map(bindings.map((binding) => [binding.lane, binding.head]));
  const leaves = value.leaves.map((leaf, index) => parseLeaf(leaf, `leaves[${index}]`));
  for (const [index, leaf] of leaves.entries()) {
    if (!lanes.has(leaf.lane)) {
      throw new TypeError(`leaves[${index}] names a lane the capture does not bind.`);
    }
    if (leaf.sequence > heads.get(leaf.lane)!.sequence) {
      throw new TypeError(`leaves[${index}] is ahead of its captured head.`);
    }
    if (index > 0 && leafOrder(leaves[index - 1]!) >= leafOrder(leaf)) {
      throw new TypeError("Memory-context leaves must be in canonical merge order.");
    }
    if (leaf.kind === "tombstone" && leaf.live) {
      throw new TypeError("A tombstone leaf cannot be live at the captured head.");
    }
  }
  return Object.freeze({ bindings: Object.freeze(bindings),
    leaves: Object.freeze(leaves), v: 1 });
}

/** A binary range over the captured leaves, aligned to its own size. */
export type OhMemoryContextNodeV1 = Readonly<{
  end: number;
  historySha256: Sha256Hex;
  sourcesSha256: Sha256Hex;
  start: number;
  v: 1;
}>;

function sourcesDigest(leaves: readonly OhMemoryContextLeafV1[], start: number, end: number): Sha256Hex {
  return canonicalSha256(leaves.slice(start, end).map((leaf) => canonicalSha256(leaf)));
}

export function createOhMemoryContextNodeV1(
  history: OhMemoryContextHistoryV1,
  start: number,
  end: number,
): OhMemoryContextNodeV1 {
  const length = end - start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0
    || end > history.leaves.length || length < 1
    || (length & (length - 1)) !== 0 || (start % length) !== 0) {
    throw new RangeError("A memory-context node must be an aligned power-of-two leaf range.");
  }
  return Object.freeze({ end, historySha256: ohMemoryContextHistorySha256V1(history),
    sourcesSha256: sourcesDigest(history.leaves, start, end), start, v: 1 });
}

export function ohMemoryContextNodeSha256V1(node: OhMemoryContextNodeV1): Sha256Hex {
  return canonicalSha256(node);
}

export function parseOhMemoryContextNodeV1(value: unknown): OhMemoryContextNodeV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["end", "historySha256", "sourcesSha256",
    "start", "v"]) || value.v !== 1) throw new TypeError("Invalid memory-context node.");
  const historySha256 = parseSha256Hex(value.historySha256);
  const sourcesSha256 = parseSha256Hex(value.sourcesSha256);
  const start = positiveInt(value.start, OH_MEMORY_CONTEXT_LIMITS_V1.leaves);
  const end = positiveInt(value.end, OH_MEMORY_CONTEXT_LIMITS_V1.leaves, 1);
  if (historySha256 === null || sourcesSha256 === null || start === null || end === null) {
    throw new TypeError("Invalid memory-context node identity.");
  }
  return Object.freeze({ end, historySha256, sourcesSha256, start, v: 1 });
}

/**
 * A host-supplied summary over one node. It is a detached reading aid with
 * explicit lineage, never an Oh store record and never a query premise.
 */
export type OhMemoryContextSummaryV1 = Readonly<{
  body: string;
  childrenSha256s: readonly Sha256Hex[];
  historySha256: Sha256Hex;
  nodeSha256: Sha256Hex;
  policySha256: Sha256Hex;
  promptSha256: Sha256Hex;
  sourcesSha256: Sha256Hex;
  summarizerSha256: Sha256Hex;
  v: 1;
}>;

export function ohMemoryContextSummarySha256V1(summary: OhMemoryContextSummaryV1): Sha256Hex {
  return canonicalSha256(summary);
}

export function parseOhMemoryContextSummaryV1(value: unknown): OhMemoryContextSummaryV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["body", "childrenSha256s", "historySha256",
    "nodeSha256", "policySha256", "promptSha256", "sourcesSha256", "summarizerSha256", "v"])
    || value.v !== 1) throw new TypeError("Invalid memory-context summary envelope.");
  const historySha256 = parseSha256Hex(value.historySha256);
  const nodeSha256 = parseSha256Hex(value.nodeSha256);
  const policySha256 = parseSha256Hex(value.policySha256);
  const promptSha256 = parseSha256Hex(value.promptSha256);
  const sourcesSha256 = parseSha256Hex(value.sourcesSha256);
  const summarizerSha256 = parseSha256Hex(value.summarizerSha256);
  const childrenSha256s = digestList(value.childrenSha256s, OH_MEMORY_CONTEXT_LIMITS_V1.summaryChildren);
  if (typeof value.body !== "string" || value.body.length === 0
    || utf8ByteLength(value.body) > OH_MEMORY_CONTEXT_LIMITS_V1.summaryBodyBytes
    || value.body !== value.body.normalize("NFC")) {
    throw new TypeError("Invalid memory-context summary body.");
  }
  if (historySha256 === null || nodeSha256 === null || policySha256 === null
    || promptSha256 === null || sourcesSha256 === null || summarizerSha256 === null
    || childrenSha256s === null) {
    throw new TypeError("Invalid memory-context summary lineage.");
  }
  return Object.freeze({ body: value.body, childrenSha256s: Object.freeze([...childrenSha256s]),
    historySha256, nodeSha256, policySha256, promptSha256, sourcesSha256, summarizerSha256, v: 1 });
}

/** One generation of derivative summaries; a later correction increments it. */
export type OhMemoryContextGenerationV1 = Readonly<{
  generation: number;
  historySha256: Sha256Hex;
  policySha256: Sha256Hex;
  promptSha256: Sha256Hex;
  summarizerSha256: Sha256Hex;
  summaries: readonly Readonly<{ nodeSha256: Sha256Hex; summarySha256: Sha256Hex }>[];
  v: 1;
}>;

export function ohMemoryContextGenerationSha256V1(generation: OhMemoryContextGenerationV1): Sha256Hex {
  return canonicalSha256(generation);
}

export function parseOhMemoryContextGenerationV1(value: unknown): OhMemoryContextGenerationV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["generation", "historySha256", "policySha256",
    "promptSha256", "summarizerSha256", "summaries", "v"]) || value.v !== 1
    || !Array.isArray(value.summaries)
    || value.summaries.length > OH_MEMORY_CONTEXT_LIMITS_V1.summariesPerGeneration) {
    throw new TypeError("Invalid memory-context generation envelope.");
  }
  const generation = positiveInt(value.generation, Number.MAX_SAFE_INTEGER);
  const historySha256 = parseSha256Hex(value.historySha256);
  const policySha256 = parseSha256Hex(value.policySha256);
  const promptSha256 = parseSha256Hex(value.promptSha256);
  const summarizerSha256 = parseSha256Hex(value.summarizerSha256);
  const summaries: { nodeSha256: Sha256Hex; summarySha256: Sha256Hex }[] = [];
  for (const [index, entry] of value.summaries.entries()) {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ["nodeSha256", "summarySha256"])) {
      throw new TypeError(`Invalid memory-context generation entry ${index}.`);
    }
    const nodeSha256 = parseSha256Hex(entry.nodeSha256);
    const summarySha256 = parseSha256Hex(entry.summarySha256);
    if (nodeSha256 === null || summarySha256 === null) {
      throw new TypeError(`Invalid memory-context generation entry ${index}.`);
    }
    summaries.push({ nodeSha256, summarySha256 });
  }
  if (!orderedUnique(summaries, (entry) => entry.nodeSha256)) {
    throw new TypeError("Generation entries must be unique and ordered by node digest.");
  }
  if (generation === null || historySha256 === null || policySha256 === null
    || promptSha256 === null || summarizerSha256 === null) {
    throw new TypeError("Invalid memory-context generation identity.");
  }
  return Object.freeze({ generation, historySha256, policySha256, promptSha256,
    summarizerSha256, summaries: Object.freeze(summaries), v: 1 });
}

/** The records host code supplies when it publishes one derivative generation. */
export type OhMemoryContextPoolV1 = Readonly<{
  generation: OhMemoryContextGenerationV1;
  nodes: readonly OhMemoryContextNodeV1[];
  summaries: readonly OhMemoryContextSummaryV1[];
}>;

export function parseOhMemoryContextPoolV1(
  history: OhMemoryContextHistoryV1,
  value: unknown,
): OhMemoryContextPoolV1 {
  const historySha256 = ohMemoryContextHistorySha256V1(history);
  if (!isPlainRecord(value) || !hasExactKeys(value, ["generation", "nodes", "summaries"])
    || !Array.isArray(value.nodes) || !Array.isArray(value.summaries)
    || value.nodes.length > OH_MEMORY_CONTEXT_LIMITS_V1.summariesPerGeneration
    || value.summaries.length > OH_MEMORY_CONTEXT_LIMITS_V1.summariesPerGeneration
    || utf8ByteLength(canonicalJson(value)) > OH_MEMORY_CONTEXT_LIMITS_V1.poolBytes) {
    throw new TypeError("Invalid memory-context derivative pool.");
  }
  const generation = parseOhMemoryContextGenerationV1(value.generation);
  if (generation.historySha256 !== historySha256) {
    throw new OhMemoryContextError("integrity", "Derivative generation belongs to another history.");
  }
  const nodes = new Map<Sha256Hex, OhMemoryContextNodeV1>();
  for (const candidate of value.nodes) {
    const parsed = parseOhMemoryContextNodeV1(candidate);
    const recomputed = createOhMemoryContextNodeV1(history, parsed.start, parsed.end);
    if (canonicalJson(parsed) !== canonicalJson(recomputed)
      || ohMemoryContextNodeSha256V1(parsed) !== ohMemoryContextNodeSha256V1(recomputed)) {
      throw new OhMemoryContextError("integrity", "A derivative node does not match its history range.");
    }
    nodes.set(ohMemoryContextNodeSha256V1(parsed), parsed);
  }
  const summaries = new Map<Sha256Hex, OhMemoryContextSummaryV1>();
  for (const candidate of value.summaries) {
    const parsed = parseOhMemoryContextSummaryV1(candidate);
    const node = nodes.get(parsed.nodeSha256);
    if (parsed.historySha256 !== historySha256 || node === undefined
      || parsed.sourcesSha256 !== node.sourcesSha256
      || parsed.promptSha256 !== generation.promptSha256
      || parsed.policySha256 !== generation.policySha256
      || parsed.summarizerSha256 !== generation.summarizerSha256) {
      throw new OhMemoryContextError("integrity", "A summary does not match its node's sources or recipe.");
    }
    if (parsed.childrenSha256s.length !== 0
      && !(node.end - node.start > 1 && parsed.childrenSha256s.length === 2)) {
      throw new OhMemoryContextError("integrity",
        "A summary lists children only for a multi-leaf node, and then exactly two.");
    }
    summaries.set(ohMemoryContextSummarySha256V1(parsed), parsed);
  }
  for (const parsed of summaries.values()) {
    if (parsed.childrenSha256s.length === 0) continue;
    const parentNode = nodes.get(parsed.nodeSha256)!;
    const mid = (parentNode.start + parentNode.end) / 2;
    const halves = new Set<"left" | "right">();
    for (const child of parsed.childrenSha256s) {
      const childSummary = summaries.get(child);
      const childNode = childSummary === undefined ? undefined : nodes.get(childSummary.nodeSha256);
      if (childNode === undefined || childNode.end - childNode.start !== mid - parentNode.start
        || (childNode.start !== parentNode.start && childNode.start !== mid)) {
        throw new OhMemoryContextError("integrity", "A summary child does not cover a node half.");
        }
      halves.add(childNode.start === parentNode.start ? "left" : "right");
    }
    if (halves.size !== parsed.childrenSha256s.length) {
      throw new OhMemoryContextError("integrity", "Summary children must cover both node halves.");
    }
  }
  for (const entry of generation.summaries) {
    const summary = summaries.get(entry.summarySha256);
    if (summary === undefined || !nodes.has(entry.nodeSha256)
      || summary.nodeSha256 !== entry.nodeSha256) {
      throw new OhMemoryContextError("integrity", "A generation entry lacks its summary or node.");
    }
  }
  return Object.freeze({ generation, nodes: Object.freeze([...nodes.values()]),
    summaries: Object.freeze([...summaries.values()]) });
}

/** The host's current permission decision for one admitted capture. */
export type OhMemoryContextAccessV1 = Readonly<{
  historySha256: Sha256Hex;
  /** Permitted leaf positions, or `null` for all leaves. */
  indices: readonly number[] | null;
  /** Permitted lanes, or `null` for every captured lane. */
  lanes: readonly OhMemoryContextLaneV1[] | null;
  revision: number;
  state: "active" | "revoked";
  v: 1;
}>;

export function parseOhMemoryContextAccessV1(value: unknown): OhMemoryContextAccessV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["historySha256", "indices", "lanes",
    "revision", "state", "v"]) || value.v !== 1
    || (value.state !== "active" && value.state !== "revoked")) {
    throw new TypeError("Invalid memory-context access record.");
  }
  const historySha256 = parseSha256Hex(value.historySha256);
  const revision = positiveInt(value.revision, Number.MAX_SAFE_INTEGER);
  const indices = value.indices === null ? null
    : Array.isArray(value.indices) && value.indices.length <= OH_MEMORY_CONTEXT_LIMITS_V1.leaves
      && value.indices.every((index) => positiveInt(index, OH_MEMORY_CONTEXT_LIMITS_V1.leaves - 1) !== null)
      && orderedUnique(value.indices as number[], (index) => String(index).padStart(16, "0"))
      ? Object.freeze([...(value.indices as number[])]) : null;
  const lanes = value.lanes === null ? null
    : Array.isArray(value.lanes) && value.lanes.length >= 1
      && value.lanes.length <= OH_MEMORY_CONTEXT_LIMITS_V1.bindings
      && value.lanes.every((lane) => laneOf(lane) !== null)
      && orderedUnique(value.lanes as string[], (lane) => lane)
      ? Object.freeze([...(value.lanes as OhMemoryContextLaneV1[])]) : null;
  if (historySha256 === null || revision === null
    || (value.indices !== null && indices === null)
    || (value.lanes !== null && lanes === null)) {
    throw new TypeError("Invalid memory-context access record.");
  }
  return Object.freeze({ historySha256, indices, lanes, revision, state: value.state, v: 1 });
}

export type OhMemoryContextRefV1 = Readonly<{ historySha256: Sha256Hex; v: 1 }>;
export function ohMemoryContextRefSha256V1(ref: OhMemoryContextRefV1): Sha256Hex {
  return canonicalSha256(ref);
}

/** Per-lane capture bound: `from` is exclusive, `through` pins the upper head. */
export type OhMemoryContextCaptureBoundV1 = Readonly<{
  from?: OhHeadRefV1;
  store: OhStoreV1;
  through?: OhHeadRefV1;
}>;

async function resolveLaneHead(store: OhStoreV1, ref: OhHeadRefV1): Promise<OhHeadV1> {
  const parsed = parseOhHeadRefV1(ref);
  if (parsed === null) throw new TypeError("Invalid memory-context capture bound.");
  // `changesSince` resolves its `through` ref against the live log and returns
  // the full head on the page, which also proves the head is still reachable.
  const page = await store.changesSince(
    { operationSha256: null, sequence: 0 }, { limit: 1, through: parsed });
  return page.through;
}

/**
 * Walks the change feed of each supplied lane from `from` (default: genesis)
 * through `through` (default: the lane's current head) and returns the merged,
 * deterministically ordered leaf list. Every `live` flag is resolved against
 * the captured head's snapshot.
 */
export async function captureOhMemoryContextV1(
  lanes: Readonly<Partial<Record<OhMemoryContextLaneV1, OhMemoryContextCaptureBoundV1>>>,
): Promise<OhMemoryContextHistoryV1> {
  if (!isPlainRecord(lanes)) throw new TypeError("Invalid memory-context capture input.");
  const keys = Reflect.ownKeys(lanes);
  if (keys.length < 1 || keys.length > OH_MEMORY_CONTEXT_LIMITS_V1.bindings
    || keys.some((key) => laneOf(key) === null)) {
    throw new TypeError("Capture requires one or two known lanes.");
  }
  const bindings: OhMemoryContextLaneBindingV1[] = [];
  const leaves: OhMemoryContextLeafV1[] = [];
  for (const lane of OH_MEMORY_CONTEXT_LANES_V1) {
    const bound = (lanes as Record<string, unknown>)[lane] as OhMemoryContextCaptureBoundV1 | undefined;
    if (bound === undefined) continue;
    if (!isPlainRecord(bound)) throw new TypeError(`Invalid ${lane} capture bound.`);
    const boundKeys = Reflect.ownKeys(bound);
    if (!boundKeys.includes("store")
      || boundKeys.some((key) => !["from", "store", "through"].includes(key as string))) {
      throw new TypeError(`Invalid ${lane} capture bound.`);
    }
    const store = bound.store;
    if (store === null || typeof store !== "object" || typeof store.changesSince !== "function"
      || typeof store.snapshot !== "function" || typeof store.head !== "function"
      || store.binding?.profile?.profileKind !== lane) {
      throw new TypeError(`The ${lane} capture requires an ${lane}-profile OhStoreV1 handle.`);
    }
    const head = bound.through === undefined ? parseOhHeadV1(await store.head())
      : await resolveLaneHead(store, bound.through);
    if (head === null) throw new OhMemoryContextError("stale", `The ${lane} store returned an invalid head.`);
    const fromRef = bound.from === undefined
      ? { operationSha256: null, sequence: 0 }
      : parseOhHeadRefV1(bound.from);
    if (fromRef === null) throw new TypeError(`Invalid ${lane} from bound.`);
    const operations: OhOperationV1[] = [];
    let cursor = fromRef;
    for (;;) {
      const page = await store.changesSince(cursor, {
        limit: OH_MEMORY_CONTEXT_LIMITS_V1.changeFeedPage,
        through: { operationSha256: head.operationSha256, sequence: head.sequence } });
      operations.push(...page.operations);
      if (!page.hasMore) break;
      cursor = page.to;
      if (operations.length > OH_MEMORY_CONTEXT_LIMITS_V1.leaves) {
        throw new RangeError(`The ${lane} capture exceeds its operation bound.`);
      }
    }
    const snapshot = await store.snapshot({ head: { operationSha256: head.operationSha256,
      sequence: head.sequence } });
    const liveDigests = new Map(snapshot.records.map((record) => [record.key, record.recordSha256]));
    for (const operation of operations) {
      for (const [changeIndex, change] of operation.changes.entries()) {
        if (leaves.length >= OH_MEMORY_CONTEXT_LIMITS_V1.leaves) {
          throw new RangeError(`The ${lane} capture exceeds its leaf bound.`);
        }
        if (change.kind === "put") {
          leaves.push(Object.freeze({ changeIndex, instant: operation.instant,
            key: change.record.key, kind: "put" as const, lane,
            live: liveDigests.get(change.record.key) === change.record.recordSha256,
            operationSha256: operation.operationSha256,
            parentOperationSha256: operation.parentOperationSha256,
            recordSha256: change.record.recordSha256, sequence: operation.sequence, v: 1 as const }));
        } else {
          leaves.push(Object.freeze({ changeIndex, instant: operation.instant,
            key: change.key, kind: "tombstone" as const, lane, live: false,
            operationSha256: operation.operationSha256,
            parentOperationSha256: operation.parentOperationSha256,
            recordSha256: change.priorSha256, sequence: operation.sequence, v: 1 as const }));
        }
      }
    }
    bindings.push(Object.freeze({ bindingSha256: store.binding.bindingSha256, head, lane }));
  }
  leaves.sort((left, right) => {
    const order = leafOrder(left);
    const other = leafOrder(right);
    return order < other ? -1 : order > other ? 1 : 0;
  });
  return parseOhMemoryContextHistoryV1({ bindings, leaves, v: 1 });
}

/** Aligned power-of-two ranges with finer granularity toward the present. */
export function ohMemoryContextCoverV1(
  leafCount: number,
  recentLeaves: number,
  detailedIndices: readonly number[] = [],
): readonly Readonly<{ start: number; end: number }>[] {
  const size = positiveInt(leafCount, OH_MEMORY_CONTEXT_LIMITS_V1.leaves);
  const recent = positiveInt(recentLeaves, OH_MEMORY_CONTEXT_LIMITS_V1.leaves);
  if (size === null || recent === null) throw new RangeError("Invalid cover bounds.");
  if (detailedIndices.length > OH_MEMORY_CONTEXT_LIMITS_V1.detailedIndices
    || detailedIndices.some((index) => positiveInt(index, size - 1) === null)) {
    throw new RangeError("Invalid detailed leaf selection.");
  }
  const detailed = new Set<number>(detailedIndices);
  const result: { start: number; end: number }[] = [];
  const visit = (start: number, end: number): void => {
    const length = end - start;
    let forced = false;
    for (let index = start; index < end; index += 1) {
      if (detailed.has(index)) { forced = true; break; }
    }
    if (length === 1 || (!forced && end <= size - recent && length <= size - end)) {
      result.push({ start, end });
      return;
    }
    const middle = (start + end) / 2;
    visit(start, middle);
    visit(middle, end);
  };
  let start = 0;
  for (let length = OH_MEMORY_CONTEXT_LIMITS_V1.leaves; length >= 1; length /= 2) {
    if (start + length <= size) { visit(start, start + length); start += length; }
  }
  return Object.freeze(result);
}

export type OhMemoryContextItemV1 =
  | Readonly<{ kind: "leaf"; leaf: OhMemoryContextLeafV1; leafIndex: number;
      record: KnowledgeGraphRecordV1 | null }>
  | Readonly<{ kind: "summary"; childrenSha256s: readonly Sha256Hex[];
      end: number; lanes: readonly OhMemoryContextLaneV1[]; nodeSha256: Sha256Hex;
      start: number; summarySha256: Sha256Hex; text: string }>
  | Readonly<{ end: number; kind: "pending"; lanes: readonly OhMemoryContextLaneV1[];
      nodeSha256: Sha256Hex; reason: "missing-summary" | "unpermitted"; start: number }>;

export type OhMemoryContextPageV1 = Readonly<{
  binding: Readonly<{ generationSha256: Sha256Hex; historySha256: Sha256Hex;
    selectionSha256: Sha256Hex }>;
  continuation: string | null;
  end: number;
  items: readonly OhMemoryContextItemV1[];
  start: number;
  status: "complete" | "partial";
  v: 1;
}>;

export type OhMemoryContextExpansionV1 = Readonly<{
  items: readonly OhMemoryContextItemV1[];
  nodeSha256: Sha256Hex;
  status: "complete" | "incomplete";
  v: 1;
}>;

export type OhMemoryContextReadV1 = Readonly<{
  leaf: OhMemoryContextLeafV1;
  leafIndex: number;
  record: KnowledgeGraphRecordV1 | null;
  v: 1;
}>;

export type OhMemoryContextSearchMatchV1 = Readonly<{
  end: number;
  key: string;
  lane: OhMemoryContextLaneV1;
  leafIndex: number;
  recordSha256: Sha256Hex;
  start: number;
}>;

export type OhMemoryContextSearchResultV1 = Readonly<{
  complete: boolean;
  denied: number;
  matches: readonly OhMemoryContextSearchMatchV1[];
  scannedBytes: number;
  v: 1;
}>;

export type OhMemoryContextInspectionV1 = Readonly<{
  generationSha256: Sha256Hex;
  heads: Readonly<Partial<Record<OhMemoryContextLaneV1, OhHeadV1>>>;
  historySha256: Sha256Hex;
  leaves: number;
  v: 1;
}>;

export type OhMemoryContextReadLimitsV1 = Readonly<{
  maxBytes?: number;
  maxItems?: number;
}>;

export interface OhMemoryContextReaderV1 {
  expand(nodeSha256: unknown, options?: Readonly<{ continuation?: string | null }>): Promise<OhMemoryContextExpansionV1>;
  inspect(): Promise<OhMemoryContextInspectionV1>;
  overview(options?: Readonly<{ continuation?: string | null;
    detailedIndices?: readonly number[]; limits?: OhMemoryContextReadLimitsV1;
    recentLeaves?: number }>): Promise<OhMemoryContextPageV1>;
  read(leafIndex: unknown): Promise<OhMemoryContextReadV1>;
  search(options: unknown): Promise<OhMemoryContextSearchResultV1>;
}

export interface OhMemoryContextHostV1 {
  admit(history: unknown, options?: Readonly<{ derivatives?: unknown;
    detailedIndices?: readonly number[]; recentLeaves?: number }>): Promise<OhMemoryContextRefV1>;
  bind(ref: unknown): OhMemoryContextReaderV1;
  publishDerivatives(ref: unknown, pool: unknown,
    expectedGenerationSha256: unknown): Promise<Sha256Hex>;
  revoke(ref: unknown): void;
}

type HistoryEntry = {
  bindings: Map<OhMemoryContextLaneV1, OhMemoryContextLaneBindingV1>;
  history: OhMemoryContextHistoryV1;
};

type Registered = {
  detailedIndices: readonly number[];
  generation: OhMemoryContextGenerationV1;
  nodes: Map<Sha256Hex, OhMemoryContextNodeV1>;
  recentLeaves: number;
  ref: OhMemoryContextRefV1;
  refSha256: Sha256Hex;
  revoked: boolean;
  summaries: Map<Sha256Hex, OhMemoryContextSummaryV1>;
  summariesByNode: Map<Sha256Hex, OhMemoryContextSummaryV1>;
};

function emptyGeneration(historySha256: Sha256Hex): OhMemoryContextGenerationV1 {
  return Object.freeze({ generation: 0, historySha256,
    policySha256: canonicalSha256("oh.memory-context.no-policy"),
    promptSha256: canonicalSha256("oh.memory-context.no-prompt"),
    summarizerSha256: canonicalSha256("oh.memory-context.no-summarizer"),
    summaries: Object.freeze([]), v: 1 });
}

type ContinuationPayload = {
  expiresAtMonotonicMs: number;
  generationSha256: Sha256Hex;
  historySha256: Sha256Hex;
  nextOffset: number;
  nodeSha256: Sha256Hex | null;
  refSha256: Sha256Hex;
  selectionSha256: Sha256Hex;
  surface: "expand" | "overview";
  v: 1;
};

export function createOhMemoryContextHostV1(options: Readonly<{
  canonical?: Readonly<{ expectedBindingSha256: Sha256Hex; store: OhStoreV1 }>;
  continuationKey?: Uint8Array;
  continuationLifetimeMs?: number;
  monotonicNow?: () => number;
  resolveAccess: (ref: OhMemoryContextRefV1) => unknown;
  working?: Readonly<{ expectedBindingSha256: Sha256Hex; store: OhStoreV1 }>;
}>): OhMemoryContextHostV1 {
  if (!isPlainRecord(options) || typeof options.resolveAccess !== "function") {
    throw new TypeError("A memory-context host requires an access resolver.");
  }
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.some((key) => !["canonical", "continuationKey", "continuationLifetimeMs",
    "monotonicNow", "resolveAccess", "working"].includes(key as string))) {
    throw new TypeError("Unknown memory-context host option.");
  }
  const key = options.continuationKey === undefined
    ? Uint8Array.from(randomBytes(OH_MEMORY_CONTEXT_LIMITS_V1.continuationKeyBytes))
    : options.continuationKey;
  if (!(key instanceof Uint8Array)
    || key.byteLength !== OH_MEMORY_CONTEXT_LIMITS_V1.continuationKeyBytes) {
    throw new RangeError("The memory-context continuation key must be exactly 32 raw bytes.");
  }
  const lifetime = options.continuationLifetimeMs ?? OH_MEMORY_CONTEXT_CONTINUATION_LIFETIME_MS_V1;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 24 * 60 * 60 * 1000) {
    throw new RangeError("Invalid memory-context continuation lifetime.");
  }
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  if (typeof monotonicNow !== "function") throw new TypeError("Invalid monotonic clock.");
  const lanes = new Map<OhMemoryContextLaneV1, { expectedBindingSha256: Sha256Hex; store: OhStoreV1 }>();
  for (const lane of OH_MEMORY_CONTEXT_LANES_V1) {
    const bound = options[lane];
    if (bound === undefined) continue;
    if (!isPlainRecord(bound) || !hasExactKeys(bound, ["expectedBindingSha256", "store"])
      || parseSha256Hex(bound.expectedBindingSha256) === null
      || bound.store === null || typeof bound.store !== "object"
      || typeof bound.store.changesSince !== "function") {
      throw new TypeError(`Invalid ${lane} memory-context lane.`);
    }
    if (bound.store.binding.bindingSha256 !== bound.expectedBindingSha256) {
      throw new OhMemoryContextError("stale", `The ${lane} store is not the host-bound authority.`);
    }
    if (bound.store.binding.profile.profileKind !== lane) {
      throw new OhMemoryContextError("stale", `The ${lane} lane has the wrong store profile.`);
    }
    lanes.set(lane, { expectedBindingSha256: bound.expectedBindingSha256, store: bound.store });
  }
  if (lanes.size === 0) throw new TypeError("A memory-context host needs at least one lane.");
  const histories = new Map<Sha256Hex, HistoryEntry>();
  const registered = new Map<Sha256Hex, Registered>();
  // Revocation survives re-admission: `admit` cannot clear a host `revoke`.
  const revokedRefs = new Set<Sha256Hex>();

  function historyEntry(entry: Registered): HistoryEntry {
    const found = histories.get(entry.ref.historySha256);
    if (found === undefined) contextError("integrity", "Unknown memory-context history.");
    return found;
  }

  interface PreparedAccess {
    record: OhMemoryContextAccessV1;
    indices: ReadonlySet<number> | null;
    lanes: ReadonlySet<OhMemoryContextLaneV1> | null;
  }

  function accessFor(entry: Registered): PreparedAccess {
    if (entry.revoked || revokedRefs.has(entry.refSha256)) {
      contextError("authorization", "The memory-context grant was revoked.");
    }
    const access = parseOhMemoryContextAccessV1(options.resolveAccess(entry.ref));
    if (access.historySha256 !== entry.ref.historySha256) {
      contextError("integrity", "The access record belongs to another history.");
    }
    if (access.state !== "active") {
      contextError("authorization", "The memory-context grant is not active.");
    }
    return {
      record: access,
      indices: access.indices === null ? null : new Set(access.indices),
      lanes: access.lanes === null ? null : new Set(access.lanes),
    };
  }

  function laneStore(entry: Registered, lane: OhMemoryContextLaneV1): OhStoreV1 {
    const binding = historyEntry(entry).bindings.get(lane);
    const bound = lanes.get(lane);
    if (binding === undefined || bound === undefined) {
      contextError("authorization", `The ${lane} lane is not part of this history.`);
    }
    if (bound.store.binding.bindingSha256 !== binding.bindingSha256) {
      contextError("stale", `The ${lane} store binding changed since capture.`);
    }
    return bound.store;
  }

  function permitted(access: PreparedAccess, index: number,
    leaf: OhMemoryContextLeafV1): boolean {
    return (access.indices === null || access.indices.has(index))
      && (access.lanes === null || access.lanes.has(leaf.lane));
  }

  function capturedThrough(entry: HistoryEntry, lane: OhMemoryContextLaneV1): OhHeadRefV1 {
    const head = entry.bindings.get(lane)!.head;
    return { operationSha256: head.operationSha256, sequence: head.sequence };
  }

  /** Proves every bound lane still serves the log containing its captured head. */
  async function probeLanes(entry: Registered): Promise<void> {
    for (const binding of historyEntry(entry).bindings.values()) {
      const store = laneStore(entry, binding.lane);
      try {
        await store.changesSince(
          { operationSha256: binding.head.operationSha256, sequence: binding.head.sequence },
          { limit: 1 });
      } catch (error) {
        if (error instanceof OhMemoryContextError) throw error;
        contextError("availability",
          `The ${binding.lane} lane's captured head is no longer available.`);
      }
    }
  }

  /** Re-reads one source operation from the live log and returns its stored record. */
  async function fetchLeafRecord(entry: Registered, access: PreparedAccess,
    index: number): Promise<KnowledgeGraphRecordV1 | null> {
    const { history } = historyEntry(entry);
    const leaf = history.leaves[index];
    if (leaf === undefined || !permitted(access, index, leaf)) {
      contextError("authorization", "The leaf is outside the current grant.");
    }
    const store = laneStore(entry, leaf.lane);
    let page;
    try {
      page = await store.changesSince(
        { operationSha256: leaf.parentOperationSha256, sequence: leaf.sequence - 1 },
        { limit: 1, through: capturedThrough(historyEntry(entry), leaf.lane) });
    } catch (error) {
      if (error instanceof OhMemoryContextError) throw error;
      contextError("availability", "The leaf's source operation is no longer available.");
    }
    const operation = page.operations[0];
    if (page.operations.length !== 1 || operation === undefined
      || operation.operationSha256 !== leaf.operationSha256) {
      contextError("stale", "The leaf's source operation does not match the capture.");
    }
    const change = operation.changes[leaf.changeIndex];
    if (change === undefined) contextError("integrity", "The leaf's change is missing.");
    if (change.kind !== leaf.kind) {
      contextError("integrity", "The leaf's change kind changed since capture.");
    }
    if (change.kind === "tombstone") {
      if (change.key !== leaf.key || change.priorSha256 !== leaf.recordSha256) {
        contextError("integrity", "The leaf's tombstone changed since capture.");
      }
      return null;
    }
    const record = parseKnowledgeGraphRecordV1(change.record);
    if (record === null || record.recordSha256 !== leaf.recordSha256 || record.key !== leaf.key) {
      contextError("integrity", "The leaf's record changed since capture.");
    }
    return record;
  }

  function lanesInRange(entry: HistoryEntry, start: number, end: number): OhMemoryContextLaneV1[] {
    const lanesSeen = new Set<OhMemoryContextLaneV1>();
    for (let index = start; index < end; index += 1) {
      lanesSeen.add(entry.history.leaves[index]!.lane);
    }
    return [...lanesSeen].sort();
  }

  function allPermitted(entry: Registered, access: PreparedAccess,
    start: number, end: number): boolean {
    const { history } = historyEntry(entry);
    for (let index = start; index < end; index += 1) {
      if (!permitted(access, index, history.leaves[index]!)) return false;
    }
    return true;
  }

  async function itemFor(entry: Registered, access: PreparedAccess,
    node: OhMemoryContextNodeV1, fetched: Map<number, KnowledgeGraphRecordV1 | null>,
    fetchBudget: { remaining: number }): Promise<OhMemoryContextItemV1> {
    const { history } = historyEntry(entry);
    const nodeSha256 = ohMemoryContextNodeSha256V1(node);
    const base = { end: node.end, lanes: lanesInRange(historyEntry(entry), node.start, node.end),
      nodeSha256, start: node.start };
    if (node.end - node.start === 1) {
      const index = node.start;
      const leaf = history.leaves[index]!;
      if (!permitted(access, index, leaf)) {
        return Object.freeze({ ...base, kind: "pending" as const, reason: "unpermitted" as const });
      }
      if (fetchBudget.remaining <= 0) {
        contextError("budget", "The page exceeds its original-read allowance.");
      }
      fetchBudget.remaining -= 1;
      let record = fetched.get(index);
      if (record === undefined) {
        record = await fetchLeafRecord(entry, access, index);
        fetched.set(index, record);
      }
      return Object.freeze({ kind: "leaf" as const, leaf, leafIndex: index, record });
    }
    const summary = entry.summariesByNode.get(nodeSha256);
    if (summary === undefined) {
      return Object.freeze({ ...base, kind: "pending" as const, reason: "missing-summary" as const });
    }
    if (!allPermitted(entry, access, node.start, node.end)) {
      return Object.freeze({ ...base, kind: "pending" as const, reason: "unpermitted" as const });
    }
    return Object.freeze({ ...base, kind: "summary" as const,
      childrenSha256s: summary.childrenSha256s,
      summarySha256: ohMemoryContextSummarySha256V1(summary), text: summary.body });
  }

  function encodeContinuation(payload: ContinuationPayload, key: Uint8Array): string {
    const cursorSha256 = canonicalSha256(payload);
    const signed = { ...payload, cursorSha256 };
    const envelope = { ...signed, cursorHmacSha256: createHmac("sha256", key)
      .update("oh.memory-context.continuation.v1\0", "utf8")
      .update(canonicalJson(signed), "utf8").digest().toString("hex") as Sha256Hex };
    const continuation = Buffer.from(canonicalJson(envelope), "utf8").toString("base64url");
    if (utf8ByteLength(continuation) > OH_MEMORY_CONTEXT_LIMITS_V1.continuationBytes) {
      throw new RangeError("The issued memory-context continuation exceeds its byte bound.");
    }
    return continuation;
  }

  function parseContinuation(value: unknown, entry: Registered, surface: "expand" | "overview",
    key: Uint8Array): (ContinuationPayload & { cursorSha256: Sha256Hex }) | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length < 1
      || utf8ByteLength(value) > OH_MEMORY_CONTEXT_LIMITS_V1.continuationBytes
      || !/^[A-Za-z0-9_-]+$/u.test(value)) {
      throw new OhMemoryContextContinuationError("encoding", "Invalid memory-context continuation.");
    }
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value
      || bytes.byteLength > OH_MEMORY_CONTEXT_LIMITS_V1.continuationBytes) {
      throw new OhMemoryContextContinuationError("encoding", "Invalid memory-context continuation.");
    }
    const text = bytes.toString("utf8");
    let decoded: unknown;
    try { decoded = JSON.parse(text); } catch {
      throw new OhMemoryContextContinuationError("encoding", "Invalid memory-context continuation JSON.");
    }
    if (!isPlainRecord(decoded) || !hasExactKeys(decoded, ["cursorHmacSha256", "cursorSha256",
      "expiresAtMonotonicMs", "generationSha256", "historySha256", "nextOffset", "nodeSha256",
      "refSha256", "selectionSha256", "surface", "v"]) || decoded.v !== 1
      || canonicalJson(decoded) !== text) {
      throw new OhMemoryContextContinuationError("encoding", "Invalid memory-context continuation payload.");
    }
    const cursorHmacSha256 = parseSha256Hex(decoded.cursorHmacSha256);
    const cursorSha256 = parseSha256Hex(decoded.cursorSha256);
    const generationSha256 = parseSha256Hex(decoded.generationSha256);
    const historySha256 = parseSha256Hex(decoded.historySha256);
    const refSha256 = parseSha256Hex(decoded.refSha256);
    const selectionSha256 = parseSha256Hex(decoded.selectionSha256);
    const nodeSha256 = decoded.nodeSha256 === null ? null : parseSha256Hex(decoded.nodeSha256);
    const expiresAtMonotonicMs = typeof decoded.expiresAtMonotonicMs === "number"
      && Number.isFinite(decoded.expiresAtMonotonicMs) ? decoded.expiresAtMonotonicMs : null;
    const nextOffset = positiveInt(decoded.nextOffset, OH_MEMORY_CONTEXT_LIMITS_V1.leaves, 1);
    if (cursorHmacSha256 === null || cursorSha256 === null || generationSha256 === null
      || historySha256 === null || refSha256 === null || selectionSha256 === null
      || expiresAtMonotonicMs === null || nextOffset === null
      || (decoded.nodeSha256 === null) !== (nodeSha256 === null)
      || (decoded.surface !== "expand" && decoded.surface !== "overview")) {
      throw new OhMemoryContextContinuationError("identity", "Invalid memory-context continuation identity.");
    }
    const payload: ContinuationPayload = { expiresAtMonotonicMs, generationSha256, historySha256,
      nextOffset, nodeSha256, refSha256, selectionSha256,
      surface: decoded.surface as "expand" | "overview", v: 1 };
    const signed = { ...payload, cursorSha256 };
    if (canonicalSha256(payload) !== cursorSha256) {
      throw new OhMemoryContextContinuationError("identity", "The memory-context continuation digest is invalid.");
    }
    const expectedHmac = createHmac("sha256", key)
      .update("oh.memory-context.continuation.v1\0", "utf8")
      .update(canonicalJson(signed), "utf8").digest();
    if (!timingSafeEqual(expectedHmac, Buffer.from(cursorHmacSha256, "hex"))) {
      throw new OhMemoryContextContinuationError("authentication",
        "The memory-context continuation is not an issued capability.");
    }
    if (payload.surface !== surface) {
      throw new OhMemoryContextContinuationError("identity",
        "The memory-context continuation belongs to another surface.");
    }
    if (monotonicNow() >= expiresAtMonotonicMs) {
      throw new OhMemoryContextContinuationError("expired", "The memory-context continuation has expired.");
    }
    if (refSha256 !== entry.refSha256 || historySha256 !== entry.ref.historySha256
      || generationSha256 !== ohMemoryContextGenerationSha256V1(entry.generation)) {
      throw new OhMemoryContextContinuationError("identity",
        "The memory-context continuation belongs to another view.");
    }
    return Object.freeze({ ...payload, cursorSha256 });
  }

  function nodeFor(entry: Registered, start: number, end: number): OhMemoryContextNodeV1 {
    const { history } = historyEntry(entry);
    const candidate = createOhMemoryContextNodeV1(history, start, end);
    const digest = ohMemoryContextNodeSha256V1(candidate);
    if (!entry.nodes.has(digest)) entry.nodes.set(digest, candidate);
    return candidate;
  }

  function parseRef(value: unknown): OhMemoryContextRefV1 {
    if (!isPlainRecord(value) || !hasExactKeys(value, ["historySha256", "v"]) || value.v !== 1
      || parseSha256Hex(value.historySha256) === null) {
      throw new TypeError("Invalid memory-context reference.");
    }
    return Object.freeze({ historySha256: value.historySha256 as Sha256Hex, v: 1 });
  }

  function readerFor(entry: Registered): OhMemoryContextReaderV1 {
    return Object.freeze({
      async expand(nodeSha256: unknown, expandOptions: Readonly<{
        continuation?: string | null }> = {}) {
        if (!isPlainRecord(expandOptions)
          || Reflect.ownKeys(expandOptions).some((key) => key !== "continuation")) {
          throw new TypeError("Unknown expand option.");
        }
        const access = accessFor(entry);
        const digest = parseSha256Hex(nodeSha256);
        if (digest === null) throw new TypeError("Invalid memory-context node digest.");
        const node = entry.nodes.get(digest);
        if (node === undefined) {
          contextError("integrity", "The node is not part of this captured history.");
        }
        await probeLanes(entry);
        const continuation = parseContinuation(expandOptions?.continuation, entry, "expand", key);
        if (continuation !== null && continuation.nodeSha256 !== digest) {
          throw new OhMemoryContextContinuationError("identity",
            "The continuation expands another node.");
        }
        const children = node.end - node.start === 1 ? [node] : [
          nodeFor(entry, node.start, (node.start + node.end) / 2),
          nodeFor(entry, (node.start + node.end) / 2, node.end),
        ];
        const fetched = new Map<number, KnowledgeGraphRecordV1 | null>();
        const fetchBudget = { remaining: OH_MEMORY_CONTEXT_LIMITS_V1.leafFetchesPerRead };
        const items: OhMemoryContextItemV1[] = [];
        for (const child of children) {
          items.push(await itemFor(entry, access, child, fetched, fetchBudget));
        }
        return Object.freeze({ items: Object.freeze(items), nodeSha256: digest,
          status: items.some((item) => item.kind === "pending") ? "incomplete" as const
            : "complete" as const, v: 1 });
      },
      async inspect() {
        accessFor(entry);
        await probeLanes(entry);
        const { history } = historyEntry(entry);
        const heads: Partial<Record<OhMemoryContextLaneV1, OhHeadV1>> = {};
        for (const binding of history.bindings) heads[binding.lane] = binding.head;
        return Object.freeze({
          generationSha256: ohMemoryContextGenerationSha256V1(entry.generation),
          heads, historySha256: entry.ref.historySha256, leaves: history.leaves.length, v: 1 });
      },
      async overview(overviewOptions: Readonly<{ continuation?: string | null;
        detailedIndices?: readonly number[]; limits?: OhMemoryContextReadLimitsV1;
        recentLeaves?: number }> = {}) {
        if (!isPlainRecord(overviewOptions)
          || Reflect.ownKeys(overviewOptions).some((key) => !["continuation",
            "detailedIndices", "limits", "recentLeaves"].includes(key as string))) {
          throw new TypeError("Unknown overview option.");
        }
        const access = accessFor(entry);
        await probeLanes(entry);
        const { history } = historyEntry(entry);
        const recentLeaves = overviewOptions.recentLeaves ?? entry.recentLeaves;
        if (positiveInt(recentLeaves, OH_MEMORY_CONTEXT_LIMITS_V1.leaves) === null) {
          throw new RangeError("Invalid recent-leaf count.");
        }
        const requested = overviewOptions.detailedIndices === undefined
          ? [] : overviewOptions.detailedIndices;
        if (requested.length > OH_MEMORY_CONTEXT_LIMITS_V1.detailedIndices) {
          throw new RangeError("The detailed selection exceeds its bound.");
        }
        const detailed = new Set(entry.detailedIndices);
        for (const index of requested) {
          if (positiveInt(index, history.leaves.length - 1) === null) {
            throw new RangeError("A detailed leaf index is outside the capture.");
          }
          detailed.add(index);
        }
        if (detailed.size > OH_MEMORY_CONTEXT_LIMITS_V1.detailedIndices) {
          throw new RangeError("The combined detailed selection exceeds its bound.");
        }
        const requestedLimits = overviewOptions.limits;
        if (requestedLimits !== undefined && !isPlainRecord(requestedLimits)) {
          throw new TypeError("Invalid read limits.");
        }
        const maxItems = requestedLimits?.maxItems === undefined
          ? OH_MEMORY_CONTEXT_LIMITS_V1.pageItems
          : positiveInt(requestedLimits.maxItems, OH_MEMORY_CONTEXT_LIMITS_V1.pageItems, 1);
        const maxBytes = requestedLimits?.maxBytes === undefined
          ? OH_MEMORY_CONTEXT_LIMITS_V1.pageBytes
          : positiveInt(requestedLimits.maxBytes, OH_MEMORY_CONTEXT_LIMITS_V1.pageBytes, 1);
        if (maxItems === null || maxBytes === null) {
          throw new RangeError("Read limits exceed the memory-context bounds.");
        }
        const selectionSha256 = canonicalSha256({ detailed: [...detailed].sort((a, b) => a - b),
          maxBytes, maxItems, recentLeaves });
        const continuation = parseContinuation(overviewOptions.continuation, entry, "overview", key);
        if (continuation !== null && continuation.selectionSha256 !== selectionSha256) {
          throw new OhMemoryContextContinuationError("identity",
            "The continuation selects a different overview.");
        }
        const cover = ohMemoryContextCoverV1(history.leaves.length, recentLeaves, [...detailed]);
        const startIndex = continuation?.nextOffset ?? 0;
        const startRange = cover.findIndex((range) => range.start >= startIndex);
        if (startIndex !== 0 && startIndex !== history.leaves.length
          && (startRange < 0 || cover[startRange]!.start !== startIndex)) {
          throw new OhMemoryContextContinuationError("identity",
            "The continuation offset does not align to a range.");
        }
        const fetched = new Map<number, KnowledgeGraphRecordV1 | null>();
        const fetchBudget = { remaining: OH_MEMORY_CONTEXT_LIMITS_V1.leafFetchesPerRead };
        const items: OhMemoryContextItemV1[] = [];
        let bytes = 0;
        let end = startIndex;
        for (let index = startRange < 0 ? cover.length : startRange; index < cover.length; index += 1) {
          if (items.length >= maxItems) break;
          const range = cover[index]!;
          const item = await itemFor(entry, access,
            nodeFor(entry, range.start, range.end), fetched, fetchBudget);
          bytes += utf8ByteLength(canonicalJson(item));
          if (bytes > maxBytes && items.length > 0) break;
          items.push(item);
          end = range.end;
        }
        const complete = end >= history.leaves.length;
        const generationSha256 = ohMemoryContextGenerationSha256V1(entry.generation);
        const continuationOut = complete ? null : encodeContinuation({
          expiresAtMonotonicMs: monotonicNow() + lifetime,
          generationSha256, historySha256: entry.ref.historySha256, nextOffset: end,
          nodeSha256: null, refSha256: entry.refSha256, selectionSha256,
          surface: "overview", v: 1 }, key);
        return Object.freeze({
          binding: Object.freeze({ generationSha256, historySha256: entry.ref.historySha256,
            selectionSha256 }),
          continuation: continuationOut, end, items: Object.freeze(items), start: startIndex,
          status: complete ? "complete" as const : "partial" as const, v: 1 });
      },
      async read(leafIndex: unknown) {
        const access = accessFor(entry);
        const { history } = historyEntry(entry);
        const index = positiveInt(leafIndex, OH_MEMORY_CONTEXT_LIMITS_V1.leaves - 1);
        if (index === null || index >= history.leaves.length) {
          throw new RangeError("The leaf index is outside the capture.");
        }
        const record = await fetchLeafRecord(entry, access, index);
        return Object.freeze({ leaf: history.leaves[index]!, leafIndex: index, record, v: 1 });
      },
      async search(searchOptions: unknown) {
        const access = accessFor(entry);
        const { history } = historyEntry(entry);
        if (!isPlainRecord(searchOptions)
          || Reflect.ownKeys(searchOptions).some((key) => !["flags", "pattern"].includes(key as string))
          || !Object.hasOwn(searchOptions, "pattern")) {
          throw new TypeError("A memory-context search requires a pattern and optional flags only.");
        }
        const raw = searchOptions as { flags?: unknown; pattern: unknown };
        if (typeof raw.pattern !== "string" || raw.pattern.length === 0
          || utf8ByteLength(raw.pattern) > OH_MEMORY_CONTEXT_LIMITS_V1.searchPatternBytes) {
          throw new RangeError("The search pattern exceeds its byte bound.");
        }
        if (raw.flags !== undefined
          && (typeof raw.flags !== "string" || !/^[imsuvy]*$/u.test(raw.flags))) {
          throw new TypeError("Invalid search flags.");
        }
        const flags = raw.flags === undefined ? "" : raw.flags;
        let pattern: RegExp;
        try { pattern = new RegExp(raw.pattern, flags.includes("g") ? flags : `g${flags}`); }
        catch { throw new TypeError("Invalid search pattern."); }
        const matches: OhMemoryContextSearchMatchV1[] = [];
        let scannedBytes = 0;
        let denied = 0;
        let complete = true;
        for (const [index, leaf] of history.leaves.entries()) {
          if (!permitted(access, index, leaf)) { denied += 1; continue; }
          if (leaf.kind !== "put") continue;
          const store = laneStore(entry, leaf.lane);
          let operation;
          try {
            const page = await store.changesSince(
              { operationSha256: leaf.parentOperationSha256, sequence: leaf.sequence - 1 },
              { limit: 1, through: capturedThrough(historyEntry(entry), leaf.lane) });
            operation = page.operations[0];
          } catch {
            contextError("availability", "A leaf's source operation is no longer available.");
          }
          if (operation === undefined || operation.operationSha256 !== leaf.operationSha256) {
            contextError("stale", "A leaf's source operation does not match the capture.");
          }
          const change = operation.changes[leaf.changeIndex];
          if (change === undefined || change.kind !== "put") {
            contextError("integrity", "A leaf's source change is missing.");
          }
          const record = parseKnowledgeGraphRecordV1(change.record);
          if (record === null || record.recordSha256 !== leaf.recordSha256) {
            contextError("integrity", "A leaf's record changed since capture.");
          }
          const text = canonicalJson(record);
          scannedBytes += utf8ByteLength(text);
          if (scannedBytes > OH_MEMORY_CONTEXT_LIMITS_V1.scannedBytes) {
            complete = false;
            break;
          }
          for (const match of text.matchAll(pattern)) {
            matches.push(Object.freeze({ end: match.index + match[0].length,
              key: leaf.key, lane: leaf.lane, leafIndex: index,
              recordSha256: leaf.recordSha256, start: match.index }));
            if (matches.length >= OH_MEMORY_CONTEXT_LIMITS_V1.searchMatches) {
              complete = false;
              break;
            }
          }
          if (!complete) break;
        }
        return Object.freeze({ complete, denied, matches: Object.freeze(matches),
          scannedBytes, v: 1 });
      },
    });
  }

  return Object.freeze({
    async admit(historyValue: unknown, admitOptions: Readonly<{ derivatives?: unknown;
      detailedIndices?: readonly number[]; recentLeaves?: number }> = {}) {
      if (!isPlainRecord(admitOptions)
        || Reflect.ownKeys(admitOptions).some((key) => !["derivatives",
          "detailedIndices", "recentLeaves"].includes(key as string))) {
        throw new TypeError("Unknown admit option.");
      }
      const history = parseOhMemoryContextHistoryV1(historyValue);
      for (const binding of history.bindings) {
        const bound = lanes.get(binding.lane);
        if (bound === undefined) {
          contextError("authorization", `The ${binding.lane} lane is not admitted on this host.`);
        }
        if (bound.store.binding.bindingSha256 !== binding.bindingSha256) {
          contextError("stale", `The ${binding.lane} store binding changed since capture.`);
        }
        try {
          await bound.store.changesSince(
            { operationSha256: binding.head.operationSha256, sequence: binding.head.sequence },
            { limit: 1 });
        } catch (error) {
          if (error instanceof OhMemoryContextError) throw error;
          contextError("stale", `The captured ${binding.lane} head is not in this store's history.`);
        }
      }
      const recentLeaves = admitOptions.recentLeaves ?? 8;
      if (positiveInt(recentLeaves, OH_MEMORY_CONTEXT_LIMITS_V1.leaves) === null) {
        throw new RangeError("Invalid recent-leaf count.");
      }
      const detailed = admitOptions.detailedIndices === undefined ? [] : admitOptions.detailedIndices;
      if (detailed.length > OH_MEMORY_CONTEXT_LIMITS_V1.detailedIndices
        || detailed.some((index) => positiveInt(index, history.leaves.length - 1) === null)
        || new Set(detailed).size !== detailed.length
        || !orderedUnique([...detailed], (index) => String(index).padStart(16, "0"))) {
        throw new RangeError("Invalid detailed leaf selection.");
      }
      const ref: OhMemoryContextRefV1 = Object.freeze({
        historySha256: ohMemoryContextHistorySha256V1(history), v: 1 });
      const refSha256 = ohMemoryContextRefSha256V1(ref);
      const resolverAccess = parseOhMemoryContextAccessV1(options.resolveAccess(ref));
      if (resolverAccess.historySha256 !== ref.historySha256) {
        contextError("integrity", "The access resolver returned another history's grant.");
      }
      if (resolverAccess.state !== "active") {
        contextError("authorization", "The memory-context grant is not active.");
      }
      const existing = registered.get(refSha256);
      if (existing !== undefined && !existing.revoked) return existing.ref;
      if (revokedRefs.has(refSha256)) {
        contextError("authorization", "The memory-context grant was revoked.");
      }
      const nodes = new Map<Sha256Hex, OhMemoryContextNodeV1>();
      for (let length = 1; length <= OH_MEMORY_CONTEXT_LIMITS_V1.leaves; length *= 2) {
        for (let start = 0; start + length <= history.leaves.length; start += length) {
          const node = createOhMemoryContextNodeV1(history, start, start + length);
          nodes.set(ohMemoryContextNodeSha256V1(node), node);
        }
      }
      histories.set(ref.historySha256, {
        bindings: new Map(history.bindings.map((binding) => [binding.lane, binding])),
        history });
      const summaries = new Map<Sha256Hex, OhMemoryContextSummaryV1>();
      const summariesByNode = new Map<Sha256Hex, OhMemoryContextSummaryV1>();
      let generation = emptyGeneration(ref.historySha256);
      if (admitOptions.derivatives !== undefined) {
        const pool = parseOhMemoryContextPoolV1(history, admitOptions.derivatives);
        if (pool.generation.generation !== 0) {
          contextError("integrity", "Admission requires derivative generation 0.");
        }
        generation = pool.generation;
        for (const node of pool.nodes) nodes.set(ohMemoryContextNodeSha256V1(node), node);
        for (const summary of pool.summaries) {
          summaries.set(ohMemoryContextSummarySha256V1(summary), summary);
        }
        for (const entryItem of generation.summaries) {
          summariesByNode.set(entryItem.nodeSha256, summaries.get(entryItem.summarySha256)!);
        }
      }
      registered.set(refSha256, {
        detailedIndices: Object.freeze([...detailed]), generation, nodes, recentLeaves,
        ref, refSha256, revoked: false, summaries, summariesByNode });
      return ref;
    },
    bind(refValue: unknown) {
      const ref = parseRef(refValue);
      const entry = registered.get(ohMemoryContextRefSha256V1(ref));
      if (entry === undefined) {
        contextError("authorization", "The memory-context reference was never admitted.");
      }
      return readerFor(entry);
    },
    async publishDerivatives(refValue: unknown, poolValue: unknown, expected: unknown) {
      const ref = parseRef(refValue);
      const entry = registered.get(ohMemoryContextRefSha256V1(ref));
      if (entry === undefined) {
        contextError("authorization", "The memory-context reference was never admitted.");
      }
      accessFor(entry);
      const { history } = historyEntry(entry);
      const pool = parseOhMemoryContextPoolV1(history, poolValue);
      const expectedSha256 = parseSha256Hex(expected);
      if (expectedSha256 === null) throw new TypeError("Invalid expected generation digest.");
      const currentSha256 = ohMemoryContextGenerationSha256V1(entry.generation);
      const candidateSha256 = ohMemoryContextGenerationSha256V1(pool.generation);
      if (candidateSha256 === currentSha256) return currentSha256;
      if (expectedSha256 !== currentSha256) {
        contextError("stale", "The expected derivative generation does not match the current one.");
      }
      if (pool.generation.generation !== entry.generation.generation + 1) {
        contextError("stale", "A derivative generation must advance the counter by exactly one.");
      }
      for (const node of pool.nodes) entry.nodes.set(ohMemoryContextNodeSha256V1(node), node);
      for (const summary of pool.summaries) {
        entry.summaries.set(ohMemoryContextSummarySha256V1(summary), summary);
      }
      // Only the new generation's membership decides what an overview shows.
      entry.summariesByNode = new Map(pool.generation.summaries.map((entryItem) =>
        [entryItem.nodeSha256, entry.summaries.get(entryItem.summarySha256)!]));
      entry.generation = pool.generation;
      return candidateSha256;
    },
    revoke(refValue: unknown) {
      const ref = parseRef(refValue);
      const refSha256 = ohMemoryContextRefSha256V1(ref);
      revokedRefs.add(refSha256);
      const entry = registered.get(refSha256);
      if (entry !== undefined) entry.revoked = true;
    },
  });
}
