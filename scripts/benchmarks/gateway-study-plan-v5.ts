/** Truncation is an explicit failed extraction; partial output never becomes memory. */
import { canonicalSha256 } from "../../src/canonical";
import { completeGatewayExtraction, completeGatewayReader, completeGatewayJudge,
  type GatewayExtractionJob, type GatewayExtractionRow, type GatewayReaderJob, type GatewayJudgeJob } from "./gateway-study-plan-v3";
import { makeGatewayStudyRequest, type GatewayStudyResult } from "./gateway-study-transport-v3";
import type { GatewayStudyV5Result } from "./gateway-study-transport-v5";
import type { Question } from "./datasets";

type Truncation = Extract<GatewayStudyV5Result, { kind: "truncated-extraction" }>;
export type GatewayExtractionRowV5 = GatewayExtractionRow | Readonly<Omit<GatewayExtractionRow, "profile" | "origin" | "status" | "reason" | "response"> & {
  profile: "oh.memory-gateway-study-plan.v5"; origin: "gateway-v5-first-response";
  status: "invalid-truncation"; reason: "output-token-limit"; response: Truncation;
}>;
export function completeGatewayV5Extraction(job: GatewayExtractionJob, response: GatewayStudyV5Result): GatewayExtractionRowV5 {
  if (response.kind !== "truncated-extraction") return completeGatewayExtraction(job, response);
  const native = makeGatewayStudyRequest({ phase: "extract", messages: job.request.body.messages });
  if (job.phase !== "extract" || canonicalSha256(native) !== canonicalSha256(job.request)
    || response.requestSha256 !== job.request.requestSha256 || response.identity.requestedModel !== job.request.model
    || response.identity.finalProvider !== "openai" || response.finishReason !== "length" || response.reason !== "output-token-limit"
    || response.usage.outputTokens !== 16384 || "prediction" in response) throw new Error("Invalid v5 truncation evidence");
  const payload = Object.freeze({ id: job.original.chunk.id, units: Object.freeze([]), rejected: 0 });
  return Object.freeze({ profile: "oh.memory-gateway-study-plan.v5", origin: "gateway-v5-first-response", jobKey: job.key,
    originalJobKey: job.original.key, ordinal: job.ordinal, corpusId: job.original.corpusId, corpusSha256: job.original.corpusSha256,
    chunkId: job.original.chunk.id, requestSha256: job.request.requestSha256, status: "invalid-truncation", reason: "output-token-limit",
    payload, payloadSha256: canonicalSha256(payload), response });
}
function ordinary(response: GatewayStudyV5Result): GatewayStudyResult {
  if (response.kind === "truncated-extraction") throw new Error("Truncation outside extraction remains fatal");
  return response;
}
export function completeGatewayV5Reader(job: GatewayReaderJob, question: Question, response: GatewayStudyV5Result) {
  return completeGatewayReader(job, question, ordinary(response));
}
export function completeGatewayV5Judge(job: GatewayJudgeJob, response: GatewayStudyV5Result) {
  return completeGatewayJudge(job, ordinary(response));
}
