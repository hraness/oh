import { describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256 } from "../src/canonical";
import { createFrameworkPilotSourceUnitsV1, FRAMEWORK_PILOT_SOURCE_V1, FRAMEWORK_PILOT_SPLIT_PLAN_V1 } from "../scripts/benchmarks/framework-pilot-source-v1";
import { FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1, prepareFrameworkPilotSupermemoryV1, runFrameworkPilotSupermemoryV1,
  type FrameworkPilotSupermemoryIOV1, type FrameworkPilotSupermemoryRequestV1 } from "../scripts/benchmarks/framework-pilot-supermemory-v1";

function fixture(units = 2) {
  const source = { protocol: FRAMEWORK_PILOT_SOURCE_V1, sessions: [{ sessionId: "s0001", sessionIndex: 0,
    date: "2025/03/01 12:00", turns: Array.from({ length: units }, (_, i) => ({ role: "user", text: `Verbatim ${i} 🦀\n e\u0301` })) }] };
  const splitPlan = { protocol: FRAMEWORK_PILOT_SPLIT_PLAN_V1, sourceSha256: canonicalSha256(source),
    turns: source.sessions[0]!.turns.map((turn, i) => ({ turnId: `s0001#0:${i}`, spans: [{ startByte: 0, endByte: Buffer.byteLength(turn.text) }] })) };
  return { protocol: "oh.framework-pilot-supermemory-input.v1", namespace: "oh_fp1_0123456789abcdef0123456789abcdef",
    target: { origin: "https://api.supermemory.ai" as const, projectId: "test_project", resourceId: "test_resource" },
    query: "What did the speaker say?", dreaming: "instant",
    source, splitPlan, sourceUnits: createFrameworkPilotSourceUnitsV1(source, splitPlan),
    documentDates: [{ sourceSha256: canonicalSha256(source), sessionIndex: 0, sourceDate: source.sessions[0]!.date, documentDate: "2025-03-01" }],
    budget: { maximumDocuments: Math.max(10, units), maximumMemoryEntries: 200, maximumMainRequests: Math.max(100, 3 + 2 * units), maximumCleanupRequests: Math.max(40, units + 20),
      maximumRequestBytes: 32_768, maximumResponseBytes: units > 100 ? 262_144 : 65_536, maximumMainResponseBytes: 4_194_304, maximumCleanupResponseBytes: 4_194_304,
      requestTimeoutMs: 20_000, workTimeoutMs: 600_000, cleanupTimeoutMs: 120_000, readinessTimeoutMs: 300_000,
      maximumPollsPerDocument: 61, pollIntervalMs: 5_000, cleanupObservationDelayMs: 10_000 } };
}
type Input = ReturnType<typeof fixture>;
type Row = Record<string, unknown>;
function response(value: unknown, status = 200) { return { status, body: Buffer.from(JSON.stringify(value)), complete: true }; }
type Hook = (request: FrameworkPilotSupermemoryRequestV1, normal: ReturnType<typeof response>, state: State) => unknown;
type State = ReturnType<typeof fake>["state"];
function fake(input: Input, options: { hook?: Hook; pendingPolls?: number; failAppend?: (entry: Readonly<Row>) => boolean } = {}) {
  const plan = prepareFrameworkPilotSupermemoryV1(input);
  const state = { time: 10, calls: [] as FrameworkPilotSupermemoryRequestV1[], journal: [] as Readonly<Row>[],
    claims: new Set<string>(), stored: new Map<string, Row>(), polls: new Map<string, number>(), sleeping: [] as number[], deleted: false };
  const doc = (documentId: string, body: Row) => ({ id: documentId, customId: body.customId, containerTags: [input.namespace],
    metadata: body.metadata, status: "done", dreamingStatus: "done", raw: body.content });
  const refs = () => [...state.stored.keys()].map(id => ({ id, createdAt: "2025-03-01T00:00:00Z", updatedAt: "2025-03-01T00:00:00Z" }));
  const io: FrameworkPilotSupermemoryIOV1 = {
    target: input.target, now: () => state.time,
    sleep: async milliseconds => { state.sleeping.push(milliseconds); state.time += milliseconds; },
    claim: async entry => { const key = String(entry.namespace); if (state.claims.has(key)) throw Error("duplicate durable namespace claim"); state.claims.add(key); state.journal.push(entry); },
    append: async entry => { if (options.failAppend?.(entry)) throw Error("synthetic disk unavailable"); state.journal.push(entry); },
    dispatch: async request => {
      expect(state.journal.at(-1)).toMatchObject({ kind: "intent", request });
      expect(request.target).toEqual(input.target);
      expect([request.automaticRetries, request.redirects]).toEqual([0, 0]);
      expect(Object.isFrozen(request)).toBeTrue();
      state.calls.push(request); state.time++;
      const body: Row = request.body === null ? {} : JSON.parse(request.body);
      let result: ReturnType<typeof response>;
      if (request.operation === "inventory") {
        const documents = request.path === "/v3/documents/list";
        const rows = documents ? [...state.stored].map(([id, value]) => doc(id, value))
          : state.stored.size ? [{ id: "mem_1", documentIds: [...state.stored.keys()] }] : [];
        const page = body.page as number;
        result = response({ [documents ? "memories" : "memoryEntries"]: rows.slice((page - 1) * 100, page * 100),
          pagination: { currentPage: page, limit: 100, totalItems: rows.length, totalPages: Math.ceil(rows.length / 100) } });
      } else if (request.operation === "ingest") {
        const id = `doc_${state.stored.size + 1}`; state.stored.set(id, body); result = response({ id, status: "queued" });
      } else if (request.operation === "readiness") {
        const id = request.path.split("/").at(-1)!, body = state.stored.get(id)!;
        const polls = (state.polls.get(id) ?? 0) + 1; state.polls.set(id, polls);
        result = response({ ...doc(id, body), dreamingStatus: polls <= (options.pendingPolls ?? 0) ? "dreaming" : "done" });
      } else if (request.operation === "search") {
        expect(state.stored.size).toBe(input.sourceUnits.unitCount);
        expect([...state.polls.values()].every(count => count > (options.pendingPolls ?? 0))).toBeTrue();
        result = response({ results: [
          { id: "mem_1", memory: "Provider-generated statement", documents: refs(), metadata: null, updatedAt: "2025-03-01T00:00:00Z", similarity: 0.9 },
          { id: "chunk_1", chunk: String(plan.documents[0]!.content), documents: refs().slice(0, 1), metadata: {}, updatedAt: "2025-03-01T00:00:00Z", similarity: 0.8 },
        ], total: 2, timing: 8.5 });
      } else if (request.operation === "delete") {
        result = response({ success: true, containerTag: input.namespace, deletedDocumentsCount: state.stored.size,
          deletedMemoriesCount: state.stored.size > 0 ? 1 : 0 }); state.stored.clear(); state.deleted = true;
      } else { result = response({ error: "not found" }, 404); }
      return options.hook ? options.hook(request, result, state) : result;
    },
  };
  return { io, state, plan };
}
function mutate(normal: ReturnType<typeof response>, change: (value: ReturnType<typeof JSON.parse>) => void) {
  const value = JSON.parse(Buffer.from(normal.body).toString()); change(value); return response(value, normal.status);
}

