import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { FRAMEWORK_PILOT_REPORT_ARMS_V1 as ARMS, FRAMEWORK_PILOT_REPORT_TYPES_V1 as TYPES,
  FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1, reportFrameworkPilotV1 } from "../scripts/benchmarks/framework-pilot-report-v1";
import { prepareFrameworkPilotReaderPlanV1, freezeFrameworkPilotReaderResultsV1,
  type FrameworkPilotReaderFreezeInputV1 as Freeze, type FrameworkPilotReaderPhysicalOutcomeV1 as Outcome } from "../scripts/benchmarks/framework-pilot-paid-reader-v1";
import { FRAMEWORK_PILOT_PAID_JUDGE_POLICY_V1 as POLICY, prepareFrameworkPilotJudgePlanV1 as prepare,
  validateFrameworkPilotJudgePlanV1 as validate, selectFrameworkPilotJudgeWaveV1 as wave,
  freezeFrameworkPilotJudgeResultsV1 as results } from "../scripts/benchmarks/framework-pilot-paid-judge-v1";

const hash = sha256Hex;
const rubricText = readFileSync(new URL("../benchmarks/profiles/longmemeval-judge-v1.json", import.meta.url), "utf8");
const templates = (JSON.parse(rubricText) as { templates: Record<string, string> }).templates;
type PhysicalPlan = { planSha256: string; jobs: readonly { key: string; request: { reservationMicros: number } }[] };
function seal<T extends Record<string, unknown>>(input: T): Freeze {
  const { freezeSha256: _old, ...body } = input;
  return { ...body, freezeSha256: canonicalSha256(body) } as unknown as Freeze;
}
function retrieval(distinctArms = false): Freeze {
  const cases = TYPES.flatMap((questionType, group) => Array.from({ length: 10 }, (_, i) => {
    const caseId = `c${String(group * 10 + i + 1).padStart(4, "0")}`;
    const query = { queryId: "q0001" as const, text: `Synthetic question ${caseId}?`, questionDate: "2026-01-01" };
    return { caseId, questionType, sourceSha256: hash(`synthetic source ${caseId}`), query, querySha256: canonicalSha256(query) };
  }));
  return seal({ protocol: "oh.framework-pilot-retrieval-freeze.v1", sourceManifestSha256: hash("synthetic source manifest"),
    judgeRubricSha256: POLICY.rubricSha256, judgeParserSha256: POLICY.parserSourceSha256,
    reportPlanSha256: FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1, cases,
    rows: cases.flatMap(row => ARMS.map(arm => {
      const context = distinctArms ? `Synthetic private ${arm} evidence.` : "Synthetic private shared evidence.";
      return { caseId: row.caseId, arm, status: "completed", searchMs: 3.5, captureSha256: hash(`synthetic ${row.caseId} ${arm} capture`),
        context: { context, contextSha256: hash(context), contextTokens: 6, evidenceSha256: hash("synthetic evidence"), tokenizationSha256: hash("synthetic tokenizer receipt") } };
    })) });
}
function raw(answer = "Synthetic answer.", finish = "stop", fields: Record<string, unknown> = {}) {
  return new TextEncoder().encode(JSON.stringify({ model: "openai/gpt-4o", choices: [{ index: 0, finish_reason: finish,
    message: { role: "assistant", content: answer } }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    provider_metadata: { gateway: { routing: { finalProvider: "openai", originalModelId: "openai/gpt-4o", canonicalSlug: "openai/gpt-4o" } } }, ...fields }));
}
function settled(plan: PhysicalPlan, answer = "Synthetic answer."): Outcome[] {
  return plan.jobs.map(job => ({ requestSha256: job.key, state: "settled", raw: raw(answer), chargeMicros: 35, serviceMs: 4 }));
}
function closed(plan: PhysicalPlan, outcomes: readonly Outcome[] = settled(plan)) {
  return { planSha256: plan.planSha256, storeClosed: true, ownerCollected: true, databaseSha256: plan.jobs.length ? hash("synthetic closed database") : null, outcomes };
}
function goldProjection(plan: ReturnType<typeof prepareFrameworkPilotReaderPlanV1>) {
  const body = { protocol: "oh.framework-pilot-gold-projection.v1", sourceManifestSha256: plan.input.sourceManifestSha256,
    sourceDatasetSha256: hash("synthetic dataset"), privateMapSha256: hash("synthetic alias map"),
    rows: plan.input.cases.map(row => ({ caseId: row.caseId, querySha256: row.querySha256, questionType: row.questionType,
      reference: `Synthetic gold ${row.caseId}` as string | number, unanswerable: false })) };
  return { ...body, projectionSha256: canonicalSha256(body) };
}
function sealGold(input: ReturnType<typeof goldProjection>) {
  const { projectionSha256: _old, ...body } = input;
  return { ...body, projectionSha256: canonicalSha256({ ...body,
    rows: body.rows.map(row => ({ ...row, reference: typeof row.reference === "number" && Number.isFinite(row.reference) ? String(row.reference) : row.reference })) }) };
}
function fixture(input = retrieval(), map?: (outcomes: Outcome[], plan: ReturnType<typeof prepareFrameworkPilotReaderPlanV1>) => Outcome[]) {
  const readerPlan = prepareFrameworkPilotReaderPlanV1(input);
  const readerEvidence = closed(readerPlan, map?.(settled(readerPlan), readerPlan) ?? settled(readerPlan));
  const reader = freezeFrameworkPilotReaderResultsV1(readerPlan, readerEvidence);
  return { readerPlan, readerEvidence, readerAudit: { protocol: "oh.framework-pilot-reader-authentication.v1", authenticated: true,
    readerPlanSha256: readerPlan.planSha256, readerResultsSha256: reader.resultsSha256, readerDatabaseSha256: reader.databaseSha256,
    readerSourceClosureSha256: hash("synthetic verified source closure"), closedStoreAuditSha256: hash("synthetic closed-store audit"),
    ownerReceiptSha256: hash("synthetic collected owner") }, rubricText, gold: goldProjection(readerPlan) };
}
function snapshot(plan: PhysicalPlan, fields: Record<string, unknown> = {}) {
  return { planSha256: plan.planSha256, previousWaveDrained: true, charges: [], stopped: false, elapsedMs: 0, ...fields };
}
const rejection = (fn: () => unknown) => expect(fn).toThrow();

describe("separate pure gold-only framework pilot judge", () => {
  test("requires closed complete reader first captures and authenticated matching audit pins before inspecting gold", () => {
    const input = fixture(); let touches = 0;
    const unreadGold = new Proxy({}, { ownKeys() { touches++; throw new Error("gold traversed"); } });
    expect(() => prepare({ ...input, gold: unreadGold, readerEvidence: { ...input.readerEvidence, storeClosed: false } })).toThrow("closed reader phase");
    expect(() => prepare({ ...input, gold: unreadGold, readerEvidence: { ...input.readerEvidence, ownerCollected: false } })).toThrow("closed reader phase");
    expect(() => prepare({ ...input, gold: unreadGold, readerAudit: { ...input.readerAudit, authenticated: false } })).toThrow("before gold");
    expect(() => prepare({ ...input, gold: unreadGold, readerAudit: { ...input.readerAudit, readerResultsSha256: hash("wrong") } })).toThrow("before gold");
    expect(touches).toBe(0);
    expect(() => prepare({ ...input, gold: unreadGold })).toThrow("gold traversed"); expect(touches).toBe(1);
    rejection(() => prepare({ ...input, readerEvidence: { ...input.readerEvidence, outcomes: input.readerEvidence.outcomes.slice(1) } }));
    rejection(() => prepare({ ...input, readerEvidence: { ...input.readerEvidence, databaseSha256: hash("transplanted") } }));
    rejection(() => prepare({ ...input, readerAudit: { ...input.readerAudit, ownerReceiptSha256: null } }));
    rejection(() => prepare({ ...input, readerEvidence: { ...input.readerEvidence, outcomes: settled(input.readerPlan, "Changed first answer") } }));
  });

  test("uses the pre-reader pinned native templates for all six types, numeric references and abstention without shortcuts", () => {
    const input = fixture();
    expect(hash(rubricText)).toBe(POLICY.rubricSha256);
    expect(hash(readFileSync(new URL("../scripts/benchmarks/judge.ts", import.meta.url)))).toBe(POLICY.parserSourceSha256);
    input.gold = sealGold({ ...input.gold, rows: input.gold.rows.map((row, i) => i === 0 ? { ...row, reference: 42 }
      : i === 1 ? { ...row, reference: -0, unanswerable: true } : row) });
    const plan = prepare(input);
    expect(plan.cells).toHaveLength(180); expect(plan.jobs).toHaveLength(60);
    for (const questionType of TYPES) {
      const source = input.readerPlan.input.cases.find(row => row.questionType === questionType)!;
      const cell = plan.cells.find(row => row.caseId === source.caseId)!;
      const prompt = plan.jobs.find(job => job.key === cell.requestSha256)!.request.body.messages[0]!.content;
      const key = ["knowledge-update", "temporal-reasoning", "single-session-preference"].includes(questionType) ? questionType : "general";
      const reference = source.caseId === "c0001" ? "42" : `Synthetic gold ${source.caseId}`;
      expect(prompt).toBe(templates[key]!.replace("{question}", source.query.text).replace("{answer}", reference).replace("{response}", "Synthetic answer."));
    }
    const abstention = plan.jobs.find(job => job.key === plan.cells.find(cell => cell.caseId === "c0002")!.requestSha256)!;
    expect(abstention.request.body.messages[0]!.content).toContain("I will give you an unanswerable question");
    expect(abstention.request.body.messages[0]!.content).toContain("Explanation: 0");
    for (const job of plan.jobs) {
      expect(job.request.profileId).toBe("gpt4o-gateway-framework-pilot-16-alias-v1-judge");
      expect(job.repeat).toBe(0); expect(job.request.maxOutputTokens).toBe(16);
      expect(job.request.body.messages).toHaveLength(1); expect(job.request.timeoutMs).toBe(120000);
      expect(job.request.body.messages[0]!.content).not.toContain("private shared evidence");
    }
    expect(plan.cells.map(cell => [cell.caseId, cell.arm])).toEqual(input.readerPlan.cells.map(cell => [cell.caseId, cell.arm]));
    expect(Object.isFrozen(plan.jobs[0]!.request)).toBe(true);
    expect(validate(JSON.parse(JSON.stringify(plan)), input)).toEqual(plan);
  });

  test("preserves literal field content and exact-request dedup across arms, including shared failure propagation", () => {
    const initial = retrieval(true);
    const query = { ...initial.cases[0]!.query, text: "Synthetic {answer} and {response}?" };
    const input = fixture(seal({ ...initial, cases: initial.cases.map((row, i) => i ? row : { ...row, query, querySha256: canonicalSha256(query) }) }),
      (outcomes, plan) => settled(plan, "I do not know. Literal {question} remains."));
    input.gold = sealGold({ ...input.gold, rows: input.gold.rows.map((row, i) => i ? row : { ...row, reference: "Literal {response} reference", unanswerable: true }) });
    const plan = prepare(input);
    expect(input.readerPlan.jobs).toHaveLength(180); expect(plan.jobs).toHaveLength(60);
    const prompt = plan.jobs[0]!.request.body.messages[0]!.content;
    expect(prompt).toContain("Question: Synthetic {answer} and {response}?");
    expect(prompt).toContain("Explanation: Literal {response} reference");
    expect(prompt).toContain("Model Response: I do not know. Literal {question} remains.");
    expect(plan.cells.filter(cell => cell.caseId === "c0001").every(cell => cell.disposition === "ready")).toBe(true);
    const judged = settled(plan, "Yes.");
    judged[0] = { requestSha256: plan.jobs[0]!.key, state: "settled", raw: raw("maybe yes"), chargeMicros: 35, serviceMs: 4 };
    const output = results(plan, input, closed(plan, judged));
    expect(output.rows.filter(row => row.caseId === "c0001").every(row => row.judgeStatus === "failed" && row.verdict === null)).toBe(true);
    expect(output.reusedLogicalCells).toBe(120); expect(output.accounting.judgeConfirmedMicros).toBe(60 * 35);
  });

  test("rejects changed source joins, missing or duplicate gold, unpinned rubric/parser and resealed request transplants", () => {
    const input = fixture(), plan = prepare(input);
    rejection(() => prepare({ ...input, gold: { ...input.gold, rows: input.gold.rows.slice(1) } }));
    rejection(() => prepare({ ...input, gold: { ...input.gold, rows: [input.gold.rows[1], input.gold.rows[1], ...input.gold.rows.slice(2)] } }));
    rejection(() => prepare({ ...input, gold: { ...input.gold, sourceManifestSha256: hash("different source") } }));
    rejection(() => prepare({ ...input, gold: { ...input.gold, rows: input.gold.rows.map((row, i) => i ? row : { ...row, querySha256: hash("changed query") }) } }));
    rejection(() => prepare({ ...input, gold: { ...input.gold, rows: input.gold.rows.map((row, i) => i ? row : { ...row, questionType: TYPES[1] }) } }));
    rejection(() => prepare({ ...input, gold: { ...input.gold, rows: input.gold.rows.map((row, i) => i ? row : { ...row, reference: NaN }) } }));
    rejection(() => prepare({ ...input, gold: { ...input.gold, rows: input.gold.rows.map((row, i) => i ? row : { ...row, reference: "\ud800" }) } }));
    rejection(() => prepare({ ...input, gold: { ...input.gold, rows: input.gold.rows.map((row, i) => i ? row : { ...row, evidenceLabels: [] }) } }));
    rejection(() => prepare({ ...input, rubricText: rubricText + "\n" }));
    rejection(() => prepare(fixture(seal({ ...retrieval(), judgeParserSha256: hash("replacement parser") }))));
    const changed = structuredClone(plan);
    (changed.jobs[0]!.request.body.messages[0] as { content: string }).content = "replacement prompt";
    const { planSha256: _old, ...body } = changed;
    rejection(() => validate({ ...body, planSha256: canonicalSha256(body) }, input));
    rejection(() => validate({ ...plan, maximumJudgeAllocationMicros: 25_000_000 }, input));
    rejection(() => validate({ ...plan, cells: plan.cells.slice(1) }, input));
  });

  test("keeps failed/not-run retrieval and readers unjudged; over-bound gold requests fail without shortening", () => {
    const initial = retrieval();
    const input = fixture(seal({ ...initial, rows: initial.rows.map((row, i) => i === 0 ? { ...row, status: "failed", context: null, searchMs: 7 }
      : i === 1 ? { ...row, status: "not-run", context: null, captureSha256: null, searchMs: null }
        : i === 2 ? { ...row, context: null } : row) }), (outcomes, plan) => outcomes.map((row, i) => i === 0
      ? { requestSha256: plan.jobs[i]!.key, state: "settled", raw: raw("Partial answer", "length"), chargeMicros: 35, serviceMs: 5 }
      : i < 3 ? row : { requestSha256: plan.jobs[i]!.key, state: "not-run", reason: "deadline" }));
    input.gold = sealGold({ ...input.gold, rows: input.gold.rows.map(row => row.caseId === "c0021" ? { ...row, reference: "x".repeat(130000) } : row) });
    const plan = prepare(input), output = results(plan, input, closed(plan, settled(plan, "yes")));
    const at = (caseId: string, arm = "oh") => output.rows.find(row => row.caseId === caseId && row.arm === arm)!;
    expect(at("c0001")).toMatchObject({ retrievalStatus: "failed", readerStatus: "not-run", judgeStatus: "not-run", verdict: null });
    expect(at("c0001", "supermemory")).toMatchObject({ retrievalStatus: "not-run", readerStatus: "not-run", judgeStatus: "not-run" });
    expect(at("c0001", "bm25")).toMatchObject({ readerStatus: "failed", judgeStatus: "not-run" });
    expect(at("c0011")).toMatchObject({ readerStatus: "failed", judgeStatus: "not-run" });
    expect(at("c0021")).toMatchObject({ readerStatus: "completed", judgeStatus: "failed", reason: "request-bound" });
    expect(at("c0031")).toMatchObject({ readerStatus: "completed", judgeStatus: "completed", verdict: 1 });
    expect(at("c0041")).toMatchObject({ readerStatus: "not-run", judgeStatus: "not-run" });
    expect(output.rows).toHaveLength(180); expect(output.coverageComplete).toBe(true); expect(output.allJudgmentsCompleted).toBe(false);
    expect(output.accounting.readerConfirmedMicros).toBe(105);
    expect(reportFrameworkPilotV1(output.reportInput).quality.arms[0]!.completedJudgments).toBe(1);
  });

  test("uses at most four drained first-attempt jobs, recycles settled budget, and halts on held, stop or deadline", () => {
    const input = fixture(), plan = prepare(input), first = wave(plan, input, snapshot(plan));
    expect(first.jobs).toHaveLength(4); expect(first.stopReason).toBeNull();
    const charges = first.jobs.map(job => ({ requestSha256: job.key, state: "settled", chargeMicros: 35 }));
    const next = wave(plan, input, snapshot(plan, { charges }));
    expect(next.jobs[0]!.key).toBe(plan.jobs[4]!.key); expect(next.exposureMicros).toBe(140);
    const held = [{ requestSha256: first.jobs[0]!.key, state: "held", chargeMicros: first.jobs[0]!.request.reservationMicros }];
    expect(wave(plan, input, snapshot(plan, { charges: held })).stopReason).toBe("unresolved");
    expect(wave(plan, input, snapshot(plan, { stopped: true })).jobs).toHaveLength(0);
    expect(wave(plan, input, snapshot(plan, { elapsedMs: 900000 })).stopReason).toBe("deadline");
    rejection(() => wave(plan, input, snapshot(plan, { previousWaveDrained: false })));
    rejection(() => wave(plan, input, snapshot(plan, { charges: [{ ...held[0], chargeMicros: 0 }] })));
    rejection(() => wave(plan, input, snapshot(plan, { charges: [charges[1]] })));
    rejection(() => wave(plan, input, snapshot(plan, { elapsedMs: Infinity })));
    expect(plan.maximumJudgeAllocationMicros).toBe(25_000_000 - 14_348_242 - 60 * 35);
  });

  test("carries closed reader holds into the residual budget and keeps prior campaign exposure exactly once", () => {
    const input = fixture(retrieval(), (outcomes, plan) => outcomes.map((row, i) => i < outcomes.length - 1 ? row : {
      requestSha256: plan.jobs[i]!.key, state: "held", rawSha256: hash("unverifiable reader first capture"), rawBytes: 55,
      serviceMs: 2, chargeMicros: plan.jobs[i]!.request.reservationMicros }));
    const readerHeld = input.readerPlan.jobs.at(-1)!.request.reservationMicros, plan = prepare(input);
    expect(plan.maximumJudgeAllocationMicros).toBe(25_000_000 - 14_348_242 - readerHeld - 59 * 35);
    const outcomes = settled(plan, "yes");
    const last = plan.jobs.at(-1)!;
    outcomes[outcomes.length - 1] = { requestSha256: last.key, state: "held", rawSha256: null, rawBytes: null, serviceMs: null, chargeMicros: last.request.reservationMicros };
    const output = results(plan, input, closed(plan, outcomes)), judgeHeld = last.request.reservationMicros;
    expect(output.accounting.combinedUnresolvedMicros).toBe(readerHeld + judgeHeld);
    expect(output.accounting.combinedConfirmedMicros).toBe((59 + 58) * 35);
    expect(output.accounting.totalTaskExposureMicros).toBe(14_348_242 + readerHeld + judgeHeld + 117 * 35);
    expect(output.accounting.totalGlobalExposureMicros).toBe(263_307_255 + readerHeld + judgeHeld + 117 * 35);
    expect(output.reportInput.accounting.observed).toBeNull(); expect(output.reportInput.accounting.priorTaskExposure).toBe(14_348_242);
    expect(output.rows.filter(row => row.judgeStatus === "failed")).toHaveLength(3);
    expect(output.rows.filter(row => row.readerStatus === "failed" && row.judgeStatus === "not-run")).toHaveLength(3);
    expect(JSON.stringify(output.reportInput)).not.toContain("Synthetic gold");
    expect(JSON.stringify(output.reportInput)).not.toContain("Synthetic answer");
  });

  test("bounds a near-ceiling request prefix by residual exposure and rejects over-budget closed settlements", () => {
    const input = fixture();
    input.gold = sealGold({ ...input.gold, rows: input.gold.rows.map(row => ({ ...row, reference: "x".repeat(120000) })) });
    const plan = prepare(input), charges: { requestSha256: string; state: "settled"; chargeMicros: number }[] = [];
    let exposure = 0;
    for (const job of plan.jobs) {
      if (exposure + job.request.reservationMicros > plan.maximumJudgeAllocationMicros) break;
      charges.push({ requestSha256: job.key, state: "settled", chargeMicros: job.request.reservationMicros }); exposure += job.request.reservationMicros;
    }
    expect(charges.length).toBeGreaterThan(4); expect(charges.length).toBeLessThan(plan.jobs.length);
    expect(wave(plan, input, snapshot(plan, { charges })).stopReason).toBe("budget-cap");
    const last = wave(plan, input, snapshot(plan, { charges: charges.slice(0, -1) }));
    expect(last.jobs).toHaveLength(1); expect(last.exposureMicros + last.reservationMicros).toBe(exposure);
    const settledAtUpperBound: Outcome[] = plan.jobs.map(job => ({ requestSha256: job.key, state: "settled", serviceMs: 1,
      raw: raw("yes", "stop", { usage: { prompt_tokens: job.request.inputUpperBound, completion_tokens: 16, total_tokens: job.request.inputUpperBound + 16 } }),
      chargeMicros: job.request.reservationMicros }));
    expect(() => results(plan, input, closed(plan, settledAtUpperBound))).toThrow("closed judge exposure exceeds cap");
  });

  test("scores only valid completed existing-parser verdicts; invalid, refused, truncated and unattempted rows remain explicit", () => {
    const input = fixture(), plan = prepare(input), texts = ["Yes.", "NO!", "maybe yes", "yes", "yes", ""];
    const outcomes: Outcome[] = plan.jobs.map((job, i) => i < texts.length ? { requestSha256: job.key, state: "settled",
      raw: raw(texts[i], i === 3 ? "length" : i === 4 ? "content_filter" : "stop"), chargeMicros: 35, serviceMs: 3 }
      : { requestSha256: job.key, state: "not-run", reason: "stopped" });
    const output = results(plan, input, closed(plan, outcomes));
    expect(output.physical.slice(0, 6).map(row => [row.status, row.verdict])).toEqual([
      ["completed", 1], ["completed", 0], ["failed", null], ["failed", null], ["failed", null], ["failed", null],
    ]);
    expect(output.physical[2]!.reason).toBe("invalid-verdict"); expect(output.accounting.judgeConfirmedMicros).toBe(210);
    expect(output.snapshotPinned).toBe(false); expect(output.qualification).toBe("gateway-alias");
    const arm = reportFrameworkPilotV1(output.reportInput).quality.arms[0]!;
    expect(arm.correct).toBe(1); expect(arm.completedJudgments).toBe(2);
    expect(arm.conservativeSuccessRate.value).toBe(1 / 60); expect(arm.gradedAnswerAccuracy.value).toBe(0.5);
    rejection(() => results(plan, input, { ...closed(plan, outcomes), ownerCollected: false }));
    rejection(() => results(plan, input, closed(plan, [outcomes[1]!, outcomes[0]!, ...outcomes.slice(2)])));
    rejection(() => results(plan, input, closed(plan, outcomes.map((row, i) => i === 2 ? { requestSha256: plan.jobs[i]!.key, state: "not-run", reason: "stopped" } : row))));
    rejection(() => results(plan, input, closed(plan, [{ requestSha256: plan.jobs[0]!.key, state: "settled", raw: raw("yes"), chargeMicros: 0, serviceMs: 3 }, ...outcomes.slice(1)])));
    rejection(() => results(plan, input, closed(plan, [{ requestSha256: plan.jobs[0]!.key, state: "settled", raw: raw("yes", "stop", { model: "other/model" }), chargeMicros: 35, serviceMs: 3 }, ...outcomes.slice(1)])));
  });

  test("counts settled plus held first captures at the exact aggregate boundary and never reduces a held charge", () => {
    const input = fixture(retrieval(true), (outcomes, plan) => plan.jobs.map((job, i) => ({ requestSha256: job.key,
      state: "settled", raw: raw(`Synthetic distinct answer ${i}`), chargeMicros: 35, serviceMs: 1 })));
    const plan = prepare(input), unit = 1024 * 1024, padded = new Uint8Array(unit).fill(0x20); padded.set(raw("Yes."));
    // Fifteen complete four-job waves, then one settled plus three held captures
    // in the final drained wave; trailing JSON whitespace keeps verdicts small.
    const outcomes: Outcome[] = plan.jobs.map((job, i) => i < 61
      ? { requestSha256: job.key, state: "settled", raw: padded, chargeMicros: 35, serviceMs: 1 }
      : i < 64 ? { requestSha256: job.key, state: "held", rawSha256: hash(`synthetic held ${i}`),
        rawBytes: unit, chargeMicros: job.request.reservationMicros, serviceMs: 2 }
        : { requestSha256: job.key, state: "not-run", reason: "operational-halt" });
    const output = results(plan, input, closed(plan, outcomes));
    expect(output.physical.reduce((sum, row) => sum + (row.rawBytes ?? 0), 0)).toBe(64 * 1024 * 1024);
    const boundary = outcomes[63]!;
    if (boundary.state !== "held") throw new Error("fixture must be held");
    rejection(() => results(plan, input, closed(plan, outcomes.map((row, i) => i === 63 ? { ...boundary, rawBytes: boundary.rawBytes! + 1 } : row))));
    rejection(() => results(plan, input, closed(plan, outcomes.map((row, i) => i === 63 ? { ...boundary, chargeMicros: 1 } : row))));
    rejection(() => results(plan, input, closed(plan, outcomes.map((row, i) => i === 63 ? { ...boundary, rawBytes: null } : row))));
  });

  test("retains a complete no-call matrix when no reader is eligible", () => {
    const initial = retrieval(), input = fixture(seal({ ...initial, rows: initial.rows.map(row => ({ ...row, status: "not-run", context: null, searchMs: null, captureSha256: null })) }));
    const plan = prepare(input); expect(plan.jobs).toHaveLength(0); expect(plan.cells).toHaveLength(180);
    expect(wave(plan, input, snapshot(plan)).stopReason).toBe("complete");
    const output = results(plan, input, closed(plan, []));
    expect(output.databaseSha256).toBeNull(); expect(output.accounting.totalTaskExposureMicros).toBe(14_348_242);
    expect(output.reportInput.accounting.observed).toBeNull(); expect(output.rows.every(row => row.judgeStatus === "not-run" && row.verdict === null)).toBe(true);
    expect(reportFrameworkPilotV1(output.reportInput).quality.arms[0]!.gradedAnswerAccuracy.value).toBeNull();
  });
});
