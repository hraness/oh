// Purpose: declared semantic fact producer for the `deductive-semantic`
// retrieval arm. Emits `sem-near(turn)` facts — question→turn embedding
// proximity under the pinned OH_EMBEDDING_PROFILE_V1 engine — as
// question-scoped derivation inputs. Every emitted fact's sources carry the
// producer digest, which binds the engine, model file sha256, thresholds,
// the pinned question digest, and the emitted turn set: semantic evidence
// enters the derivation with declared provenance and is replay-verified
// like every mechanical edge, never arriving as an opaque score.
//
// The engine is the repo's own optional semantic runtime (@tobilu/qmd),
// resolved from a scratch install under .cache/qmd-env so the package's
// dependency manifest stays untouched. Embedding outputs are deterministic
// for a fixed model file; the model's sha256 is pinned into every producer
// digest. Usage: bun run scripts/benchmarks/deductive-recall.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalSha256 } from "../../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../../src/semantic-model";
import { ROOT } from "./io";
import type { Corpus } from "./datasets";
import type { AlgalFactV1 } from "./consistency-rules";

export const SEMANTIC_PRODUCER_ID = "oh.deductive-semantic-producer.v1" as const;
/** sha256 of the pinned embeddinggemma-300M Q8_0 GGUF file actually loaded. */
export const SEMANTIC_MODEL_SHA256 =
  "b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63" as const;
export const SEMANTIC_PROFILE_SHA256 = canonicalSha256(OH_EMBEDDING_PROFILE_V1);

const SEM_MODEL = OH_EMBEDDING_PROFILE_V1.model;
const DEFAULT_CACHE = join(ROOT, ".cache/benchmarks/sem");
const QMD_SPECIFIER = join(ROOT, ".cache/qmd-env/node_modules/@tobilu/qmd");

interface QmdHit { readonly filepath?: unknown; readonly displayPath?: unknown;
  readonly score?: unknown }
interface QmdStoreLike {
  update(options: unknown): Promise<unknown>;
  embed(options: unknown): Promise<unknown>;
  searchVector(query: string, options: unknown): Promise<readonly QmdHit[]>;
  close(): Promise<void>;
}

export interface SemanticProducerOptions {
  readonly cacheRoot?: string;
  /** Score floor for a `sem-near` edge (default 0.30, tuned on dev only). */
  readonly tau?: number;
  /** Maximum `sem-near` facts per question (default 48). */
  readonly topN?: number;
}

export interface SemanticFacts {
  readonly facts: readonly AlgalFactV1[];
  readonly nearTurns: readonly string[];
  readonly producerDigest: string;
}

export interface SemanticProducer {
  /** Writes turn documents and embeds the collection once; repeated calls are
   * incremental (qmd skips unchanged documents by content hash). */
  prepare(corpus: Corpus): Promise<void>;
  /** One vector search serving both consumers: `ranked` is the score-ordered
   * proximity list (the "embeddings alone" baseline), `facts` the declared
   * `sem-near` edges above tau for the deductive-semantic derivation. */
  searchAndFacts(question: string, questionDigest: string, rankLimit: number):
    Promise<SemanticFacts & { ranked: readonly { turnId: string; score: number }[] }>;
  factsFor(question: string, questionDigest: string): Promise<SemanticFacts>;
  /** Raw score-ordered proximity ranking — the honest "embeddings alone"
   * baseline arm the semantic-deductive composition is compared against. */
  vectorRank(question: string, limit: number): Promise<readonly { turnId: string; score: number }[]>;
  close(): Promise<void>;
}

function fail(message: string): never {
  throw new TypeError(`deductive semantic producer: ${message}`);
}

