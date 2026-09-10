import { canonicalSha256, sha256Hex } from "./canonical";
import type { KnowledgeGraphRecordV1 } from "./graph";
import { recordDocument, type OhSemanticSearchResultV1 } from "./semantic-model";
import { hostedDocumentChunksV1, hostedInteger, hostedQueryV1, hostedRecordsV1, hostedSourceSha256V1,
  OH_HOSTED_EMBEDDING_PROFILE_V2, parseOhHostedSnapshotV1, type OhHostedSnapshotV1,
  type OhSemanticSearchBackendV2 } from "./semantic-hosted-model";
import type { OhSqliteStore } from "./sqlite/store";

/** Immutable precomputed vectors; no provider, filesystem or asynchronous resource ownership. */
export class OhHostedSemanticBackendV2 implements OhSemanticSearchBackendV2 {
  readonly profile = OH_HOSTED_EMBEDDING_PROFILE_V2;
  readonly snapshot: OhHostedSnapshotV1;
  readonly snapshotSha256;
  #indexed = false;
  #closed = false;
  constructor(snapshot: unknown) {
    this.snapshot = parseOhHostedSnapshotV1(snapshot);
    this.snapshotSha256 = canonicalSha256(this.snapshot);
    Object.freeze(this);
  }
  async index(value: readonly KnowledgeGraphRecordV1[]): Promise<Readonly<{ indexed: number; v: 1 }>> {
    this.#open();
    this.#indexed = false;
    const records = hostedRecordsV1(value);
    if (hostedSourceSha256V1(records) !== this.snapshot.sourceSha256) throw new TypeError("Hosted index source mismatch.");
    for (const [index, record] of records.entries()) {
      const expected = this.snapshot.records[index]!;
      const chunks = hostedDocumentChunksV1(record);
      if (sha256Hex(recordDocument(record)) !== expected.documentSha256 || chunks.length !== expected.chunks.length
        || chunks.some((chunk, i) => chunk.start !== expected.chunks[i]!.start || chunk.end !== expected.chunks[i]!.end
          || chunk.inputSha256 !== expected.chunks[i]!.inputSha256)) throw new TypeError("Hosted document/chunk binding mismatch.");
    }
    this.#indexed = true;
    return { indexed: records.length, v: 1 };
  }
  async search(query: string, limit: number, authority: OhSqliteStore): Promise<readonly OhSemanticSearchResultV1[]> {
    this.#open();
    if (!this.#indexed) throw new Error("Hosted index has not been source-validated.");
    hostedInteger(limit, 100, 1);
    const querySha = sha256Hex(hostedQueryV1(query));
    const found = this.snapshot.queries.find(q => q.querySha256 === querySha);
    if (found === undefined) throw new Error("No precomputed hosted vector for this exact query.");
    const vector = this.snapshot.embeddings[found.embeddingIndex]!.vector;
    const results: OhSemanticSearchResultV1[] = [];
    for (const record of this.snapshot.records) {
      if (authority.get(record.key)?.recordSha256 !== record.recordSha256) continue;
      let score = -1;
      for (const chunk of record.chunks) {
        const candidate = this.snapshot.embeddings[chunk.embeddingIndex]!.vector;
        const cosine = candidate.reduce((sum, component, index) => sum + component * vector[index]!, 0);
        score = Math.max(score, Math.min(1, Math.max(-1, cosine)));
      }
      results.push({ key: record.key, recordSha256: record.recordSha256, score, v: 1 });
    }
    return results.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, limit);
  }
  async close(): Promise<void> { this.#closed = true; this.#indexed = false; }
  #open(): void { if (this.#closed) throw new Error("Hosted semantic backend is closed."); }
}
