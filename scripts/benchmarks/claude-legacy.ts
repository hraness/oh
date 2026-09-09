import { canonicalSha256, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { DATASETS, type Corpus, type DatasetName, type Split } from "./datasets";
import { corpusIdentity, validateUnitBundle, type UnitBundle } from "./extract";
import { buildExtractionChunks, EXTRACTION_SCHEMA, type MemoryUnit } from "./units";

export type ClaudeLegacyInput = Readonly<{
  reportBytes: Uint8Array;
  expected: Readonly<{
    reportSha256: string;
    sourceSha256: string;
    selectionReportSha256: string;
    dataset: DatasetName;
    split: Split;
    seed: number;
  }>;
  corpora: readonly Corpus[];
}>;

export type ClaudeLegacyPayload = Readonly<{ id: string; units: readonly MemoryUnit[]; rejected: number }>;
export type ClaudeLegacyParent = Readonly<{
  corpusId: string;
  corpusSha256: string;
  chunkId: string;
  ordinal: number;
  legacy: Readonly<{
    origin: "legacy-native";
    payload: ClaudeLegacyPayload;
    payloadSha256: string;
  }> | null;
}>;

export type ClaudeLegacyExtraction = Readonly<{
  protocol: "oh.memory-claude-legacy.v1";
  provenance: Readonly<{
    reportSha256: string;
    sourceSha256: string;
    selectionReportSha256: string;
    dataset: DatasetName;
    datasetSha256: string;
    split: Split;
    seed: number;
    originalStatus: "incomplete";
    extractor: UnitBundle["extractor"];
    schemaSha256: string;
    reportedUsage: UnitBundle["usage"];
  }>;
  parents: readonly ClaudeLegacyParent[];
  requiredChunks: number;
  completedChunks: number;
  missingChunks: number;
  totalUnits: number;
  qualifications: readonly string[];
}>;

const MAX_BYTES = 128 * 1024 * 1024;
const MAX_PARENTS = 50_000;
function fail(label: string): never { throw new TypeError(`Claude legacy bridge: ${label}.`); }

function record(value: unknown, label: string, keys?: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return fail(label);
  const names = Object.getOwnPropertyNames(value);
  if (keys !== undefined && (names.length !== keys.length || !keys.every(key => names.includes(key)))) return fail(label);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return fail(label);
  }
  return value;
}

const typedPrototype: object = Reflect.getPrototypeOf(Uint8Array.prototype) ?? {};
const bufferGetter = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")?.get;
const offsetGetter = Object.getOwnPropertyDescriptor(typedPrototype, "byteOffset")?.get;
const lengthGetter = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")?.get;
const resizableGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;

function copyBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || !bufferGetter || !offsetGetter || !lengthGetter) return fail("report bytes");
  let backing: unknown;
  let offset: unknown;
  let length: unknown;
  try {
    backing = Reflect.apply(bufferGetter, value, []);
    offset = Reflect.apply(offsetGetter, value, []);
    length = Reflect.apply(lengthGetter, value, []);
  } catch { return fail("report byte storage"); }
  if (!(backing instanceof ArrayBuffer) || typeof offset !== "number" || typeof length !== "number"
    || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > MAX_BYTES) {
    return fail("report byte bound or shared storage");
  }
  if (resizableGetter && Reflect.apply(resizableGetter, backing, []) !== false) return fail("resizable report storage");
  const copy = new Uint8Array(length);
  copy.set(new Uint8Array(backing, offset, length));
  return copy;
}

function decode(bytes: Uint8Array): Record<string, unknown> {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail("report UTF-8"); }
  if (text.charCodeAt(0) === 0xfeff) return fail("report byte order mark");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("report JSON"); }
  return record(value, "report object");
}

function same(actual: unknown, expected: unknown, label: string): void {
  if (actual === undefined || canonicalSha256(actual) !== canonicalSha256(expected)) fail(label);
}

function freezePayload(payload: ClaudeLegacyPayload): ClaudeLegacyPayload {
  for (const unit of payload.units) {
    for (const support of unit.supports) Object.freeze(support);
    Object.freeze(unit.supports);
    Object.freeze(unit);
  }
  Object.freeze(payload.units);
  return Object.freeze(payload);
}