describe("framework pilot Supermemory lifecycle source contract", () => {
  test("prepares deterministic neutral per-unit documents, explicit dates and the supported rerank profile", () => {
    const input = fixture(), plan = prepareFrameworkPilotSupermemoryV1(input);
    expect(plan.documents).toHaveLength(2);
    expect(plan.profile).toEqual(FRAMEWORK_PILOT_SUPERMEMORY_PROFILE_V1);
    expect(plan.search).toMatchObject({ containerTag: input.namespace, q: input.query, searchMode: "hybrid", limit: 20,
      threshold: 0.6, rerank: true, aggregate: false, rewriteQuery: false, include: { documents: true } });
    for (const [index, body] of plan.documents.entries()) {
      const { unitSha256: _digest, ...content } = input.sourceUnits.units[index]!;
      expect(JSON.parse(body.content)).toEqual(content);
      expect(JSON.parse(body.content).date).toBe("2025/03/01 12:00");
      expect(body.documentDate).toBe("2025-03-01");
      expect(body.customId).toBe(`${input.namespace}_${input.sourceUnits.units[index]!.unitId}`);
      expect(body.metadata.sourceUnitSha256).toBe(input.sourceUnits.units[index]!.unitSha256);
      expect(Object.isFrozen(body.metadata)).toBeTrue();
    }
    const { planSha256, ...payload } = plan;
    expect(planSha256).toBe(canonicalSha256(payload));
    expect(canonicalJson(plan)).not.toContain("apiKey");
    input.query = "changed";
    expect(plan.search.q).not.toBe(input.query);
  });

  test("rejects metadata, tampered source/date mappings, unsafe identities and insufficient capacity before any callbacks", async () => {
    const changes: Array<(input: Input) => void> = [
      input => Object.assign(input, { answer: "SYNTHETIC_GOLD" }),
      input => Object.assign(input.target, { apiKey: "NO_KEY" }),
      input => { input.namespace = "known-existing-production"; },
      input => { input.documentDates[0]!.sourceDate = "another date"; },
      input => { input.documentDates[0]!.sourceSha256 = "0".repeat(64); },
      input => { input.documentDates[0]!.documentDate = "2025-02-30"; },
      input => { input.documentDates[0]!.documentDate = "2025/03/01 12:00"; },
      input => { input.budget.maximumDocuments = 1; },
      input => { input.budget.maximumCleanupRequests = 1; },
      input => { input.budget.maximumMainRequests = 3; },
      input => { input.budget.maximumRequestBytes = 512; },
      input => { input.query = "x".repeat(16_385); },
      input => { input.source.sessions[0]!.turns[0]!.text = "changed"; },
    ];
    for (const change of changes) {
      const input = fixture(), { io, state } = fake(input); change(input);
      await expect(runFrameworkPilotSupermemoryV1(input, io)).rejects.toThrow();
      expect(state.calls).toHaveLength(0); expect(state.journal).toHaveLength(0);
    }
    const input = fixture(); let read = false;
    Object.defineProperty(input, "query", { enumerable: true, get() { read = true; return "getter"; } });
    expect(() => prepareFrameworkPilotSupermemoryV1(input)).toThrow("data-properties"); expect(read).toBeFalse();
  });

  test("waits for both statuses on all units, searches once, and preserves distinct provider evidence through owned cleanup", async () => {
    const input = fixture(), { io, state } = fake(input, { pendingPolls: 2 });
    const result = await runFrameworkPilotSupermemoryV1(input, io);
    expect(result.success).toBeTrue(); expect(result.readyDocuments).toBe(2);
    expect(result.evidence.map(row => row.kind)).toEqual(["provider-generated-memory", "provider-document-chunk"]);
    expect(result.evidence.map(row => row.sourceTextAuthenticated)).toEqual([false, false]);
    expect(result.evidence[0]!.documentReferences.map(ref => ref.sourceUnitId)).toEqual(["u000001", "u000002"]);
    expect(result.evidence[0]).not.toHaveProperty("unitId");
    expect(result.providerSearchTimingMs).toBe(8.5); expect(result.searchElapsedMs).toBe(1);
    expect(result.cleanupObservedAbsent).toBeTrue(); expect(result.providerFinalSettlementVerified).toBeFalse();
    expect(result.liveTransportQualified).toBeFalse(); expect(result.errors).toEqual([]);
    expect(result.uncertainWriteCustomIds).toEqual([]);
    expect(state.calls.filter(call => call.operation === "search")).toHaveLength(1);
    expect(state.calls.findIndex(call => call.operation === "readiness")).toBeGreaterThan(state.calls.findLastIndex(call => call.operation === "ingest"));
    expect(state.calls.filter(call => call.operation === "inventory" && state.deleted).length).toBeGreaterThanOrEqual(4);
    expect(state.sleeping).toEqual([5_000, 5_000, 5_000, 5_000, 10_000]);
    expect(state.journal.at(-1)).toMatchObject({ kind: "outcome", result });
    expect(Object.isFrozen(result.evidence[0]!.documentReferences[0])).toBeTrue();
  });

  test("rejects namespace reuse and mismatched transport identity without dispatch", async () => {
    const input = fixture(), { io, state } = fake(input);
    await runFrameworkPilotSupermemoryV1(input, io);
    const calls = state.calls.length;
    await expect(runFrameworkPilotSupermemoryV1(input, io)).rejects.toThrow("duplicate durable namespace");
    expect(state.calls.length).toBe(calls);
    await expect(runFrameworkPilotSupermemoryV1(input, { ...io, target: { ...io.target, projectId: "other" } })).rejects.toThrow("target-binding");
    expect(state.calls.length).toBe(calls);
  });

  test("fresh-scope collisions cause no ingest, search or deletion", async () => {
    const input = fixture(), { io, state } = fake(input, { hook: (request, normal) => request.operation === "inventory"
      ? response({ memories: [{ id: "foreign" }], pagination: { currentPage: 1, limit: 100, totalItems: 1, totalPages: 1 } }) : normal });
    const result = await runFrameworkPilotSupermemoryV1(input, io);
    expect(result.success).toBeFalse(); expect(result.errors).toEqual([{ stage: "work", code: "scope-not-empty" }]);
    expect(state.calls).toHaveLength(1); expect(state.calls[0]!.operation).toBe("inventory");
    expect(result.cleanupObservedAbsent).toBeFalse();
  });

  test("readiness exhaustion and source-echo changes disqualify the case but retain independent cleanup capacity", async () => {
    for (const badEcho of [false, true]) {
      const input = fixture(); input.budget.maximumPollsPerDocument = 2;
      const { io, state } = fake(input, { pendingPolls: badEcho ? 0 : 99,
        hook: (request, normal) => badEcho && request.operation === "readiness" ? mutate(normal, row => { row.raw = "changed"; }) : normal });
      const result = await runFrameworkPilotSupermemoryV1(input, io);
      expect(result.retrievalCaptured).toBeFalse(); expect(result.cleanupObservedAbsent).toBeTrue();
      expect(result.errors[0]!.code).toBe(badEcho ? "ready-source-echo" : "document-dreaming-readiness-incomplete");
      expect(state.calls.filter(call => call.operation === "search")).toHaveLength(0);
      expect(state.calls.filter(call => call.operation === "delete")).toHaveLength(1);
    }
  });

  test("never retries an uncertain upload and reconciles only exact owned source identity", async () => {
    for (const visible of [true, false]) {
      const input = fixture(), { io, state } = fake(input, { hook: (request, normal, state) => {
        if (request.operation === "ingest") { if (!visible) state.stored.clear(); throw Error("synthetic lost response"); } return normal;
      } });
      const result = await runFrameworkPilotSupermemoryV1(input, io);
      expect(result.success).toBeFalse(); expect(result.cleanupObservedAbsent).toBeTrue();
      expect(state.calls.filter(call => call.operation === "ingest")).toHaveLength(1);
      expect(state.calls.filter(call => call.operation === "search")).toHaveLength(0);
      expect(result.uncertainWriteCustomIds).toEqual(visible ? [] : [prepareFrameworkPilotSupermemoryV1(input).documents[0]!.customId]);
      expect(result.acceptedDocuments).toHaveLength(visible ? 1 : 0);
      expect(state.journal.some(entry => entry.kind === "failure" && entry.uncertainAttempt === true)).toBeTrue();
      expect(result.responseBytes.work).toBeGreaterThanOrEqual(input.budget.maximumResponseBytes + 1);
    }
  });

  test("does not delete foreign documents or memories, ambiguous custom IDs, or inconsistent inventories", async () => {
    for (const change of ["foreign-document", "foreign-memory", "bad-pagination", "duplicate-document"]) {
      const input = fixture(), { io, state } = fake(input, { hook: (request, normal) => {
        if (request.phase !== "cleanup" || request.operation !== "inventory") return normal;
        return mutate(normal, value => {
          if (request.path === "/v3/documents/list") {
            if (change === "foreign-document") value.memories[0].customId = "foreign";
            if (change === "bad-pagination") value.pagination.totalItems = 3;
            if (change === "duplicate-document") value.memories[1].id = value.memories[0].id;
          } else if (change === "foreign-memory") value.memoryEntries[0].documentIds = ["foreign"];
        });
      } });
      const result = await runFrameworkPilotSupermemoryV1(input, io);
      expect(result.retrievalCaptured).toBeTrue(); expect(result.success).toBeFalse();
      expect(result.cleanupObservedAbsent).toBeFalse();
      expect(state.calls.filter(call => call.operation === "delete")).toHaveLength(0);
      expect(result.errors.at(-1)!.stage).toBe("cleanup");
    }
  });

  test("rejects forged search provenance, unbounded expansion, duplicated results and mixed evidence types", async () => {
    for (const change of ["foreign", "unmapped", "aggregate", "context", "duplicate", "both", "over-limit", "score"]) {
      const input = fixture(), { io, state } = fake(input, { hook: (request, normal) => request.operation === "search"
        ? mutate(normal, value => {
          if (change === "foreign") value.results[0].documents[0].id = "foreign";
          if (change === "unmapped") value.results[0].documents = [];
          if (change === "aggregate") value.results[0].isAggregated = true;
          if (change === "context") value.results[0].context = { parents: [{ memory: "undeclared" }] };
          if (change === "duplicate") value.results[1].id = value.results[0].id;
          if (change === "both") value.results[0].chunk = "also a chunk";
          if (change === "over-limit") { value.results = Array(21).fill(value.results[0]); value.total = 21; }
          if (change === "score") value.results[0].similarity = 1.01;
        }) : normal });
      const result = await runFrameworkPilotSupermemoryV1(input, io);
      expect(result.retrievalCaptured).toBeFalse(); expect(result.evidence).toEqual([]);
      expect(result.cleanupObservedAbsent).toBeTrue(); expect(result.success).toBeFalse();
      expect(state.calls.filter(call => call.operation === "search")).toHaveLength(1);
    }
  });

  test("enforces byte and wall deadlines with no retries and a separate cleanup allowance", async () => {
    for (const change of ["read-limit", "partial", "late", "duplicate-key"]) {
      const input = fixture(), { io, state } = fake(input, { hook: (request, normal, state) => {
        if (request.operation !== "ingest") return normal;
        if (change === "read-limit") return { ...normal, body: new Uint8Array(request.responseReadLimit) };
        if (change === "partial") return { ...normal, complete: false };
        if (change === "late") { state.time = request.deadlineMs + 1; return normal; }
        return { ...normal, body: Buffer.from('{"id":"doc_1","id":"foreign","status":"queued"}') };
      } });
      const result = await runFrameworkPilotSupermemoryV1(input, io);
      expect(result.success).toBeFalse(); expect(result.cleanupObservedAbsent).toBeTrue();
      expect(state.calls.filter(call => call.operation === "ingest")).toHaveLength(1);
      expect(state.calls.filter(call => call.operation === "search")).toHaveLength(0);
      expect(result.counts.cleanup).toBeGreaterThan(0);
    }
  });

  test("main request exhaustion cannot consume the cleanup reserve", async () => {
    const input = fixture(); input.budget.maximumMainRequests = 7;
    const { io, state } = fake(input, { pendingPolls: 3 });
    const result = await runFrameworkPilotSupermemoryV1(input, io);
    expect(result.counts.work).toBe(7); expect(result.counts.cleanup).toBeGreaterThan(0);
    expect(result.cleanupObservedAbsent).toBeTrue(); expect(result.retrievalCaptured).toBeFalse();
    expect(result.errors[0]).toEqual({ stage: "work", code: "request-budget" });
    expect(state.calls.filter(call => call.operation === "search")).toHaveLength(0);
  });

  test("the readiness window includes upload time and waiting behind the complete ingestion barrier", async () => {
    const input = fixture(); input.budget.readinessTimeoutMs = 1_000;
    const { io, state } = fake(input, { hook: (request, normal, state) => {
      if (request.operation === "ingest") state.time += state.stored.size === 1 ? 500 : 600;
      return normal;
    } });
    const result = await runFrameworkPilotSupermemoryV1(input, io);
    expect(result.success).toBeFalse(); expect(result.retrievalCaptured).toBeFalse();
    expect(result.errors[0]).toEqual({ stage: "work", code: "request-budget" });
    expect(state.calls.filter(call => call.operation === "ingest")).toHaveLength(2);
    expect(state.calls.filter(call => call.operation === "readiness")).toHaveLength(0);
    expect(state.calls.filter(call => call.operation === "search")).toHaveLength(0);
    expect(result.cleanupObservedAbsent).toBeTrue();
  });

  test("a full remaining response allowance fails closed and uncertain reads retain their complete reservation", async () => {
    const input = fixture(); input.budget.maximumResponseBytes = 512; input.budget.maximumMainResponseBytes = 512;
    const { io, state } = fake(input, { hook: (request, normal) => request.operation === "ingest"
      ? { ...normal, body: new Uint8Array(request.responseReadLimit) } : normal });
    const result = await runFrameworkPilotSupermemoryV1(input, io);
    expect(result.responseBytes.work).toBe(512);
    expect(result.errors[0]).toEqual({ stage: "work", code: "response-byte-budget-or-incomplete" });
    expect(result.counts.work).toBe(3);
    expect(state.calls.filter(call => call.operation === "ingest")).toHaveLength(1);
    // Cleanup's independent 512-byte per-response limit cannot fit the owned document.
    // It fails safely without deleting it; no budget is borrowed from another phase.
    expect(result.cleanupObservedAbsent).toBeFalse();
    expect(state.calls.filter(call => call.operation === "delete")).toHaveLength(0);
  });

  test("a failed durable intent prevents dispatch; a lost response journal prevents further mutations", async () => {
    for (const failKind of ["intent", "response"]) {
      const input = fixture(), { io, state } = fake(input, { failAppend: entry => failKind === "intent"
        ? entry.kind === "intent" && (entry.request as FrameworkPilotSupermemoryRequestV1).operation === "ingest"
        : entry.kind === "response" && entry.sequence === 3 });
      const result = await runFrameworkPilotSupermemoryV1(input, io);
      expect(result.success).toBeFalse(); expect(result.retrievalCaptured).toBeFalse();
      expect(state.calls.filter(call => call.operation === "ingest")).toHaveLength(failKind === "intent" ? 0 : 1);
      expect(state.calls.filter(call => call.operation === "delete")).toHaveLength(0);
      if (failKind === "response") {
        expect(result.cleanupObservedAbsent).toBeFalse(); expect(result.uncertainWriteCustomIds).toHaveLength(1);
        expect(result.errors.at(-1)).toEqual({ stage: "cleanup", code: "durable-journal-unavailable" });
      }
    }
  });

  test("requires both delayed empty inventories and verifies complete pagination", async () => {
    const input = fixture(101), { io, state } = fake(input);
    const result = await runFrameworkPilotSupermemoryV1(input, io);
    expect(result.success).toBeTrue();
    const pages = state.calls.filter(call => call.phase === "cleanup" && call.path === "/v3/documents/list");
    expect(pages.map(call => JSON.parse(call.body!).page)).toEqual([1, 2, 1, 1]);
    expect(state.calls.filter(call => call.operation === "absence")).toHaveLength(101);
    expect(result.counts.cleanup).toBe(109);
    const small = fixture(), late = fake(small, { hook: (request, normal, state) => request.operation === "inventory" && state.deleted
      && state.sleeping.includes(10_000) && request.path === "/v4/memories/list"
      ? response({ memoryEntries: [{ id: "reappeared", documentIds: ["doc_1"] }], pagination: { currentPage: 1, limit: 100, totalItems: 1, totalPages: 1 } }) : normal });
    const reappeared = await runFrameworkPilotSupermemoryV1(small, late.io);
    expect(reappeared.success).toBeFalse(); expect(reappeared.cleanupObservedAbsent).toBeFalse();
    expect(reappeared.errors.at(-1)).toEqual({ stage: "cleanup", code: "scope-not-empty" });
  });
});
