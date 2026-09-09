import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { validateClaudeLegacyExtraction, type ClaudeLegacyInput } from "../scripts/benchmarks/claude-legacy";
import { DATASETS, type Corpus, type Turn } from "../scripts/benchmarks/datasets";
import { corpusIdentity, validateUnitBundle, type UnitBundle } from "../scripts/benchmarks/extract";
import {
  buildExtractionChunks, extractionMessages, parseMemoryUnits, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE,
  EXTRACTION_SCHEMA, type ExtractionChunk,
} from "../scripts/benchmarks/units";

const encoder = new TextEncoder();
const h = (label: string): string => sha256Hex(`claude-legacy-synthetic:${label}`);
const source = h("original-source");
const selection = h("original-selection");
const turn = (id: string, sessionId: string, text: string): Turn => ({
  id, sessionId, date: "2026-01-01", speaker: "Casey", text,
});
const corpora: readonly Corpus[] = [
  { id: "corpus-a", groupId: "family-a", turns: [
    turn("a-0", "a-session-0", "Casey owns a blue bicycle."),
    turn("a-1", "a-session-1", "Hello there."),
    turn("a-2", "a-session-2", "Casey travels by train."),
  ] },
  { id: "corpus-b", groupId: "family-b", turns: [
    turn("b-0", "b-session-0", "Casey likes apples."),
    turn("b-1", "b-session-1", "Casey adopted a cat."),
  ] },
];

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error("Missing synthetic fixture item.");
  return value;
}

function payload(chunk: ExtractionChunk, mode: "valid" | "empty" | "all-rejected") {
  const first = at(chunk.turns, 0);
  const prediction = mode === "empty" ? { units: [] } : { units: [{
    text: first.text,
    supports: [{ turnId: first.id, quote: mode === "valid" ? first.text : "This quote is not in the source." }],
  }] };
  const parsed = parseMemoryUnits(prediction, chunk);
  return { id: chunk.id, units: parsed.units, rejected: parsed.rejected };
}

function fixture() {
  const schemaSha256: string = canonicalSha256(EXTRACTION_SCHEMA);
  const a = at(corpora, 0), b = at(corpora, 1);
  const ca = buildExtractionChunks(a), cb = buildExtractionChunks(b);
  const aChunks = [payload(at(ca, 0), "valid"), payload(at(ca, 1), "empty"), payload(at(ca, 2), "all-rejected")];
  // A stored success after a missing parent must survive the bridge unchanged.
  const bChunks = [payload(at(cb, 1), "valid")];
  const bundle: UnitBundle = {
    protocol: "oh.memory-unit-bundle.v1", dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256,
    split: "test", seed: 7,
    extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION),
      reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 8192 },
    corpora: [
      { corpusId: a.id, corpusSha256: corpusIdentity(a), chunks: aChunks, unitsSha256: canonicalSha256(aChunks.flatMap(x => x.units)) },
      { corpusId: b.id, corpusSha256: corpusIdentity(b), chunks: bChunks, unitsSha256: canonicalSha256(bChunks.flatMap(x => x.units)) },
    ],
    usage: { inputTokens: 120, cachedInputTokens: 0, outputTokens: 256, micros: 500 },
  };
  const report = {
    protocol: "oh.memory-benchmark.v1", status: "incomplete",
    manifest: { command: "extract", dataset: "longmemeval-s", source: DATASETS["longmemeval-s"], split: "test", seed: 7,
      selectedCorpora: corpora.map(corpus => corpus.id), code: { sourceSha256: source }, provenance: { reportSha256: selection } },
    unitBundle: bundle,
    provider: { extractor: "openai/gpt-4.1-mini", transport: "vercel-gateway", maximumOutput: 8192, temperature: 0,
      responseFormat: "json_schema", responseSchemaSha256: schemaSha256 },
  };
  return { report, aChunks, bChunks };
}

type FixtureReport = ReturnType<typeof fixture>["report"];
function inputOf(report: FixtureReport): ClaudeLegacyInput {
  const reportBytes = encoder.encode(`${JSON.stringify(report)}\n`);
  return { reportBytes, corpora, expected: { reportSha256: sha256Hex(reportBytes), sourceSha256: source,
    selectionReportSha256: selection, dataset: "longmemeval-s", split: "test", seed: 7 } };
}
function changedBundle(bundle: UnitBundle, entries: UnitBundle["corpora"]): UnitBundle {
  return { ...bundle, corpora: entries };
}

