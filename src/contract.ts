import { canonicalJson, canonicalSha256, type JsonValue, type Sha256Hex } from "./canonical";
import { OH_GRAPH_FORMAT_VERSION_V1, OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  type KnowledgeGraphRecordKindV1 } from "./graph";
import { OH_CONTRACT_ID_V1, OH_ONTOLOGY_VERSION_V1 } from "./ontology";
import { OH_SCHEMA_FORMAT_VERSION_V1 } from "./schema";

export type OhContractManifestV1 = Readonly<{
  contractId: typeof OH_CONTRACT_ID_V1;
  contractSha256: Sha256Hex;
  graphFormatVersion: typeof OH_GRAPH_FORMAT_VERSION_V1;
  ontologyVersion: typeof OH_ONTOLOGY_VERSION_V1;
  recordKinds: readonly KnowledgeGraphRecordKindV1[];
  schemaFormatVersion: typeof OH_SCHEMA_FORMAT_VERSION_V1;
  v: 1;
}>;

const manifestPayload = Object.freeze({
  contractId: OH_CONTRACT_ID_V1,
  graphFormatVersion: OH_GRAPH_FORMAT_VERSION_V1,
  ontologyVersion: OH_ONTOLOGY_VERSION_V1,
  recordKinds: OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  schemaFormatVersion: OH_SCHEMA_FORMAT_VERSION_V1,
  v: 1 as const,
});

export const OH_CONTRACT_MANIFEST_V1: OhContractManifestV1 = Object.freeze({
  ...manifestPayload,
  contractSha256: canonicalSha256(manifestPayload),
});

/** Accepts only the complete, byte-equivalent V1 contract manifest. */
export function parseOhContractManifestV1(value: unknown): OhContractManifestV1 | null {
  try {
    return canonicalJson(value) === canonicalJson(OH_CONTRACT_MANIFEST_V1)
      ? OH_CONTRACT_MANIFEST_V1 : null;
  } catch { return null; }
}

export type OhRecordCodec<T extends JsonValue = JsonValue> = Readonly<{
  kind: KnowledgeGraphRecordKindV1;
  parse(value: unknown): T | null;
}>;

/** Optional semantic validation layered over the immutable generic record envelope. */
export class OhRecordCodecRegistry {
  readonly #codecs = new Map<KnowledgeGraphRecordKindV1, OhRecordCodec>();

  register(codec: OhRecordCodec): this {
    if (this.#codecs.has(codec.kind)) throw new TypeError(`A codec is already registered for ${codec.kind}.`);
    this.#codecs.set(codec.kind, codec);
    return this;
  }

  parse(kind: KnowledgeGraphRecordKindV1, value: unknown): JsonValue | null {
    const codec = this.#codecs.get(kind);
    if (codec !== undefined) return codec.parse(value);
    try { canonicalJson(value); return value as JsonValue; } catch { return null; }
  }

  has(kind: KnowledgeGraphRecordKindV1): boolean {
    return this.#codecs.has(kind);
  }
}
