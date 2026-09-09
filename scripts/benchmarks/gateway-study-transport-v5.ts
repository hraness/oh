import { gatewayStudyTransportInternals as shared, type GatewayStudyIdentity, type GatewayStudyInvokeOptions,
  type GatewayStudyRaw, type GatewayStudyRequest, type GatewayStudyReservation, type GatewayStudyResult, type GatewayStudyUsage }
  from "./gateway-study-transport-v3";

export const GATEWAY_STUDY_TRANSPORT_V5 = "oh.memory-gateway-transport.v5" as const;
export type GatewayStudyTruncatedExtraction = Readonly<{ kind: "truncated-extraction"; reason: "output-token-limit";
  finishReason: "length"; requestSha256: string; rawSha256: string; rawBytes: number;
  usage: GatewayStudyUsage; identity: GatewayStudyIdentity }>;
export type GatewayStudyV5Result = GatewayStudyResult | GatewayStudyTruncatedExtraction;

/** Only the authenticated exact-cap extraction failure has a new disposition; no generated text is accepted. */
export function parseGatewayStudyV5(request: GatewayStudyRequest, reservation: GatewayStudyReservation, raw: GatewayStudyRaw): GatewayStudyV5Result {
  const checked = shared.checkedResponse(request, reservation, raw);
  if (checked.choice.finish_reason !== "length") return shared.completeResponse(checked);
  if (checked.request.phase !== "extract" || checked.request.maximumOutput !== 16_384 || checked.base.usage.outputTokens !== 16_384
    || checked.message.refusal !== undefined && checked.message.refusal !== null
    || checked.message.content !== undefined && checked.message.content !== null && typeof checked.message.content !== "string") {
    throw new TypeError("Gateway study v5: length response outside the exact-cap extraction policy; reservation retained.");
  }
  return shared.frozen({ ...checked.base, kind: "truncated-extraction", reason: "output-token-limit", finishReason: "length" });
}

/** Only the caller's new ledger is settled; inherited reservations are external immutable exposure. */
export function invokeGatewayStudyV5(options: GatewayStudyInvokeOptions): Promise<GatewayStudyV5Result> {
  return shared.invokeWithParser(options, parseGatewayStudyV5);
}
