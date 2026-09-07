#!/usr/bin/env bun
// scripts/benchmarks/stress-retrieval.ts
// Offline synthetic retrieval saturation stress helper. Importing it runs nothing.
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  beginStressRun, finishStressRun, parseStressArguments, writeStressReport, type StressRun,
} from "./stress-common";

const SEEDS = [1, 17, 104729, 4294967290] as const;
const SIZES = [0, 1, 127, 128, 129, 1024] as const;
const TOPKS = [1, 20, 100] as const;
const PAIRS = [
  ["oh-window", "bm25-record-window"],
  ["oh-fact", "bm25-record-fact"],
] as const satisfies ReadonlyArray<readonly [System, System]>;
const BUDGET_CELLS = ["one-byte", "just-below-first", "exact-first", "standard-12000"] as const;
const ANCHOR_RUN = 0;
const METADATA_RUN = 3;

function sha256Hex(input: string | Buffer): string { return createHash("sha256").update(input).digest("hex"); }
function jsonSha256(value: unknown): string { return sha256Hex(JSON.stringify(value)); }
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function codePointSafeSlice(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

type RetrievalModule = typeof import("./retrieval");
type UnitsModule = typeof import("./units");
type CanonicalModule = typeof import("../../src/canonical");
type GraphModule = typeof import("../../src/graph");
type SqliteStoreModule = typeof import("../../src/sqlite/store");
type OhSqliteStoreInstance = InstanceType<SqliteStoreModule["OhSqliteStore"]>;
type Retrieved = import("./retrieval").Retrieved;
type System = import("./retrieval").System;
type MemoryUnit = import("./units").MemoryUnit;

/** Helper-local synthetic fixture shapes: every generated turn carries an occurrence index. */
type Turn = Readonly<{ id: string; sessionId: string; sessionIndex: number; date: string; speaker: string; text: string }>;
type Corpus = Readonly<{ id: string; groupId: string; turns: readonly Turn[] }>;
/** A derived unit is a public MemoryUnit plus the retrieval source binding. */
type DerivedUnit = MemoryUnit & Readonly<{ sourceTurnIds: readonly string[] }>;
type IndexedUnit = Readonly<{ id: string; text: string; date: string; sessionId: string;
  sessionIndex?: number; sourceTurnIds: readonly string[] }>;

function pad2(n: number): string { return String(n).padStart(2, "0"); }

function generateCorpus(seed: number, size: number): Corpus {
  const rng = mulberry32(seed ^ size ^ 0x9e3779b9);
  const turns: Turn[] = [];
  const runCount = Math.ceil(size / 4);
  for (let r = 0; r < runCount; r++) {
    let sessionId: string; let sessionIndex: number;
    if (r === ANCHOR_RUN) { sessionId = `sess-anchor-${seed}x${size}`; sessionIndex = 0; }
    else if (r === ANCHOR_RUN + 1) { sessionId = `sess-anchor-${seed}x${size}`; sessionIndex = 1; }
    else { sessionId = `sess-${r % 2}`; sessionIndex = Math.floor(r / 2); }
    const date = `2026-01-${pad2(1 + (r % 27))}`;
    const runLen = Math.min(4, size - r * 4);
    for (let o = 0; o < runLen; o++) {
      const i = r * 4 + o;
      const speaker = i % 2 === 0 ? "Ada" : "Bea";
      let text = `Turn ${i} covers filler topic ${Math.floor(rng() * 100000)} in the discussion.`;
      if (i === 0) text = `FIRSTTURNMARKER${seed}x${size} introduces the discussion with café ☕ 😀 multibyte content.`;
      else if (r === ANCHOR_RUN && o === 1) text = `INTERIORANCHOR${seed}x${size} interior filler detail.`;
      else if (r === ANCHOR_RUN && o === 3) text = `BOUNDARYANCHOR${seed}x${size} boundary filler detail.`;
      else if (i === 20 || i === 21) text = "Identical duplicate marker phrase repeated content.";
      else if (i === 22) text = "Café résumé naïve façade visited again.";
      else if (i === 23) text = "😀🎉 celebration message shared warmly.";
      else if (i === 24) text = "北京 是 中国 的 首都 也是 文化 中心";
      else if (i === 25) text = `word${"x".repeat(80)} appears in this filler turn.`;
      else if (i === 26) text = "Paris Paris Paris repeated trip talk.";
      else if (i === 27) text = "rareMatchToken99 appears but must not be reached by the query cap.";
      else if (i === 28) text = "Ada announced she is now a permanent Paris resident.";
      let sid = sessionId;
      if (r === METADATA_RUN) sid = `sess-meta-METADATAONLYMARK${seed}x${size}`;
      turns.push({ id: `t-${seed}-${size}-${i}`, sessionId: sid, sessionIndex, date, speaker, text });
    }
  }
  return { id: `corpus-${seed}-${size}`, groupId: `group-${seed}-${size}`, turns };
}

type QueryTemplate = { name: string; text: (seed: number, size: number) => string; applicable: (size: number) => boolean };

const QUERIES: readonly QueryTemplate[] = [
  { name: "first-turn-marker", text: (s, n) => `FIRSTTURNMARKER${s}x${n}`, applicable: (n) => n >= 1 },
  { name: "interior-anchor", text: (s, n) => `INTERIORANCHOR${s}x${n}`, applicable: (n) => n >= 5 },
  { name: "boundary-anchor", text: (s, n) => `BOUNDARYANCHOR${s}x${n}`, applicable: (n) => n >= 5 },
  { name: "unicode-latin-diacritic", text: () => "café résumé naïve", applicable: (n) => n >= 23 },
  { name: "emoji-astral", text: () => "😀🎉 celebration", applicable: (n) => n >= 24 },
  { name: "cjk", text: () => "北京 中国", applicable: (n) => n >= 25 },
  { name: "duplicate-equal-score", text: () => "duplicate marker phrase", applicable: (n) => n >= 22 },
  { name: "long-token", text: () => `word${"x".repeat(80)}`, applicable: (n) => n >= 26 },
  { name: "metadata-only-marker", text: (s, n) => `METADATAONLYMARK${s}x${n}`, applicable: (n) => n >= 16 },
  { name: "no-match", text: () => "zzzunmatchedzzz9999", applicable: () => true },
  { name: "repeated-term", text: () => "paris paris paris", applicable: (n) => n >= 27 },
  { name: "seventeen-token-probe", text: () => Array.from({ length: 16 }, (_, k) => `nomatch${k}`).join(" ") + " rareMatchToken99", applicable: () => true },
  { name: "guaranteed-fact-query", text: () => "resident", applicable: (n) => n >= 29 },
  { name: "seeded-variation-a", text: () => "filler topic discussion", applicable: (n) => n >= 1 },
  { name: "seeded-variation-b", text: () => "covers filler", applicable: (n) => n >= 1 },
  { name: "seeded-variation-c", text: () => "introduces the discussion", applicable: (n) => n >= 1 },
];
if (QUERIES.length !== 16) throw new Error("query template count invariant broken");

type Failure = { check: string; caseId: string; detail: string };
type Counters = Record<string, { cases: number; passed: number }>;
type Sentinel = { applicable: number; executed: number; passed: number; failed: number; skipped: number };

const FAILURE_STORE_LIMIT = 100;
let failureTotal = 0;
const sentinel: Record<string, Sentinel> = {};

function sanitizeDetail(text: string): string {
  return codePointSafeSlice(text.replace(/(?:\/[^\s"':,;]+){2,}/g, "<path>"), 400);
}

function sentinelTouch(name: string): Sentinel {
  sentinel[name] ??= { applicable: 0, executed: 0, passed: 0, failed: 0, skipped: 0 };
  return sentinel[name]!;
}

function makeBump(counts: Counters, failures: Failure[]) {
  return (check: string, ok: boolean, caseId: string, detail = "") => {
    const entry = (counts[check] ??= { cases: 0, passed: 0 });
    entry.cases += 1;
    if (ok) entry.passed += 1;
    else {
      failureTotal += 1;
      if (failures.length < FAILURE_STORE_LIMIT) failures.push({ check, caseId, detail: sanitizeDetail(detail) });
    }
  };
}

function makeGate(bump: ReturnType<typeof makeBump>) {
  return async (name: string, applicable: boolean, caseId: string,
    run: () => Promise<{ ok: boolean; detail?: string }> | { ok: boolean; detail?: string }) => {
    const state = sentinelTouch(name);
    if (!applicable) { state.skipped += 1; return; }
    state.applicable += 1;
    state.executed += 1;
    const outcome = await run();
    if (outcome.ok) state.passed += 1; else state.failed += 1;
    bump(name, outcome.ok, caseId, outcome.detail ?? "");
  };
}

async function main(run: StressRun) {
  const startedAt = performance.now();
  const repoReal = run.root;
  const helperShaBefore = run.helperSha256Before;
  const networkAttemptsNow = (): number => run.networkAttempts();
  let networkAttempts = 0;

  const failures: Failure[] = [];
  const counts: Counters = {};
  const bump = makeBump(counts, failures);
  let status = "failed";
  let report: Record<string, unknown> = {};
  let partialEvidence: Record<string, unknown> = {};

  try {
    const identityBefore = run.identityBefore;
    const RETRIEVAL_RELATIVE_PATH = "scripts/benchmarks/retrieval.ts";
    const manifestEntries = identityBefore.files.filter((entry) => entry.path === RETRIEVAL_RELATIVE_PATH);
    const pinned = manifestEntries[0];
    if (manifestEntries.length !== 1 || pinned === undefined || !/^[0-9a-f]{64}$/.test(pinned.sha256)) {
      throw new Error("the caller-pinned identity manifest lacks a canonical retrieval.ts entry");
    }
    const expectedRetrievalFileSha256: string = pinned.sha256;

    const retrievalPath = join(repoReal, RETRIEVAL_RELATIVE_PATH);
    const retrievalFileShaBefore = sha256Hex(readFileSync(retrievalPath));
    if (retrievalFileShaBefore !== expectedRetrievalFileSha256) throw new Error("retrieval.ts file sha256 mismatch before run");

    const retrieval = await import(pathToFileURL(retrievalPath).href) as RetrievalModule;
    const unitsMod = await import(pathToFileURL(join(repoReal, "scripts/benchmarks/units.ts")).href) as UnitsModule;
    const canonical = await import(pathToFileURL(join(repoReal, "src/canonical.ts")).href) as CanonicalModule;
    const graph = await import(pathToFileURL(join(repoReal, "src/graph.ts")).href) as GraphModule;
    const storeMod = await import(pathToFileURL(join(repoReal, "src/sqlite/store.ts")).href) as SqliteStoreModule;
    const { canonicalSha256 } = canonical;
    const { createKnowledgeGraphRecordV1 } = graph;
    const { OhSqliteStore } = storeMod;
    const { createRetrievers, createUnitIndex, renderTurn, blockUnits } = retrieval;
    const { buildExtractionChunks, parseMemoryUnits } = unitsMod;

    let forbiddenRecordCalls = 0;
    let guardedRecordQueries = 0;
    let productionKeywordCalls = 0;
    let gridRetrieveCalls = 0;
    let extraProbeCalls = 0;
    let mutationRetrieveCalls = 0;
    // Single guarded record-query helper: every record-baseline retrieval runs with a counting/throwing
    // sentinel installed in place of production keyword search, always restored in finally.
    type SearchKeyword = OhSqliteStoreInstance["searchKeyword"];
    const guardedRecord = async (query: () => Promise<Retrieved>): Promise<Retrieved> => {
      guardedRecordQueries += 1;
      const original: SearchKeyword = OhSqliteStore.prototype.searchKeyword;
      OhSqliteStore.prototype.searchKeyword = function (
        this: OhSqliteStoreInstance, ..._parameters: Parameters<SearchKeyword>
      ): ReturnType<SearchKeyword> {
        forbiddenRecordCalls += 1;
        throw new Error("record baseline invoked production searchKeyword");
      };
      try { return await query(); } finally { OhSqliteStore.prototype.searchKeyword = original; }
    };
    // Transparent counter for the Oh side: production keyword search still runs, and is restored in finally.
    const countedA = async (query: () => Promise<Retrieved>): Promise<Retrieved> => {
      const original: SearchKeyword = OhSqliteStore.prototype.searchKeyword;
      OhSqliteStore.prototype.searchKeyword = function (
        this: OhSqliteStoreInstance, ...parameters: Parameters<SearchKeyword>
      ): ReturnType<SearchKeyword> {
        productionKeywordCalls += 1;
        return original.apply(this, parameters);
      };
      try { return await query(); } finally { OhSqliteStore.prototype.searchKeyword = original; }
    };

    function buildValidatedUnits(corpus: Corpus): readonly DerivedUnit[] {
      const chunks = buildExtractionChunks(corpus);
      const turnById = new Map(corpus.turns.map((t) => [t.id, t] as const));
      const expected = corpus.turns.filter((t) => t.text.length > 0).length;
      const out: MemoryUnit[] = [];
      let rejected = 0;
      let multiTurnChunks = 0;
      for (const chunk of chunks) {
        const head = chunk.turns[0];
        if (head === undefined) continue;
        const sameBoundary = chunk.turns.every((t) => t.sessionId === head.sessionId
          && t.sessionIndex === head.sessionIndex && t.date === head.date);
        bump("chunkBoundary", sameBoundary, chunk.id, "chunk crosses session/occurrence boundary");
        if (new Set(chunk.turns.map((t) => t.id)).size > 1) multiTurnChunks += 1;
        const nonEmpty = chunk.turns.filter((t) => t.text.length > 0);
        if (nonEmpty.length === 0) continue;
        // Keep the complete bounded fixture text as both unit body and verbatim support quote.
        const envelope = { units: nonEmpty.map((t) => ({
          text: `Unit about ${t.speaker}: ${t.text}`, supports: [{ turnId: t.id, quote: t.text }],
        })) };
        const { units: parsed, rejected: rej } = parseMemoryUnits(envelope, chunk);
        rejected += rej;
        out.push(...parsed);
      }
      const units: readonly DerivedUnit[] = out.map((u) => ({ ...u,
        sourceTurnIds: [...new Set(u.supports.map((s) => s.turnId))] }));
      bump("unitRejection", rejected === 0, corpus.id, `${rejected} units rejected`);
      bump("unitCount", units.length === expected, corpus.id, `expected ${expected} units, got ${units.length}`);
      bump("unitIdUniqueness", new Set(units.map((u) => u.id)).size === units.length, corpus.id, "duplicate derived unit id");
      const perTurn = new Map<string, number>();
      for (const unit of units) {
        bump("unitSupportShape", unit.supports.length === 1, unit.id, "expected exactly one support per derived unit");
        const support = unit.supports[0];
        if (support === undefined) { bump("unitProvenance", false, unit.id, "derived unit has no support"); continue; }
        perTurn.set(support.turnId, (perTurn.get(support.turnId) ?? 0) + 1);
        const turn = turnById.get(support.turnId);
        const valid = turn !== undefined && support.quote.length > 0 && turn.text.includes(support.quote)
          && support.quote === turn.text && unit.text.includes(support.quote)
          && turn.date === unit.date && turn.sessionId === unit.sessionId && turn.sessionIndex === unit.sessionIndex;
        bump("unitProvenance", valid, unit.id, "support/quote/date/session/occurrence mismatch");
      }
      bump("unitPerTurnUniqueness", perTurn.size === expected && [...perTurn.values()].every((n) => n === 1),
        corpus.id, `unique turn coverage ${perTurn.size} of ${expected}`);
      bump("multiTurnChunk", corpus.turns.length < 127 || multiTurnChunks > 0, corpus.id, "no multi-turn extraction chunk");
      return units;
    }

    let largeFixtureCount = 0;
    const fixtureDigests: string[] = [];
    let resultAccumulator = "genesis";
    let probeAccumulator = "genesis";
    let probeResultCount = 0;
    const caseIds = new Set<string>();
    let gridCells = 0;
    const gridCellsByFixturePair = new Map<string, number>();
    const budgetCoverage: Record<string, unknown>[] = [];
    const fixtureIdentities: Record<string, unknown>[] = [];
    const gate = makeGate(bump);
    const templateFor = (name: string) => QUERIES.find((q) => q.name === name)!;
    const recordProbe = (name: string, results: readonly unknown[]) => {
      probeResultCount += results.length;
      probeAccumulator = sha256Hex(`${probeAccumulator}|${name}|${results.map((r) => canonicalSha256(r)).join("|")}`);
    };

    for (const seed of SEEDS) {
      for (const size of SIZES) {
        const corpus = generateCorpus(seed, size);
        const isLarge = size >= 127;
        if (isLarge) largeFixtureCount += 1;
        const memoryUnits = buildValidatedUnits(corpus);
        const turnIdSet = new Set(corpus.turns.map((t) => t.id));
        const sessionIdSet = new Set(corpus.turns.map((t) => t.sessionId));
        fixtureDigests.push(canonicalSha256({ corpusId: corpus.id, turns: corpus.turns, units: memoryUnits }));

        const retrievers = createRetrievers(corpus, memoryUnits);
        try {
          retrievers.prepare(["oh-window", "bm25-record-window", "oh-fact", "bm25-record-fact"]);

          const turnById = new Map(corpus.turns.map((t) => [t.id, t] as const));
          const renderedTurnById = new Map(corpus.turns.map((t) => [t.id, renderTurn(t)] as const));
          // Documented createUnitIndex rendering of a derived unit item.
          const renderUnitItem = (unit: IndexedUnit): string => renderTurn({ id: unit.id, date: unit.date,
            sessionId: unit.sessionId,
            ...(unit.sessionIndex === undefined ? {} : { sessionIndex: unit.sessionIndex }), speaker: "Memory",
            text: `${unit.text}\nSources: ${unit.sourceTurnIds.map((id) => `[${id}]`).join(" ")}` });
          const renderedItemToUnit = new Map<string, IndexedUnit>(
            memoryUnits.map((u) => [renderUnitItem(u), u] as const));
          const contextItems = (context: string): string[] => context.length === 0 ? [] : context.split("\n\n");
          fixtureIdentities.push({ fixture: corpus.id, seed, size, turns: corpus.turns.length, units: memoryUnits.length,
            digest: fixtureDigests[fixtureDigests.length - 1]!, pairs: PAIRS.map(([a, b]) => `${a}|${b}`) });

          const windowRefPresent = corpus.turns.length > 0;
          const windowReferenceText = windowRefPresent ? renderTurn(corpus.turns[0]!)
            : renderTurn({ id: "synthetic-empty-window", sessionId: "synthetic-empty", sessionIndex: 0, date: "2026-01-01",
              speaker: "Ada", text: "synthetic empty-fixture window reference item" });
          const windowRefBytes = Buffer.byteLength(windowReferenceText);
          const firstUnit = memoryUnits[0];
          const factRefPresent = firstUnit !== undefined;
          const factReferenceText = firstUnit !== undefined ? renderUnitItem(firstUnit)
            : renderUnitItem({ id: "synthetic-empty-fact", text: "synthetic empty-fixture derived unit reference",
              date: "2026-01-01", sessionId: "synthetic-empty", sessionIndex: 0, sourceTurnIds: ["synthetic-empty-turn"] });
          const factRefBytes = Buffer.byteLength(factReferenceText);
          const references: Record<string, { present: boolean; referenceBytes: number; referenceSha256: string; text: string }> = {
            "oh-window|bm25-record-window": { present: windowRefPresent, referenceBytes: windowRefBytes,
              referenceSha256: sha256Hex(windowReferenceText), text: windowReferenceText },
            "oh-fact|bm25-record-fact": { present: factRefPresent, referenceBytes: factRefBytes,
              referenceSha256: sha256Hex(factReferenceText), text: factReferenceText },
          };

          const cellsFor = (ref: number) => ({ "one-byte": 1, "just-below-first": ref - 1, "exact-first": ref, "standard-12000": 12000 });
          const pairCells: Record<string, Record<string, number>> = {
            "oh-window|bm25-record-window": cellsFor(windowRefBytes),
            "oh-fact|bm25-record-fact": cellsFor(factRefBytes),
          };
          for (const [pairKey, cells] of Object.entries(pairCells)) {
            const values = Object.values(cells);
            const ref = references[pairKey]!.referenceBytes;
            bump("budgetReferenceBounds", ref > 2 && ref < 12000, `${corpus.id}|${pairKey}`, `referenceBytes=${ref}`);
            bump("budgetDistinctness", new Set(values).size === 4, `${corpus.id}|${pairKey}`, "budget cells not distinct");
            bump("budgetCellValues", cells["one-byte"] === 1 && cells["just-below-first"] === ref - 1
              && cells["exact-first"] === ref && cells["standard-12000"] === 12000,
              `${corpus.id}|${pairKey}`, "budget cells are not the documented values");
            budgetCoverage.push({ fixture: corpus.id, pair: pairKey, referencePresent: references[pairKey]!.present,
              referenceBytes: ref, referenceSha256: references[pairKey]!.referenceSha256, cells });
          }

          // First-item budget boundary for both pairs, against the independently rendered first item.
          for (const [sysA, sysB] of PAIRS) {
            const pairKey = `${sysA}|${sysB}`;
            const ref = references[pairKey]!;
            const isFactPair = sysA.endsWith("fact");
            const anchorQuery = templateFor("first-turn-marker").text(seed, size);
            await gate("firstItemBudgetBoundary", ref.present, `${corpus.id}|${pairKey}`, async () => {
              const belowA = await countedA(() => retrievers.retrieve(sysA, anchorQuery, { topK: 1, contextBytes: ref.referenceBytes - 1 }));
              const belowB = await guardedRecord(() => retrievers.retrieve(sysB, anchorQuery, { topK: 1, contextBytes: ref.referenceBytes - 1 }));
              const exactA = await countedA(() => retrievers.retrieve(sysA, anchorQuery, { topK: 1, contextBytes: ref.referenceBytes }));
              const exactB = await guardedRecord(() => retrievers.retrieve(sysB, anchorQuery, { topK: 1, contextBytes: ref.referenceBytes }));
              const standardA = await countedA(() => retrievers.retrieve(sysA, anchorQuery, { topK: 1, contextBytes: 12000 }));
              const standardB = await guardedRecord(() => retrievers.retrieve(sysB, anchorQuery, { topK: 1, contextBytes: 12000 }));
              extraProbeCalls += 6;
              recordProbe(`firstItemBudgetBoundary|${corpus.id}|${pairKey}`, [belowA, belowB, exactA, exactB, standardA, standardB]);
              const firstTurn = corpus.turns[0]!;
              const belowOk = (r: Retrieved) => !r.context.includes(ref.text) && r.omittedForBudget > 0
                && (isFactPair ? !(r.supportTurnIds ?? []).includes(firstTurn.id) : !r.turnIds.includes(firstTurn.id));
              const exactOk = (r: Retrieved) => r.context === ref.text
                && (isFactPair ? r.evidenceKind === "derived-unit" && r.turnIds.length === 0
                    && JSON.stringify(r.supportTurnIds ?? []) === JSON.stringify([firstTurn.id])
                  : JSON.stringify(r.turnIds) === JSON.stringify([firstTurn.id])
                    && JSON.stringify(r.sessionIds) === JSON.stringify([firstTurn.sessionId]));
              const ok = belowOk(belowA) && belowOk(belowB) && exactOk(exactA) && exactOk(exactB)
                && standardA.context.length > 0 && standardB.context.length > 0;
              return { ok, detail: `belowOmitted=${belowA.omittedForBudget}/${belowB.omittedForBudget} exactBytes=`
                + `${Buffer.byteLength(exactA.context)}/${Buffer.byteLength(exactB.context)} reference=${ref.referenceBytes}` };
            });
          }

          await gate("positiveAnchorMatch", corpus.turns.length > 0, corpus.id, async () => {
            const query = templateFor("first-turn-marker").text(seed, size);
            const a = await countedA(() => retrievers.retrieve("oh-window", query, { topK: 1, contextBytes: 12000 }));
            const b = await guardedRecord(() => retrievers.retrieve("bm25-record-window", query, { topK: 1, contextBytes: 12000 }));
            extraProbeCalls += 2;
            recordProbe(`positiveAnchorMatch|${corpus.id}`, [a, b]);
            const first = corpus.turns[0]!;
            const ok = a.turnIds[0] === first.id && b.turnIds[0] === first.id
              && a.context.includes(renderedTurnById.get(first.id)!) && [...first.text].some((character) => character.codePointAt(0)! > 127);
            return { ok, detail: `A=${JSON.stringify(a.turnIds.slice(0, 3))} B=${JSON.stringify(b.turnIds.slice(0, 3))}` };
          });

          await gate("metadataMarkerHygiene", templateFor("metadata-only-marker").applicable(size), corpus.id, () => {
            const marker = templateFor("metadata-only-marker").text(seed, size);
            const turnsClean = corpus.turns.every((t) => !t.text.includes(marker) && !renderTurn(t).includes(marker));
            const unitsClean = memoryUnits.every((u) => !u.text.includes(marker) && !renderUnitItem(u).includes(marker));
            const inTurnMetadata = corpus.turns.some((t) => t.sessionId.includes(marker));
            const inUnitMetadata = memoryUnits.some((u) => u.sessionId.includes(marker));
            return { ok: turnsClean && unitsClean && inTurnMetadata && inUnitMetadata,
              detail: "marker leaked into visible text or is absent from indexed session metadata" };
          });

          const positiveProbes = [
            ["positiveUnicodeLatin", "unicode-latin-diacritic"], ["positiveEmoji", "emoji-astral"],
            ["positiveCjk", "cjk"], ["positiveDuplicate", "duplicate-equal-score"],
            ["positiveMetadataMarker", "metadata-only-marker"],
            ["positiveRepeatedTerm", "repeated-term"], ["positiveGuaranteedFact", "guaranteed-fact-query"],
          ] as const;
          for (const [probeName, templateName] of positiveProbes) {
            const template = templateFor(templateName);
            const queryText = template.text(seed, size);
            for (const [sysA, sysB] of PAIRS) {
              const pairKey = `${sysA}|${sysB}`;
              const isFactPair = sysA.endsWith("fact");
              await gate(probeName, template.applicable(size), `${corpus.id}|${pairKey}`, async () => {
                const a = await countedA(() => retrievers.retrieve(sysA, queryText, { topK: 5, contextBytes: 12000 }));
                const b = await guardedRecord(() => retrievers.retrieve(sysB, queryText, { topK: 5, contextBytes: 12000 }));
                extraProbeCalls += 2;
                recordProbe(`${probeName}|${corpus.id}|${pairKey}`, [a, b]);
                const evidence = (r: Retrieved) => r.context.length > 0
                  && (isFactPair ? (r.supportTurnIds ?? []).length > 0 && r.evidenceKind === "derived-unit" : r.turnIds.length > 0);
                return { ok: evidence(a) && evidence(b),
                  detail: `A bytes=${Buffer.byteLength(a.context)} B bytes=${Buffer.byteLength(b.context)}` };
              });
            }
          }

          // Current keyword grammar splits a >64-character query token; the indexed complete word does not match its pieces.
          for (const [probeName, templateName] of [["seventeenTokenCap", "seventeen-token-probe"], ["noMatchEmpty", "no-match"],
            ["longTokenBoundaryEmpty", "long-token"]] as const) {
            const template = templateFor(templateName);
            const queryText = template.text(seed, size);
            for (const [sysA, sysB] of PAIRS) {
              const pairKey = `${sysA}|${sysB}`;
              await gate(probeName, template.applicable(size), `${corpus.id}|${pairKey}`, async () => {
                const a = await countedA(() => retrievers.retrieve(sysA, queryText, { topK: 5, contextBytes: 12000 }));
                const b = await guardedRecord(() => retrievers.retrieve(sysB, queryText, { topK: 5, contextBytes: 12000 }));
                extraProbeCalls += 2;
                recordProbe(`${probeName}|${corpus.id}|${pairKey}`, [a, b]);
                const empty = (r: Retrieved) => r.context === "" && r.turnIds.length === 0 && r.sessionIds.length === 0
                  && r.recordDigests.length === 0 && (r.supportTurnIds ?? []).length === 0;
                return { ok: empty(a) && empty(b), detail: `A bytes=${Buffer.byteLength(a.context)} B bytes=${Buffer.byteLength(b.context)}` };
              });
            }
          }

          for (const [windowName, templateName, offsets] of [
            ["interiorWindow", "interior-anchor", [1, 0, 2]],
            ["boundaryWindow", "boundary-anchor", [3, 2]],
          ] as const) {
            const template = templateFor(templateName);
            const queryText = template.text(seed, size);
            await gate(windowName, template.applicable(size), corpus.id, async () => {
              const expected = offsets.map((offset) => `t-${seed}-${size}-${offset}`);
              const expectedContext = expected.map((id) => renderedTurnById.get(id)).join("\n\n");
              const following = `t-${seed}-${size}-4`;
              const a = await countedA(() => retrievers.retrieve("oh-window", queryText, { topK: 1, contextBytes: 12000 }));
              const b = await guardedRecord(() => retrievers.retrieve("bm25-record-window", queryText, { topK: 1, contextBytes: 12000 }));
              extraProbeCalls += 2;
              recordProbe(`${windowName}|${corpus.id}`, [a, b]);
              const matches = (r: Retrieved) => JSON.stringify(r.turnIds) === JSON.stringify(expected)
                && r.context === expectedContext && !r.turnIds.includes(following);
              return { ok: matches(a) && matches(b),
                detail: `A=${JSON.stringify(a.turnIds)} B=${JSON.stringify(b.turnIds)} expected=${JSON.stringify(expected)}` };
            });
          }

          await gate("blockCoverage", corpus.turns.length > 0, corpus.id, () => {
            const blocks = blockUnits(corpus);
            const covered: string[] = [];
            let multiTurnBlocks = 0;
            let structural = true;
            for (const block of blocks) {
              const ids: string[] = [...block.sourceTurnIds];
              const turns = ids.map((id) => turnById.get(id));
              if (turns.some((t) => t === undefined)) { structural = false; break; }
              const head = turns[0]!;
              if (new Set(ids).size !== ids.length) structural = false;
              if (!turns.every((t) => t!.sessionId === head.sessionId && t!.sessionIndex === head.sessionIndex && t!.date === head.date)) structural = false;
              if (block.sessionId !== head.sessionId || block.date !== head.date || block.sessionIndex !== head.sessionIndex) structural = false;
              if (ids.length > 1) multiTurnBlocks += 1;
              covered.push(...ids);
            }
            const fullCoverage = JSON.stringify(covered) === JSON.stringify(corpus.turns.map((t) => t.id));
            const multiTurnOk = !isLarge || multiTurnBlocks > 0;
            return { ok: structural && fullCoverage && multiTurnOk,
              detail: `blocks=${blocks.length} multiTurnBlocks=${multiTurnBlocks} covered=${covered.length}` };
          });

          for (const query of QUERIES) {
            const queryText = query.text(seed, size);
            for (const topK of TOPKS) {
              for (const cellName of BUDGET_CELLS) {
                for (const [sysA, sysB] of PAIRS) {
                  const pairKey = `${sysA}|${sysB}`;
                  const budget = pairCells[pairKey]![cellName]!;
                  const caseId = `${seed}|${size}|${query.name}|${topK}|${cellName}|${pairKey}`;
                  const wasNew = !caseIds.has(caseId);
                  caseIds.add(caseId);
                  bump("caseIdentityUnique", wasNew, caseId, "duplicate case identity");
                  gridCells += 1;

                  const fixturePairKey = `${corpus.id}|${pairKey}`;
                  gridCellsByFixturePair.set(fixturePairKey, (gridCellsByFixturePair.get(fixturePairKey) ?? 0) + 1);
                  const isFactPair = sysA.endsWith("fact");

                  const rA = await countedA(() => retrievers.retrieve(sysA, queryText, { topK, contextBytes: budget }));
                  const rB = await guardedRecord(() => retrievers.retrieve(sysB, queryText, { topK, contextBytes: budget }));
                  const rA2 = await countedA(() => retrievers.retrieve(sysA, queryText, { topK, contextBytes: budget }));
                  gridRetrieveCalls += 3;

                  const hashA = canonicalSha256(rA);
                  const hashB = canonicalSha256(rB);
                  const hashA2 = canonicalSha256(rA2);
                  bump("pairEquality", hashA === hashB, caseId, "A/B mismatch");
                  bump("repeatDeterminism", hashA === hashA2, caseId, "A/repeat-A mismatch");
                  for (const [label, r] of [["A", rA], ["B", rB], ["A2", rA2]] as const) {
                    const problems: string[] = [];
                    if (typeof r.context !== "string") problems.push("context is not a string");
                    if (r.budgetExempt !== false) problems.push("unexpected budgetExempt");
                    if (!Number.isSafeInteger(r.omittedForBudget) || r.omittedForBudget < 0) problems.push("omittedForBudget not a safe nonnegative integer");
                    if (Buffer.byteLength(r.context) > budget) problems.push("byte budget exceeded");
                    if (new Set(r.turnIds).size !== r.turnIds.length) problems.push("duplicate turnIds");
                    if (new Set(r.sessionIds).size !== r.sessionIds.length) problems.push("duplicate sessionIds");
                    if (!r.sessionIds.every((id: string) => sessionIdSet.has(id))) problems.push("sessionId not in fixture");
                    if (!r.recordDigests.every((d: string) => /^[0-9a-f]{64}$/.test(d))) problems.push("record digest shape");
                    if (new Set(r.recordDigests).size !== r.recordDigests.length) problems.push("duplicate record digests");
                    const items = contextItems(r.context);
                    if (isFactPair) {
                      if (r.evidenceKind !== "derived-unit") problems.push("missing derived-unit evidenceKind");
                      if (r.turnIds.length !== 0) problems.push("fact turnIds must be empty");
                      const selectedUnits = items.map((item) => renderedItemToUnit.get(item));
                      const knownUnits = selectedUnits.filter((u): u is IndexedUnit => u !== undefined);
                      if (knownUnits.length !== selectedUnits.length) problems.push("context item is not a known rendered derived unit");
                      else {
                        const expectedSupport = [...new Set(knownUnits.flatMap((u) => [...u.sourceTurnIds]))];
                        if (JSON.stringify(r.supportTurnIds ?? []) !== JSON.stringify(expectedSupport)) problems.push("supportTurnIds is not the ordered unique union of selected unit sources");
                        if (!expectedSupport.every((id) => turnIdSet.has(id))) problems.push("support id not in fixture");
                        const expectedSessions = [...new Set(knownUnits.map((u) => u.sessionId))];
                        if (JSON.stringify(r.sessionIds) !== JSON.stringify(expectedSessions)) problems.push("fact sessionIds do not match the selected unit sessions in order");
                      }
                      if (r.recordDigests.length !== items.length) problems.push("record digest count");
                    } else {
                      if (r.evidenceKind !== undefined) problems.push("unexpected evidenceKind");
                      if (r.supportTurnIds !== undefined) problems.push("unexpected supportTurnIds");
                      if (!r.turnIds.every((id: string) => turnIdSet.has(id))) problems.push("turnId not in fixture");
                      if (JSON.stringify(items) !== JSON.stringify(r.turnIds.map((id: string) => renderedTurnById.get(id)))) problems.push("context is not renderTurn of the returned turn ids in order");
                      const expectedSessions = [...new Set(r.turnIds.map((id: string) => turnById.get(id)?.sessionId))];
                      if (JSON.stringify(r.sessionIds) !== JSON.stringify(expectedSessions)) problems.push("sessionIds do not match the selected fixture turns");
                      if (r.recordDigests.length !== r.turnIds.length) problems.push("record digest count");
                    }
                    bump("retrievedFieldIntegrity", problems.length === 0, `${caseId}|${label}`, problems.join("; "));
                  }

                  resultAccumulator = sha256Hex(`${resultAccumulator}|${caseId}|${hashA}|${hashB}|${hashA2}`);
                }
              }
            }
          }
        } finally { retrievers.close(); }
      }
    }
    bump("largeFixtureCount", largeFixtureCount === 16, "global", `expected 16 large fixtures, got ${largeFixtureCount}`);
    bump("gridTotalCells", gridCells === 4 * 6 * 16 * 3 * 4 * 2, "global", `expected 9216 grid cells, got ${gridCells}`);
    bump("caseIdentityTotal", caseIds.size === gridCells, "global", "case identity collisions detected");
    bump("gridRetrieveCallCount", gridRetrieveCalls === 27648, "global", `expected 27648 main-grid retrieval calls, got ${gridRetrieveCalls}`);
    bump("perFixturePairCells", gridCellsByFixturePair.size === 48
      && [...gridCellsByFixturePair.values()].every((v) => v === 192), "global",
      `entries=${gridCellsByFixturePair.size} values=${JSON.stringify([...new Set(gridCellsByFixturePair.values())])}`);
    bump("interiorSentinelAccounting", sentinel.interiorWindow?.executed === 16 && sentinel.interiorWindow?.skipped === 8,
      "global", JSON.stringify(sentinel.interiorWindow ?? null));
    bump("boundarySentinelAccounting", sentinel.boundaryWindow?.executed === 16 && sentinel.boundaryWindow?.skipped === 8,
      "global", JSON.stringify(sentinel.boundaryWindow ?? null));
    bump("firstItemProbeAccounting", sentinel.firstItemBudgetBoundary?.executed === 40 && sentinel.firstItemBudgetBoundary?.skipped === 8,
      "global", JSON.stringify(sentinel.firstItemBudgetBoundary ?? null));
    bump("guardedRecordQueryCoverage", guardedRecordQueries >= gridCells, "global", `guardedRecordQueries=${guardedRecordQueries}`);
    bump("forbiddenRecordCalls", forbiddenRecordCalls === 0, "global", `${forbiddenRecordCalls} forbidden production searchKeyword calls`);
    bump("productionKeywordUsed", productionKeywordCalls > 0, "global", "the Oh side never invoked production keyword search");
    partialEvidence = { gridCells, gridRetrieveCalls, extraProbeCalls, guardedRecordQueries, productionKeywordCalls,
      forbiddenRecordCalls, largeFixtureCount, uniqueCaseCount: caseIds.size, fixtureAggregateDigest: jsonSha256(fixtureDigests),
      resultDigest: resultAccumulator, probeDigest: probeAccumulator, probeResultCount };

    // Stale-source mutation matrix: 4 seeds * 3 support positions * 2 mutation kinds = 24 cases.
    let updateCases = 0;
    let deletionCases = 0;
    let staleAccumulator = "genesis";

    for (const seed of SEEDS) {
      const staleCorpus: Corpus = {
        id: `stale-${seed}`, groupId: `stale-${seed}`,
        turns: [0, 1, 2, 3].map((i) => ({ id: `stale-${seed}-${i}`, sessionId: "sess-stale", sessionIndex: 0, date: "2026-01-01",
          speaker: i % 2 ? "Bea" : "Ada", text: i === 3 ? "UNRELATEDMARKERXYZ single fact turn." : `STALEMARKERABC support turn ${i}.` })),
      };
      const supportTurnIds = [0, 1, 2].map((i) => staleCorpus.turns[i]!.id);
      const unrelatedId = staleCorpus.turns[3]!.id;
      const indexedUnits = [
        { id: `${staleCorpus.id}-unit-a`, text: "STALEMARKERABC compound fact.", date: "2026-01-01", sessionId: "sess-stale", sessionIndex: 0, sourceTurnIds: supportTurnIds },
        { id: `${staleCorpus.id}-unit-b`, text: "UNRELATEDMARKERXYZ fact.", date: "2026-01-01", sessionId: "sess-stale", sessionIndex: 0, sourceTurnIds: [unrelatedId] },
      ];
      for (let supportIndex = 0; supportIndex < 3; supportIndex++) {
        for (const kind of ["update", "delete"] as const) {
          const caseId = `${staleCorpus.id}|support${supportIndex}|${kind}`;
          const authority = new OhSqliteStore({ path: ":memory:", spaceId: `stale-${seed}-${supportIndex}-${kind}` });
          const records = staleCorpus.turns.map((t, i) => createKnowledgeGraphRecordV1({
            v: 1, kind: "edition", key: `edition:source-${i}`, dependencies: [], value: { ...t },
          }));
          try {
            authority.commit({ actorId: "bench", expectedHead: authority.head(), operationId: "op_init",
              instant: "2026-01-01T00:00:00.000Z", changes: records.map((record) => ({ v: 1 as const, kind: "put" as const, record })) });
            const index = createUnitIndex(staleCorpus, indexedUnits, records, authority);
            try {
              index.prepareRecordIndex();
              const factQuery = async (system: System, query: string): Promise<Retrieved> => {
                mutationRetrieveCalls += 1;
                return system.startsWith("bm25-record-")
                  ? await guardedRecord(() => index.retrieve(system, query, { topK: 2, contextBytes: 1000 }))
                  : await countedA(() => index.retrieve(system, query, { topK: 2, contextBytes: 1000 }));
              };
              const beforeAffected = await factQuery("oh-fact", "STALEMARKERABC");
              const beforeAffectedRec = await factQuery("bm25-record-fact", "STALEMARKERABC");
              const beforeUnrelated = await factQuery("oh-fact", "UNRELATEDMARKERXYZ");
              const beforeUnrelatedRec = await factQuery("bm25-record-fact", "UNRELATEDMARKERXYZ");
              const beforeProblems: string[] = [];
              if (JSON.stringify(supportTurnIds) !== JSON.stringify([`stale-${seed}-0`, `stale-${seed}-1`, `stale-${seed}-2`])) beforeProblems.push("unexpected affected support ids");
              if (unrelatedId !== `stale-${seed}-3`) beforeProblems.push("unexpected unrelated singleton id");
              if (!beforeAffected.context.includes("STALEMARKERABC") || !beforeAffectedRec.context.includes("STALEMARKERABC")) beforeProblems.push("affected context empty before mutation");
              if (JSON.stringify(beforeAffected.supportTurnIds ?? []) !== JSON.stringify(supportTurnIds)) beforeProblems.push("affected supportTurnIds mismatch");
              if (!beforeUnrelated.context.includes("UNRELATEDMARKERXYZ") || !beforeUnrelatedRec.context.includes("UNRELATEDMARKERXYZ")) beforeProblems.push("unrelated context empty before mutation");
              if (JSON.stringify(beforeUnrelated.supportTurnIds ?? []) !== JSON.stringify([unrelatedId])) beforeProblems.push("unrelated supportTurnIds mismatch");
              if (canonicalSha256(beforeAffected) !== canonicalSha256(beforeAffectedRec)) beforeProblems.push("before affected A/B mismatch");
              bump("staleBefore", beforeProblems.length === 0, caseId, beforeProblems.join("; "));
              bump("staleBeforeUnrelatedPairEquality", canonicalSha256(beforeUnrelated) === canonicalSha256(beforeUnrelatedRec),
                caseId, "beforeUnrelated A/B mismatch");

              const changedRecordIndex = staleCorpus.turns.findIndex((t) => t.id === supportTurnIds[supportIndex]);
              const prior = records[changedRecordIndex]!;
              let mutationObservation: string;
              if (kind === "update") {
                const update = createKnowledgeGraphRecordV1({ v: 1, kind: "edition", key: prior.key, dependencies: [],
                  value: { ...staleCorpus.turns[changedRecordIndex]!, text: "Support content changed." } });
                authority.commit({ actorId: "bench", expectedHead: authority.head(), operationId: `op_update_${supportIndex}`,
                  instant: "2026-01-02T00:00:00.000Z", changes: [{ v: 1, kind: "put", record: update }] });
                const now = authority.get(prior.key);
                const changed = now !== null && now.recordSha256 !== prior.recordSha256;
                mutationObservation = `update|digestChanged=${changed}`;
                bump("mutationEffective", changed, caseId, "update did not change the current record digest");
                updateCases += 1;
              } else {
                authority.commit({ actorId: "bench", expectedHead: authority.head(), operationId: `op_delete_${supportIndex}`,
                  instant: "2026-01-02T00:00:00.000Z",
                  changes: [{ v: 1, kind: "tombstone", key: prior.key, priorSha256: prior.recordSha256 }] });
                const now = authority.get(prior.key);
                mutationObservation = `delete|absent=${now === null}`;
                bump("mutationEffective", now === null, caseId, "delete did not remove the record");
                deletionCases += 1;
              }

              const afterAffected = await factQuery("oh-fact", "STALEMARKERABC");
              const afterAffectedRec = await factQuery("bm25-record-fact", "STALEMARKERABC");
              const afterUnrelated = await factQuery("oh-fact", "UNRELATEDMARKERXYZ");
              const afterUnrelatedRec = await factQuery("bm25-record-fact", "UNRELATEDMARKERXYZ");
              const fullyEmpty = (r: Retrieved) => r.context === "" && r.turnIds.length === 0 && r.sessionIds.length === 0
                && r.recordDigests.length === 0 && (r.supportTurnIds ?? []).length === 0
                && r.omittedForBudget === 0 && r.budgetExempt === false && r.evidenceKind === "derived-unit";
              const afterProblems: string[] = [];
              if (!fullyEmpty(afterAffected) || !fullyEmpty(afterAffectedRec)) afterProblems.push("affected result not fully empty after mutation");
              if (canonicalSha256(afterAffected) !== canonicalSha256(afterAffectedRec)) afterProblems.push("after affected A/B mismatch");
              if (canonicalSha256(afterUnrelated) !== canonicalSha256(beforeUnrelated)) afterProblems.push("unrelated Oh result changed");
              if (canonicalSha256(afterUnrelatedRec) !== canonicalSha256(beforeUnrelatedRec)) afterProblems.push("unrelated record result changed");
              if (canonicalSha256(afterUnrelated) !== canonicalSha256(afterUnrelatedRec)) afterProblems.push("after unrelated A/B mismatch");
              bump("staleAfter", afterProblems.length === 0, caseId, afterProblems.join("; "));

              staleAccumulator = sha256Hex([staleAccumulator, caseId, mutationObservation,
                canonicalSha256({ corpus: staleCorpus, units: indexedUnits }),
                canonicalSha256(beforeAffected), canonicalSha256(beforeAffectedRec),
                canonicalSha256(beforeUnrelated), canonicalSha256(beforeUnrelatedRec),
                canonicalSha256(afterAffected), canonicalSha256(afterAffectedRec),
                canonicalSha256(afterUnrelated), canonicalSha256(afterUnrelatedRec)].join("|"));
            } finally { index.close(); }
          } finally { authority.close(); }
        }
      }
    }
    bump("staleCaseCounts", updateCases === 12 && deletionCases === 12, "global", `updateCases=${updateCases} deletionCases=${deletionCases}`);
    bump("staleForbiddenRecordCalls", forbiddenRecordCalls === 0, "global", `${forbiddenRecordCalls} forbidden production searchKeyword calls`);
    partialEvidence = { ...partialEvidence, updateCases, deletionCases, mutationRetrieveCalls,
      staleMutationDigest: staleAccumulator, forbiddenRecordCalls };

    const retrievalFileShaAfter = sha256Hex(readFileSync(retrievalPath));
    if (retrievalFileShaAfter !== expectedRetrievalFileSha256 || retrievalFileShaAfter !== retrievalFileShaBefore) {
      throw new Error("retrieval.ts file sha256 mismatch after run");
    }
    // Every retriever, unit index and authority store above closed in its own finally.
    const finished = await finishStressRun(run);
    const identityAfter = finished.identityAfter;
    if (identityAfter.sourceSha256 !== run.expectedSourceSha256
      || identityAfter.sourceSha256 !== identityBefore.sourceSha256
      || finished.helperSha256After !== helperShaBefore) {
      throw new Error("helper or repository identity changed during the run");
    }
    networkAttempts = finished.networkAttempts;
    if (networkAttempts !== 0) throw new Error("network attempts must be zero");

    const requiredCounters: Record<string, number> = {
      gridCells, gridRetrieveCalls, extraProbeCalls, mutationRetrieveCalls, guardedRecordQueries, productionKeywordCalls,
      forbiddenRecordCalls, largeFixtureCount, updateCases, deletionCases, uniqueCaseCount: caseIds.size,
      budgetCoverageEntries: budgetCoverage.length, fixtureCount: fixtureIdentities.length, probeResultCount,
      networkAttempts, modelCalls: 0,
    };
    const missingCounters = Object.entries(requiredCounters).filter(([, v]) => !Number.isSafeInteger(v)).map(([k]) => k);
    bump("requiredCounters", missingCounters.length === 0, "global", `missing: ${missingCounters.join(",")}`);
    const invariantCases = Object.values(counts).reduce((sum, c) => sum + c.cases, 0);
    const invariantPassed = Object.values(counts).reduce((sum, c) => sum + c.passed, 0);
    status = failureTotal === 0 && missingCounters.length === 0 ? "passed" : "failed";
    const fixtureAggregateDigest = jsonSha256(fixtureDigests);
    const aggregateDigest = canonicalSha256({ fixtureAggregateDigest, resultDigest: resultAccumulator,
      probeDigest: probeAccumulator, staleMutationDigest: staleAccumulator, budgetCoverage, fixtures: fixtureIdentities,
      counters: requiredCounters, sentinel, checks: Object.keys(counts).sort() });

    report = {
      protocol: "oh.synthetic-retrieval-saturation.v1",
      createdAt: new Date().toISOString(),
      status,
      sourceIdentity: { path: "scripts/benchmarks/retrieval.ts", aggregateSourceSha256Before: identityBefore.sourceSha256,
        aggregateSourceSha256After: identityAfter.sourceSha256, fileSha256Before: retrievalFileShaBefore, fileSha256After: retrievalFileShaAfter },
      helperSha256: helperShaBefore,
      observed: { expectedSourceSha256: run.expectedSourceSha256, helperSha256After: finished.helperSha256After,
        guardNetworkAttempts: finished.networkAttempts, retrievalFileSha256: expectedRetrievalFileSha256 },
      grid: { seeds: SEEDS, sizes: SIZES, topKs: TOPKS, budgetCells: BUDGET_CELLS, pairs: PAIRS, queryTemplateCount: QUERIES.length,
        totalCells: gridCells, expectedCells: 4 * 6 * 16 * 3 * 4 * 2, totalRetrieveCalls: gridCells * 3 },
      largeFixtureCount,
      perFixturePairCells: Object.fromEntries(gridCellsByFixturePair),
      uniqueCaseCount: caseIds.size,
      budgetCoverage,
      fixtures: fixtureIdentities,
      callCounts: { gridRetrieveCalls, extraProbeCalls, mutationRetrieveCalls, guardedRecordQueries,
        productionKeywordCalls, forbiddenRecordCalls },
      staleMutation: { updateCases, deletionCases, totalCases: updateCases + deletionCases },
      networkAttempts, modelCalls: 0,
      invariants: { cases: invariantCases, passed: invariantPassed, failed: failureTotal },
      sentinel,
      checks: counts,
      failureTotal, failuresStored: failures.length, failureStoreLimit: FAILURE_STORE_LIMIT, failures,
      fixtureAggregateDigest, resultDigest: resultAccumulator, probeDigest: probeAccumulator, probeResultCount,
      staleMutationDigest: staleAccumulator, aggregateDigest,
      qualifications: ["The over-64-character query token is an expected empty-result limit of the current frozen keyword grammar, not a positive-match assertion.",
        "Separate synthetic 63/64/65/84-character controls document this boundary; no production behavior was changed."],
      timingElapsedMs: performance.now() - startedAt,
    };

    if (status !== "passed") process.exitCode = 1;
    await writeStressReport(run, report);
  } catch (error) {
    process.exitCode = 1;
    networkAttempts = networkAttemptsNow();
    const failReport = {
      protocol: "oh.synthetic-retrieval-saturation.v1", createdAt: new Date().toISOString(), status: "failed",
      error: sanitizeDetail(error instanceof Error ? error.message : String(error)),
      partialEvidence, sentinel, checks: counts,
      failureTotal, failuresStored: failures.length, failureStoreLimit: FAILURE_STORE_LIMIT, failures,
      networkAttempts, modelCalls: 0,
    };
    try { await writeStressReport(run, failReport); }
    catch { /* best effort; the validated new destination is unavailable */ }
    console.error("stress-retrieval failed:", sanitizeDetail(error instanceof Error ? error.message : String(error)));
  }
}

if (import.meta.main) {
  const stressRun = await beginStressRun(new URL(import.meta.url), parseStressArguments(process.argv.slice(2)));
  try { await main(stressRun); } finally { stressRun.restoreFetch(); }
}
