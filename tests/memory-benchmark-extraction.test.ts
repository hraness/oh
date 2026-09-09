import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, type Corpus } from "../scripts/benchmarks/datasets";
import { corpusIdentity, runExtraction, validateUnitBundle, type UnitBundle } from "../scripts/benchmarks/extract";
import { ledgerExposure, type openPilotLedger } from "../scripts/benchmarks/model";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, EXTRACTION_SCHEMA, parseMemoryUnits } from "../scripts/benchmarks/units";

const reader = "openai/gpt-4.1-mini";
const base = { datasetName: "locomo", split: "dev", seed: 17, paid: true, maxUsd: 1, maxCalls: 100,
  reader, provider: "vercel-gateway" } as const;

function corpus(id: string, count: number): Corpus {
  return { id, groupId: id, turns: Array.from({ length: count }, (_, index) => ({ id: `${id}:${index}`,
    sessionId: `session-${index}`, date: "2026-01-01", speaker: "Ada", text: "I moved to Paris." })) };
}

function completion(content = '{"units":[]}') {
  return Response.json({ model: reader, choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
}

function runtime(fetcher: typeof fetch) {
  const events: unknown[] = [];
  let closed = false;
  const openLedger: typeof openPilotLedger = async () => ({ exposure: 100,
    append: async (event) => { events.push(event); }, close: async () => { closed = true; } });
  return { dependencies: { fetcher, openLedger, environment: { VERCEL_OIDC_TOKEN: "benchmark-test-value" } },
    events, isClosed: () => closed };
}

async function temporary<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "oh-extraction-test-"));
  try { return await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("extraction transport and resume reliability", () => {
  test("uses bounded concurrency, defaults to three, and records JSON transport without changing prompts", async () => {
    for (const concurrency of [undefined, 1, 12]) await temporary(async (directory) => {
      const source = corpus("parallel", 14);
      const expectedMessages = buildExtractionChunks(source).map((chunk) => JSON.stringify({ date: chunk.date,
        turns: chunk.turns.map((turn) => ({ turnId: turn.id, speaker: turn.speaker, text: turn.text })) }));
      let active = 0;
      let maximum = 0;
      let calls = 0;
      const fake = runtime((async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        expect(body.response_format).toEqual({ type: "json_schema", json_schema: {
          name: "oh_memory_units_v1", strict: true, schema: EXTRACTION_SCHEMA,
        } });
        expect(body.max_tokens).toBe(8_192);
        expect(body.messages[0].content).toBe(EXTRACTION_INSTRUCTION);
        expect(body.messages[1].content).toBe(expectedMessages[calls++]);
        maximum = Math.max(maximum, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return completion();
      }) as typeof fetch);
      const result = await runExtraction({ ...base, dataset: { corpora: [source], questions: [] },
        output: join(directory, "report.json"), ...(concurrency === undefined ? {} : { concurrency }) }, fake.dependencies);
      expect(result.status).toBe("completed");
      expect(calls).toBe(14);
      expect(maximum).toBe(concurrency ?? 3);
      expect(result.extraction).toMatchObject({ concurrency: concurrency ?? 3, reusedChunks: 0 });
      expect(result.provider).toMatchObject({ responseFormat: "json_schema", maximumOutput: 8_192,
        responseSchemaSha256: canonicalSha256(EXTRACTION_SCHEMA) });
      expect(fake.isClosed()).toBe(true);
      expect(ledgerExposure(fake.events)).toBe(14 * 24);
    });
  });

  test("rejects invalid concurrency before opening a ledger or dispatching", async () => {
    let opened = 0;
    for (const concurrency of [0, 13, 1.5, NaN, Infinity]) {
      await expect(runExtraction({ ...base, dataset: { corpora: [], questions: [] }, output: "unused", concurrency }, {
        openLedger: async () => { opened += 1; throw new Error("must not open"); },
      })).rejects.toThrow("concurrency");
    }
    expect(opened).toBe(0);
  });

  test("still rejects an oversized envelope if a provider violates the requested schema", async () => {
    await temporary(async (directory) => {
      const source = corpus("oversized", 1);
      const units = Array.from({ length: 49 }, () => ({ text: "Ada moved to Paris.",
        supports: [{ turnId: source.turns[0]!.id, quote: "I moved to Paris." }] }));
      const fake = runtime((async () => completion(JSON.stringify({ units }))) as typeof fetch);
      const result = await runExtraction({ ...base, dataset: { corpora: [source], questions: [] },
        output: join(directory, "report.json") }, fake.dependencies);
      expect(result.status).toBe("incomplete");
      expect(result.stopped).toBe("Malformed or oversized extraction envelope.");
      expect((result.unitBundle as UnitBundle).corpora[0]!.chunks).toHaveLength(0);
      expect(result.spend).toMatchObject({ reservedCalls: 1, confirmedThisRunUsd: 0.000024 });
      expect(fake.isClosed()).toBe(true);
    });
  });

  test("preserves later cached corpora and successful in-flight chunks when an earlier resumed chunk fails", async () => {
    await temporary(async (directory) => {
      const earlier = corpus("earlier", 4);
      const later = corpus("later", 1);
      const last = corpus("not-yet-started", 1);
      const stored = [earlier, later].map((source) => {
        const chunk = buildExtractionChunks(source).at(-1)!;
        const units = parseMemoryUnits({ units: [{ text: "Ada moved to Paris.",
          supports: [{ turnId: chunk.turns[0]!.id, quote: "I moved to Paris." }] }] }, chunk).units;
        return { corpusId: source.id, corpusSha256: corpusIdentity(source), chunks: [{ id: chunk.id, units, rejected: 0 }],
          unitsSha256: canonicalSha256(units) };
      });
      const previous: UnitBundle = { protocol: "oh.memory-unit-bundle.v1", dataset: "locomo", datasetSha256: DATASETS.locomo.sha256,
        split: "dev", seed: 17, extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION),
          reader, provider: "vercel-gateway", maximumOutput: 8_192 }, corpora: stored,
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, micros: 72 } };
      const resume = join(directory, "previous.json");
      await Bun.write(resume, JSON.stringify({ protocol: "oh.memory-benchmark.v1", unitBundle: previous }));
      let calls = 0;
      const fake = runtime((async () => {
        calls += 1;
        return completion(calls === 1 ? "malformed JSON" : '{"units":[]}');
      }) as typeof fetch);
      const output = join(directory, "report.json");
      const sources = [earlier, later, last];
      const result = await runExtraction({ ...base, dataset: { corpora: sources, questions: [] }, output, resume,
        concurrency: 2 }, fake.dependencies);
      expect(result.status).toBe("incomplete");
      expect(result.stopped).toBe("Extractor did not return a JSON object.");
      expect(calls).toBe(2);
      const bundle = result.unitBundle as UnitBundle;
      expect(bundle.corpora[0]!.chunks.map((chunk) => chunk.id)).toEqual([
        buildExtractionChunks(earlier)[1]!.id, stored[0]!.chunks[0]!.id,
      ]);
      expect(bundle.corpora[1]).toEqual(stored[1]);
      expect(bundle.corpora[2]!.chunks).toHaveLength(0);
      expect(bundle.usage).toEqual({ inputTokens: 140, cachedInputTokens: 0, outputTokens: 40, micros: 120 });
      expect(result.extraction).toMatchObject({ reusedChunks: 2, priorIngestionCostUsd: 0.000072 });
      expect(validateUnitBundle(bundle, "locomo", "dev", 17, sources, true).get(later.id)).toEqual(stored[1]!.chunks[0]!.units);
      expect((await Bun.file(`${output}.extraction.jsonl`).text()).trim().split("\n")).toHaveLength(1);
      expect(ledgerExposure(fake.events)).toBe(48);
      expect(fake.isClosed()).toBe(true);
    });
  });

  test("retains in-flight successes when the per-run call budget stops a concurrent batch", async () => {
    await temporary(async (directory) => {
      let calls = 0;
      const fake = runtime((async () => { calls += 1; return completion(); }) as typeof fetch);
      const result = await runExtraction({ ...base, maxCalls: 1, concurrency: 12,
        dataset: { corpora: [corpus("bounded", 14)], questions: [] }, output: join(directory, "report.json") }, fake.dependencies);
      expect(calls).toBe(1);
      expect(result.status).toBe("incomplete");
      expect(result.stopped).toBe("Pilot budget exhausted before dispatch.");
      expect((result.unitBundle as UnitBundle).corpora[0]!.chunks).toHaveLength(1);
      expect(result.spend).toMatchObject({ reservedCalls: 1, priorExposureUsd: 0.0001, unresolvedThisRunUsd: 0 });
      expect(ledgerExposure(fake.events)).toBe(24);
    });
  });
});

