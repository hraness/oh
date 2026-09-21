/**
 * Deductive memory steel thread (benchmark-scoped).
 *
 * Composes the five benchmark primitives into one auditable pipeline:
 *
 *   records --projectFacts--> algal.memory.v1 snapshot --query--> algal.query-result.v1
 *     (proof-carrying derivations; verify() replays canonical equality)
 *   snapshot --auditConsistency--> conflict/stale derivations (consistency-rules pack)
 *   scores --calibrate--> probabilities --conformal--> coverage-bounded set
 *     --submodular--> byte-budgeted channel with a marginal-gain receipt
 *
 * Every emitted artifact is digest-stamped so a downstream audit can replay the
 * exact inputs. This module is a benchmark seam: it changes no production
 * retrieval, store, or wire contract.
 */
import {
  canonicalSha256,
  isPlainRecord,
  utf8ByteLength,
  type JsonValue,
  type Sha256Hex,
} from "../../src/canonical";
import {
  query as datalogQuery,
  verify as datalogVerify,
  type Fact,
  type QueryResult,
  type Snapshot,
} from "./memory-datalog";
import {
  buildQuery,
  validateMemoryFact,
} from "./consistency-rules";
import {
  fitIsotonic,
  predictIsotonic,
  type CalibrationSample,
  type IsotonicModel,
} from "./jev-calibration";
import {
  conformalSelect,
  conformalThreshold,
  type ConformalSelectionArtifact,
  type ConformalThresholdArtifact,
} from "./conformal-selection";
import {
  selectBudgeted,
  type Item,
  type Selection,
} from "./submodular-selection";

export const DEDUCTIVE_MEMORY_PROTOCOL = "oh.benchmark.deductive-memory.v1" as const;
export const DEDUCTIVE_MEMORY_LIMITS = Object.freeze({
  maximumRecords: 2_048,
  maximumRecordBytes: 65_536,
  maximumContentBytes: 8_192,
  maximumAliases: 16,
  maximumMentions: 64,
});

function fail(message: string): never {
  throw new TypeError(`deductive memory: ${message}`);
}

/** Content-addressed record identity in the `sha256:<hex>` digest format the
 * memory contract requires for fact sources. */
export const memoryRecordDigest = (record: JsonValue): string =>
  `sha256:${canonicalSha256(record)}`;

/**
 * Canonical benchmark record. `kind` selects which fact relations the record
 * emits; `content` is opaque text carried for evidence only (never joined).
 * `digest` is recomputed over the record itself — callers cannot inject a
 * foreign source identity.
 */
export interface MemoryRecord {
  readonly kind: "state" | "alias" | "supersede" | "contradiction" | "mention";
  readonly entity?: string;
  readonly attr?: string;
  readonly value?: JsonValue;
  readonly alias?: string;
  readonly canonical?: string;
  readonly target?: string;
  readonly validFrom?: string;
  readonly mentions?: readonly string[];
  readonly content?: string;
}

/**
 * Project records into an `algal.memory.v1` snapshot. Every emitted fact's
 * `sources` is the digest of the exact record that produced it, so a derived
 * answer's proof DAG terminates in the records themselves.
 */
export function projectRecords(input: unknown): Snapshot {
  if (!Array.isArray(input)) fail("records must be an array");
  if (input.length > DEDUCTIVE_MEMORY_LIMITS.maximumRecords)
    fail(`records must be at most ${DEDUCTIVE_MEMORY_LIMITS.maximumRecords}`);
  const facts: Fact[] = [];
  for (const raw of input) {
    if (!isPlainRecord(raw)) fail("record must be a plain object");
    if (utf8ByteLength(JSON.stringify(raw)) > DEDUCTIVE_MEMORY_LIMITS.maximumRecordBytes)
      fail("record exceeds 64KiB bound");
    const record = raw as unknown as MemoryRecord;
    if (typeof record.kind !== "string") fail("record.kind required");
    const source = memoryRecordDigest(record as unknown as JsonValue);
    const push = (relation: string, tuple: JsonValue[]) => {
      const fact = { relation, tuple, sources: [source] };
      validateMemoryFact(fact);
      facts.push(fact);
    };
    switch (record.kind) {
      case "state": {
        const { entity, attr, value } = record;
        if (typeof entity !== "string") fail("state record needs entity");
        if (typeof attr !== "string") fail("state record needs attr");
        push("entity", [entity]);
        push("states", [entity, attr, (value as JsonValue) ?? null]);
        push("asserts", [source, entity, attr, (value as JsonValue) ?? null]);
        if (record.validFrom !== undefined) {
          if (typeof record.validFrom !== "string") fail("validFrom must be an instant string");
          push("states-at", [entity, attr, (value as JsonValue) ?? null, record.validFrom]);
        }
        for (const m of record.mentions ?? []) {
          if (typeof m !== "string") fail("mention must be a string");
          push("mentions", [source, m]);
        }
        break;
      }
      case "alias": {
        if (typeof record.alias !== "string") fail("alias record needs alias");
        if (typeof record.canonical !== "string") fail("alias record needs canonical");
        push("alias", [record.canonical, record.alias]);
        push("entity", [record.canonical]);
        break;
      }
      case "supersede": {
        if (typeof record.target !== "string") fail("supersede record needs target digest");
        push("supersedes", [source, record.target]);
        break;
      }
      case "contradiction": {
        if (typeof record.target !== "string") fail("contradiction record needs target digest");
        push("contradicts", [source, record.target]);
        push("contradicts", [record.target, source]);
        break;
      }
      case "mention": {
        if (typeof record.entity !== "string") fail("mention record needs entity");
        push("mentions", [source, record.entity]);
        push("entity", [record.entity]);
        break;
      }
      default:
        fail(`unknown record kind ${String(record.kind)}`);
    }
    if (record.content !== undefined) {
      if (typeof record.content !== "string" ||
          utf8ByteLength(record.content) > DEDUCTIVE_MEMORY_LIMITS.maximumContentBytes)
        fail("content bound");
    }
  }
  return { contract: "algal.memory.v1", facts };
}

