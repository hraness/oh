import { readFile, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import type { OhSemanticSearchBackendV1 } from "../../src/semantic";
import type { Corpus } from "./datasets";
import { prepareEvolutionCorpus } from "./evolution-retrieval";
import { packOhEvidenceContextV1, projectOhEvidenceTurnsV1,
  type OhEvidenceDependencyV1, type OhEvidenceSourcePositionV1 } from "./oh-evidence-context";

export type OhEvidenceContextRunOptionsV1 = Readonly<{ contextBytes: number; topK: number;
  previousTurns?: number; nextTurns?: number; rrfK?: number; vector?: boolean }>;

/** Explicit development generator; existing experiment protocols and outputs are untouched. */
export async function createOhEvidenceContextGeneratorV1(corpus: Corpus, options: Readonly<{
  positions?: readonly OhEvidenceSourcePositionV1[]; dependencies?: readonly OhEvidenceDependencyV1[];
  semanticBackend?: OhSemanticSearchBackendV1; semanticCacheDirectory?: string;
}> = {}) {
  const projection = projectOhEvidenceTurnsV1(corpus.turns, options);
  const prepared = await prepareEvolutionCorpus(corpus, options);
  return Object.freeze({ projection, identity: prepared.identity,
    async generate(question: string, inputConfig: OhEvidenceContextRunOptionsV1) {
      const vector = inputConfig.vector;
      if (vector !== undefined && typeof vector !== "boolean") throw new RangeError("Invalid evidence generator ranking configuration.");
      const config = Object.freeze({ contextBytes: inputConfig.contextBytes, topK: inputConfig.topK,
        previousTurns: inputConfig.previousTurns ?? 1, nextTurns: inputConfig.nextTurns ?? 1,
        rrfK: inputConfig.rrfK ?? 60, vector: vector ?? false });
      if (!Number.isSafeInteger(config.topK) || config.topK < 1 || config.topK > (config.vector ? 100 : 400)) {
        throw new RangeError("Invalid evidence generator ranking configuration.");
      }
      // Validate every packing bound before a semantic backend can perform work.
      packOhEvidenceContextV1({ projection, rankings: [] }, config);
      const requests = [prepared.nativeRanks(question, { source: "bm25-native", kind: "lexical", topK: config.topK })];
      if (config.vector) requests.push(prepared.nativeRanks(question, { source: "oh-vector-native", kind: "vector", topK: config.topK }));
      const rankings = Object.freeze(await Promise.all(requests));
      const rendering = packOhEvidenceContextV1({ projection, rankings }, config);
      const payload = { protocol: "oh.evidence-context-run.v1" as const, preparedSha256: prepared.identity.preparedSha256,
        sourceProjectionSha256: canonicalSha256(projection.records), querySha256: sha256Hex(question),
        config, rankings, rendering };
      return Object.freeze({ ...payload, runSha256: canonicalSha256(payload) });
    },
    close: () => prepared.close(),
  });
}

async function boundedFile(path: string, maximumBytes: number): Promise<string> {
  if ((await stat(path)).size > maximumBytes) throw new RangeError("Evidence generator input exceeds its byte limit.");
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text) > maximumBytes) throw new RangeError("Evidence generator input exceeds its byte limit.");
  return text;
}

/** CLI is local lexical-only; vector use requires the explicit generator backend/cache option. */
if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { corpus: { type: "string" }, query: { type: "string" },
    output: { type: "string" }, bytes: { type: "string", default: "96000" }, "top-k": { type: "string", default: "100" },
    previous: { type: "string", default: "1" }, next: { type: "string", default: "1" }, help: { type: "boolean" } }, strict: true });
  if (values.help) console.log("Usage: bun scripts/benchmarks/oh-evidence-context-run.ts --corpus corpus.json --query question.txt --output new-run.json [--bytes 96000 --top-k 100 --previous 1 --next 1]\nLocal lexical development context; never overwrites an existing artifact and makes no provider calls.");
  else {
    if (!values.corpus || !values.query || !values.output) throw new TypeError("Evidence generator requires --corpus, --query and --output.");
    const corpus: Corpus = JSON.parse(await boundedFile(values.corpus, 32 * 1024 * 1024));
    const question = await boundedFile(values.query, 16_384);
    const generator = await createOhEvidenceContextGeneratorV1(corpus);
    try {
      const result = await generator.generate(question, { contextBytes: Number(values.bytes), topK: Number(values["top-k"]),
        previousTurns: Number(values.previous), nextTurns: Number(values.next) });
      await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ output: values.output, runSha256: result.runSha256, contextBytes: result.rendering.contextBytes,
        nativeAnchors: result.rendering.anchors.length, includedTurns: result.rendering.turnIds.length }));
    } finally { await generator.close(); }
  }
}
