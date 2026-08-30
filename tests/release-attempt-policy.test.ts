import { describe, expect, test } from "bun:test";
import { parseNpmProvenanceAdmission, planNpmPublication } from "../scripts/release-attempt-policy";

describe("npm release attempt policy", () => {
  test("publishes only from a current absent preflight and emits its exact attempt", () => {
    expect(planNpmPublication({
      currentAttempt: "2", currentRunId: "123", exactVersionExists: false,
      preflightAttempt: "2", preflightRunId: "123", preflightState: "absent",
    })).toEqual({ action: "publish", provenance: { attempt: 2, mode: "exact", runId: "123" } });
  });

  test("does not mutate exact bytes found after a retained earlier absent preflight", () => {
    expect(planNpmPublication({
      currentAttempt: "2", currentRunId: "123", exactVersionExists: true,
      preflightAttempt: "1", preflightRunId: "123", preflightState: "absent",
    })).toEqual({ action: "verify", provenance: { attempt: 2, mode: "maximum", runId: "123" } });
  });

  test("fails closed on a same-attempt absent-to-existing race", () => {
    expect(() => planNpmPublication({
      currentAttempt: "2", currentRunId: "123", exactVersionExists: true,
      preflightAttempt: "2", preflightRunId: "123", preflightState: "absent",
    })).toThrow("appeared during the current attempt");
  });

  test("lets a later failed-job rerun publish absence and emits that writer's exact attempt", () => {
    expect(planNpmPublication({
      currentAttempt: "2", currentRunId: "123", exactVersionExists: false,
      preflightAttempt: "1", preflightRunId: "123", preflightState: "absent",
    })).toEqual({ action: "publish", provenance: { attempt: 2, mode: "exact", runId: "123" } });
  });

  test("retains an earlier exact preflight bound and rejects another run or reversed order", () => {
    expect(planNpmPublication({
      currentAttempt: "2", currentRunId: "123", exactVersionExists: true,
      preflightAttempt: "1", preflightRunId: "123", preflightState: "exact_same_run",
    })).toEqual({ action: "verify", provenance: { attempt: 1, mode: "maximum", runId: "123" } });
    expect(() => planNpmPublication({
      currentAttempt: "2", currentRunId: "123", exactVersionExists: true,
      preflightAttempt: "1", preflightRunId: "999", preflightState: "exact_same_run",
    })).toThrow("current workflow run");
    expect(() => planNpmPublication({
      currentAttempt: "1", currentRunId: "123", exactVersionExists: true,
      preflightAttempt: "2", preflightRunId: "123", preflightState: "exact_same_run",
    })).toThrow("later workflow attempt");
  });

  test("admits retained successful-writer outputs with their exact earlier attempt", () => {
    expect(parseNpmProvenanceAdmission({
      admissionAttempt: "2", admissionRunId: "123", provenanceAttempt: "1",
      provenanceAttemptMode: "exact", provenanceRunId: "123",
    })).toEqual({ requiredAttempt: 1, requiredRunId: "123" });
    expect(parseNpmProvenanceAdmission({
      admissionAttempt: "3", admissionRunId: "123", provenanceAttempt: "2",
      provenanceAttemptMode: "maximum", provenanceRunId: "123",
    })).toEqual({ maximumAttempt: 2, requiredRunId: "123" });
  });

  test("never turns blank, cross-run, future, or unknown-mode outputs into unconstrained admission", () => {
    const base = {
      admissionAttempt: "2", admissionRunId: "123", provenanceAttempt: "1",
      provenanceAttemptMode: "exact", provenanceRunId: "123",
    };
    expect(() => parseNpmProvenanceAdmission({ ...base, provenanceAttempt: "" })).toThrow();
    expect(() => parseNpmProvenanceAdmission({ ...base, provenanceRunId: "999" })).toThrow("current workflow run");
    expect(() => parseNpmProvenanceAdmission({ ...base, provenanceAttempt: "3" })).toThrow("later workflow attempt");
    expect(() => parseNpmProvenanceAdmission({ ...base, provenanceAttemptMode: "" })).toThrow("mode is invalid");
  });
});
