import { Database } from "bun:sqlite";
import { canonicalJson, canonicalSha256, type Sha256Hex } from "../../src/canonical";
import { OhRecordCodecRegistry } from "../../src/contract";
import { createKnowledgeGraphRecordV1 } from "../../src/graph";
import { createOhMemoryAgentV2, OH_MEMORY_LIMITS_V1, OH_MEMORY_QUERY_LIMITS_V2,
  type OhMemoryLaneIdentityV1, type OhMemoryNamedProgramV2 } from "../../src/memory";
import { createOhProjectionLiteralV1, createOhProjectionQueryV1, createOhProjectionRulePackV1,
  createOhProjectionRuleV1, ohProjectionConstantV1, ohProjectionVariableV1 } from "../../src/projection";
import { createOhSqliteStoreAuthorityV1 } from "../../src/sqlite/port";
import { OH_CANONICAL_STORE_PROFILE_V1, OH_WORKING_STORE_PROFILE_V1 } from "../../src/store";
import type { Corpus, Turn } from "./datasets";
import { pack, queryTerms, renderTurn, type Retrieved, type RetrievalBudget } from "./retrieval";

export type LabMemoryMetadata = Readonly<{
  profile: "oh.memory-development-native.v1";
  ranking: "host-raw-text-bm25";
  cache: "corpus-program-authority-snapshot";
  corpusSha256: Sha256Hex;
  materializationSha256: Sha256Hex;
  programSha256: Sha256Hex;
  memorySha256: Sha256Hex;
  projectionResultSha256: Sha256Hex;
  pageResultSha256: readonly Sha256Hex[];
  canonical: OhMemoryLaneIdentityV1;
  working: OhMemoryLaneIdentityV1;
  sourceRecordCount: number;
  queryCalls: number;
  materializationMs: number;
}>;
export type LabMemoryRetrieved = Retrieved & Readonly<{
  native: LabMemoryMetadata;
  nativeSources: readonly Readonly<{ turnId: string; key: string; recordSha256: Sha256Hex }>[];
}>;

function sourceProgram(maximumRows: number): OhMemoryNamedProgramV2 {
  const key = ohProjectionVariableV1("key"), digest = ohProjectionVariableV1("digest");
  const source = createOhProjectionLiteralV1({ relation: "memory.record", terms: [
    ohProjectionConstantV1("canonical"), key, ohProjectionConstantV1("edition"), digest] });
  const visible = createOhProjectionLiteralV1({ relation: "lab.raw-turn", terms: [key, digest] });
  return {
    v: 2, programId: "lab.raw-turns", purpose: "lab.source-provenance", parameters: [],
    maximumRows, pageSize: Math.min(maximumRows, OH_MEMORY_QUERY_LIMITS_V2.maximumPageRows),
    maximumPageBytes: 1024 * 1024,
    evaluation: { maximumDerivedTuples: maximumRows, maximumProofDepth: 4, maximumProofNodes: 4,
      maximumResultBytes: 16 * 1024 * 1024, maximumRounds: 4,
      maximumTotalProofNodes: maximumRows * 2, maximumWorkUnits: 16_777_216 },
    query: createOhProjectionQueryV1({ find: ["key", "digest"], limit: maximumRows,
      queryId: "lab.raw-turns", where: [visible] }),
    rulePack: createOhProjectionRulePackV1({ rulePackId: "lab.raw-turns", rulePackRevision: 1,
      rules: [createOhProjectionRuleV1({ body: [source], head: visible, ruleId: "lab.raw-turns" })] }),
  };
}

/**
 * Native API integration control, with no model or embedding runtime. The named query
 * authorizes raw records; host BM25 ranks them. Its question-independent projection is
 * materialized once (including all native pages) and reused only for this private snapshot.
 */
