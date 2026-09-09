import { canonicalSha256 } from "../../src/canonical";
import { LAB_GPT5_MINI_READER_PROFILE, LAB_GPT5_MINI_MEDIUM_READER_PROFILE, makeLabGpt5MiniReaderRequest, parseLabGpt5MiniReaderResponse, reserveLabGpt5MiniReader, type LabReaderRaw, type LabReaderRequest, type LabReaderReservation, type LabReaderResult } from "./lab-reader-profile";
import { makeGatewayStudyRequest, type GatewayStudyRaw, type GatewayStudyRequest, type GatewayStudyReservation } from "./gateway-study-transport-v3";
import { gatewayReservation } from "./gateway-study-store-v3";
import { parseGatewayStudyV6, type GatewayStudyV6Result } from "./gateway-study-transport-v6";

export type FrozenJudgeRequest = GatewayStudyRequest & Readonly<{ phase: "judge" }>;
export type LabReaderJudgeRequest = LabReaderRequest | FrozenJudgeRequest;
export type LabReaderJudgeReservation = LabReaderReservation | GatewayStudyReservation;
export type LabReaderJudgeRaw = LabReaderRaw | GatewayStudyRaw;
export type LabReaderJudgeResult = LabReaderResult | GatewayStudyV6Result;
function fail(reason: string): never { throw new TypeError(`Lab reader/judge bridge: ${reason}.`); }

/** Reconstructs either accepted GPT-5-mini reader requests or the frozen GPT-4o judge profile. */
export function canonicalReaderJudgeRequest(request: LabReaderJudgeRequest): LabReaderJudgeRequest {
  if ("protocol" in request && (request.protocol === LAB_GPT5_MINI_READER_PROFILE || request.protocol === LAB_GPT5_MINI_MEDIUM_READER_PROFILE)) {
    const expected = makeLabGpt5MiniReaderRequest(request.body.messages, { profile: request.protocol === LAB_GPT5_MINI_MEDIUM_READER_PROFILE ? "medium" : "minimal" });
    if (canonicalSha256(expected) !== canonicalSha256(request)) fail("reader request differs from accepted profile");
    return expected;
  }
  if ("phase" in request && request.phase === "judge") {
    const expected = makeGatewayStudyRequest({ phase: "judge", messages: request.body.messages });
    if (canonicalSha256(expected) !== canonicalSha256(request)) fail("judge request differs from frozen profile");
    return expected as FrozenJudgeRequest;
  }
  fail("only GPT-5 mini reader and frozen GPT-4o judge requests are allowed");
}
export function reserveReaderJudge(request: LabReaderJudgeRequest, id: string): LabReaderJudgeReservation {
  const canonical = canonicalReaderJudgeRequest(request);
  return "phase" in canonical ? gatewayReservation({ key: id, ordinal: 0, phase: "judge", request: canonical }) : reserveLabGpt5MiniReader(canonical, id);
}
export function parseReaderJudge(request: LabReaderJudgeRequest, reservation: LabReaderJudgeReservation, raw: LabReaderJudgeRaw): LabReaderJudgeResult {
  const canonical = canonicalReaderJudgeRequest(request);
  if ("phase" in canonical) {
    const expected = gatewayReservation({ key: reservation.id, ordinal: 0, phase: "judge", request: canonical });
    if (canonicalSha256(expected) !== canonicalSha256(reservation)) fail("judge reservation transplant");
    return parseGatewayStudyV6(canonical, expected, raw as GatewayStudyRaw);
  }
  return parseLabGpt5MiniReaderResponse(canonical, reservation as LabReaderReservation, raw as LabReaderRaw);
}
export const labReaderProfileJudge = Object.freeze({ canonicalRequest: canonicalReaderJudgeRequest, reserve: reserveReaderJudge, parse: parseReaderJudge });
