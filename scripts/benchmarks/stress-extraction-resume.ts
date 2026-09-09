// stress-extraction-resume.ts
// Offline synthetic extraction-resume stress benchmark. No real datasets, network, or credentials.
// Usage: bun run bench:stress:resume --expected-source-sha256 SOURCE_SHA256 --output ABS_NEW_OUTPUT_JSON
//
// This exercises generic, non-frozen extraction resume/checkpoint plumbing (concurrency, transport
// interruption, and budget accounting) against synthetic fixtures only. It does not add or claim a
// frozen-protocol scenario, and it makes zero real network calls.
import { chmod, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  beginStressRun,
  finishStressRun,
  parseStressArguments,
  writeStressReport,
} from "./stress-common";
import type { Corpus, Turn } from "./datasets";
import type { UnitBundle } from "./extract";
import type { callOpenAI, openPilotLedger } from "./model";
import type { ExtractionChunk, MemoryUnit } from "./units";

type PilotLedger = Awaited<ReturnType<typeof openPilotLedger>>;
type LedgerEvent = Parameters<PilotLedger["append"]>[0];
type Usage = Awaited<ReturnType<typeof callOpenAI>>["usage"];
type BundleUsage = UnitBundle["usage"];
type CorpusUnits = UnitBundle["corpora"][number];
type ChunkUnits = CorpusUnits["chunks"][number];
type PriorBundle = Readonly<{ corpora: readonly CorpusUnits[]; usage: BundleUsage }>;

type Receipt = Readonly<{ corpusId: string; id: string; units: readonly MemoryUnit[]; rejected: number;
  usage: Usage; requestSha256: string; reportedModel: string }>;

type ExtractionOutcome = Readonly<{
  status: "completed" | "incomplete";
  stopped: string | null;
  unitBundle: UnitBundle;
  extraction: Readonly<{ concurrency: number; reusedChunks: number; priorIngestionCostUsd: number;
    totalUnits: number; usage: BundleUsage }>;
  spend: Readonly<{ capUsd: number; maxCalls: number; reservedCalls: number; priorExposureUsd: number;
    accountedUsd: number; confirmedThisRunUsd: number; unresolvedThisRunUsd: number }>;
}>;

type ScenarioRow = { scenario: string; concurrency: number; order: Order; status: "pass" | "fail";
  checkCount?: number; failedInvariantCount?: number; error?: string; simulatedCalls?: number;
  realNetworkCalls?: number; successes?: number; plannedFailures?: number; finalChunks?: number;
  maximumConcurrencyObserved?: number; micros?: number; unresolvedReservations?: number;
  settledCount?: number; reservedCount?: number; accountedUsd?: number; digest?: string;
  orderBatchDigest?: string };

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function numeric(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of keys) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) throw new Error(`${label}.${key} must be a number`);
  }
}

function usageRecord(value: unknown, label: string): void {
  numeric(record(value, label), ["inputTokens", "cachedInputTokens", "outputTokens", "micros"], label);
}

function bundleRecord(value: unknown, label: string): void {
  const bundle = record(value, label);
  if (!Array.isArray(bundle.corpora)) throw new Error(`${label}.corpora must be an array`);
  for (const corpus of bundle.corpora) {
    const entry = record(corpus, `${label}.corpora[]`);
    if (typeof entry.corpusId !== "string" || !Array.isArray(entry.chunks)) throw new Error(`${label} has an invalid corpus entry`);
    for (const chunk of entry.chunks) {
      const stored = record(chunk, `${label}.chunks[]`);
      if (typeof stored.id !== "string" || !Array.isArray(stored.units) || typeof stored.rejected !== "number") {
        throw new Error(`${label} has an invalid chunk entry`);
      }
    }
  }
  usageRecord(bundle.usage, `${label}.usage`);
}

// runExtraction returns an untyped envelope; it is validated once here and only then used as a typed value.
function extractionOutcome(value: Record<string, unknown>): ExtractionOutcome {
  if (value.status !== "completed" && value.status !== "incomplete") throw new Error("extraction status is invalid");
  if (value.stopped !== null && typeof value.stopped !== "string") throw new Error("extraction stop reason is invalid");
  bundleRecord(value.unitBundle, "unitBundle");
  const extraction = record(value.extraction, "extraction");
  numeric(extraction, ["concurrency", "reusedChunks", "priorIngestionCostUsd", "totalUnits"], "extraction");
  usageRecord(extraction.usage, "extraction.usage");
  numeric(record(value.spend, "spend"), ["capUsd", "maxCalls", "reservedCalls", "priorExposureUsd",
    "accountedUsd", "confirmedThisRunUsd", "unresolvedThisRunUsd"], "spend");
  return value as unknown as ExtractionOutcome;
}

function storedBundle(value: unknown): UnitBundle {
  const envelope = record(value, "resume envelope");
  if (envelope.protocol !== "oh.memory-benchmark.v1") throw new Error("resume envelope protocol is invalid");
  bundleRecord(envelope.unitBundle, "resume unitBundle");
  return envelope.unitBundle as UnitBundle;
}

