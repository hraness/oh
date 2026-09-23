import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OhQmdRerankBackendV1 } from "./rerank";

// Each native-boundary test gets an isolated package resolver and process.
// The source under test and filesystem validation are real; the optional native
// peer and (except in the digest-rejection case) the large model's hash are fakes.
// This proves lifecycle/admission behavior without downloading or loading a model.
const peer = String.raw`
import { appendFile } from "node:fs/promises";
const scenario = process.argv[2];
export function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
export const state = { events: [], initialized: 0, ranks: 0, disposed: 0,
  entered: deferred(), release: deferred(), disposing: deferred(), disposedGate: deferred() };
export const initFailure = Object.freeze({ message: "initialization failed" });
export const closeFailure = Object.freeze({ message: "release failed" });
export class LlamaCpp {
  static RERANK_CONTEXT_SIZE = scenario === "static-context" ? 8192 : 4096;
  static RERANK_TEMPLATE_OVERHEAD = 512;
  constructor(options) {
    state.initialized++; state.events.push("construct"); state.options = options;
    this.rerankModelName = options.rerankModel;
    this.model = { _modelPath: options.rerankModel, tokenize(text) {
      state.events.push("tokens:" + text);
      return new Array(text === "query-heavy" ? 3585 : text === "oversized" ? 3600 : text === "edge" ? 3583 : text.length);
    } };
  }
  async ensureLlama(allowBuild) {
    state.events.push("ensure:" + allowBuild);
    if (scenario === "partial-runtime") throw initFailure;
    if (scenario === "initializing-close") { state.entered.resolve(); await state.release.promise; }
  }
  async ensureRerankModel() {
    state.events.push("model");
    if (scenario === "partial-model" || scenario === "partial-close-failure") throw initFailure;
    if (scenario === "model-changed") await appendFile(this.rerankModelName, "changed");
    if (scenario === "wrong-model-path") return { ...this.model, _modelPath: this.rerankModelName + ".wrong" };
    return this.model;
  }
  async ensureRerankContexts() {
    state.events.push("contexts");
    if (scenario === "partial-context") throw initFailure;
    const count = ["other-context", "wrong-context"].includes(scenario) ? 2 : 1;
    return Array.from({ length: count }, (_, i) => ({
      _llamaContext: { contextSize: scenario === "wrong-context" && i === 1 ? 8192 : 4096 },
      _getEvaluationInput(query, text) {
        state.events.push("frame:" + i + ":" + text);
        return new Array(text === "framed-full" || (scenario === "other-context" && i === 1) ? 4096 : text === "edge" ? 4095 : 512 + query.length + text.length);
      },
    }));
  }
  async rerank(query, documents) {
    state.ranks++; state.events.push("rank"); state.query = query; state.documents = documents;
    if (scenario === "drain" && state.ranks === 1) { state.entered.resolve(); await state.release.promise; }
    let results = documents.map((document, index) => ({ file: document.file, index, score: 0.5 }));
    if (scenario === "duplicate") results = [results[0], results[0]];
    if (scenario === "wrong-index") results[0].index = 1;
    if (scenario === "non-finite") results[0].score = NaN;
    if (scenario === "outside-score") results[0].score = 1.1;
    if (scenario === "extra-row-key") results[0].extra = true;
    const result = { results, model: this.rerankModelName };
    if (scenario === "wrong-envelope-model") result.model = "other";
    if (scenario === "extra-envelope-key") result.extra = true;
    return result;
  }
  async dispose() {
    state.disposed++; state.events.push("dispose"); state.disposing.resolve();
    if (scenario === "drain" || scenario === "initializing-close") await state.disposedGate.promise;
    if (scenario === "close-failure" || scenario === "partial-close-failure") throw closeFailure;
  }
}
`;