test("frozen extraction refuses incompatible resume profiles before dispatch", async () => {
  await temporary(async directory => {
    const source=corpus("frozen",1), frozen={sourceSha256:"a".repeat(64),selectionReportSha256:"b".repeat(64)};
    const bundle:UnitBundle={protocol:"oh.memory-unit-bundle.v1",dataset:"locomo",datasetSha256:DATASETS.locomo.sha256,
      split:"dev",seed:17,extractor:{profile:EXTRACTION_PROFILE,promptSha256:sha256Hex(EXTRACTION_INSTRUCTION),
        reader,provider:"vercel-gateway",maximumOutput:8192},corpora:[{corpusId:source.id,corpusSha256:corpusIdentity(source),
          chunks:[],unitsSha256:canonicalSha256([])}],usage:{inputTokens:0,cachedInputTokens:0,outputTokens:0,micros:0}};
    const report={protocol:"oh.memory-benchmark.v1",unitBundle:bundle,
      manifest:{code:{sourceSha256:frozen.sourceSha256},provenance:{reportSha256:frozen.selectionReportSha256}},
      provider:{responseFormat:"json_schema",responseSchemaSha256:canonicalSha256(EXTRACTION_SCHEMA)}};
    let calls=0;
    const fake=runtime((async()=>{calls++;return completion();}) as typeof fetch);
    const variants=[{...report,unitBundle:{...bundle,extractor:{...bundle.extractor,maximumOutput:4096}}},
      {...report,manifest:{...report.manifest,code:{sourceSha256:"c".repeat(64)}}},
      {...report,provider:{...report.provider,responseFormat:"json_object"}}];
    for(const [i,value] of variants.entries()){
      const resume=join(directory,"prior-"+i+".json");await Bun.write(resume,JSON.stringify(value));
      await expect(runExtraction({...base,dataset:{corpora:[source],questions:[]},frozen,resume,
        output:join(directory,"next-"+i+".json")},fake.dependencies)).rejects.toThrow("frozen extraction profile");
    }
    expect(calls).toBe(0);expect(fake.events).toEqual([]);
  });
});