export async function createSemanticProducer(
  options: SemanticProducerOptions = {}): Promise<SemanticProducer> {
  const cacheRoot = options.cacheRoot ?? DEFAULT_CACHE;
  const tau = options.tau ?? 0.30;
  const topN = options.topN ?? 48;
  if (!Number.isFinite(tau) || tau < 0 || tau >= 1) fail("invalid tau");
  if (!Number.isSafeInteger(topN) || topN < 1 || topN > 256) fail("invalid topN");
  let createStore: unknown;
  try { createStore = (await import(QMD_SPECIFIER)).createStore; }
  catch { fail("@tobilu/qmd is not provisioned — run `bun add @tobilu/qmd@2.5.3` inside .cache/qmd-env"); }
  if (typeof createStore !== "function") fail("installed qmd has no createStore export");

  let store: QmdStoreLike | null = null;
  let indexOfFile = new Map<string, number>();
  let turnIds: readonly string[] = [];

  const vectorRank = async (question: string, limit: number) => {
    if (store === null) fail("prepare() has not run");
    const hits = await store.searchVector(question, { collection: "oh", limit });
    const out: { turnId: string; score: number }[] = [];
    for (const hit of hits) {
      const name = String(hit.displayPath ?? hit.filepath ?? "").split("/").pop() ?? "";
      const index = indexOfFile.get(name);
      const score = typeof hit.score === "number" ? hit.score : Number.NaN;
      if (index === undefined || !Number.isFinite(score)) continue;
      out.push({ turnId: turnIds[index]!, score });
    }
    return out;
  };

  const searchAndFacts = async (question: string, questionDigest: string, rankLimit: number) => {
    const ranked = await vectorRank(question, Math.max(topN, rankLimit));
    const near = ranked.filter((hit) => hit.score >= tau).map((hit) => hit.turnId);
    const producerDigest = `sha256:${canonicalSha256({ producer: SEMANTIC_PRODUCER_ID,
      engine: OH_EMBEDDING_PROFILE_V1.engine, model: SEM_MODEL,
      modelSha256: SEMANTIC_MODEL_SHA256, profileSha256: SEMANTIC_PROFILE_SHA256,
      tau, topN, question: questionDigest,
      near: [...near].sort(), scores: near.map((id) =>
        Math.round((ranked.find((hit) => hit.turnId === id)!.score) * 1_000_000) / 1_000_000) })}`;
    const facts = near.map((turnId): AlgalFactV1 => ({ relation: "sem-near",
      tuple: [`turn:${turnId}`], sources: [producerDigest] }));
    return Object.freeze({ facts, nearTurns: near, producerDigest,
      ranked: ranked.slice(0, rankLimit) });
  };

  return Object.freeze({
    async prepare(corpus: Corpus): Promise<void> {
      if (store !== null) await store.close();
      const dir = join(cacheRoot, corpus.id);
      const docs = join(dir, "docs");
      mkdirSync(docs, { recursive: true });
      indexOfFile = new Map();
      corpus.turns.forEach((turn, index) => {
        const filename = `t${String(index).padStart(5, "0")}.md`;
        indexOfFile.set(filename, index);
        writeFileSync(join(docs, filename),
          `# ${turn.speaker} — ${turn.date}\n\n${turn.text}\n`, { mode: 0o600 });
      });
      turnIds = corpus.turns.map((turn) => turn.id);
      store = await (createStore as (o: unknown) => Promise<QmdStoreLike>)({
        dbPath: join(dir, "qmd.sqlite"),
        config: { collections: { oh: { path: docs, pattern: "*.md" } },
          models: { embed: SEM_MODEL } },
      });
      await store.update({ collections: ["oh"] });
      await store.embed({ collection: "oh", model: SEM_MODEL });
    },

    searchAndFacts,

    vectorRank,

    async factsFor(question: string, questionDigest: string): Promise<SemanticFacts> {
      const { ranked: _, ...rest } = await searchAndFacts(question, questionDigest, 0);
      return Object.freeze(rest);
    },

    async close(): Promise<void> {
      if (store !== null) { await store.close(); store = null; }
    },
  });
}
