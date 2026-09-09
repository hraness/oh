import { expect, test } from "bun:test";
import { answerMessages } from "../scripts/benchmarks/model";
import { makeGatewayStudyRequest } from "../scripts/benchmarks/gateway-study-transport-v3";
import { makeLabGpt5MiniReaderRequest } from "../scripts/benchmarks/lab-reader-profile";
import { canonicalReaderJudgeRequest, reserveReaderJudge, type FrozenJudgeRequest } from "../scripts/benchmarks/lab-reader-profile-judge";

test("accepts only canonical GPT-5-mini reader and frozen GPT-4o judge profiles", () => {
  const reader = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Memory." }, { role: "user", content: "Question." }]);
  const judge = makeGatewayStudyRequest({ phase: "judge", messages: answerMessages({ question: "Q", questionDate: "2026-01-01" }, "memory") }) as FrozenJudgeRequest;
  expect(canonicalReaderJudgeRequest(reader)).toEqual(reader);
  expect(canonicalReaderJudgeRequest(judge)).toEqual(judge);
  expect(reserveReaderJudge(reader, "reader_1").maximumOutput).toBe(2048);
  expect(reserveReaderJudge(judge, "judge_1").maximumOutput).toBe(512);
  const altered = structuredClone(judge) as any; altered.body.model = "openai/gpt-4.1-mini";
  expect(() => canonicalReaderJudgeRequest(altered)).toThrow("frozen profile");
  const oldReader = makeGatewayStudyRequest({ phase: "reader", messages: judge.body.messages }) as FrozenJudgeRequest;
  expect(() => canonicalReaderJudgeRequest(oldReader)).toThrow("only GPT-5");
  const extract = makeGatewayStudyRequest({ phase: "extract", messages: judge.body.messages }) as FrozenJudgeRequest;
  expect(() => canonicalReaderJudgeRequest(extract)).toThrow("only GPT-5");
});