/** Validate an independently pinned incomplete native checkpoint; never execute a model or infer a missing outcome. */
export function validateClaudeLegacyExtraction(input: ClaudeLegacyInput): ClaudeLegacyExtraction {
  record(input, "input", ["reportBytes", "expected", "corpora"]);
  record(input.expected, "expected identities", ["reportSha256", "sourceSha256", "selectionReportSha256", "dataset", "split", "seed"]);
  const pins = input.expected;
  for (const digest of [pins.reportSha256, pins.sourceSha256, pins.selectionReportSha256]) {
    if (parseSha256Hex(digest) === null) fail("expected digest");
  }
  if (!Object.hasOwn(DATASETS, pins.dataset) || !["dev", "test", "all"].includes(pins.split)
    || !Number.isSafeInteger(pins.seed) || Object.is(pins.seed, -0) || pins.seed < 0 || pins.seed > 4_294_967_295) {
    fail("dataset, split or seed");
  }
  if (!Array.isArray(input.corpora) || input.corpora.length < 1 || input.corpora.length > 1_000) fail("selected corpora");
  const selectedIds = input.corpora.map(corpus => corpus.id);
  if (new Set(selectedIds).size !== selectedIds.length) fail("duplicate selected corpus");
  const bytes = copyBytes(input.reportBytes);
  if (sha256Hex(bytes) !== pins.reportSha256) fail("raw report digest");
  const report = decode(bytes);
  if (report.protocol !== "oh.memory-benchmark.v1" || report.status !== "incomplete") fail("incomplete native report required");
  const manifest = record(report.manifest, "manifest");
  same(manifest.command, "extract", "manifest command");
  same(manifest.dataset, pins.dataset, "manifest dataset");
  same(manifest.split, pins.split, "manifest split");
  same(manifest.seed, pins.seed, "manifest seed");
  same(record(manifest.source, "manifest source").sha256, DATASETS[pins.dataset].sha256, "dataset source digest");
  same(record(manifest.code, "manifest code").sourceSha256, pins.sourceSha256, "original source digest");
  same(record(manifest.provenance, "selection provenance").reportSha256, pins.selectionReportSha256, "selection report digest");
  same(manifest.selectedCorpora, selectedIds, "selected corpus order");

  // This native partial validator verifies each stored payload's source quotes,
  // derived identity, chunk membership and corpus/unit digests. It does not grant
  // completed-report status, authenticate timing, or validate monetary settlement.
  validateUnitBundle(report.unitBundle, pins.dataset, pins.split, pins.seed, input.corpora, true);
  const bundle = report.unitBundle as UnitBundle;
  const provider = record(report.provider, "native extractor provider");
  same(bundle.extractor.maximumOutput, 8192, "original extraction cap");
  same(provider.extractor, bundle.extractor.reader, "original extractor model");
  same(provider.transport, bundle.extractor.provider, "original extractor transport");
  same(provider.maximumOutput, 8192, "original provider cap");
  same(provider.temperature, 0, "original temperature");
  same(provider.responseFormat, "json_schema", "original response format");
  same(provider.responseSchemaSha256, canonicalSha256(EXTRACTION_SCHEMA), "original schema digest");

  const positions = new Map(selectedIds.map((id, index) => [id, index]));
  let lastCorpus = -1;
  for (const stored of bundle.corpora) {
    const position = positions.get(stored.corpusId);
    if (position === undefined || position <= lastCorpus) fail("foreign or reordered stored corpus");
    lastCorpus = position;
  }
  const storedCorpora = new Map(bundle.corpora.map(corpus => [corpus.corpusId, corpus]));
  const parents: ClaudeLegacyParent[] = [];
  let completedChunks = 0;
  let totalUnits = 0;
  for (const corpus of input.corpora) {
    const corpusSha256 = corpusIdentity(corpus);
    const chunks = buildExtractionChunks(corpus);
    if (parents.length + chunks.length > MAX_PARENTS) fail("native parent bound");
    const stored = storedCorpora.get(corpus.id)?.chunks ?? [];
    const chunkPositions = new Map(chunks.map((chunk, index) => [chunk.id, index]));
    let lastChunk = -1;
    for (const chunk of stored) {
      const position = chunkPositions.get(chunk.id);
      if (position === undefined || position <= lastChunk) fail("foreign or reordered stored chunk");
      lastChunk = position;
    }
    const storedChunks = new Map(stored.map(chunk => [chunk.id, chunk]));
    for (const chunk of chunks) {
      const payload = storedChunks.get(chunk.id);
      const legacy = payload === undefined ? null : Object.freeze({
        origin: "legacy-native" as const,
        payload: freezePayload(payload),
        payloadSha256: canonicalSha256(payload),
      });
      if (legacy !== null) { completedChunks += 1; totalUnits += legacy.payload.units.length; }
      parents.push(Object.freeze({ corpusId: corpus.id, corpusSha256, chunkId: chunk.id, ordinal: parents.length, legacy }));
    }
  }
  return Object.freeze({
    protocol: "oh.memory-claude-legacy.v1",
    provenance: Object.freeze({
      reportSha256: pins.reportSha256, sourceSha256: pins.sourceSha256, selectionReportSha256: pins.selectionReportSha256,
      dataset: pins.dataset, datasetSha256: DATASETS[pins.dataset].sha256, split: pins.split, seed: pins.seed,
      originalStatus: "incomplete", extractor: Object.freeze(bundle.extractor), schemaSha256: canonicalSha256(EXTRACTION_SCHEMA),
      reportedUsage: Object.freeze(bundle.usage),
    }),
    parents: Object.freeze(parents), requiredChunks: parents.length, completedChunks,
    missingChunks: parents.length - completedChunks, totalUnits,
    qualifications: Object.freeze([
      "Legacy native extraction payloads retain their original extractor identity; they are not Claude outputs.",
      "Independent checkpoint identity selects the previously preserved successes. Source quotes and native identities are revalidated; provider responses and earliest-success timing are not reconstructed.",
      "Empty and all-rejected stored chunks remain successful payloads. Missing parents stay explicit and require new extraction before complete memory use.",
      "Rejected counts and historical usage are preserved from the pinned report, not re-inferred. No subscription billing, API settlement or new USD ledger entry is established.",
    ]),
  });
}