function parseReceipt(line: string): Receipt {
  const receipt = record(JSON.parse(line), "checkpoint receipt");
  if (typeof receipt.corpusId !== "string" || typeof receipt.id !== "string" || !Array.isArray(receipt.units)
    || typeof receipt.rejected !== "number" || typeof receipt.reportedModel !== "string"
    || typeof receipt.requestSha256 !== "string") throw new Error("checkpoint receipt has an unexpected shape");
  for (const unit of receipt.units) {
    if (typeof record(unit, "receipt unit").text !== "string") throw new Error("checkpoint receipt unit is malformed");
  }
  usageRecord(receipt.usage, "receipt.usage");
  return receipt as unknown as Receipt;
}

function sanitize(message: string): string {
  return message.replace(/[A-Za-z0-9+/_.-]{20,}/g, "[REDACTED]").slice(0, 300);
}

const failures: { scenario: string; invariant: string; detail?: string }[] = [];
let checkCalls = 0;
function check(scenario: string, invariant: string, cond: boolean, detail?: string) {
  checkCalls += 1;
  if (!cond) failures.push({ scenario, invariant, ...(detail === undefined ? {} : { detail: sanitize(detail) }) });
}

function makeTurn(corpusId: string, i: number): Turn {
  return { id: `${corpusId}:${i}`, sessionId: `${corpusId}-session-${i}`, date: "2026-01-01", speaker: "Ada",
    text: `synthetic corpus ${corpusId} turn ${i}: fact ${i} recorded verbatim.` };
}
function makeCorpus(corpusId: string): Corpus {
  return { id: corpusId, groupId: corpusId, turns: Array.from({ length: 25 }, (_, i) => makeTurn(corpusId, i)) };
}

function completionFor(turnId: string, text: string): Response {
  const quote = text.slice(text.indexOf("fact "), text.indexOf("fact ") + `fact ${turnId.split(":")[1]} recorded`.length);
  const units = [{ text: `Ada recorded a fact in ${turnId}.`, supports: [{ turnId, quote }] }];
  return Response.json({ model: "openai/gpt-4.1-mini", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ units }) } }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
}

type Order = "forward" | "reverse" | "interleaved";
function permutationOrder(order: Order, n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (order === "forward") return idx;
  if (order === "reverse") return [...idx].reverse();
  const out: number[] = [];
  let lo = 0, hi = n - 1;
  while (lo <= hi) { out.push(lo); if (lo !== hi) out.push(hi); lo += 1; hi -= 1; }
  return out;
}

type BatchEvidence = { dispatch: string[]; resolved: string[] };

class ScheduledFetcher {
  private pending: { turnId: string; resolve: (r: Response) => void; reject: (e: Error) => void }[] = [];
  private scheduled = false;
  private active = 0;
  private readonly completedIds = new Set<string>();
  private readonly pendingIds = new Set<string>();
  maxActive = 0;
  calls = 0;
  rejections = 0;
  requestedIds: string[] = [];
  invocations: string[] = [];
  batches: BatchEvidence[] = [];
  invariantViolations: string[] = [];
  readonly fetcher: typeof fetch;

  // knownTurnIds holds the first-turn identifiers of chunks already stored in the resume bundle, so the
  // duplicate guard compares turn ids against turn ids instead of chunk ids against turn ids.
  constructor(private readonly turnsById: Map<string, string>, private readonly order: Order,
    private readonly failTurnId: string | undefined, private readonly knownTurnIds: ReadonlySet<string>) {
    this.fetcher = (async (_url: unknown, init: unknown) => {
      const requestBody = record(JSON.parse(String(record(init, "request init").body)), "request body");
      const messages = requestBody.messages;
      if (!Array.isArray(messages) || messages.length < 2) throw new Error("synthetic request has no user message");
      const userContent = record(messages[1], "request message").content;
      if (typeof userContent !== "string") throw new Error("synthetic request content is not a string");
      const turns = record(JSON.parse(userContent), "chunk payload").turns;
      if (!Array.isArray(turns) || turns.length === 0) throw new Error("synthetic chunk payload has no turns");
      const turnId = record(turns[0], "chunk turn").turnId;
      if (typeof turnId !== "string") throw new Error("synthetic chunk turn id is not a string");
      this.calls += 1;
      this.invocations.push(turnId);
      if (this.knownTurnIds.has(turnId) || this.completedIds.has(turnId) || this.pendingIds.has(turnId)
        || this.requestedIds.includes(turnId)) {
        this.invariantViolations.push(turnId);
        throw new Error("synthetic invariant: duplicate request for an already-completed or pending chunk");
      }
      this.requestedIds.push(turnId);
      this.pendingIds.add(turnId);
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      return new Promise<Response>((resolve, reject) => {
        this.pending.push({
          turnId,
          resolve: (response) => { this.active -= 1; this.pendingIds.delete(turnId); this.completedIds.add(turnId); resolve(response); },
          reject: (error) => { this.active -= 1; this.pendingIds.delete(turnId); reject(error); },
        });
        if (!this.scheduled) { this.scheduled = true; setTimeout(() => this.flush(), 0); }
      });
    }) as typeof fetch;
  }

  private flush(): void {
    const batch = this.pending;
    this.pending = [];
    this.scheduled = false;
    if (batch.length === 0) return;
    const dispatch = batch.map((b) => b.turnId);
    const resolved: string[] = [];
    this.batches.push({ dispatch, resolved });
    const permutation = permutationOrder(this.order, batch.length);
    permutation.forEach((originalIndex, rank) => {
      const item = batch[originalIndex]!;
      setTimeout(() => {
        resolved.push(item.turnId);
        if (item.turnId === this.failTurnId) {
          this.rejections += 1;
          item.reject(new Error("synthetic transport failure"));
        } else {
          item.resolve(completionFor(item.turnId, this.turnsById.get(item.turnId)!));
        }
      }, rank * 5 + 1);
    });
  }
}

