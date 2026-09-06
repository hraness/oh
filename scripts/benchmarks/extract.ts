import { open } from "node:fs/promises";

import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, type Corpus, type Dataset, type DatasetName, type Split } from "./datasets";
import { writeNew } from "./io";
import { callOpenAI, MODELS, ModelCompletionError, openPilotLedger, PilotBudget, validatePaidAccess } from "./model";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, EXTRACTION_SCHEMA, extractionMessages, parseMemoryUnits,
  type MemoryUnit } from "./units";

type Usage = Awaited<ReturnType<typeof callOpenAI>>["usage"];
type ChunkUnits = Readonly<{ id: string; units: readonly MemoryUnit[]; rejected: number }>;
type CorpusUnits = Readonly<{ corpusId: string; corpusSha256: string; chunks: readonly ChunkUnits[]; unitsSha256: string }>;
export type UnitBundle = Readonly<{
  protocol: "oh.memory-unit-bundle.v1"; dataset: DatasetName; datasetSha256: string; split: Split; seed: number;
  extractor: Readonly<{ profile: string; promptSha256: string; reader: string; provider: string; maximumOutput: number }>;
  corpora: readonly CorpusUnits[];
  usage: Readonly<{ inputTokens: number; cachedInputTokens: number; outputTokens: number; micros: number }>;
}>;
export type LoadedUnits = Readonly<{ units: ReadonlyMap<string, readonly MemoryUnit[]>; provenance: Readonly<{
  reportSha256: string; profile: string; model: string; promptSha256: string; totalUnits: number;
  inputTokens: number; cachedInputTokens: number; outputTokens: number; ingestionCostUsd: number;
}> }>;

export function corpusIdentity(corpus: Corpus): string {
  return canonicalSha256({ id: corpus.id, groupId: corpus.groupId, turns: corpus.turns.map((turn) => ({
    id: turn.id, sessionId: turn.sessionId, ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
    date: turn.date, speaker: turn.speaker, text: turn.text,
  })) });
}

export function validateUnitBundle(value: unknown, name: DatasetName, split: Split, seed: number,
  corpora: readonly Corpus[], allowPartial = false): ReadonlyMap<string, readonly MemoryUnit[]> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "dataset", "datasetSha256", "split", "seed", "extractor", "corpora", "usage"])
    || value.protocol !== "oh.memory-unit-bundle.v1" || value.dataset !== name || value.datasetSha256 !== DATASETS[name].sha256
    || value.split !== split || value.seed !== seed || !isPlainRecord(value.extractor)
    || !hasExactKeys(value.extractor, ["profile", "promptSha256", "reader", "provider", "maximumOutput"])
    || value.extractor.profile !== EXTRACTION_PROFILE || value.extractor.promptSha256 !== sha256Hex(EXTRACTION_INSTRUCTION)
    || typeof value.extractor.provider !== "string" || !["openai", "vercel-gateway"].includes(value.extractor.provider)
    || typeof value.extractor.reader !== "string" || !["gpt-4.1-mini-2025-04-14", "openai/gpt-4.1-mini"].includes(value.extractor.reader)
    || ![4_096, 8_192].includes(Number(value.extractor.maximumOutput)) || typeof value.extractor.maximumOutput !== "number"
    || !Array.isArray(value.corpora) || value.corpora.length > 1_000
    || !isPlainRecord(value.usage) || !hasExactKeys(value.usage, ["inputTokens", "cachedInputTokens", "outputTokens", "micros"])
    || Object.values(value.usage).some((number) => typeof number !== "number" || !Number.isSafeInteger(number) || number < 0)) {
    throw new TypeError("Invalid or incompatible memory-unit bundle.");
  }
  const stored = new Map<string, Record<string, unknown>>();
  for (const entry of value.corpora) {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ["corpusId", "corpusSha256", "chunks", "unitsSha256"])
      || typeof entry.corpusId !== "string" || stored.has(entry.corpusId)) throw new TypeError("Invalid or duplicate unit corpus.");
    stored.set(entry.corpusId, entry);
  }
  const result = new Map<string, readonly MemoryUnit[]>();
  for (const corpus of corpora) {
    const entry = stored.get(corpus.id);
    if (entry === undefined && allowPartial) continue;
    const chunks = buildExtractionChunks(corpus);
    if (!entry || entry.corpusSha256 !== corpusIdentity(corpus) || !Array.isArray(entry.chunks)
      || (allowPartial ? entry.chunks.length > chunks.length : entry.chunks.length !== chunks.length)) {
      throw new Error("Units are missing or stale for the requested corpus.");
    }
    const expected = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const seen = new Set<string>();
    const units: MemoryUnit[] = [];
    for (const cached of entry.chunks) {
      if (!isPlainRecord(cached) || !hasExactKeys(cached, ["id", "units", "rejected"]) || typeof cached.id !== "string"
        || !expected.has(cached.id) || seen.has(cached.id) || !Array.isArray(cached.units) || cached.units.length > 48
        || typeof cached.rejected !== "number" || !Number.isSafeInteger(cached.rejected) || cached.rejected < 0 || cached.rejected > 48) {
        throw new TypeError("Invalid unit chunk.");
      }
      seen.add(cached.id);
      const candidates = cached.units.map((unit: unknown) => {
        if (!isPlainRecord(unit) || !hasExactKeys(unit, ["id", "text", "date", "sessionId", "supports",
          ...(Object.hasOwn(unit, "sessionIndex") ? ["sessionIndex"] : [])])) throw new TypeError("Invalid cached memory unit.");
        return { text: unit.text, supports: unit.supports };
      });
      const checked = parseMemoryUnits({ units: candidates }, expected.get(cached.id)!);
      if (checked.rejected !== 0 || canonicalSha256(checked.units) !== canonicalSha256(cached.units)) {
        throw new Error("Cached units have invalid provenance or identity.");
      }
      units.push(...checked.units);
      if (units.length > 20_000) throw new RangeError("Memory-unit corpus bound exceeded.");
    }
    if (canonicalSha256(units) !== entry.unitsSha256) throw new Error("Memory-unit digest mismatch.");
    result.set(corpus.id, units);
  }
  return result;
}

