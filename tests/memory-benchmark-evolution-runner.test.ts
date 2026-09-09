import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/canonical";
import { DATASETS } from "../scripts/benchmarks/datasets";
import { evolutionPhaseAttempts, parseEvolutionArgs, parseEvolutionRunConfig } from "../scripts/benchmarks/evolution";
import { makeEvolutionRequest, parseEvolutionResponse, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";

const root = "/example/evolution-runner-test";
const hash = (label: string) => sha256Hex(`evolution-runner-test:${label}`);
const pin = (name: string, sha256 = hash(name)) => ({ path: `${root}/${name}.json`, sha256 });
const variant = (id = "baseline") => ({ id, system: "bm25-window" as const, budget: { topK: 1, contextBytes: 1_024 } });
const config = () => ({
  protocol: "oh.memory.evolution-run.v1" as const,
  dataset: "longmemeval-s" as const,
  datasetPin: pin("dataset", DATASETS["longmemeval-s"].sha256),
  manifestPin: pin("manifest"),
  campaignPin: pin("campaign"),
  limit: 20,
  seed: 7,
  variants: [variant()],
  readers: ["gpt5-mini-reader"],
  judge: "gpt4o-gateway-judge" as const,
  directory: `${root}/run`,
  storeDirectory: `${root}/store`,
  concurrency: 2,
});
const args = (command: string, flags: readonly string[]) => [command, "--config", `${root}/config.json`, "--config-sha256", hash("config"), ...flags];
const phaseRequest = (suffix: string) => makeEvolutionRequest("gpt4o-official-snapshot-judge", [{ role: "user", content: `Is ${suffix} correct?` }]);
function response(request: EvolutionRequest) {
  const raw = new TextEncoder().encode(JSON.stringify({ model: request.model, choices: [{ index: 0, finish_reason: "stop",
    message: { role: "assistant", content: "yes" } }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }));
  return parseEvolutionResponse(raw, request);
}
function reservedFailure(request: EvolutionRequest) {
  return { requestSha256: request.requestSha256, profileSha256: request.profileSha256, repeat: 0,
    storeStatus: "reserved" as const, reason: "dispatch-outcome-unknown" as const, rawSha256: null, rawBytes: null,
    transport: null, serviceMs: null, reservationMicros: request.reservationMicros };
}
const attempts = (requests: readonly EvolutionRequest[], responses: readonly unknown[], failures: readonly unknown[], complete = true) => ({
  protocol: "oh.memory.evolution-phase.v1", phase: "reader", planSha256: hash("phase-plan"), complete, responses, failures,
});

describe("memory evolution runner configuration and CLI contracts", () => {
  test("accepts the closed configuration and preserves its pin-bound reader matrix", () => {
    const value = config(), parsed = parseEvolutionRunConfig(value);
    expect(parsed).toEqual(value);
    expect(Object.isFrozen(parsed.datasetPin)).toBe(true);
    expect(parsed.variants).toEqual([variant()]);
  });

  test("rejects a source pin mismatch, overlapping paths, and matrix/case bounds", () => {
    const wrongDataset = config(); wrongDataset.datasetPin = pin("dataset", hash("different-official-source"));
    expect(() => parseEvolutionRunConfig(wrongDataset)).toThrow("dataset source");
    const overlap = config(); overlap.storeDirectory = `${root}/run/store`;
    expect(() => parseEvolutionRunConfig(overlap)).toThrow("paths overlap");
    const tooMany = config(); tooMany.limit = 2_000;
    tooMany.variants = Array.from({ length: 32 }, (_, index) => variant(`v${index}`));
    tooMany.readers = ["qwen37-flash-reader", "gpt5-nano-reader", "gemini25-flash-lite-reader", "gpt5-mini-reader"];
    expect(() => parseEvolutionRunConfig(tooMany)).toThrow("complete-coverage");
    for (const change of [
      (value: any) => { value.limit = 0; },
      (value: any) => { value.limit = 2_001; },
      (value: any) => { value.concurrency = 13; },
      (value: any) => { value.variants[0].budget.contextBytes = 1_000_001; },
      (value: any) => { value.readers = ["gpt5-mini-reader", "gpt5-mini-reader"]; },
      (value: any) => { value.directory = `${root}/run/../run`; },
    ]) {
      const invalid = config(); change(invalid);
      expect(() => parseEvolutionRunConfig(invalid)).toThrow();
    }
  });

  test("requires exact command flags and canonical pin/numeric values", () => {
    const prepare = parseEvolutionArgs(args("prepare", []));
    expect(prepare.command).toBe("prepare");
    expect([...prepare.flags.keys()]).toEqual(["config", "config-sha256"]);
    const run = parseEvolutionArgs(args("run-reader", [
      "--plan", `${root}/readers.json`, "--plan-sha256", hash("readers"),
      "--max-usd", "0.01", "--max-new-calls", "1", "--output", `${root}/reader-receipt.json`,
    ]));
    expect(run.flags.get("max-usd")).toBe("0.01");
    const replay = parseEvolutionArgs(args("run-reader", [
      "--plan", `${root}/readers.json`, "--plan-sha256", hash("readers"),
      "--max-usd", "0.01", "--max-new-calls", "0", "--output", `${root}/reader-replay-receipt.json`,
    ]));
    expect(replay.flags.get("max-new-calls")).toBe("0");
    for (const value of [
      args("prepare", ["--ignored", "x"]),
      ["prepare", "--config", `${root}/config.json`],
      args("prepare", ["--config", `${root}/second-config.json`, "--config-sha256", hash("second")]),
      args("readers", ["--context", `${root}/contexts.json`]),
      args("run-reader", ["--plan", `${root}/readers.json`, "--plan-sha256", hash("readers"), "--max-usd", "01", "--max-new-calls", "1", "--output", `${root}/receipt.json`]),
      args("run-reader", ["--plan", `${root}/readers.json`, "--plan-sha256", hash("readers"), "--max-usd", "0.01", "--max-new-calls", "01", "--output", `${root}/receipt.json`]),
      args("run-reader", ["--plan", `${root}/readers.json`, "--plan-sha256", hash("readers"), "--max-usd", "0.01", "--max-new-calls", "-0", "--output", `${root}/receipt.json`]),
      args("run-reader", ["--plan", `${root}/readers.json`, "--plan-sha256", hash("readers"), "--max-usd", "0.01", "--max-new-calls", "0.0", "--output", `${root}/receipt.json`]),
      ["prepare", "--config", `${root}/nested/../config.json`, "--config-sha256", hash("config")],
    ]) expect(() => parseEvolutionArgs(value)).toThrow();
  });

  test("requires a complete disjoint response-or-failure receipt for every planned request", () => {
    const first = phaseRequest("first"), second = phaseRequest("second"), requests = [first, second];
    const validResponse = { requestSha256: first.requestSha256, response: response(first) }, failure = reservedFailure(second);
    const parsed = evolutionPhaseAttempts(attempts(requests, [validResponse], [failure]), "reader", hash("phase-plan"), requests);
    expect([...parsed.responses]).toEqual([[first.requestSha256, validResponse.response]]);
    expect([...parsed.failures]).toEqual([[second.requestSha256, failure]]);
    for (const receipt of [
      attempts(requests, [], []),
      attempts(requests, [validResponse], []),
      attempts(requests, [validResponse], [reservedFailure(first)]),
      attempts(requests, [validResponse], [{ ...failure, requestSha256: "f".repeat(64) }]),
      attempts(requests, [validResponse], [{ ...failure, repeat: 1 }]),
      attempts(requests, [validResponse], [{ ...failure, usage: { micros: 0 } }]),
      attempts(requests, [validResponse], [failure], false),
    ]) expect(() => evolutionPhaseAttempts(receipt, "reader", hash("phase-plan"), requests)).toThrow();
  });
});
