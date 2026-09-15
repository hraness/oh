import { createKnowledgeWikidataMappingPreviewV1, spongeKnowledgeWikidataMappingCatalogV1 } from "./research/knowledge-wikidata-mappings-v1";
import { createKnowledgeWikidataMappingPreviewV2, spongeKnowledgeWikidataMappingCatalogV2 } from "./research/knowledge-wikidata-mappings-v2";
import { spongeKnowledgeWikidataMappingCatalogV3 } from "./research/knowledge-wikidata-mappings-v3";
import { spongeKnowledgeDomainCatalogV3 } from "./research/knowledge-domain-catalog-v3";
import { spongeKnowledgeDomainCatalogV4 } from "./research/knowledge-domain-catalog-v4";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "./research/document-domain";
import { spongeKnowledgeDomainCatalogV2 } from "./research/knowledge-domain-catalog-v2";
import { isPlainRecord } from "./research/unknown";
import { createKnowledgeWikidataImportPreviewV2 } from "./research/knowledge-wikidata-import-v2";
import { spongeKnowledgeDomainCatalog } from "./research/knowledge-domain-catalog";
import { parseSpongeKnowledgeProposalDraftV3 } from "./research/knowledge-proposal-v3";
import { createKnowledgeWikidataImportPreviewV1 } from "./research/knowledge-wikidata-import-v1";
import { OH_RESEARCH_PACKET_LIMITS_V1, prepareOhResearchPacketV1,
  verifyOhResearchPacketV1 } from "./research/research-packet";

async function readInput(path: string): Promise<unknown> {
  if (path.length === 0 || path.length > 4096 || path.includes("\0")) {
    throw new TypeError("Research input path is invalid.");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const limit = OH_RESEARCH_PACKET_LIMITS_V1.packetBytes;
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new RangeError("Research input must be a bounded regular file.");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > limit) throw new RangeError("Research input exceeds its byte limit.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))) as unknown;
  } finally { await handle.close(); }
}

/** Offline commands have no store, host identity, credentials, or network client. */
export async function runOhResearchCli(arguments_: readonly string[]): Promise<number> {
  const command = arguments_[0];
  let output: unknown;
  if (["catalog", "catalog-v2", "catalog-v3", "catalog-v4", "wikidata-mappings", "wikidata-mappings-v2", "wikidata-mappings-v3"].includes(command ?? "") && arguments_.length === 1) {
    output = command === "catalog-v4" ? await spongeKnowledgeDomainCatalogV4()
      : command === "catalog-v3" ? await spongeKnowledgeDomainCatalogV3()
      : command === "wikidata-mappings-v3" ? await spongeKnowledgeWikidataMappingCatalogV3()
      : command === "wikidata-mappings-v2" ? await spongeKnowledgeWikidataMappingCatalogV2()
      : command === "wikidata-mappings" ? await spongeKnowledgeWikidataMappingCatalogV1()
      : command === "catalog-v2" ? await spongeKnowledgeDomainCatalogV2() : await spongeKnowledgeDomainCatalog();
  } else {
    if (!["validate-draft", "wikidata-preview", "wikidata-mapping-preview", "wikidata-mapping-preview-v2", "prepare-packet", "verify-packet"].includes(command ?? "")
      || arguments_.length !== 3 || arguments_[1] !== "--file") {
      throw new TypeError("Use research catalog|catalog-v2|catalog-v3|catalog-v4|wikidata-mappings|wikidata-mappings-v2|wikidata-mappings-v3 or research validate-draft|wikidata-preview|wikidata-mapping-preview|wikidata-mapping-preview-v2|prepare-packet|verify-packet --file PATH.");
    }
    const input = await readInput(arguments_[2] as string);
    if (command === "validate-draft") output = parseSpongeKnowledgeProposalDraftV3(input);
    if (command === "prepare-packet") output = await prepareOhResearchPacketV1(input);
    if (command === "verify-packet") output = await verifyOhResearchPacketV1(input);
    if (command === "wikidata-mapping-preview" || command === "wikidata-mapping-preview-v2") {
      const preview = command === "wikidata-mapping-preview-v2"
        ? await createKnowledgeWikidataMappingPreviewV2(input) : await createKnowledgeWikidataMappingPreviewV1(input);
      if (!preview.ok) throw new TypeError("Invalid Wikidata mapping request.");
      output = preview.value;
    }
    if (command === "wikidata-preview") {
      const preview = isPlainRecord(input) && input["v"] === 2
        ? await createKnowledgeWikidataImportPreviewV2(input) : await createKnowledgeWikidataImportPreviewV1(input);
      if (!preview.ok) throw new TypeError("Invalid Wikidata capture request.");
      output = preview.value;
    }
    if (output === null || output === undefined) throw new TypeError("Invalid research input.");
  }
  const text = canonicalJson(output as JsonValue);
  if (Buffer.byteLength(text) > OH_RESEARCH_PACKET_LIMITS_V1.packetBytes) {
    throw new RangeError("Research output exceeds its byte limit.");
  }
  process.stdout.write(`${text}\n`);
  return 0;
}
