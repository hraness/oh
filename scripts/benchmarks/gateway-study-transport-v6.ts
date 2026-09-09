import { canonicalSha256 } from "../../src/canonical";
import { gatewayStudyTransportInternals as shared, type GatewayStudyInvokeOptions, type GatewayStudyRaw,
  type GatewayStudyRequest, type GatewayStudyReservation } from "./gateway-study-transport-v3";
import { parseGatewayStudyV5, type GatewayStudyV5Result } from "./gateway-study-transport-v5";

/** This policy changes failure scoring, never the frozen generation request or an earlier ledger. */
export const GATEWAY_READER_FAILURE_V6_POLICY = shared.frozen({
  profile: "oh.memory-gateway-reader-failure-policy.v6",
  eligibility: { phase: "reader", model: "openai/gpt-4.1-mini", provider: "openai", finishReason: "length",
    maximumOutput: 512, outputTokens: 512, transport: "complete-authenticated-single-response",
    usage: "verified-within-reservation", refusal: "absent-or-null", content: "absent-null-or-string", tools: "none" },
  disposition: { status: "terminal-reader-failure", reason: "output-token-limit", prediction: "absent",
    correct: 0, decisionSource: "reader-failure-policy", judgeRequest: "none", denominator: "all-fixed-cases" },
  sensitivity: { candidateFailure: 0, baselineFailure: 1, ordinaryJudgments: "unchanged",
    criterion: "unchanged-assessSuperiority", report: "separate-from-primary" },
} as const);
export const GATEWAY_READER_FAILURE_V6_POLICY_SHA256 = canonicalSha256(GATEWAY_READER_FAILURE_V6_POLICY);
export const GATEWAY_STUDY_TRANSPORT_V6 = "oh.memory-gateway-transport.v6" as const;
export type GatewayStudyTerminalReaderFailure = Readonly<Omit<Extract<GatewayStudyV5Result, { kind: "truncated-extraction" }>, "kind"> & {
  kind: "terminal-reader-failure"; policySha256: string;
}>;
export type GatewayStudyV6Result = GatewayStudyV5Result | GatewayStudyTerminalReaderFailure;

/** Authenticates raw evidence before recognizing the one additional terminal failure class. */
export function parseGatewayStudyV6(request: GatewayStudyRequest, reservation: GatewayStudyReservation, raw: GatewayStudyRaw): GatewayStudyV6Result {
  if (request.phase !== "reader") return parseGatewayStudyV5(request, reservation, raw);
  const checked = shared.checkedResponse(request, reservation, raw);
  if (checked.choice.finish_reason !== "length") return shared.completeResponse(checked);
  if (checked.request.maximumOutput !== 512 || checked.base.usage.outputTokens !== 512
    || checked.message.refusal !== undefined && checked.message.refusal !== null
    || checked.message.content !== undefined && checked.message.content !== null && typeof checked.message.content !== "string") {
    throw new TypeError("Gateway study v6: reader length response outside the exact-cap failure policy; reservation retained.");
  }
  return shared.frozen({ ...checked.base, kind: "terminal-reader-failure", reason: "output-token-limit", finishReason: "length",
    policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256 });
}

/** Settles only this invocation's ledger; importing an earlier failure does not invoke this function. */
export function invokeGatewayStudyV6(options: GatewayStudyInvokeOptions): Promise<GatewayStudyV6Result> {
  return shared.invokeWithParser(options, parseGatewayStudyV6);
}