const harness = String.raw`
import { mock } from "bun:test";
import * as crypto from "node:crypto";
import { join } from "node:path";
import { state, initFailure, closeFailure } from "./node_modules/@tobilu/qmd/dist/llm.js";
const scenario = process.argv[2];
const realCreateHash = crypto.createHash;
if (scenario !== "digest") mock.module("node:crypto", () => ({ ...crypto, createHash(...args) {
  const hash = realCreateHash(...args);
  hash.digest = () => "22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48";
  return hash;
} }));
globalThis.fetch = async () => { throw new Error("Network must never be used by this boundary test"); };
const { OhQmdRerankBackendV1 } = await import("./src/rerank.ts");
const backend = new OhQmdRerankBackendV1({ modelPath: join(import.meta.dir, scenario === "missing" ? "missing.gguf" : "model.gguf") });
const documents = [{ key: "entity:0-0:0", text: "small", v: 1 }, { key: "entity:0-0/b", text: "other", v: 1 }];
let result = null, error = null, identity = null, closed = null, shared = null, settledBeforeRelease = null;
const message = e => e instanceof Error ? e.message : e?.message;
if (scenario === "drain" || scenario === "initializing-close") {
  const first = backend.rerank("q", documents);
  await state.entered.promise;
  const second = backend.rerank("q", documents);
  const one = backend.close(), two = backend.close(); shared = one === two;
  let settled = false; void two.then(() => { settled = true; });
  try { await backend.rerank("late", documents); } catch (e) { closed = message(e); }
  state.release.resolve();
  result = await first; await second; await state.disposing.promise;
  settledBeforeRelease = settled;
  state.disposedGate.resolve(); await Promise.all([one, two, backend.close()]);
} else {
  let query = "q", submitted = documents;
  if (scenario === "query-budget") query = "query-heavy";
  if (scenario === "document-budget") submitted = [documents[0], { ...documents[1], text: "oversized" }];
  if (scenario === "frame-budget") submitted = [documents[0], { ...documents[1], text: "framed-full" }];
  if (scenario === "edge-budget") submitted = [{ ...documents[0], text: "edge" }];
  if (scenario === "empty") submitted = [];
  if (scenario === "invalid-input") submitted = [documents[0], documents[0]];
  try { result = await backend.rerank(query, submitted); } catch (e) {
    error = message(e); identity = e === initFailure ? "init" : e === closeFailure ? "close" : "other";
  }
  const one = backend.close(), two = backend.close(); shared = one === two;
  const closes = await Promise.allSettled([one, two, backend.close()]);
  closed = closes.map(item => item.status === "fulfilled" ? "ok" : item.reason === closeFailure ? "close" : message(item.reason));
}
console.log(JSON.stringify({ result, error, identity, closed, shared, settledBeforeRelease,
  events: state.events, initialized: state.initialized, ranks: state.ranks, disposed: state.disposed,
  query: state.query, documents: state.documents, options: state.options }));
`;

type Outcome = {
  result: readonly { key: string; score: number; v: 1 }[] | null;
  error: string | null; identity: string | null; closed: string[] | string | null;
  shared: boolean; settledBeforeRelease: boolean | null; events: string[];
  initialized: number; ranks: number; disposed: number;
  query?: string; documents?: readonly { file: string; text: string }[];
  options?: { inactivityTimeoutMs: number; modelCacheDir: string; rerankModel: string };
};

