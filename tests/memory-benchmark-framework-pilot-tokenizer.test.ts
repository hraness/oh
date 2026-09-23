import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countFrameworkPilotTokenBatchV1, FRAMEWORK_PILOT_TOKENIZER_V1,
  packFrameworkPilotContextWithTiktokenV1, parseFrameworkPilotTokenBatchInputV1 } from "../scripts/benchmarks/framework-pilot-tokenizer-v1";

const input = (texts: unknown) => ({ protocol: "oh.framework-pilot-token-batch-input.v1", texts });
const root = join(import.meta.dir, "..");
const absent = { python: "/nonexistent-oh-tokenizer-python", artifactsDirectory: "/nonexistent-oh-tokenizer-artifacts" };

describe("framework pilot tokenizer envelope", () => {
  test("preserves exact Unicode, controls, special spellings and whole strings", () => {
    const texts = ["", "é", "e\u0301", "👩🏽‍💻", "\x00\b\f\r\n\t", "<|endoftext|>", "<|endofprompt|>"];
    const parsed = parseFrameworkPilotTokenBatchInputV1(input(texts));
    expect(parsed.texts).toEqual(texts);
    texts[0] = "mutated";
    expect(parsed.texts[0]).toBe("");
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.texts)).toBe(true);
  });

  test("rejects unknown fields, accessors, sparse and decorated arrays without executing them", () => {
    let getterCalls = 0;
    const accessor = { protocol: "oh.framework-pilot-token-batch-input.v1", get texts() { getterCalls++; return ["safe"]; } };
    const arrayAccessor = Object.defineProperty(["safe"], "0", { enumerable: true, get() { getterCalls++; return "safe"; } });
    for (const value of [null, [], { ...input(["safe"]), gold: "forbidden" }, accessor,
      input(new Array(1)), input(Object.assign(["safe"], { extra: true })), input(arrayAccessor),
      input(Object.defineProperty(["safe"], Symbol("extra"), { value: true })),
      Object.defineProperty(input(["safe"]), "hidden", { value: true })]) {
      expect(() => parseFrameworkPilotTokenBatchInputV1(value)).toThrow(TypeError);
    }
    expect(getterCalls).toBe(0);
  });

  test("enforces text count, scalar Unicode and exact UTF-8 byte bounds", () => {
    const limit = FRAMEWORK_PILOT_TOKENIZER_V1.maximumTextBytes;
    expect(parseFrameworkPilotTokenBatchInputV1(input(["😀".repeat(limit / 4)])).texts).toHaveLength(1);
    expect(parseFrameworkPilotTokenBatchInputV1(input(Array(21).fill(""))).texts).toHaveLength(21);
    for (const texts of [[], Array(22).fill(""), [false], [1], ["\ud800"], ["\udfff"],
      ["x".repeat(limit + 1)], ["😀".repeat(limit / 4 + 1)]]) {
      expect(() => parseFrameworkPilotTokenBatchInputV1(input(texts))).toThrow(TypeError);
    }
    expect(() => countFrameworkPilotTokenBatchV1(input(["\ud800"]), absent)).toThrow("invalid text bytes");
  });

  test("fully validates context and explicit paths before any child process", () => {
    expect(() => packFrameworkPilotContextWithTiktokenV1({ protocol: "oh.framework-pilot-context-input.v1",
      maxContextTokens: 8192, candidates: [{ unitId: "u000001", content: "safe" }, { unitId: "u000002", content: "\ud800" }] }, absent)).toThrow("candidate content");
    expect(() => packFrameworkPilotContextWithTiktokenV1({ protocol: "oh.framework-pilot-context-input.v1",
      maxContextTokens: 8193, candidates: [] }, absent)).toThrow("context-token budget");
    for (const configuration of [{ python: "python3", artifactsDirectory: "/tmp" }, { python: "/tmp/p\n", artifactsDirectory: "/tmp" },
      { ...absent, download: true }]) {
      expect(() => countFrameworkPilotTokenBatchV1(input([""]), configuration)).toThrow(TypeError);
    }
  });

  test("pins artifact manifest and official token-ID fixtures independently of process output", () => {
    const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(hash(join(root, "scripts/benchmarks/framework-pilot-tokenizer-v1/artifacts.json"))).toBe(FRAMEWORK_PILOT_TOKENIZER_V1.artifactsSha256);
    expect(hash(join(import.meta.dir, "fixtures/framework-pilot-tokenizer-v1.json"))).toBe("4278140dea12fc079ba809c6f241d178b58e2174eac8d13298c9e4b11e19e8e5");
    const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/framework-pilot-tokenizer-v1.json"), "utf8"));
    const counts = new Map<string, number>(fixture.rows.map((row: { id: string; tokens: number[] }) => [row.id, row.tokens.length]));
    expect(counts.get("literal-endoftext")).toBe(7);
    expect(counts.get("part-one")! + counts.get("part-two")!).toBe(2);
    expect(counts.get("combined")).toBe(1);
    expect(counts.get("nfc")).not.toBe(counts.get("nfd"));
  });

  test("runs isolated stdlib rejection tests without downloading or importing a native wheel", () => {
    const result = Bun.spawnSync(["python3", "-I", "-S", "-B", join(root, "scripts/benchmarks/framework-pilot-tokenizer-v1/test_worker.py")],
      { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 10_000, env: { PATH: process.env.PATH ?? "", LC_ALL: "C" } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("Ran 7 tests");
    expect(result.stderr.toString()).toContain("OK");
  });
});
