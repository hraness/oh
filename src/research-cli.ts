import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "./research/document-domain";
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
  if (command === "catalog" && arguments_.length === 1) {
    output = await spongeKnowledgeDomainCatalog();
  } else {
    if (!["validate-draft", "wikidata-preview", "prepare-packet", "verify-packet"].includes(command ?? "")
      || arguments_.length !== 3 || arguments_[1] !== "--file") {
      throw new TypeError("Use research catalog or research validate-draft|wikidata-preview|prepare-packet|verify-packet --file PATH.");
    }
    const input = await readInput(arguments_[2] as string);
    if (command === "validate-draft") output = parseSpongeKnowledgeProposalDraftV3(input);
    if (command === "prepare-packet") output = await prepareOhResearchPacketV1(input);
    if (command === "verify-packet") output = await verifyOhResearchPacketV1(input);
    if (command === "wikidata-preview") {
      const preview = await createKnowledgeWikidataImportPreviewV1(input);
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
