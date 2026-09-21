import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, isPlainRecord } from "../src/canonical";
import { editionTurnToRecords } from "../scripts/benchmarks/deductive-memory-real";
import { projectRecords } from "../scripts/benchmarks/deductive-memory";
import { DATASETS } from "../scripts/benchmarks/datasets";
import { query as datalogQuery, verify as datalogVerify } from "../scripts/benchmarks/memory-datalog";

const TURN = {
  id: "d1:1", sessionId: "session_1", date: "2023-05-08T13:00:00Z",
  speaker: "Caroline", text: "I went to the Gym with Melanie on Saturday. It was great!",
};

describe("editionTurnToRecords", () => {
  test("projects structured fields and bounded lexical mentions", () => {
    const records = editionTurnToRecords(TURN);
    const kinds = records.map(r => r.kind);
    expect(kinds.filter(k => k === "state")).toHaveLength(3);
    expect(kinds.filter(k => k === "mention").length).toBeGreaterThanOrEqual(2);
    const states = records.filter(r => r.kind === "state");
    expect(states.map(s => s.attr).sort()).toEqual(["said-at", "session", "speaker"]);
    expect(states.find(s => s.attr === "said-at")?.validFrom).toBe("2023-05-08T13:00:00Z");
    // speaker is a structured mention; session is a scoped entity id
    const mentions = records.filter(r => r.kind === "mention").map(r => r.entity);
    expect(mentions).toContain("Caroline");
    expect(mentions).toContain("session:session_1");
    // lexical mentions: "Gym" and "Melanie" surface; speaker excluded
    expect(mentions).toContain("gym");
    expect(mentions).toContain("melanie");
    expect(mentions).not.toContain("caroline");
  });

  test("lexical mentions are capped at 8 and stopword-filtered", () => {
    const long = { ...TURN, text: Array.from({ length: 20 }, (_, i) => `Token${i}`).join(" ") };
    const records = editionTurnToRecords(long);
    const lexical = records.filter(r => r.kind === "mention")
      .map(r => r.entity).filter(e => e !== "Caroline" && !String(e).startsWith("session:"));
    expect(lexical.length).toBeLessThanOrEqual(8);
    const stop = { ...TURN, text: "Monday Tuesday Wednesday January February March" };
    const stopMentions = editionTurnToRecords(stop).filter(r => r.kind === "mention")
      .map(r => r.entity).filter(e => e !== "Caroline" && !String(e).startsWith("session:"));
    expect(stopMentions).toEqual([]);
  });

  test("rejects malformed turn values", () => {
    expect(() => editionTurnToRecords(null)).toThrow(TypeError);
    expect(() => editionTurnToRecords({})).toThrow(TypeError);
    expect(() => editionTurnToRecords({ ...TURN, date: 42 })).toThrow(TypeError);
  });

  test("projected records produce valid proof-carrying facts", () => {
    const memory = projectRecords(editionTurnToRecords(TURN).map(r => ({
      ...r, content: "edition:turn-00000:sha256:abc",
    })));
    const program = { contract: "algal.query.v1" as const, rules: [] as const,
      query: { relation: "mentions", terms: [{ var: "d" }, { var: "x" }] as const } };
    const result = datalogQuery(memory, program);
    expect(datalogVerify(memory, program, result)).toBe(true);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    // every row's proof resolves to a fact node whose source is a record digest
    for (const row of result.rows) {
      const proof = result.proofs[row.proof];
      expect(proof?.kind).toBe("fact");
      expect((proof as { sources: string[] }).sources[0]).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });
});

describe("committed LOCOMO artifact", () => {
  const path = join(import.meta.dir, "../benchmarks/results/deductive-memory-locomo-v1.json");
  const artifact = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

  test("pins the real dataset and corpus", () => {
    expect(artifact.protocol).toBe("oh.deductive-memory-real.v1");
    expect(artifact.dataset).toBe("locomo");
    expect(artifact.datasetSha256).toBe(DATASETS.locomo.sha256);
    expect(artifact.corpusId).toBe("conv-49");
    expect(String(artifact.corpusSha256)).toMatch(/^[a-f0-9]{64}$/);
  });

  test("store section reports verified replay over real records", () => {
    const store = artifact.store as Record<string, unknown>;
    expect(store.integrity).toBe("verified");
    expect(store.recordCount).toBe(509);
    expect(Number(store.operations)).toBeGreaterThan(0);
  });

  test("sharding is honest: 25 session shards, all within contract bounds", () => {
    const sharding = artifact.sharding as Record<string, unknown>;
    expect(sharding.sessions).toBe(25);
    expect(Number(sharding.maxSnapshotBytes)).toBeLessThanOrEqual(262_144);
    expect(Number(sharding.maxFacts)).toBeLessThanOrEqual(2_048);
    const shards = artifact.shards as readonly Record<string, unknown>[];
    expect(shards).toHaveLength(25);
    for (const shard of shards) {
      expect(String(shard.memorySha256)).toMatch(/^[a-f0-9]{64}$/);
      expect(Number(shard.statesRows)).toBeGreaterThan(0);
      expect(Number(shard.mentionsRows)).toBeGreaterThan(0);
      expect(Number(shard.timelineRows)).toBeGreaterThan(0);
    }
  });

  test("corpus index carries verified derived results", () => {
    const index = artifact.corpusIndex as Record<string, unknown>;
    expect(index.verified).toBe(true);
    expect(index.refersRows).toBe(50); // 25 sessions × 2 speakers
    expect(index.historyRows).toBe(25); // one dated state per session
    expect(index.conflictPairs).toBe(0); // true negative — nothing fabricated
    expect(index.staleFacts).toBe(0);
    expect(Number(index.snapshotBytes)).toBeLessThanOrEqual(262_144);
    expect(Number(index.facts)).toBeLessThanOrEqual(2_048);
  });

  test("shard digests recombine into the recorded totals", () => {
    const shards = artifact.shards as readonly Record<string, unknown>[];
    const totalFacts = shards.reduce((n, s) => n + Number(s.facts), 0);
    expect(totalFacts).toBe((artifact.sharding as Record<string, unknown>).totalFacts);
  });
});