function expectedOrderFor(order: Order, dispatch: readonly string[]): string[] {
  const permutation = permutationOrder(order, dispatch.length);
  return permutation.map((i) => dispatch[i]!);
}

// The second parameter is the imported model namespace object, not a ledger factory: only its pure
// ledgerExposure helper is read, and no real pilot ledger is ever opened.
function makeLedger(initialEvents: readonly LedgerEvent[],
  exposureSource: { ledgerExposure: (events: readonly unknown[]) => number }) {
  const events: LedgerEvent[] = [...initialEvents];
  let openCount = 0;
  let closeCount = 0;
  const openLedger: typeof openPilotLedger = async () => {
    openCount += 1;
    return { exposure: exposureSource.ledgerExposure(events), append: async (event: LedgerEvent) => { events.push(event); },
      close: async () => { closeCount += 1; } };
  };
  return { openLedger, events, openCount: () => openCount, closeCount: () => closeCount };
}

// Independent reconstruction of ledger state; deliberately does not reuse model.ts's ledgerExposure logic
// so it can corroborate that function rather than merely echo it.
function reconstructLedger(events: readonly LedgerEvent[]) {
  const reservedAt = new Map<string, number>();
  const settledAt = new Map<string, number>();
  const micros = new Map<string, number>();
  let running = 0;
  let peakExposure = 0;
  events.forEach((event, index) => {
    if (event.v !== 1) throw new Error("unexpected ledger event version");
    const id = event.id;
    if (typeof id !== "string" || id.length === 0) throw new Error("invalid ledger event id");
    const eventMicros = event.micros;
    if (!Number.isSafeInteger(eventMicros) || eventMicros < 0) throw new Error("non-integer ledger micros");
    if (event.kind === "reserved") {
      if (reservedAt.has(id)) throw new Error("duplicate reservation id");
      reservedAt.set(id, index);
      micros.set(id, eventMicros);
      running += eventMicros;
      peakExposure = Math.max(peakExposure, running);
    } else if (event.kind === "settled") {
      if (!reservedAt.has(id) || reservedAt.get(id)! > index) throw new Error("settlement precedes reservation");
      if (settledAt.has(id)) throw new Error("duplicate settlement for reservation id");
      if (eventMicros > micros.get(id)!) throw new Error("settlement exceeds reservation");
      running -= micros.get(id)! - eventMicros;
      settledAt.set(id, index);
      micros.set(id, eventMicros);
    } else throw new Error("unknown ledger event kind");
  });
  const exposure = [...micros.values()].reduce((sum, m) => sum + m, 0);
  if (running !== exposure) throw new Error("ledger exposure reconstruction disagreed with itself");
  const unresolvedIds = [...reservedAt.keys()].filter((id) => !settledAt.has(id));
  const unresolvedMicros = unresolvedIds.reduce((sum, id) => sum + micros.get(id)!, 0);
  const confirmedMicros = [...settledAt.keys()].reduce((sum, id) => sum + micros.get(id)!, 0);
  return { exposure, peakExposure, reservedCount: reservedAt.size, settledCount: settledAt.size, confirmedMicros,
    unresolvedIds, unresolvedCount: unresolvedIds.length, unresolvedMicros };
}