/**
 * Run a named rule pack + query literal against a snapshot, then replay-verify
 * the result. Returns the verified `algal.query-result.v1` (proof DAG intact).
 */
export function queryMemory(
  snapshot: unknown,
  packName: string,
  queryLiteral: unknown,
): QueryResult & { verified: true } {
  const program = buildQuery(packName, queryLiteral);
  const result = datalogQuery(snapshot, program);
  if (!datalogVerify(snapshot, program, result))
    fail("query result failed replay verification");
  return { ...result, verified: true as const };
}

/**
 * Consistency audit over a projected snapshot: conflict pairs, conflicted
 * entities, and stale/superseded facts — each row carrying its proof digest.
 */
export function auditConsistency(snapshot: unknown): {
  readonly conflicts: readonly { pair: readonly JsonValue[]; proof: string }[];
  readonly stale: readonly { fact: JsonValue; proof: string }[];
  readonly auditSha256: Sha256Hex;
} {
  const conflicts = queryMemory(snapshot, "consistency-audit", {
    relation: "conflict-pair",
    terms: [{ var: "a" }, { var: "b" }],
  });
  const staleRows = queryMemory(snapshot, "supersession", {
    relation: "stale",
    terms: [{ var: "f" }],
  });
  const audit = {
    conflicts: conflicts.rows.map(r => ({ pair: r.tuple, proof: r.proof })),
    stale: staleRows.rows.map(r => ({ fact: r.tuple[0]!, proof: r.proof })),
  };
  return { ...audit, auditSha256: canonicalSha256({ protocol: DEDUCTIVE_MEMORY_PROTOCOL, ...audit }) };
}

export interface ChannelCandidate {
  readonly id: string;
  readonly score: number;
  readonly bytes: number;
  readonly features?: readonly string[];
}

/**
 * Calibrate → conformal → submodular channel selection. `samples` (held-out
 * labeled data) fit an isotonic calibrator AND fix the conformal threshold;
 * candidates are calibrated, coverage-filtered, then packed under the byte
 * budget by density-greedy submodular selection. The receipt binds all three
 * stage digests so the channel's provenance replays end-to-end.
 */
export function selectInstructionChannel(input: Readonly<{
  candidates: readonly ChannelCandidate[];
  samples: readonly CalibrationSample[];
  alpha?: number;
  budgetBytes: number;
  diversityWeight?: number;
}>): {
  readonly calibration: IsotonicModel;
  readonly conformal: ConformalThresholdArtifact;
  readonly coverageSet: ConformalSelectionArtifact;
  readonly channel: Selection;
  readonly receipt: Readonly<{ protocol: typeof DEDUCTIVE_MEMORY_PROTOCOL; receiptSha256: Sha256Hex }>;
} {
  if (!isPlainRecord(input)) fail("input must be a plain object");
  const alpha = input.alpha ?? 0.1;
  const calibration = fitIsotonic(input.samples);
  const threshold = conformalThreshold(input.samples, alpha);
  const calibrated = input.candidates.map(c => ({
    id: c.id,
    score: predictIsotonic(calibration, c.score),
    bytes: c.bytes,
    features: c.features,
  }));
  const coverageSet = conformalSelect({
    candidates: calibrated.map(({ id, score }) => ({ id, score })),
    threshold,
  });
  const eligible = new Set(coverageSet.selected);
  const items: Item[] = calibrated
    .filter(c => eligible.has(c.id))
    .map(c => (c.features === undefined
      ? { id: c.id, bytes: c.bytes, weight: c.score }
      : { id: c.id, bytes: c.bytes, weight: c.score, features: c.features }));
  const channel = input.diversityWeight === undefined
    ? selectBudgeted({ items, budgetBytes: input.budgetBytes })
    : selectBudgeted({ items, budgetBytes: input.budgetBytes, diversityWeight: input.diversityWeight });
  const receiptPayload = {
    protocol: DEDUCTIVE_MEMORY_PROTOCOL,
    calibrationSha256: calibration.modelSha256,
    conformalSha256: threshold.calibrationSha256,
    coverageSha256: coverageSet.selectionSha256,
    channelSha256: channel.selectionSha256,
    alpha,
  };
  return {
    calibration,
    conformal: threshold,
    coverageSet,
    channel,
    receipt: { protocol: DEDUCTIVE_MEMORY_PROTOCOL, receiptSha256: canonicalSha256(receiptPayload) },
  };
}
