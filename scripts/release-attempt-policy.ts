export type NpmRetryState = "absent" | "exact_same_run";

export type NpmPublicationPlan = Readonly<{
  action: "publish" | "verify";
  provenance: Readonly<{
    attempt: number;
    mode: "exact" | "maximum";
    runId: string;
  }>;
}>;

export type NpmProvenanceAdmission = Readonly<{
  maximumAttempt?: number;
  requiredAttempt?: number;
  requiredRunId: string;
}>;

function positiveAttempt(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${label} is invalid.`);
  const attempt = Number(value);
  if (!Number.isSafeInteger(attempt)) throw new Error(`${label} is invalid.`);
  return attempt;
}

export function parseNpmProvenanceAdmission(input: Readonly<{
  admissionAttempt: string;
  admissionRunId: string;
  provenanceAttempt: string;
  provenanceAttemptMode: string;
  provenanceRunId: string;
}>): NpmProvenanceAdmission {
  if (!/^[1-9][0-9]*$/u.test(input.admissionRunId)
    || !/^[1-9][0-9]*$/u.test(input.provenanceRunId)
    || input.provenanceRunId !== input.admissionRunId) {
    throw new Error("npm provenance output is not bound to the current workflow run.");
  }
  const admissionAttempt = positiveAttempt(input.admissionAttempt, "Public release admission attempt");
  const provenanceAttempt = positiveAttempt(input.provenanceAttempt, "npm provenance output attempt");
  if (provenanceAttempt > admissionAttempt) {
    throw new Error("npm provenance output is from a later workflow attempt.");
  }
  if (input.provenanceAttemptMode === "exact") {
    return Object.freeze({ requiredAttempt: provenanceAttempt, requiredRunId: input.provenanceRunId });
  }
  if (input.provenanceAttemptMode === "maximum") {
    return Object.freeze({ maximumAttempt: provenanceAttempt, requiredRunId: input.provenanceRunId });
  }
  throw new Error("npm provenance output attempt mode is invalid.");
}

export function planNpmPublication(input: Readonly<{
  currentAttempt: string;
  currentRunId: string;
  exactVersionExists: boolean;
  preflightAttempt: string;
  preflightRunId: string;
  preflightState: NpmRetryState;
}>): NpmPublicationPlan {
  if (!/^[1-9][0-9]*$/u.test(input.currentRunId) || input.currentRunId !== input.preflightRunId) {
    throw new Error("npm publication preflight is not bound to the current workflow run.");
  }
  const currentAttempt = positiveAttempt(input.currentAttempt, "Current release attempt");
  const preflightAttempt = positiveAttempt(input.preflightAttempt, "npm publication preflight attempt");
  if (preflightAttempt > currentAttempt) {
    throw new Error("npm publication preflight is from a later workflow attempt.");
  }

  if (input.preflightState === "exact_same_run") {
    if (!input.exactVersionExists) throw new Error("The exact npm version disappeared after retry admission.");
    return Object.freeze({
      action: "verify",
      provenance: Object.freeze({ attempt: preflightAttempt, mode: "maximum", runId: input.currentRunId }),
    });
  }

  if (input.exactVersionExists) {
    if (preflightAttempt === currentAttempt) {
      throw new Error("The npm version appeared during the current attempt after an absent preflight.");
    }
    return Object.freeze({
      action: "verify",
      provenance: Object.freeze({ attempt: currentAttempt, mode: "maximum", runId: input.currentRunId }),
    });
  }

  return Object.freeze({
    action: "publish",
    provenance: Object.freeze({ attempt: currentAttempt, mode: "exact", runId: input.currentRunId }),
  });
}