export async function main(argv: readonly string[]): Promise<void> {
  const run = await beginStressRun(new URL(import.meta.url), parseStressArguments(argv));
  const tmpDirs: string[] = [];
  const rows: ScenarioRow[] = [];
  const cleanupFailures: string[] = [];
  let cleanedUp = false;
  let status: "passed" | "failed" = "failed";

  // Removes every owned mode-0700 temporary directory, attempting all of them even after a failure.
  async function cleanupOwnedDirectories(): Promise<void> {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const directory of tmpDirs) {
      try {
        await rm(directory, { recursive: true, force: true });
        const present = await lstat(directory).then(() => true, (error: unknown) => {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
          throw error;
        });
        if (present) cleanupFailures.push(sanitize(`${directory} still exists after removal`));
      } catch (error) {
        cleanupFailures.push(sanitize(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  try {
    // Repository modules are imported only after the shared network tripwire is installed.
    const io = await import("./io");
    const extract = await import("./extract");
    const model = await import("./model");
    const units = await import("./units");
    const canonical = await import("../../src/canonical");
    const { DATASETS } = await import("./datasets");

    async function tmp(prefix: string) {
      const d = await mkdtemp(join(tmpdir(), prefix));
      tmpDirs.push(d);
      await chmod(d, 0o700);
      return d;
    }

    const corpora = [makeCorpus("A"), makeCorpus("B"), makeCorpus("C")];
    const turnsById = new Map<string, string>();
    for (const c of corpora) for (const t of c.turns) turnsById.set(t.id, t.text);
    const environment = { VERCEL_OIDC_TOKEN: "synthetic-token" };
    const baseArgs = { datasetName: "locomo" as const, split: "dev" as const, seed: 17, paid: true, maxUsd: 10, maxCalls: 1000,
      reader: "openai/gpt-4.1-mini", provider: "vercel-gateway" as const };

    const chunkPlan = (corpus: Corpus): readonly ExtractionChunk[] => units.buildExtractionChunks(corpus);
    function allChunkIdsOrdered(): Map<string, string[]> {
      const map = new Map<string, string[]>();
      for (const c of corpora) map.set(c.id, chunkPlan(c).map((ch) => ch.id));
      return map;
    }
    const orderedIds = allChunkIdsOrdered();
    // Precomputed chunk-id -> first-turn-id mapping taken from the same buildExtractionChunks plan the
    // extractor uses; no separate identity algorithm is invented here.
    const turnIdOfChunk = new Map<string, string>();
    for (const c of corpora) for (const ch of chunkPlan(c)) turnIdOfChunk.set(ch.id, ch.turns[0]!.id);

    function knownIds(bundle: PriorBundle): Set<string> {
      return new Set(bundle.corpora.flatMap((c) => c.chunks.map((ch) => ch.id)));
    }
    function knownTurnIds(bundle: PriorBundle): Set<string> {
      return new Set([...knownIds(bundle)].map((id) => {
        const turnId = turnIdOfChunk.get(id);
        if (turnId === undefined) throw new Error("resume bundle holds a chunk outside the synthetic extraction plan");
        return turnId;
      }));
    }
    function missingOf(bundle: PriorBundle): { id: string; turnId: string }[] {
      const known = knownIds(bundle);
      const out: { id: string; turnId: string }[] = [];
      for (const c of corpora) for (const ch of chunkPlan(c)) if (!known.has(ch.id)) out.push({ id: ch.id, turnId: ch.turns[0]!.id });
      return out;
    }
    type StageInput = { scenarioId: string; label: string; priorBundle: PriorBundle; result: ExtractionOutcome;
      outputPath: string; fetcher: ScheduledFetcher; events: readonly LedgerEvent[]; eventBoundary: number;
      entryExposure: number; concurrency: number; expectedUnresolved: number };

    // One shared verification pass, applied identically to the baseline, the three interrupted stages,
    // and the final resume.
    async function verifyStage(o: StageInput): Promise<{ newChunkCount: number }> {
      const { scenarioId, label, priorBundle, result, fetcher, events, eventBoundary } = o;
      const bundle = result.unitBundle;
      const payloadOf = (chunk: ChunkUnits | Receipt) =>
        canonical.canonicalJson({ id: chunk.id, units: chunk.units, rejected: chunk.rejected });
      const keyOf = (corpusId: string, chunkId: string) => canonical.canonicalJson([corpusId, chunkId]);

      // (A) Every mock invocation is a distinct chunk that was not already stored.
      check(scenarioId, `${label}-no-invariant-violations`, fetcher.invariantViolations.length === 0,
        fetcher.invariantViolations.join(","));
      check(scenarioId, `${label}-invocations-recorded`, fetcher.invocations.length === fetcher.calls);
      check(scenarioId, `${label}-invocations-distinct`, new Set(fetcher.invocations).size === fetcher.invocations.length);
      const priorTurns = knownTurnIds(priorBundle);
      check(scenarioId, `${label}-no-refetch-of-known`, fetcher.invocations.every((turnId) => !priorTurns.has(turnId)));
      check(scenarioId, `${label}-max-active-bound`, fetcher.maxActive <= o.concurrency);

      // (B) Previously stored chunks survive unchanged; corpus and chunk ordering stay canonical.
      const priorPayloads = new Map<string, string>();
      for (const c of priorBundle.corpora) for (const ch of c.chunks) priorPayloads.set(keyOf(c.corpusId, ch.id), payloadOf(ch));
      const newPayloads = new Map<string, string>();
      for (const c of bundle.corpora) for (const ch of c.chunks) {
        const key = keyOf(c.corpusId, ch.id);
        check(scenarioId, `${label}-no-duplicate-chunk-identity`, !newPayloads.has(key), key);
        newPayloads.set(key, payloadOf(ch));
      }
      for (const [key, payload] of priorPayloads) check(scenarioId, `${label}-chunk-preserved`, newPayloads.get(key) === payload, key);
      check(scenarioId, `${label}-corpus-order`, canonical.canonicalJson(bundle.corpora.map((c) => c.corpusId))
        === canonical.canonicalJson(corpora.map((c) => c.id)));
      for (const corpus of corpora) {
        const entry = bundle.corpora.find((c) => c.corpusId === corpus.id);
        const plan = orderedIds.get(corpus.id)!;
        const ids: string[] = entry === undefined ? [] : entry.chunks.map((ch) => ch.id);
        const present = new Set(ids);
        check(scenarioId, `${label}-plan-membership-${corpus.id}`, present.size === ids.length && ids.every((id) => plan.includes(id)));
        check(scenarioId, `${label}-chunk-order-${corpus.id}`,
          canonical.canonicalJson(ids) === canonical.canonicalJson(plan.filter((id) => present.has(id))));
      }

      // (C) Exactly one deterministic checkpoint receipt per newly completed chunk, and nothing else.
      const newKeys = [...newPayloads.keys()].filter((key) => !priorPayloads.has(key));
      const receiptText = await Bun.file(`${o.outputPath}.extraction.jsonl`).text();
      check(scenarioId, `${label}-empty-receipts-only-without-success`, receiptText.length > 0 || newKeys.length === 0);
      if (receiptText.length > 0) check(scenarioId, `${label}-receipts-trailing-newline`, receiptText.endsWith("\n"));
      const lines = receiptText.length === 0 ? [] : receiptText.replace(/\n$/, "").split("\n");
      check(scenarioId, `${label}-receipts-no-blank-lines`, lines.every((line) => line.length > 0));
      const receipts = lines.map((line) => parseReceipt(line));
      check(scenarioId, `${label}-receipt-count`, receipts.length === newKeys.length, `${receipts.length} vs ${newKeys.length}`);
      const seenReceipts = new Set<string>();
      for (const receipt of receipts) {
        const key = keyOf(receipt.corpusId, receipt.id);
        check(scenarioId, `${label}-receipt-is-new-chunk`, newPayloads.has(key) && !priorPayloads.has(key), key);
        check(scenarioId, `${label}-receipt-identity-unique`, !seenReceipts.has(key), key);
        seenReceipts.add(key);
        check(scenarioId, `${label}-receipt-payload`, payloadOf(receipt) === newPayloads.get(key), key);
        const usage = receipt.usage;
        check(scenarioId, `${label}-receipt-usage`, usage.inputTokens === 20 && usage.cachedInputTokens === 0
          && usage.outputTokens === 10 && usage.micros === 24 && usage.cacheTokensReported === false, key);
        check(scenarioId, `${label}-receipt-model`, receipt.reportedModel === "openai/gpt-4.1-mini", key);
      }
      check(scenarioId, `${label}-receipts-cover-new-chunks`, seenReceipts.size === newKeys.length
        && newKeys.every((key) => seenReceipts.has(key)));

      // (D) Cumulative usage equals prior bundle usage plus this stage's successful receipt usage.
      const receiptUsage = receipts.reduce((sum, receipt) => ({
        inputTokens: sum.inputTokens + receipt.usage.inputTokens,
        cachedInputTokens: sum.cachedInputTokens + receipt.usage.cachedInputTokens,
        outputTokens: sum.outputTokens + receipt.usage.outputTokens,
        micros: sum.micros + receipt.usage.micros,
      }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 });
      const priorUsage = priorBundle.usage;
      check(scenarioId, `${label}-cumulative-usage`, canonical.canonicalJson(bundle.usage) === canonical.canonicalJson({
        inputTokens: priorUsage.inputTokens + receiptUsage.inputTokens,
        cachedInputTokens: priorUsage.cachedInputTokens + receiptUsage.cachedInputTokens,
        outputTokens: priorUsage.outputTokens + receiptUsage.outputTokens,
        micros: priorUsage.micros + receiptUsage.micros }));
      const extraction = result.extraction;
      check(scenarioId, `${label}-extraction-usage-agrees`,
        canonical.canonicalJson(extraction.usage) === canonical.canonicalJson(bundle.usage));
      check(scenarioId, `${label}-reused-chunks`, extraction.reusedChunks === priorPayloads.size);
      check(scenarioId, `${label}-prior-ingestion-cost`,
        extraction.priorIngestionCostUsd === priorUsage.micros / 1_000_000);

      // (E) Exact ledger and spend accounting for this stage, without USD tolerances.
      const priorLedger = reconstructLedger(events.slice(0, eventBoundary));
      check(scenarioId, `${label}-entry-exposure-snapshot`, priorLedger.exposure === o.entryExposure);
      const stageEvents = events.slice(eventBoundary);
      const newReservations = stageEvents.filter((e) => e.kind === "reserved");
      const newSettlements = stageEvents.filter((e) => e.kind === "settled");
      const fullLedger = reconstructLedger(events);
      const spend = result.spend;
      check(scenarioId, `${label}-cap-and-max-calls`, spend.capUsd === baseArgs.maxUsd && spend.maxCalls === baseArgs.maxCalls);
      check(scenarioId, `${label}-reserved-calls`, spend.reservedCalls === fetcher.calls
        && newReservations.length === fetcher.calls && fetcher.calls <= baseArgs.maxCalls);
      check(scenarioId, `${label}-prior-exposure-usd`, spend.priorExposureUsd === o.entryExposure / 1_000_000);
      check(scenarioId, `${label}-settlements-exactly-24`, newSettlements.length === receipts.length
        && newSettlements.every((e) => e.micros === 24));
      check(scenarioId, `${label}-confirmed-this-run-usd`, spend.confirmedThisRunUsd === (receipts.length * 24) / 1_000_000);
      const newReserved = new Map(newReservations.map((e) => [e.id, e.micros] as const));
      const stageUnresolved = fullLedger.unresolvedIds.filter((id) => newReserved.has(id));
      const stageUnresolvedMicros = stageUnresolved.reduce((sum, id) => sum + newReserved.get(id)!, 0);
      check(scenarioId, `${label}-unresolved-count`, stageUnresolved.length === o.expectedUnresolved);
      check(scenarioId, `${label}-unresolved-this-run-usd`, spend.unresolvedThisRunUsd === stageUnresolvedMicros / 1_000_000);
      check(scenarioId, `${label}-accounted-usd`, spend.accountedUsd === fullLedger.exposure / 1_000_000);
      check(scenarioId, `${label}-model-exposure-agrees`, model.ledgerExposure(events) === fullLedger.exposure);
      check(scenarioId, `${label}-prior-unresolved-retained`,
        priorLedger.unresolvedIds.every((id) => fullLedger.unresolvedIds.includes(id))
        && fullLedger.unresolvedCount === priorLedger.unresolvedCount + stageUnresolved.length);
      check(scenarioId, `${label}-reservation-time-cap`, fullLedger.peakExposure <= baseArgs.maxUsd * 1_000_000);

      return { newChunkCount: newKeys.length };
    }

    // Uninterrupted synthetic baseline.
    const baselineDir = await tmp("oh-bench-baseline-");
    const baselineLedger = makeLedger([], model);
    const baselineFetcher = new ScheduledFetcher(turnsById, "forward", undefined, new Set());
    const baselineOut = join(baselineDir, "baseline.json");
    const baselineEmptyBundle: PriorBundle = { corpora: [],
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 } };
    const baselineResult = extractionOutcome(await extract.runExtraction({ ...baseArgs, dataset: { corpora, questions: [] },
      output: baselineOut },
      { fetcher: baselineFetcher.fetcher, openLedger: baselineLedger.openLedger, environment }));
    check("baseline", "completed", baselineResult.status === "completed");
    await verifyStage({ scenarioId: "baseline", label: "baseline", priorBundle: baselineEmptyBundle, result: baselineResult,
      outputPath: baselineOut, fetcher: baselineFetcher, events: baselineLedger.events, eventBoundary: 0, entryExposure: 0,
      concurrency: 3, expectedUnresolved: 0 });
    const baselineBundle = baselineResult.unitBundle;
    const baselineChunkCount = baselineBundle.corpora.reduce((s, c) => s + c.chunks.length, 0);
    check("baseline", "chunks-75", baselineChunkCount === 75);
    check("baseline", "units-75", baselineResult.extraction.totalUnits === 75);
    check("baseline", "calls-75", baselineFetcher.calls === 75);
    check("baseline", "usage-matches-fixed-totals", canonical.canonicalJson(baselineBundle.usage)
      === canonical.canonicalJson({ inputTokens: 1500, cachedInputTokens: 0, outputTokens: 750, micros: 1800 }));
    check("baseline", "ledger-one-open-one-close", baselineLedger.openCount() === 1 && baselineLedger.closeCount() === 1);
    const baselineLedgerState = reconstructLedger(baselineLedger.events);
    check("baseline", "ledger-75-reservations", baselineLedgerState.reservedCount === 75);
    check("baseline", "ledger-75-settlements", baselineLedgerState.settledCount === 75);
    check("baseline", "ledger-zero-unresolved", baselineLedgerState.unresolvedCount === 0 && baselineLedgerState.unresolvedMicros === 0);
    check("baseline", "ledger-1800-micros", baselineLedgerState.confirmedMicros === 1800 && baselineLedgerState.exposure === 1800
      && baselineLedgerState.exposure === model.ledgerExposure(baselineLedger.events));
    check("baseline", "ledger-reservation-time-cap", baselineLedgerState.peakExposure <= baseArgs.maxUsd * 1_000_000);
    const baselineSpend = baselineResult.spend;
    check("baseline", "spend-exact", baselineSpend.capUsd === baseArgs.maxUsd && baselineSpend.maxCalls === baseArgs.maxCalls
      && baselineSpend.reservedCalls === 75 && baselineSpend.priorExposureUsd === 0
      && baselineSpend.confirmedThisRunUsd === 1800 / 1_000_000 && baselineSpend.unresolvedThisRunUsd === 0
      && baselineSpend.accountedUsd === 1800 / 1_000_000);

    const lastCorpus = corpora[2]!;
    const lastEntry = baselineBundle.corpora.find((c) => c.corpusId === lastCorpus.id);
    if (lastEntry === undefined) throw new Error("baseline bundle is missing the third synthetic corpus");
    const priorChunks: readonly ChunkUnits[] = lastEntry.chunks.slice(0, 2);
    const priorUnits: readonly MemoryUnit[] = priorChunks.flatMap((c) => [...c.units]);

    const resumeInitBundle: UnitBundle = { protocol: "oh.memory-unit-bundle.v1", dataset: "locomo", datasetSha256: DATASETS.locomo.sha256,
      split: "dev", seed: 17, extractor: { profile: units.EXTRACTION_PROFILE, promptSha256: canonical.sha256Hex(units.EXTRACTION_INSTRUCTION),
        reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 8192 },
      corpora: [{ corpusId: lastCorpus.id, corpusSha256: extract.corpusIdentity(lastCorpus), chunks: priorChunks,
        unitsSha256: canonical.canonicalSha256(priorUnits) }],
      usage: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 20, micros: 48 } };

    for (const concurrency of [1, 3, 12] as const) {
      for (const order of ["forward", "reverse", "interleaved"] as const) {
        const scenarioId = `c${concurrency}-${order}`;
        const scenarioRow: ScenarioRow = { scenario: scenarioId, concurrency, order, status: "fail" };
        const checkStart = checkCalls;
        try {
          const scenarioDir = await tmp(`oh-bench-${scenarioId}-`);
          const ledger = makeLedger([
            { v: 1, id: "prior-1", kind: "reserved", micros: 24 }, { v: 1, id: "prior-1", kind: "settled", micros: 24 },
            { v: 1, id: "prior-2", kind: "reserved", micros: 24 }, { v: 1, id: "prior-2", kind: "settled", micros: 24 },
          ], model);
          const initialLedgerState = reconstructLedger(ledger.events);
          check(scenarioId, "initial-ledger-two-settled-reservations", initialLedgerState.reservedCount === 2
            && initialLedgerState.settledCount === 2 && initialLedgerState.unresolvedCount === 0
            && initialLedgerState.confirmedMicros === 48 && initialLedgerState.exposure === 48);
          let resumePath = join(scenarioDir, "resume-0.json");
          await io.writeNew(resumePath, JSON.stringify({ protocol: "oh.memory-benchmark.v1", unitBundle: resumeInitBundle }));

          let simulatedCalls = 0;
          let successes = 0;
          let plannedFailures = 0;
          let maxActiveSeen = 0;
          let everReachedFullConcurrency = false;
          const orderEvidence: BatchEvidence[] = [];
          const usedTargets = new Set<string>();

          for (let stage = 0; stage < 3; stage += 1) {
            const eventBoundary = ledger.events.length;
            const currentBundle = storedBundle(JSON.parse(await Bun.file(resumePath).text()));
            const missing = missingOf(currentBundle);
            if (missing.length === 0) throw new Error(`stage ${stage}: no missing chunk available for interruption`);
            const preferredIndex = Math.min(concurrency - 1 + stage * 7, missing.length - 1);
            const target = missing.find((_, i) => i >= preferredIndex && !usedTargets.has(missing[i]!.id)) ?? missing.find((m) => !usedTargets.has(m.id));
            if (target === undefined) throw new Error(`stage ${stage}: no unused missing chunk available for interruption`);
            usedTargets.add(target.id);

            const knownTurns = knownTurnIds(currentBundle);
            const entryExposure = reconstructLedger(ledger.events).exposure;
            const stageFetcher = new ScheduledFetcher(turnsById, order, target.turnId, knownTurns);
            const stageOut = join(scenarioDir, `stage-${stage}.json`);
            const result = extractionOutcome(await extract.runExtraction({ ...baseArgs, dataset: { corpora, questions: [] },
              output: stageOut, resume: resumePath, concurrency },
            { fetcher: stageFetcher.fetcher, openLedger: ledger.openLedger, environment }));

            simulatedCalls += stageFetcher.calls;
            maxActiveSeen = Math.max(maxActiveSeen, stageFetcher.maxActive);
            if (stageFetcher.maxActive === concurrency) everReachedFullConcurrency = true;
            orderEvidence.push(...stageFetcher.batches);

            check(scenarioId, `stage${stage}-incomplete`, result.status === "incomplete");
            check(scenarioId, `stage${stage}-transport-stopped`, typeof result.stopped === "string" && result.stopped.includes("transport"));
            check(scenarioId, `stage${stage}-exactly-one-rejection`, stageFetcher.rejections === 1);

            const bundle = result.unitBundle;
            check(scenarioId, `stage${stage}-target-still-missing`, !knownIds(bundle).has(target.id));
            const cachedEntry = bundle.corpora.find((c) => c.corpusId === lastCorpus.id);
            const cachedChunkIds = new Set((cachedEntry?.chunks ?? []).map((ch) => ch.id));
            check(scenarioId, `stage${stage}-cached-survives`, cachedEntry !== undefined
              && priorChunks.every((c) => cachedChunkIds.has(c.id)));

            const stageVerdict = await verifyStage({ scenarioId, label: `stage${stage}`, priorBundle: currentBundle, result,
              outputPath: stageOut, fetcher: stageFetcher, events: ledger.events, eventBoundary, entryExposure,
              concurrency, expectedUnresolved: 1 });
            successes += stageVerdict.newChunkCount;
            plannedFailures += stageFetcher.rejections;

            resumePath = join(scenarioDir, `resume-${stage + 1}.json`);
            await io.writeNew(resumePath, JSON.stringify({ protocol: "oh.memory-benchmark.v1", unitBundle: bundle }));
          }

          // Final successful resume.
          const finalCurrentBundle = storedBundle(JSON.parse(await Bun.file(resumePath).text()));
          const finalKnownTurns = knownTurnIds(finalCurrentBundle);
          const finalEventBoundary = ledger.events.length;
          const finalEntryExposure = reconstructLedger(ledger.events).exposure;
          const finishFetcher = new ScheduledFetcher(turnsById, order, undefined, finalKnownTurns);
          const finishOut = join(scenarioDir, "stage-final.json");
          const finalResult = extractionOutcome(await extract.runExtraction({ ...baseArgs, dataset: { corpora, questions: [] },
            output: finishOut, resume: resumePath, concurrency },
          { fetcher: finishFetcher.fetcher, openLedger: ledger.openLedger, environment }));
          simulatedCalls += finishFetcher.calls;
          maxActiveSeen = Math.max(maxActiveSeen, finishFetcher.maxActive);
          if (finishFetcher.maxActive === concurrency) everReachedFullConcurrency = true;
          orderEvidence.push(...finishFetcher.batches);

          check(scenarioId, "final-no-rejections", finishFetcher.rejections === 0);
          const finalVerdict = await verifyStage({ scenarioId, label: "final", priorBundle: finalCurrentBundle,
            result: finalResult, outputPath: finishOut, fetcher: finishFetcher, events: ledger.events,
            eventBoundary: finalEventBoundary, entryExposure: finalEntryExposure, concurrency, expectedUnresolved: 0 });
          successes += finalVerdict.newChunkCount;
          check(scenarioId, "final-completed", finalResult.status === "completed");
          const finalBundle = finalResult.unitBundle;
          check(scenarioId, "final-chunks-75", finalBundle.corpora.reduce((s, c) => s + c.chunks.length, 0) === 75);
          check(scenarioId, "final-units-75", finalResult.extraction.totalUnits === 75);
          check(scenarioId, "final-matches-baseline-full-bundle",
            canonical.canonicalSha256(finalBundle) === canonical.canonicalSha256(baselineBundle));
          check(scenarioId, "final-usage-fixed-totals", canonical.canonicalJson(finalBundle.usage)
            === canonical.canonicalJson({ inputTokens: 1500, cachedInputTokens: 0, outputTokens: 750, micros: 1800 }));

          const finalSpend = finalResult.spend;
          check(scenarioId, "final-no-unresolved-this-run", finalSpend.unresolvedThisRunUsd === 0);

          // Scenario-wide accounting invariants.
          check(scenarioId, "counts-73-new-successes", successes === 73);
          check(scenarioId, "counts-3-observed-transport-failures", plannedFailures === 3);
          check(scenarioId, "counts-76-simulated-calls", simulatedCalls === 76);

          const finalLedger = reconstructLedger(ledger.events);
          check(scenarioId, "ledger-78-reservations", finalLedger.reservedCount === 78);
          check(scenarioId, "ledger-75-settlements", finalLedger.settledCount === 75);
          check(scenarioId, "ledger-3-unresolved-exactly", finalLedger.unresolvedIds.length === 3);
          check(scenarioId, "ledger-total-exposure",
            finalLedger.exposure === 1800 + finalLedger.unresolvedMicros
            && finalLedger.exposure === model.ledgerExposure(ledger.events));
          check(scenarioId, "ledger-opened-and-closed-four-times", ledger.openCount() === 4 && ledger.closeCount() === 4);

          check(scenarioId, "max-active-never-exceeds-concurrency", maxActiveSeen <= concurrency);
          check(scenarioId, "max-active-reaches-concurrency", everReachedFullConcurrency);
          for (const batch of orderEvidence) {
            if (batch.dispatch.length < 2) continue;
            check(scenarioId, "order-realised", canonical.canonicalJson(batch.resolved)
              === canonical.canonicalJson(expectedOrderFor(order, batch.dispatch)));
          }
          if (concurrency === 1) check(scenarioId, "concurrency1-degenerate", orderEvidence.every((b) => b.dispatch.length <= 1));

          const scenarioFailureCount = failures.filter((f) => f.scenario === scenarioId).length;
          scenarioRow.status = scenarioFailureCount === 0 ? "pass" : "fail";
          Object.assign(scenarioRow, {
            simulatedCalls, realNetworkCalls: 0, successes, plannedFailures,
            finalChunks: 75,
            maximumConcurrencyObserved: maxActiveSeen,
            micros: finalLedger.exposure, unresolvedReservations: finalLedger.unresolvedIds.length,
            settledCount: finalLedger.settledCount, reservedCount: finalLedger.reservedCount,
            accountedUsd: finalSpend.accountedUsd, digest: canonical.canonicalSha256(finalBundle.corpora),
            orderBatchDigest: canonical.canonicalSha256(orderEvidence),
          });
        } catch (error) {
          check(scenarioId, "scenario-threw", false, error instanceof Error ? error.message : String(error));
          scenarioRow.status = "fail";
          scenarioRow.error = sanitize(error instanceof Error ? error.message : String(error));
        }
        // Numeric count of check invocations for this scenario, reported even when the scenario threw.
        scenarioRow.checkCount = checkCalls - checkStart;
        scenarioRow.failedInvariantCount = failures.filter((f) => f.scenario === scenarioId).length;
        rows.push(scenarioRow);
      }
    }

    // Every owned temporary directory is removed and checked before the final report is written.
    await cleanupOwnedDirectories();
    const finished = await finishStressRun(run);

    status = failures.length === 0 && cleanupFailures.length === 0 ? "passed" : "failed";
    const report = { protocol: "oh.memory-benchmark.v1", status,
      sourceIdentity: { expected: run.expectedSourceSha256, before: run.identityBefore.sourceSha256,
        after: finished.identityAfter.sourceSha256 },
      helperSha256: { before: run.helperSha256Before, after: finished.helperSha256After },
      realNetworkCalls: 0, observedGlobalFetchAttempts: finished.networkAttempts,
      cleanup: { ownedTemporaryDirectories: tmpDirs.length, failures: cleanupFailures },
      qualifications: [
        "Fully synthetic offline extraction-resume stress benchmark; no real datasets, credentials, or network access.",
        "locomo/dev/seed17 are internal compatibility fixture labels only, not a real LoCoMo evaluation.",
        "This exercises generic, non-frozen extraction resume/checkpoint plumbing (concurrency, transport interruption, budget accounting), not the frozen extraction protocol.",
        "No claims of semantic accuracy or superiority; this measures transport/concurrency/resume plumbing only.",
      ],
      rows,
      failedCases: status === "failed" ? failures : undefined,
      cleanupFailures: cleanupFailures.length === 0 ? undefined : cleanupFailures,
    };
    await writeStressReport(run, report);
    console.log(JSON.stringify({ status, cases: rows.length, failedCount: failures.length,
      cleanupFailures: cleanupFailures.length }));
    if (status !== "passed") process.exitCode = 1;
  } finally {
    await cleanupOwnedDirectories();
    run.restoreFetch();
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: sanitize(error instanceof Error ? error.message : String(error)),
      failedCases: failures }));
    process.exitCode = 1;
  }
}
