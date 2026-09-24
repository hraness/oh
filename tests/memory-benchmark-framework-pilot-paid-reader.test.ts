import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { FRAMEWORK_PILOT_REPORT_ARMS_V1 as ARMS, FRAMEWORK_PILOT_REPORT_TYPES_V1 as TYPES,
  FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1 } from "../scripts/benchmarks/framework-pilot-report-v1";
import { FRAMEWORK_PILOT_PAID_READER_POLICY_V1 as POLICY, prepareFrameworkPilotReaderPlanV1 as prepare,
  validateFrameworkPilotReaderPlanV1 as validate, selectFrameworkPilotReaderWaveV1 as wave,
  freezeFrameworkPilotReaderResultsV1 as results, type FrameworkPilotReaderFreezeInputV1 as Freeze,
  type FrameworkPilotReaderPhysicalOutcomeV1 as Outcome, type FrameworkPilotReaderPlanV1 as Plan } from "../scripts/benchmarks/framework-pilot-paid-reader-v1";

const hash = (text: string) => sha256Hex(text);
function seal<T extends Record<string, unknown>>(value: T) {
  const { freezeSha256: _old, ...body } = value;
  return { ...body, freezeSha256: canonicalSha256(body) } as unknown as Freeze;
}
function fixture(distinctArms = false): Freeze {
  const cases = TYPES.flatMap((questionType, group) => Array.from({ length: 10 }, (_, i) => {
    const caseId = `c${String(group * 10 + i + 1).padStart(4, "0")}`;
    const query = { queryId: "q0001" as const, text: `Synthetic question ${caseId}?`, questionDate: "2026-01-01" };
    return { caseId, questionType, sourceSha256: hash(`synthetic source ${caseId}`), query, querySha256: canonicalSha256(query) };
  }));
  return seal({ protocol: "oh.framework-pilot-retrieval-freeze.v1", sourceManifestSha256: hash("synthetic source manifest"),
    judgeRubricSha256: hash("synthetic pinned rubric"), judgeParserSha256: hash("synthetic pinned parser"),
    reportPlanSha256: FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1, cases,
    rows: cases.flatMap(row => ARMS.map(arm => {
      const context = distinctArms ? `Synthetic ${arm} evidence.` : "Synthetic shared evidence.";
      return { caseId: row.caseId, arm, status: "completed", searchMs: 3.5, captureSha256: hash(`synthetic ${row.caseId} ${arm} capture`),
        context: { context, contextSha256: hash(context), contextTokens: 5, evidenceSha256: hash("synthetic evidence receipt"), tokenizationSha256: hash("synthetic token receipt") } };
    })) });
}
function revise(input: Freeze, index: number, fields: Record<string, unknown>): Freeze {
  return seal({ ...input, rows: input.rows.map((row, i) => i === index ? { ...row, ...fields } : row) });
}
function snapshot(plan: Plan, fields: Record<string, unknown> = {}) {
  return { planSha256: plan.planSha256, previousWaveDrained: true, charges: [], stopped: false, elapsedMs: 0, ...fields };
}
function raw(answer = "Synthetic answer.", finish = "stop") {
  return new TextEncoder().encode(JSON.stringify({ model: "openai/gpt-4o", choices: [{ index: 0, finish_reason: finish,
    message: { role: "assistant", content: answer } }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    provider_metadata: { gateway: { routing: { finalProvider: "openai", originalModelId: "openai/gpt-4o", canonicalSlug: "openai/gpt-4o" } } } }));
}
function settled(plan: Plan): Outcome[] { return plan.jobs.map(job => ({ requestSha256: job.key, state: "settled", raw: raw(), chargeMicros: 35, serviceMs: 4 })); }
function closed(plan: Plan, outcomes: readonly Outcome[] = settled(plan), extra: Record<string, unknown> = {}) {
  return { planSha256: plan.planSha256, storeClosed: true, ownerCollected: true, databaseSha256: plan.jobs.length ? hash("synthetic closed store") : null, outcomes, ...extra };
}
const rejection = (fn: () => unknown) => expect(fn).toThrow();

describe("bounded answer-blind paid reader preparation", () => {
  test("retains all180 logical cells, exact-input dedup and a deterministic type-balanced rotating order", () => {
    const plan = prepare(fixture());
    expect(plan.cells).toHaveLength(180); expect(plan.jobs).toHaveLength(60);
    expect(plan.cells.filter(cell => cell.caseId === "c0001").map(cell => cell.requestSha256)).toEqual(Array(3).fill(plan.jobs[0]!.key));
    expect(plan.cells.slice(0, 6).map(cell => [cell.caseId, cell.arm])).toEqual([
      ["c0001", "oh"], ["c0001", "supermemory"], ["c0001", "bm25"],
      ["c0011", "supermemory"], ["c0011", "bm25"], ["c0011", "oh"],
    ]);
    expect(plan.cells.filter((_, index) => index % 3 === 0).slice(0, 7).map(cell => cell.caseId)).toEqual(["c0001", "c0011", "c0021", "c0031", "c0041", "c0051", "c0002"]);
    for (const job of plan.jobs) {
      expect(job.repeat).toBe(0); expect(job.request.profileId).toBe(POLICY.readerProfileId);
      expect(job.request.maxOutputTokens).toBe(512); expect(job.request.timeoutMs).toBe(120000);
    }
    expect(validate(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(prepare(fixture(true)).jobs).toHaveLength(180);
    expect(Object.isFrozen(plan.jobs[0]!.request)).toBe(true);
  });

  test("requires the entire frozen60×3 matrix and binds exact source/query/context/scoring digests", () => {
    const input = fixture();
    rejection(() => prepare(seal({ ...input, cases: input.cases.slice(1) })));
    rejection(() => prepare(seal({ ...input, rows: input.rows.slice(1) })));
    rejection(() => prepare(seal({ ...input, rows: [input.rows[1], input.rows[1], ...input.rows.slice(2)] })));
    rejection(() => prepare(seal({ ...input, cases: input.cases.map((row, i) => i ? row : { ...row, questionType: TYPES[1] }) })));
    rejection(() => prepare(seal({ ...input, cases: input.cases.map((row, i) => i ? row : { ...row, querySha256: hash("wrong") }) })));
    rejection(() => prepare(revise(input, 0, { context: { ...input.rows[0]!.context!, context: "tampered" } })));
    rejection(() => prepare(revise(input, 0, { context: { ...input.rows[0]!.context!, contextTokens: 8193 } })));
    rejection(() => prepare(revise(input, 0, { status: "completed", captureSha256: null })));
    rejection(() => prepare(revise(input, 0, { status: "not-run", context: null, searchMs: 0 })));
    rejection(() => prepare(revise(input, 0, { searchMs: NaN })));
    rejection(() => prepare({ ...input, sourceManifestSha256: hash("changed without refreezing") }));
    rejection(() => prepare(seal({ ...input, reportPlanSha256: hash("other statistics") })));
    rejection(() => prepare({ ...input, gold: "must never enter reader" }));
  });

  test("keeps failed/not-run retrieval and context/request preflight failures without dropping or truncating", () => {
    let input = revise(fixture(), 0, { status: "failed", context: null, searchMs: 25 });
    input = revise(input, 1, { status: "not-run", context: null, searchMs: null, captureSha256: null });
    input = revise(input, 2, { context: null });
    input = revise(input, 3, { context: { ...input.rows[3]!.context!, context: "", contextSha256: hash(""), contextTokens: 0 } });
    const huge = "x".repeat(130000);
    input = revise(input, 4, { context: { ...input.rows[4]!.context!, context: huge, contextSha256: hash(huge), contextTokens: 8192 } });
    const plan = prepare(input), cell = (caseId: string, arm: string) => plan.cells.find(row => row.caseId === caseId && row.arm === arm)!;
    expect(cell("c0001", "oh")).toMatchObject({ disposition: "not-run", reason: "retrieval-failed", requestSha256: null });
    expect(cell("c0001", "supermemory")).toMatchObject({ disposition: "not-run", reason: "retrieval-not-run" });
    expect(cell("c0001", "bm25")).toMatchObject({ disposition: "failed", reason: "context-preparation" });
    expect(cell("c0002", "oh").disposition).toBe("ready");
    expect(cell("c0002", "supermemory")).toMatchObject({ disposition: "failed", reason: "request-bound" });
    expect(plan.input.rows[4]!.context!.context).toBe(huge);
    const report = results(plan, closed(plan));
    expect(report.rows).toHaveLength(180);
    expect(report.rows[0]).toMatchObject({ retrievalStatus: "failed", readerStatus: "not-run", searchMs: 25 });
    expect(report.rows[2]).toMatchObject({ retrievalStatus: "completed", readerStatus: "failed", searchMs: 3.5 });
    expect(report.allReadersCompleted).toBe(false);
  });

  test("reconstructs plans to reject resealed prompt, routing, cap, mapping and extra-property transplants", () => {
    const plan = prepare(fixture());
    for (const edit of [
      (p: any) => { p.jobs[0].request.body.max_tokens = 2048; },
      (p: any) => { p.jobs[0].request.body.messages[0].content += "more"; },
      (p: any) => { p.jobs[0].request.body.providerOptions.gateway.only = ["azure"]; },
      (p: any) => { p.jobs[0].repeat = 1; },
      (p: any) => { p.jobs[0].key = p.jobs[1].key; },
      (p: any) => { p.cells[0].requestSha256 = p.jobs[1].key; },
      (p: any) => { p.sumReservationMicros = 1; },
      (p: any) => { p.jobs[0].request.body.gold = "hidden"; },
    ]) {
      const changed = JSON.parse(JSON.stringify(plan)); edit(changed);
      const { planSha256: _old, ...body } = changed; changed.planSha256 = canonicalSha256(body);
      rejection(() => validate(changed));
    }
    let reads = 0;
    const cell = { ...plan.cells[0], get reason() { reads++; return null; } };
    rejection(() => validate({ ...plan, cells: [cell, ...plan.cells.slice(1)] })); expect(reads).toBe(0);
  });

  test("admits only drained fixed waves, preserves held charges and freezes stop/deadline behavior", () => {
    const plan = prepare(fixture(true)), first = wave(plan, snapshot(plan));
    expect(first.jobs).toHaveLength(4); expect(first.jobs.map(job => job.key)).toEqual(plan.jobs.slice(0, 4).map(job => job.key));
    expect(first.reservationMicros).toBe(first.jobs.reduce((sum, job) => sum + job.request.reservationMicros, 0));
    const charges = first.jobs.map(job => ({ requestSha256: job.key, state: "settled", chargeMicros: 35 }));
    expect(wave(plan, snapshot(plan, { charges }))).toMatchObject({ exposureMicros: 140, previousPhysicalJobs: 4, stopReason: null });
    expect(wave(plan, snapshot(plan, { charges })).jobs[0]!.key).toBe(plan.jobs[4]!.key);
    const held = [{ requestSha256: plan.jobs[0]!.key, state: "held", chargeMicros: plan.jobs[0]!.request.reservationMicros }];
    expect(wave(plan, snapshot(plan, { charges: held }))).toMatchObject({ jobs: [], stopReason: "unresolved", exposureMicros: held[0]!.chargeMicros });
    rejection(() => wave(plan, snapshot(plan, { charges: [{ ...held[0], chargeMicros: 35 }] })));
    rejection(() => wave(plan, snapshot(plan, { previousWaveDrained: false })));
    rejection(() => wave(plan, snapshot(plan, { charges: [charges[1]] })));
    expect(wave(plan, snapshot(plan, { stopped: true })).stopReason).toBe("stopped");
    expect(wave(plan, snapshot(plan, { elapsedMs: 900000 })).stopReason).toBe("deadline");
    expect(POLICY.ownerRequirements).toMatchObject({ signalsBeforeChildAcquisition: true, exceptionalPostSpawnCollection: true });
    expect(POLICY.ownerMaximumMs).toBe(1050000);
  });

  test("can run a plan whose summed reservations exceed the cap, recycling only settled headroom", () => {
    const base = fixture(), context = "x".repeat(124000);
    const input = seal({ ...base, rows: base.rows.map((row, i) => i < 90 && row.arm === "oh"
      ? { ...row, context: { ...row.context!, context, contextSha256: hash(context), contextTokens: 8192 } }
      : { ...row, status: "not-run", searchMs: null, captureSha256: null, context: null }) });
    const plan = prepare(input); expect(plan.jobs).toHaveLength(30); expect(plan.sumReservationMicros).toBeGreaterThan(POLICY.readerCapMicros);
    const prefix = plan.jobs.slice(0, 25).map(job => ({ requestSha256: job.key, state: "settled", chargeMicros: job.request.reservationMicros }));
    const next = wave(plan, snapshot(plan, { charges: prefix }));
    expect(next.jobs.length).toBeGreaterThan(0); expect(next.jobs.length).toBeLessThan(4);
    expect(next.exposureMicros + next.reservationMicros).toBeLessThanOrEqual(POLICY.readerCapMicros);
    const expensive = [...prefix, ...next.jobs.map(job => ({ requestSha256: job.key, state: "settled", chargeMicros: job.request.reservationMicros }))];
    expect(wave(plan, snapshot(plan, { charges: expensive })).stopReason).toBe("budget-cap");
    const inexpensive = plan.jobs.slice(0, expensive.length).map(job => ({ requestSha256: job.key, state: "settled", chargeMicros: 35 }));
    expect(wave(plan, snapshot(plan, { charges: inexpensive })).jobs.length).toBeGreaterThan(0);
  });

  test("freezes exact parsed first answers once per physical job and retains every logical cell and residual judge cap", () => {
    const plan = prepare(fixture()), report = results(plan, closed(plan));
    expect(report.physical).toHaveLength(60); expect(report.rows).toHaveLength(180); expect(report.allReadersCompleted).toBe(true);
    expect(report.rows.slice(0, 3).map(row => row.answerSha256)).toEqual(Array(3).fill(hash("Synthetic answer.")));
    expect(report.accounting).toEqual({ unit: "USD-microdollars", confirmedMicros: 2100, unresolvedMicros: 0, exposureMicros: 2100,
      totalTaskExposureMicros: 14350342, totalGlobalExposureMicros: 263309355, maximumJudgeAllocationMicros: 10649658 });
    expect(report.rows.every(row => row.judgeStatus === "not-run" && row.verdict === null)).toBe(true);
    expect(report.judgePreparation).toMatchObject({ separateGoldOnlyProcessRequired: true, rubricSha256: plan.input.judgeRubricSha256, parserSha256: plan.input.judgeParserSha256 });
    expect(Object.isFrozen(report.rows[0])).toBe(true);
  });

  test("propagates held and normal parsed failures, retains uncertainty, and leaves pending cases explicit", () => {
    const plan = prepare(fixture()), outcomes: Outcome[] = plan.jobs.map((job, i) => i === 0
      ? { requestSha256: job.key, state: "held", chargeMicros: job.request.reservationMicros, rawSha256: null, rawBytes: null, serviceMs: null }
      : i < 4 ? { requestSha256: job.key, state: "settled", raw: raw("partial", "length"), chargeMicros: 35, serviceMs: 4 }
        : { requestSha256: job.key, state: "not-run", reason: "operational-halt" });
    const report = results(plan, closed(plan, outcomes)), held = plan.jobs[0]!.request.reservationMicros;
    expect(report.accounting).toMatchObject({ confirmedMicros: 105, unresolvedMicros: held, exposureMicros: held + 105,
      maximumJudgeAllocationMicros: 10651758 - held - 105 });
    expect(report.rows.filter(row => row.readerStatus === "failed")).toHaveLength(12);
    expect(report.rows.filter(row => row.readerStatus === "not-run")).toHaveLength(168);
    expect(report.rows.every(row => row.answer === null && row.verdict === null)).toBe(true);
    expect(report.coverageComplete).toBe(true); expect(report.allReadersCompleted).toBe(false);
  });

  test("counts mixed settled and held captures at the aggregate raw-byte boundary", () => {
    const plan = prepare(fixture(true)), oneMiB = 1024 * 1024;
    const paddedRaw = new Uint8Array(oneMiB).fill(0x20); paddedRaw.set(raw());
    // Fifteen settled four-job waves, then one settled and three held captures
    // in the final drained wave. Trailing JSON whitespace keeps answers small.
    const outcomes: Outcome[] = plan.jobs.map((job, index) => index < 61
      ? { requestSha256: job.key, state: "settled", raw: paddedRaw, chargeMicros: 35, serviceMs: 4 }
      : index < 64 ? { requestSha256: job.key, state: "held", rawSha256: hash(`synthetic held ${index}`), rawBytes: oneMiB,
        chargeMicros: job.request.reservationMicros, serviceMs: 4 }
        : { requestSha256: job.key, state: "not-run", reason: "operational-halt" });
    const report = results(plan, closed(plan, outcomes));
    expect(report.physical.reduce((sum, row) => sum + (row.rawBytes ?? 0), 0)).toBe(POLICY.maximumAggregateRawBytes);
    expect(report.physical.slice(61, 64).every(row => row.reason === "unresolved-first-attempt")).toBe(true);
    const oversized = outcomes.map((row, index) => index === 63 && row.state === "held" ? { ...row, rawBytes: oneMiB + 1 } : row);
    expect(() => results(plan, closed(plan, oversized))).toThrow("aggregate raw byte bound");
  });

  test("rejects an open/uncollected store, missing or transplanted captures and released held costs", () => {
    const plan = prepare(fixture()), outcomes = settled(plan);
    rejection(() => results(plan, closed(plan, outcomes, { storeClosed: false })));
    rejection(() => results(plan, closed(plan, outcomes, { ownerCollected: false })));
    rejection(() => results(plan, closed(plan, outcomes.slice(1))));
    rejection(() => results(plan, closed(plan, [outcomes[1]!, ...outcomes.slice(1)])));
    rejection(() => results(plan, closed(plan, [{ ...outcomes[0], chargeMicros: 0 } as Outcome, ...outcomes.slice(1)])));
    rejection(() => results(plan, closed(plan, [{ requestSha256: plan.jobs[0]!.key, state: "held", chargeMicros: 0, rawSha256: null, rawBytes: null, serviceMs: null }, ...outcomes.slice(1)])));
    rejection(() => results(plan, closed(plan, [{ requestSha256: plan.jobs[0]!.key, state: "not-run", reason: "stopped" }, ...outcomes.slice(1)])));
    rejection(() => results(plan, closed(plan, [{ requestSha256: plan.jobs[0]!.key, state: "settled", raw: raw().slice(0, 4), chargeMicros: 35, serviceMs: 4 }, ...outcomes.slice(1)])));
    const empty = fixture(), noCalls = prepare(seal({ ...empty, rows: empty.rows.map(row => ({ ...row, status: "not-run", context: null, captureSha256: null, searchMs: null })) }));
    expect(noCalls.jobs).toHaveLength(0); expect(wave(noCalls, snapshot(noCalls)).stopReason).toBe("complete");
    expect(results(noCalls, closed(noCalls)).accounting).toMatchObject({ exposureMicros: 0, maximumJudgeAllocationMicros: 10651758 });
  });
});
