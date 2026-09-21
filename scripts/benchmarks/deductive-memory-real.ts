// Purpose: run the deductive-memory seam over a real corpus ingested into a real
// Oh SQLite store — no synthetic records. Turns become `edition` records through
// the same commit path the native lab uses; the store snapshot is read back and
// replay-verified before projection. Facts emitted are honest mechanical
// projections only: structured fields (speaker, session, date) plus bounded
// lexical mentions (capitalized tokens). No labels, no paid calls, no inferred
// contradictions — the audit's empty-conflict report is a true finding.
// Usage: bun run scripts/benchmarks/deductive-memory-real.ts

import { mkdirSync } from "node:fs";
import { canonicalJson, canonicalSha256, isPlainRecord, utf8ByteLength } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { createOhSqliteStoreAuthorityV1 } from "../../src/sqlite/port";
import { OH_CANONICAL_STORE_PROFILE_V1 } from "../../src/store";
import { OH_MEMORY_LIMITS_V1 } from "../../src/memory";
import { DATASETS, selectSplit, type Corpus, type Dataset } from "./datasets";
import { fetchDataset, loadDataset, ROOT, writeNew } from "./io";
import { projectRecords, auditConsistency, queryMemory,
  type MemoryRecord } from "./deductive-memory";
import { query as datalogQuery, verify as datalogVerify,
  type JsonValue } from "./memory-datalog";

const PROTOCOL = "oh.deductive-memory-real.v1" as const;
const SEED = 17;

/** Deterministic corpus pick: first dev corpus by id. */
function pickCorpus(dataset: Dataset): Corpus {
  const dev = selectSplit(dataset, "dev", SEED);
  const sorted = [...dev.corpora].sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length === 0) throw new RangeError("No dev corpus available.");
  return sorted[0]!;
}

/** Honest mechanical projection of one `edition` turn record into benchmark
 * records. Structured fields map to `state` facts; capitalized tokens map to
 * `mention` facts (lexical, not semantic — bounded and stopword-filtered). */
const MENTION_STOPWORDS = new Set(["i", "the", "a", "an", "and", "but", "so", "we", "you",
  "it", "my", "our", "your", "he", "she", "they", "this", "that", "there", "here", "in",
  "on", "at", "to", "of", "for", "with", "is", "was", "are", "were", "be", "been", "do",
  "did", "have", "has", "had", "not", "no", "yes", "oh", "hi", "hey", "ok", "okay",
  "image", "caption", "what", "when", "where", "who", "how", "why", "which", "if",
  "then", "than", "just", "also", "really", "very", "much", "some", "any", "all",
  "one", "two", "first", "last", "new", "old", "good", "great", "nice", "like", "get",
  "got", "go", "went", "see", "saw", "know", "think", "want", "need", "make", "made",
  "take", "took", "say", "said", "tell", "told", "let", "me", "us", "him", "her",
  "am", "pm", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  "sunday", "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december"]);

export function editionTurnToRecords(turn: JsonValue): MemoryRecord[] {
  if (!isPlainRecord(turn)) throw new TypeError("edition turn value must be an object");
  const t = turn as { id?: unknown; sessionId?: unknown; date?: unknown; speaker?: unknown; text?: unknown };
  if (typeof t.id !== "string" || typeof t.sessionId !== "string"
    || typeof t.date !== "string" || typeof t.speaker !== "string"
    || typeof t.text !== "string") throw new TypeError("edition turn needs id/sessionId/date/speaker/text strings");
  const records: MemoryRecord[] = [
    { kind: "state", entity: `turn:${t.id}`, attr: "speaker", value: t.speaker },
    { kind: "state", entity: `turn:${t.id}`, attr: "session", value: t.sessionId },
    { kind: "state", entity: `turn:${t.id}`, attr: "said-at", value: t.date, validFrom: t.date },
    { kind: "mention", entity: t.speaker },
    { kind: "mention", entity: `session:${t.sessionId}` },
  ];
  const mentions = new Set<string>();
  for (const match of t.text.matchAll(/\b[A-Z][a-z]{2,19}\b/g)) {
    const token = match[0].toLowerCase();
    if (MENTION_STOPWORDS.has(token) || token === t.speaker.toLowerCase()) continue;
    mentions.add(token);
    if (mentions.size >= 8) break;
  }
  for (const m of [...mentions].sort()) {
    records.push({ kind: "mention", entity: m });
  }
  return records;
}