export async function loadUnitReport(path: string, name: DatasetName, split: Split, seed: number,
  corpora: readonly Corpus[]): Promise<LoadedUnits> {
  const file = Bun.file(path);
  if (!await file.exists() || file.size > 64 * 1024 * 1024) throw new Error("Memory-unit report must be at most 64 MiB.");
  const bytes = await file.bytes();
  const report: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isPlainRecord(report) || report.protocol !== "oh.memory-benchmark.v1" || report.status !== "completed") {
    throw new TypeError("A completed extraction report is required.");
  }
  const units = validateUnitBundle(report.unitBundle, name, split, seed, corpora);
  const bundle = report.unitBundle as UnitBundle;
  return { units, provenance: { reportSha256: sha256Hex(bytes), profile: bundle.extractor.profile, model: bundle.extractor.reader,
    promptSha256: bundle.extractor.promptSha256, totalUnits: [...units.values()].reduce((sum, items) => sum + items.length, 0),
    inputTokens: bundle.usage.inputTokens, cachedInputTokens: bundle.usage.cachedInputTokens, outputTokens: bundle.usage.outputTokens,
    ingestionCostUsd: bundle.usage.micros / 1_000_000 } };
}

export async function runExtraction(input: Readonly<{ dataset: Dataset; datasetName: DatasetName; split: Split; seed: number;
  paid: boolean; maxUsd: number; maxCalls: number; reader: string; provider: string; output: string; resume?: string;
  concurrency?: number }>, dependencies: Readonly<{ environment?: Readonly<Record<string, string | undefined>>;
    fetcher?: typeof fetch; openLedger?: typeof openPilotLedger }> = {}): Promise<Record<string, unknown>> {
  const concurrency = input.concurrency ?? 3;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new RangeError("Extraction concurrency must be an integer from 1 through 12.");
  }
  const { apiKey, provider, selection } = validatePaidAccess(input, dependencies.environment);
  if (!["gpt-4.1-mini-2025-04-14", "openai/gpt-4.1-mini"].includes(input.reader)) throw new TypeError("Use the fixed GPT-4.1-mini extraction profile.");
  let previous: UnitBundle | undefined;
  let resumeSha256: string | null = null;
  if (input.resume !== undefined) {
    const file = Bun.file(input.resume);
    if (!await file.exists() || file.size > 64 * 1024 * 1024) throw new Error("Resume report must be at most 64 MiB.");
    const bytes = await file.bytes();
    const report: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isPlainRecord(report) || report.protocol !== "oh.memory-benchmark.v1") throw new TypeError("Invalid extraction resume report.");
    validateUnitBundle(report.unitBundle, input.datasetName, input.split, input.seed, input.dataset.corpora, true);
    previous = report.unitBundle as UnitBundle;
    const ids = new Set(input.dataset.corpora.map((corpus) => corpus.id));
    if (previous.extractor.reader !== input.reader || previous.extractor.provider !== provider
      || previous.corpora.some((corpus) => !ids.has(corpus.corpusId))) throw new Error("Resume source does not match this extraction experiment.");
    resumeSha256 = sha256Hex(bytes);
  }
  const path = `${input.output}.extraction.jsonl`;
  await writeNew(path, "");
  const checkpoint = await open(path, "a");
  const ledger = await (dependencies.openLedger ?? openPilotLedger)().catch(async (error: unknown) => { await checkpoint.close(); throw error; });
  const budget = new PilotBudget({ maxUsd: input.maxUsd, maxCalls: input.maxCalls, priorExposureMicros: ledger.exposure });
  const totals = { inputTokens: previous?.usage.inputTokens ?? 0, cachedInputTokens: previous?.usage.cachedInputTokens ?? 0,
    outputTokens: previous?.usage.outputTokens ?? 0, micros: previous?.usage.micros ?? 0 };
  let reusedChunks = 0;
  const corpora: CorpusUnits[] = [];
  const summaries: { corpusId: string; requestedChunks: number; completedChunks: number; units: number; rejected: number }[] = [];
  let checkpointWrites = Promise.resolve();
  let stopped: string | null = null;
  const account = (usage: Usage) => { totals.inputTokens += usage.inputTokens; totals.cachedInputTokens += usage.cachedInputTokens;
    totals.outputTokens += usage.outputTokens; totals.micros += usage.micros; };
  try {
    for (const corpus of input.dataset.corpora) {
      const chunks = buildExtractionChunks(corpus);
      const collected: ChunkUnits[] = [...(previous?.corpora.find((entry) => entry.corpusId === corpus.id)?.chunks ?? [])];
      reusedChunks += collected.length;
      const known = new Set(collected.map((chunk) => chunk.id));
      const missing = chunks.filter((chunk) => !known.has(chunk.id));
      for (let offset = 0; offset < missing.length && stopped === null; offset += concurrency) {
        const completed = await Promise.all(missing.slice(offset, offset + concurrency).map(async (chunk): Promise<ChunkUnits | null> => {
          let charged = false;
          try {
            const completion = await callOpenAI({ apiKey, provider, model: input.reader as keyof typeof MODELS,
              messages: extractionMessages(chunk), maximumOutput: 8_192, responseFormat: "memory_units_v1",
              seed: input.seed, budget, record: ledger.append,
              ...(dependencies.fetcher === undefined ? {} : { fetcher: dependencies.fetcher }) });
            account(completion.usage); charged = true;
            let raw: unknown;
            try { raw = JSON.parse(completion.prediction); } catch { throw new Error("Extractor did not return a JSON object."); }
            const parsed = parseMemoryUnits(raw, chunk);
            const entry = { id: chunk.id, units: parsed.units, rejected: parsed.rejected };
            const receipt = `${JSON.stringify({ corpusId: corpus.id, ...entry, usage: completion.usage,
              requestSha256: completion.requestSha256, reportedModel: completion.reportedModel })}\n`;
            checkpointWrites = checkpointWrites.then(async () => { await checkpoint.appendFile(receipt); await checkpoint.sync(); });
            await checkpointWrites;
            return entry;
          } catch (error) {
            if (!charged && error instanceof ModelCompletionError) account(error.usage);
            stopped ??= error instanceof Error ? error.message : "Memory extraction failed.";
            return null;
          }
        }));
        collected.push(...completed.filter((chunk): chunk is ChunkUnits => chunk !== null));
      }
      const collectedById = new Map(collected.map((chunk) => [chunk.id, chunk]));
      const ordered = chunks.flatMap((chunk) => { const found = collectedById.get(chunk.id); return found === undefined ? [] : [found]; });
      const units = ordered.flatMap((chunk) => chunk.units);
      corpora.push({ corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunks: ordered, unitsSha256: canonicalSha256(units) });
      summaries.push({ corpusId: corpus.id, requestedChunks: chunks.length, completedChunks: collected.length,
        units: units.length, rejected: collected.reduce((sum, chunk) => sum + chunk.rejected, 0) });
      // Continue collecting verified cached chunks from later corpora after any failure.
    }
  } finally { await ledger.close(); await checkpoint.close(); }
  const bundle: UnitBundle = { protocol: "oh.memory-unit-bundle.v1", dataset: input.datasetName,
    datasetSha256: DATASETS[input.datasetName].sha256, split: input.split, seed: input.seed,
    extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION), reader: input.reader,
      provider, maximumOutput: 8_192 }, corpora, usage: totals };
  return { status: stopped === null ? "completed" : "incomplete", stopped, unitBundle: bundle,
    extraction: { concurrency, resumeSha256, reusedChunks, priorIngestionCostUsd: (previous?.usage.micros ?? 0) / 1_000_000,
      corpora: summaries, totalUnits: summaries.reduce((sum, corpus) => sum + corpus.units, 0),
      rejectedUnits: summaries.reduce((sum, corpus) => sum + corpus.rejected, 0), usage: totals,
      unitBundleSha256: canonicalSha256(bundle), profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION) },
    provider: { extractor: input.reader, transport: provider, requestedModel: selection.requestedModel,
      snapshotPinned: selection.snapshotPinned, maximumOutput: 8_192, temperature: 0, responseFormat: "json_schema",
      responseSchemaSha256: canonicalSha256(EXTRACTION_SCHEMA) }, spend: budget.summary,
    qualifications: ["Question-blind ingestion of complete selected corpora; questions, reference answers, and evidence labels are never sent to the extractor.",
      "A supported quote proves source attribution, not semantic entailment of the extracted claim. Extraction can omit or misinterpret facts.",
      "Invalid individual claims are counted and rejected, not ingested. Malformed or clipped batches stop extraction without automatic retries.",
      "Extraction cost is separate from reader cost and remains in the shared cumulative ledger; cached reuse does not make ingestion free."] };
}