async function run(scenario: string): Promise<Outcome> {
  const root = await mkdtemp(join(tmpdir(), "oh-rerank-boundary-"));
  try {
    await mkdir(join(root, "src"));
    const peerRoot = join(root, "node_modules", "@tobilu", "qmd");
    await mkdir(join(peerRoot, "dist"), { recursive: true });
    await Promise.all(["canonical.ts", "rerank-model.ts", "rerank.ts"].map(async (name) => {
      await writeFile(join(root, "src", name), await readFile(join(import.meta.dir, name)));
    }));
    await writeFile(join(peerRoot, "package.json"), scenario === "metadata-bound" ? " ".repeat(65_537) : JSON.stringify({
      name: "@tobilu/qmd", version: scenario === "version" ? "2.5.4" : "2.5.3", type: "module",
      exports: { ".": { import: "./dist/index.js" } },
    }));
    await writeFile(join(peerRoot, "dist", "index.js"), "throw new Error('The import entry must only be resolved, never evaluated');");
    await writeFile(join(peerRoot, "dist", "llm.js"), peer);
    await writeFile(join(root, "model.gguf"), "GGUF bounded fake model bytes\n");
    await writeFile(join(root, "check.mjs"), harness);
    const child = Bun.spawn([process.execPath, join(root, "check.mjs"), scenario], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Boundary fixture ${scenario} failed: ${stderr}\n${stdout}`);
    return JSON.parse(stdout) as Outcome;
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("OhQmdRerankBackendV1 local native boundary", () => {
  test("rejects URI/model-hub inputs and malformed paths before any optional runtime acquisition", () => {
    for (const modelPath of ["", "https://example.test/model.gguf", "hf:org/repo/model.gguf", "file:///tmp/model.gguf", "\ud800", "nul\0path", "x".repeat(4_097)]) {
      expect(() => new OhQmdRerankBackendV1({ modelPath })).toThrow("local path");
    }
    expect(() => new OhQmdRerankBackendV1({ modelPath: "/tmp/model.gguf", modelCacheDir: "hf:cache" })).toThrow("local path");
  });

  test.each(["digest", "missing", "version", "metadata-bound", "static-context"])("rejects %s before native acquisition", async (scenario) => {
    const result = await run(scenario);
    expect(result.error).not.toBeNull();
    if (scenario === "digest") expect(result.error).toContain("SHA-256");
    if (scenario === "version") expect(result.error).toContain("exactly @tobilu/qmd@2.5.3");
    expect([result.initialized, result.ranks, result.disposed]).toEqual([0, 0, 0]);
  });

  test.each(["empty", "invalid-input"])("%s does not acquire the optional peer or model", async (scenario) => {
    const result = await run(scenario);
    expect([result.initialized, result.ranks, result.disposed]).toEqual([0, 0, 0]);
    expect(scenario === "empty" ? result.result : result.error !== null).toEqual(scenario === "empty" ? [] : true);
  });

  test.each(["partial-runtime", "partial-model", "partial-context", "model-changed", "wrong-model-path", "wrong-context"])("disposes partial initialization after %s", async (scenario) => {
    const result = await run(scenario);
    expect(result.error).not.toBeNull();
    if (scenario.startsWith("partial-")) expect(result.identity).toBe("init");
    expect([result.initialized, result.ranks, result.disposed]).toEqual([1, 0, 1]);
    expect(result.closed).toEqual(["ok", "ok", "ok"]);
  });

  test.each(["query-budget", "document-budget", "frame-budget", "other-context"])("rejects %s before scoring any candidate", async (scenario) => {
    const result = await run(scenario);
    expect(result.error).toContain("4096-token context");
    expect([result.initialized, result.ranks, result.disposed]).toEqual([1, 0, 1]);
  });

  test("accepts the whole-document token boundary and preserves query/document bytes and code-unit ties", async () => {
    const edge = await run("edge-budget");
    expect(edge.error).toBeNull();
    expect(edge.ranks).toBe(1);
    expect(edge.documents?.[0]?.text).toBe("edge");
    const result = await run("valid");
    expect(result.error).toBeNull();
    expect(result.result?.map((item) => item.key)).toEqual(["entity:0-0/b", "entity:0-0:0"]);
    expect(result.query).toBe("q");
    expect(result.documents?.map((item) => item.text)).toEqual(["small", "other"]);
    expect(result.events.indexOf("rank")).toBeGreaterThan(result.events.indexOf("frame:0:other"));
    expect(result.events).toContain("ensure:false");
    expect(result.options?.inactivityTimeoutMs).toBe(0);
  });

  test.each(["duplicate", "wrong-index", "non-finite", "outside-score", "extra-row-key", "wrong-envelope-model", "extra-envelope-key"])("rejects native %s output", async (scenario) => {
    const result = await run(scenario);
    expect(result.error).not.toBeNull();
    expect([result.initialized, result.ranks, result.disposed]).toEqual([1, 1, 1]);
  });

  test.each(["drain", "initializing-close"])("concurrent close during %s drains queued work and shares the final release", async (scenario) => {
    const result = await run(scenario);
    expect(result.shared).toBe(true);
    expect(result.closed).toContain("closed");
    expect(result.settledBeforeRelease).toBe(false);
    expect([result.initialized, result.ranks, result.disposed]).toEqual([1, 2, 1]);
    expect(result.events.at(-1)).toBe("dispose");
  });

  test.each(["close-failure", "partial-close-failure"])("every close caller observes %s without a second release", async (scenario) => {
    const result = await run(scenario);
    expect(result.shared).toBe(true);
    expect(result.closed).toEqual(["close", "close", "close"]);
    expect(result.disposed).toBe(1);
    if (scenario === "partial-close-failure") expect(result.identity).toBe("close");
  });
});