export async function createLabMemory(corpus: Corpus) {
  if (corpus.turns.length < 1 || corpus.turns.length > OH_MEMORY_LIMITS_V1.maximumRecordsPerLane
    || new Set(corpus.turns.map(turn => turn.id)).size !== corpus.turns.length) {
    throw new RangeError("Native lab requires 1–8192 uniquely identified raw turns.");
  }
  const records = corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({
    dependencies: [], key: `edition:turn-${index.toString().padStart(5, "0")}`, kind: "edition", v: 1,
    // Keep labels and unrelated runtime fields outside both the record and its digest.
    value: { id: turn.id, sessionId: turn.sessionId,
      ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
      date: turn.date, speaker: turn.speaker, text: turn.text },
  }));
  // Canonical data detachment prevents the caller changing text after its digest was admitted.
  const turns = records.map(record => JSON.parse(canonicalJson(record.value)) as Turn);
  const corpusSha256 = canonicalSha256({ id: corpus.id, groupId: corpus.groupId, turns });
  const suffix = corpusSha256.slice(0, 24);
  const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: `realm:lab-c-${suffix}`, spaceId: `lab-c-${suffix}` });
  let working: ReturnType<typeof createOhSqliteStoreAuthorityV1> | undefined;
  let fts: Database | undefined;
  try {
    working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: `realm:lab-w-${suffix}`, spaceId: `lab-w-${suffix}` });
    for (let start = 0; start < records.length;) {
      const changes: Array<{ kind: "put"; record: typeof records[number]; v: 1 }> = [];
      let bytes = 0;
      while (start + changes.length < records.length && changes.length < 512) {
        const change = { kind: "put" as const, record: records[start + changes.length]!, v: 1 as const };
        const next = Buffer.byteLength(canonicalJson(change));
        if (changes.length && bytes + next > 4 * 1024 * 1024) break;
        changes.push(change); bytes += next;
      }
      await canonical.store.commit({ actorId: "lab.memory", changes,
        expectedHead: await canonical.store.head(), instant: "2026-01-01T00:00:00.000Z",
        operationId: `op_lab_memory_${start}` });
      start += changes.length;
    }
    const program = sourceProgram(records.length);
    const agent = await createOhMemoryAgentV2({ actorId: "lab.memory",
      canonical: { authorityId: "lab.canonical", expectedBindingSha256: canonical.store.binding.bindingSha256,
        expectedHead: await canonical.store.head(), store: canonical.store },
      working: { authorityId: "lab.working", expectedBindingSha256: working.store.binding.bindingSha256,
        store: working.store, codecs: new OhRecordCodecRegistry() }, programs: [program] });
    const admitted = new Map<string, Sha256Hex>();
    const expected = new Map(records.map(record => [record.key, record.recordSha256]));
    const pageResultSha256: Sha256Hex[] = [];
    let first: Awaited<ReturnType<typeof agent.query>> | undefined;
    let continuation: string | null = null;
    const began = performance.now();
    do {
      const page = await agent.query({ v: 2, programId: program.programId, bindings: {}, continuation });
      first ??= page;
      if (page.identity.memorySha256 !== first.identity.memorySha256
        || page.projectionResultSha256 !== first.projectionResultSha256
        || page.page.totalRows !== records.length || page.page.start !== admitted.size
        || page.page.endExclusive !== admitted.size + page.rows.length || page.rows.length === 0
        || page.conflicts.count !== 0) throw new Error("Native memory projection identity or coverage changed.");
      for (const row of page.rows) {
        const [key, digest] = row.values;
        if (row.values.length !== 2 || typeof key !== "string" || typeof digest !== "string"
          || expected.get(key) !== digest || admitted.has(key) || row.premiseAuthority !== "canonical"
          || row.premiseLanes.length !== 1 || row.premiseLanes[0] !== "canonical"
          || row.proofsTruncated || row.supportCount !== 1) throw new Error("Native memory returned a different raw source.");
        admitted.set(key, digest as Sha256Hex);
      }
      pageResultSha256.push(page.resultSha256);
      continuation = page.continuation;
      if (page.page.hasMore !== (continuation !== null)
        || pageResultSha256.length > Math.ceil(records.length / program.pageSize)) {
        throw new Error("Native memory pagination is inconsistent.");
      }
    } while (continuation !== null);
    if (admitted.size !== expected.size) throw new Error("Native memory omitted a raw source.");
    const metadata: LabMemoryMetadata = Object.freeze({
      profile: "oh.memory-development-native.v1", ranking: "host-raw-text-bm25",
      cache: "corpus-program-authority-snapshot", corpusSha256,
      materializationSha256: canonicalSha256({ corpusSha256, identity: first!.identity,
        projectionResultSha256: first!.projectionResultSha256, pageResultSha256 }),
      programSha256: first!.identity.programSha256, memorySha256: first!.identity.memorySha256,
      projectionResultSha256: first!.projectionResultSha256, pageResultSha256: Object.freeze(pageResultSha256),
      canonical: first!.identity.canonical, working: first!.identity.working,
      sourceRecordCount: admitted.size, queryCalls: pageResultSha256.length,
      materializationMs: performance.now() - began,
    });
    fts = new Database(":memory:");
    fts.run("CREATE VIRTUAL TABLE raw_turns USING fts5(turn_index UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')");
    const insert = fts.prepare("INSERT INTO raw_turns (turn_index, text) VALUES (?, ?)");
    fts.transaction(() => turns.forEach((turn, index) => insert.run(index, renderTurn(turn))))();
    const database = fts, workingStore = working.store;
    const selectedSource = new Map(turns.map((turn, index) => [turn.id, Object.freeze({ turnId: turn.id,
      key: records[index]!.key, recordSha256: admitted.get(records[index]!.key)! })]));
    let closed = false;
    return {
      native: metadata,
      async retrieve(question: string, budget: RetrievalBudget): Promise<LabMemoryRetrieved> {
        if (closed) throw new Error("Native lab memory is closed.");
        if (!Number.isSafeInteger(budget.topK) || budget.topK < 1 || budget.topK > 100
          || !Number.isSafeInteger(budget.contextBytes) || budget.contextBytes < 1
          || budget.contextBytes > 4_000_000) throw new RangeError("Invalid native lab retrieval budget.");
        if (typeof question !== "string" || Buffer.byteLength(question) > 65_536) throw new TypeError("Invalid lab question.");
        const terms = queryTerms(question, true);
        const matches = terms.length === 0 ? [] : database.query<{ turn_index: number }, [string, number]>(
          "SELECT turn_index FROM raw_turns WHERE raw_turns MATCH ? ORDER BY bm25(raw_turns), CAST(turn_index AS INTEGER) LIMIT ?",
        ).all(terms.map(term => `"${term}"`).join(" OR "), budget.topK);
        const retrieved = pack(matches.map(({ turn_index }) => ({ turn: turns[turn_index]!,
          digest: admitted.get(records[turn_index]!.key)! })), budget.contextBytes);
        return { ...retrieved, native: metadata, nativeSources: retrieved.turnIds.map(id => selectedSource.get(id)!) };
      },
      async close() {
        if (closed) return;
        closed = true;
        database.close();
        await Promise.all([canonical.store.close(), workingStore.close()]);
      },
    };
  } catch (error) {
    fts?.close();
    await Promise.all([canonical.store.close(), working?.store.close()]);
    throw error;
  }
}
