import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import result from "../benchmarks/results/memory-sdk-retrieval-qualification-v1.json";
import registry from "../costs.json";

const root = resolve(import.meta.dir, "..");
const budget = registry.surfaces["benchmark:sdk-retrieval-audit"].budget;
const bytes = (path: string) => readFileSync(resolve(root, path));
const digest = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
const reports = [result.primary, result.secondary];

describe("SDK qualification public evidence", () => {
  test("preserves exact pre-answer auditor, fixture and independent report bytes", () => {
    for (const [path, expected] of [
      ["benchmarks/audit/sdk-retrieval-qualification-v1/audit-sdk-qualification.py", result.evidenceDigests.auditorSha256],
      ["benchmarks/audit/sdk-retrieval-qualification-v1/test-audit-sdk-qualification.py", result.evidenceDigests.syntheticFixtureSha256],
    ] as const) expect(digest(bytes(path))).toBe(expected);
    for (const [path, expected, report] of [
      ["benchmarks/results/memory-sdk-retrieval-semantic-qualification-v1.json", result.evidenceDigests.primaryReportSha256, result.primary],
      ["benchmarks/results/memory-sdk-retrieval-hybrid-qualification-v1.json", result.evidenceDigests.secondaryReportSha256, result.secondary],
    ] as const) {
      const raw = bytes(path);
      expect(raw.length).toBeLessThanOrEqual(budget.reportBytes);
      expect(digest(raw)).toBe(expected);
      expect(JSON.parse(raw.toString())).toEqual(report);
      expect(report.auditorSha256).toBe(result.evidenceDigests.auditorSha256);
      expect(report.benchmarkCheckpoint).toBe(result.benchmarkCheckpoint);
    }
    expect(budget.providerCalls).toBe(0);
  });

  test("keeps all planned cells, separate candidate attempts and shared native work", () => {
    expect(result.primary.comparison).toBe("semantic");
    expect(result.secondary.comparison).toBe("hybrid");
    expect(result.primary.pins.databasePin).not.toBe(result.secondary.pins.databasePin);
    expect(result.primary.reader.byRepeat).not.toEqual(result.secondary.reader.byRepeat);
    expect(result.primary.pins.capturePin).toBe(result.secondary.pins.capturePin);
    expect(result.sharedNativeCapture.calls).toBe(result.accounting.sharedNativeCalls);
    expect(result.sharedNativeCapture.calls).toBe(result.dataset.uniqueQuestions);
    expect(result.sharedNativeCapture.sdkRouteMs).toHaveLength(3);
    for (const report of reports) {
      expect(report.questions).toBe(budget.questionsPerReport);
      expect(report.logicalCases).toBe(budget.logicalCasesPerReport);
      expect(report.reader.arms.map(arm => arm.cases)).toEqual([438, 438]);
      expect(report.reader.arms.map(arm => arm.armId)[1]).toBe("sdk-default-rerank");
      expect(report.reader.byPersona.map(persona => persona.reader.questions)).toEqual(result.dataset.personaQuestions);
      expect(report.reader.pairedQuestions.questions).toBe(result.dataset.uniqueQuestions);
      expect(report.reader.pairedQuestions.wins + report.reader.pairedQuestions.losses + report.reader.pairedQuestions.ties).toBe(report.questions);
      for (const arm of report.reader.arms) {
        expect(Object.values(arm.dispositions).reduce((sum, count) => sum + count, 0)).toBe(arm.cases);
        expect(arm.accuracy).toBeCloseTo(arm.correct / arm.cases, 12);
        expect(report.reader.byPersona.reduce((sum, person) => sum + person.arms.find(row => row.armId === arm.armId)!.correct, 0)).toBe(arm.correct);
        expect(report.reader.byRepeat.reduce((sum, repeat) => sum + repeat.arms.find(row => row.armId === arm.armId)!.correct, 0)).toBe(arm.correct);
      }
    }
  });

  test("adds each campaign cost once and preserves primary and interpretation limits", () => {
    const exposure = reports.reduce((sum, report) => sum + report.costs.exposureMicros, 0);
    expect(result.accounting.exposureMicros).toBe(exposure);
    expect(result.secondary.costs.additionalExposureMicros).toBe(exposure);
    expect(result.secondary.costs.priorAdditionalExposureMicros).toBe(result.primary.costs.exposureMicros);
    expect(result.accounting.totalTaskExposureMicros).toBe(result.accounting.priorTaskExposureMicros + exposure);
    expect(result.accounting.remainingAdditionalMicros).toBe(result.accounting.additionalCapMicros - exposure);
    expect(exposure).toBeLessThanOrEqual(result.accounting.additionalCapMicros);
    expect(result.accounting.physicalCalls).toBe(reports.reduce((sum, report) => sum + report.costs.physicalCalls, 0));
    expect(result.accounting.failedLogicalCases).toBe(reports.reduce((sum, report) => sum + report.failedLogicalCases, 0));
    expect(result.primary.decision.passesPrimaryDevelopmentGate).toBe(Object.values(result.primary.decision.conditions).every(Boolean));
    expect(result.secondary.decision.passesPrimaryDevelopmentGate).toBeNull();
    for (const report of reports) {
      expect(report.decision.passesLiteralZeroNativeErrorLogAdmission).toBeFalse();
      expect(report.native.initializationInterpretation.literalZeroErrorLogPolicyWouldFail).toBeTrue();
      expect(report.native.initializationInterpretation.numericalQualityGatesChanged).toBeFalse();
      expect(report.native.initializationInterpretation.handledCapabilityProbeFailures).toBe(1);
      expect(report.reader.descriptiveUncertainty.exposedDevelopmentPersonas).toBe(2);
    }
    expect(result.dataset.cleanHoldout).toBeFalse();
    expect(result.methodDisclosures.workingTreeContinuouslyClean).toBeFalse();
    expect(result.methodDisclosures.independentAuditIsThirdPartyReview).toBeFalse();
  });

  test("bounds public aggregates and excludes private observations or filesystem paths", () => {
    const raw = bytes("benchmarks/results/memory-sdk-retrieval-qualification-v1.json");
    expect(raw.length).toBeLessThanOrEqual(budget.combinedPublicBytes);
    const text = raw.toString();
    expect(text).not.toMatch(/\/Users\/|\/Volumes\/|\/private\//);
    expect(text).not.toMatch(/2684282b-1e09-42a8-9425-533e2a95901d|11ccc069-2a93-4e9d-af03-cdacb0b8d568/);
    const forbidden = new Set(["questionId", "personId", "personName", "content", "correctChoiceId", "sourceText", "raw", "raw_meta", "messages", "request", "response", "path"]);
    const check = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(check);
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbidden.has(key)).toBeFalse();
        check(child);
      }
    };
    check(result);
  });
});