describe("Claude legacy checkpoint bridge", () => {
  test("native fixture validates; every stored payload survives and the missing parent stays explicit", () => {
    const f = fixture();
    const native = validateUnitBundle(f.report.unitBundle, "longmemeval-s", "test", 7, corpora, true);
    expect(native.size).toBe(2);
    const result = validateClaudeLegacyExtraction(inputOf(f.report));
    expect([result.requiredChunks, result.completedChunks, result.missingChunks, result.totalUnits]).toEqual([5, 4, 1, 2]);
    expect(result.parents.map(parent => parent.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(result.parents.map(parent => parent.chunkId)).toEqual(corpora.flatMap(corpus => buildExtractionChunks(corpus).map(chunk => chunk.id)));
    expect(at(result.parents, 3).legacy).toBeNull();
    for (const [index, expected] of [[0, f.aChunks[0]], [1, f.aChunks[1]], [2, f.aChunks[2]], [4, f.bChunks[0]]] as const) {
      if (expected === undefined) throw new Error("Fixture payload missing.");
      const inherited = at(result.parents, index).legacy;
      if (inherited === null) throw new Error("Inherited payload missing.");
      expect(inherited.origin).toBe("legacy-native");
      expect(inherited.payload).toEqual(expected);
      expect(inherited.payloadSha256).toBe(canonicalSha256(expected));
    }
    expect(at(result.parents, 1).legacy?.payload).toMatchObject({ units: [], rejected: 0 });
    expect(at(result.parents, 2).legacy?.payload).toMatchObject({ units: [], rejected: 1 });
    expect(result.provenance.extractor.reader).toBe("openai/gpt-4.1-mini");
    expect(result.provenance.reportedUsage).toEqual(f.report.unitBundle.usage);
    expect(result.provenance.originalStatus).toBe("incomplete");
  });

  test("raw report, source, selection, seed and selected corpus order remain independently pinned", () => {
    const input = inputOf(fixture().report);
    for (const field of ["reportSha256", "sourceSha256", "selectionReportSha256"] as const) {
      expect(() => validateClaudeLegacyExtraction({ ...input, expected: { ...input.expected, [field]: h(`wrong-${field}`) } })).toThrow();
    }
    expect(() => validateClaudeLegacyExtraction({ ...input, expected: { ...input.expected, seed: 8 } })).toThrow();
    expect(() => validateClaudeLegacyExtraction({ ...input, corpora: [...corpora].reverse() })).toThrow();
    const altered = encoder.encode(`${new TextDecoder().decode(input.reportBytes)} `);
    expect(() => validateClaudeLegacyExtraction({ ...input, reportBytes: altered })).toThrow();
  });

  test("repinned model/schema/status changes cannot relabel legacy payloads as Claude or completed", () => {
    const f = fixture();
    for (const report of [
      { ...f.report, status: "completed" },
      { ...f.report, provider: { ...f.report.provider, extractor: "claude-synthetic" } },
      { ...f.report, provider: { ...f.report.provider, responseSchemaSha256: h("wrong-schema") } },
      { ...f.report, unitBundle: { ...f.report.unitBundle, extractor: { ...f.report.unitBundle.extractor, reader: "claude-synthetic" } } },
    ]) expect(() => validateClaudeLegacyExtraction(inputOf(report))).toThrow();
  });

  test("native quote, payload identity and selected corpus identity validation cannot be bypassed by repinning", () => {
    const f = fixture(), storedA = at(f.report.unitBundle.corpora, 0), valid = at(storedA.chunks, 0), unit = at(valid.units, 0);
    const forged = { ...unit, supports: [{ turnId: at(unit.supports, 0).turnId, quote: "Absent source quote." }] };
    const forgedChunks = [{ ...valid, units: [forged] }, ...storedA.chunks.slice(1)];
    const forgedA = { ...storedA, chunks: forgedChunks, unitsSha256: canonicalSha256(forgedChunks.flatMap(chunk => chunk.units)) };
    const report = { ...f.report, unitBundle: changedBundle(f.report.unitBundle, [forgedA, ...f.report.unitBundle.corpora.slice(1)]) };
    expect(() => validateClaudeLegacyExtraction(inputOf(report))).toThrow();
    const a = at(corpora, 0);
    const alteredCorpora = [{ ...a, turns: [{ ...at(a.turns, 0), text: "Changed source text." }, ...a.turns.slice(1)] }, ...corpora.slice(1)];
    expect(() => validateClaudeLegacyExtraction({ ...inputOf(f.report), corpora: alteredCorpora })).toThrow();
  });

  test("foreign stored corpora and reordered chunks reject even when native partial validation alone passes", () => {
    const f = fixture(), a = at(f.report.unitBundle.corpora, 0);
    const foreign = { ...a, corpusId: "foreign-corpus" };
    const extra = changedBundle(f.report.unitBundle, [...f.report.unitBundle.corpora, foreign]);
    expect(validateUnitBundle(extra, "longmemeval-s", "test", 7, corpora, true).size).toBe(2);
    expect(() => validateClaudeLegacyExtraction(inputOf({ ...f.report, unitBundle: extra }))).toThrow();
    const reordered = [...a.chunks].reverse();
    const shuffled = changedBundle(f.report.unitBundle, [{ ...a, chunks: reordered,
      unitsSha256: canonicalSha256(reordered.flatMap(chunk => chunk.units)) }, ...f.report.unitBundle.corpora.slice(1)]);
    expect(validateUnitBundle(shuffled, "longmemeval-s", "test", 7, corpora, true).size).toBe(2);
    expect(() => validateClaudeLegacyExtraction(inputOf({ ...f.report, unitBundle: shuffled }))).toThrow();
  });

  test("absent corpus payloads produce all its native missing parents without inventing empty successes", () => {
    const f = fixture();
    const bundle = changedBundle(f.report.unitBundle, [at(f.report.unitBundle.corpora, 0)]);
    const result = validateClaudeLegacyExtraction(inputOf({ ...f.report, unitBundle: bundle }));
    expect(result.requiredChunks).toBe(5);
    expect(result.completedChunks).toBe(3);
    expect(result.parents.slice(3).map(parent => parent.legacy)).toEqual([null, null]);
  });

  test("Buffer/subviews are copied; malformed/shared bytes and accessor control fields reject", () => {
    const input = inputOf(fixture().report);
    const parent = new Uint8Array(input.reportBytes.length + 8);
    parent.set(input.reportBytes, 4);
    expect(validateClaudeLegacyExtraction({ ...input, reportBytes: parent.subarray(4, -4) }).completedChunks).toBe(4);
    expect(validateClaudeLegacyExtraction({ ...input, reportBytes: Buffer.from(input.reportBytes) }).completedChunks).toBe(4);
    const shared = new Uint8Array(new SharedArrayBuffer(input.reportBytes.length));
    shared.set(input.reportBytes);
    let accessors = 0;
    Object.defineProperty(shared, "buffer", { get() { accessors += 1; return new ArrayBuffer(shared.length); } });
    expect(() => validateClaudeLegacyExtraction({ ...input, reportBytes: shared })).toThrow();
    const expected = { ...input.expected };
    Object.defineProperty(expected, "sourceSha256", { enumerable: true, get() { accessors += 1; return source; } });
    expect(() => validateClaudeLegacyExtraction({ ...input, expected })).toThrow();
    expect(accessors).toBe(0);
    for (const malformed of [encoder.encode("\ufeff{}"), Uint8Array.of(0xff), encoder.encode("{"), new Uint8Array(0)]) {
      expect(() => validateClaudeLegacyExtraction({ ...input, reportBytes: malformed,
        expected: { ...input.expected, reportSha256: sha256Hex(malformed) } })).toThrow();
    }
  });

  test("result is detached/frozen and no model request occurs; native extraction prompts contain only the chunk", () => {
    const input = inputOf(fixture().report);
    const original = globalThis.fetch;
    let calls = 0;
    const forbidden = () => { calls += 1; throw new Error("No network in a legacy bridge."); };
    const tripwire: typeof fetch = Object.assign(forbidden, { preconnect: forbidden });
    globalThis.fetch = tripwire;
    try {
      const result = validateClaudeLegacyExtraction(input);
      const snapshot = JSON.stringify(result);
      input.reportBytes.fill(0);
      expect(JSON.stringify(result)).toBe(snapshot);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.parents)).toBe(true);
      const inherited = at(result.parents, 0).legacy;
      if (inherited === null) throw new Error("Expected inherited fixture.");
      expect(Object.isFrozen(inherited.payload.units)).toBe(true);
      expect(Object.isFrozen(at(inherited.payload.units, 0).supports)).toBe(true);
      const messages = extractionMessages(at(buildExtractionChunks(at(corpora, 0)), 0));
      expect(at(messages, 0).content).toBe(EXTRACTION_INSTRUCTION);
      expect(JSON.parse(at(messages, 1).content)).toEqual({ date: "2026-01-01", turns: [{
        turnId: "a-0", speaker: "Casey", text: "Casey owns a blue bicycle.",
      }] });
      expect(calls).toBe(0);
    } finally { globalThis.fetch = original; }
  });
});