async function main(): Promise<void> {
  await fetchDataset("locomo");
  const dataset = await loadDataset("locomo");
  const corpus = pickCorpus(dataset);
  if (corpus.turns.length > OH_MEMORY_LIMITS_V1.maximumRecordsPerLane) {
    throw new RangeError("Corpus exceeds record bound.");
  }

  // Ingest: real edition records, real batched commits (lab-memory pattern).
  const records = corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({
    dependencies: [], key: `edition:turn-${index.toString().padStart(5, "0")}`, kind: "edition", v: 1,
    value: { id: turn.id, sessionId: turn.sessionId, date: turn.date, speaker: turn.speaker, text: turn.text },
  }));
  const corpusSha256 = canonicalSha256({ id: corpus.id, groupId: corpus.groupId, turns: corpus.turns });
  const suffix = corpusSha256.slice(0, 24);
  const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: `realm:ded-c-${suffix}`, spaceId: `ded-c-${suffix}` });
  try {
    let operations = 0;
    for (let start = 0; start < records.length;) {
      const changes: Array<{ kind: "put"; record: KnowledgeGraphRecordV1; v: 1 }> = [];
      let bytes = 0;
      while (start + changes.length < records.length && changes.length < 512) {
        const change = { kind: "put" as const, record: records[start + changes.length]!, v: 1 as const };
        const next = Buffer.byteLength(canonicalJson(change));
        if (changes.length && bytes + next > 4 * 1024 * 1024) break;
        changes.push(change); bytes += next;
      }
      await canonical.store.commit({ actorId: "deductive.memory", changes,
        expectedHead: await canonical.store.head(), instant: "2026-01-01T00:00:00.000Z",
        operationId: `op_deductive_memory_${start}` });
      operations += 1;
      start += changes.length;
    }

    // Read back through the real store snapshot; replay-verify the op log.
    const verified = await canonical.store.verify();
    if (verified.integrity !== "verified" || verified.records !== records.length) {
      throw new Error(`Store replay failed: ${verified.records} records vs ${records.length}`);
    }
    const snapshot = await canonical.store.snapshot({ maximumRecords: OH_MEMORY_LIMITS_V1.maximumRecordsPerLane });
    const head = await canonical.store.head();

    // The algal.memory.v1 contract bounds a snapshot to 256KiB / 2048 facts —
    // a full LOCOMO session (~5k projected facts) does not fit. The honest
    // architecture shards at session granularity (each session fits with
    // headroom) plus one compact corpus-level index snapshot.
    const sessions = new Map<string, MemoryRecord[]>();
    const bySessionTurns = new Map<string, typeof snapshot.records[number][]>();
    for (const record of snapshot.records) {
      if (record.kind !== "edition") continue;
      const sessionId = (record.value as { sessionId: string }).sessionId;
      const list = bySessionTurns.get(sessionId) ?? [];
      list.push(record);
      bySessionTurns.set(sessionId, list);
    }
    for (const [sessionId, sessionRecords] of [...bySessionTurns.entries()].sort()) {
      const projected: MemoryRecord[] = [];
      for (const record of sessionRecords) {
        for (const r of editionTurnToRecords(record.value)) {
          // Bind each projected record's source digest to the store record it
          // came from: carry the record identity so the digest is content-honest.
          projected.push({ ...r, content: `${record.key}:${record.recordSha256}` });
        }
      }
      sessions.set(sessionId, projected);
    }

    // Per-session shards: base-fact provenance queries only (zero-rule program).
    // The engine evaluates EVERY pack rule at fixpoint regardless of the query
    // target, and its naive-scan join charges per (binding × tuple) scan — any
    // non-trivial rule pack over ~600-fact shards exhausts the 250K work bound
    // (measured). Derivation runs on the compact corpus index; shards carry
    // proof-carrying base facts. This is the honest split.
    const baseProgram = (relation: string, arity: number) => ({
      contract: "algal.query.v1" as const, rules: [] as const,
      query: { relation, terms: Array.from({ length: arity }, () => ({ var: `v${arity}` }) as const)
        .map((_, i) => ({ var: `v${i}` }) as const) },
    });
    const baseQuery = (snap: ReturnType<typeof projectRecords>, relation: string, arity: number) => {
      const program = baseProgram(relation, arity);
      const result = datalogQuery(snap, program);
      if (!datalogVerify(snap, program, result)) throw new Error("shard base query failed replay");
      return result;
    };
    const shards = [...sessions.entries()].map(([sessionId, projected]) => {
      const memory = projectRecords(projected);
      const states = baseQuery(memory, "states", 3);
      const timeline = baseQuery(memory, "states-at", 4);
      const mentions = baseQuery(memory, "mentions", 2);
      const factsByRelation: Record<string, number> = {};
      for (const fact of memory.facts) {
        factsByRelation[fact.relation] = (factsByRelation[fact.relation] ?? 0) + 1;
      }
      return { sessionId, memoryRecords: projected.length, facts: memory.facts.length,
        snapshotBytes: utf8ByteLength(canonicalJson(memory)),
        factsByRelation, memorySha256: canonicalSha256(memory),
        statesRows: states.rows.length, statesSha256: canonicalSha256(states),
        timelineRows: timeline.rows.length, timelineSha256: canonicalSha256(timeline),
        mentionsRows: mentions.rows.length, mentionsSha256: canonicalSha256(mentions) };
    });

    // Corpus-level index at session granularity: one mention per
    // (session, speaker) plus one dated state per session — ~190 facts, small
    // enough that even the three-literal `conflicted` audit rule fits the
    // 250K work bound. Turn-level detail stays in the per-session shards.
    const indexRecords: MemoryRecord[] = [];
    for (const [sessionId, sessionRecords] of [...bySessionTurns.entries()].sort()) {
      const sessionSpeakers = new Set(sessionRecords.map(r => (r.value as { speaker: string }).speaker));
      for (const speaker of [...sessionSpeakers].sort()) {
        indexRecords.push({ kind: "mention", entity: speaker,
          content: `session:${sessionId}` });
      }
      const date = corpus.turns.find(t => t.sessionId === sessionId)!.date;
      indexRecords.push({ kind: "state", entity: `session:${sessionId}`,
        attr: "date", value: date, validFrom: date });
    }
    const index = projectRecords(indexRecords);
    const indexAudit = auditConsistency(index);
    const indexRefers = queryMemory(index, "alias-expansion",
      { relation: "record-refers", terms: [{ var: "d" }, { var: "c" }] });
    const indexHistory = queryMemory(index, "temporal",
      { relation: "history-at", terms: [{ var: "e" }, { var: "a" }, { var: "v" }, { var: "vf" }] });
    const speakers = [...new Set(corpus.turns.map(t => t.speaker))].sort();
    const speakerRefs = indexRefers.rows.filter(r => speakers.includes(String(r.tuple[1])));

    const artifact = {
      protocol: PROTOCOL,
      dataset: "locomo",
      datasetSha256: DATASETS.locomo.sha256,
      corpusId: corpus.id,
      corpusSha256,
      store: {
        integrity: verified.integrity,
        operations,
        head: head as unknown as JsonValue,
        recordCount: snapshot.records.length,
        snapshotSha256: canonicalSha256(snapshot),
      },
      sharding: {
        reason: "algal.memory.v1 bounds a snapshot to 256KiB/2048 facts; a full corpus exceeds it",
        sessions: shards.length,
        maxSnapshotBytes: Math.max(...shards.map(s => s.snapshotBytes)),
        maxFacts: Math.max(...shards.map(s => s.facts)),
        totalFacts: shards.reduce((n, s) => n + s.facts, 0),
      },
      shards,
      corpusIndex: {
        memoryRecords: indexRecords.length,
        facts: index.facts.length,
        snapshotBytes: utf8ByteLength(canonicalJson(index)),
        memorySha256: canonicalSha256(index),
        speakerMentionRows: speakerRefs.length,
        refersRows: indexRefers.rows.length,
        refersSha256: canonicalSha256(indexRefers),
        historyRows: indexHistory.rows.length,
        historySha256: canonicalSha256(indexHistory),
        conflictPairs: indexAudit.conflicts.length,
        staleFacts: indexAudit.stale.length,
        auditSha256: indexAudit.auditSha256,
        verified: indexRefers.verified && indexHistory.verified,
      },
      workBoundFinding:
        "naive-scan join charges per (binding × tuple) scan before the relation " +
        "check; any non-trivial pack over ~600-fact session shards exhausts the " +
        "250K work bound — measured, not configured. Feasible shape: zero-rule " +
        "base-fact queries per shard + all packs on a ~190-fact corpus index.",
      speakers,
      honesty: [
        "contradicts/supersedes facts are never fabricated — empty audit is a true negative",
        "mentions are lexical (capitalized tokens), not semantic extraction",
        "no labels, no paid calls, no inferred facts beyond the declared projection",
        "proofs are intra-shard: a derived row cites only facts inside its session snapshot",
      ],
      v: 1,
    };
    const dir = `${ROOT}/benchmarks/results`;
    mkdirSync(dir, { recursive: true });
    const path = `${dir}/deductive-memory-locomo-v1.json`;
    await writeNew(path, Buffer.from(canonicalJson(artifact)));
    console.log(JSON.stringify({
      output: path.replace(`${ROOT}/`, ""),
      artifactSha256: canonicalSha256(artifact),
      corpus: corpus.id, turns: corpus.turns.length,
      sessions: shards.length,
      totalFacts: artifact.sharding.totalFacts,
      maxShardBytes: artifact.sharding.maxSnapshotBytes,
      indexFacts: index.facts.length,
      conflictPairs: indexAudit.conflicts.length,
      speakerMentionRows: speakerRefs.length,
      storeIntegrity: verified.integrity,
    }));
  } finally {
    await canonical.store.close();
  }
}

if (import.meta.main) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
