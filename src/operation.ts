import {
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  type Sha256Hex,
} from "./canonical";
import { OH_CONTRACT_ID_V1 } from "./ontology";
import { canonicalKnowledgeGraphChangesV1, OH_GRAPH_LIMITS_V1, type KnowledgeGraphChangeV1 } from "./graph";

export { graphRevisionSha256V1 } from "./graph";

export const OH_OPERATION_MAX_BYTES_V1 = 64 * 1024 * 1024;

export type OhOperationPayloadV1 = Readonly<{
  actorId: string;
  changes: readonly KnowledgeGraphChangeV1[];
  contractId: typeof OH_CONTRACT_ID_V1;
  graphRevisionSha256: Sha256Hex;
  instant: string;
  operationId: string;
  parentOperationSha256: Sha256Hex | null;
  recordsSha256: Sha256Hex;
  sequence: number;
  spaceId: string;
  v: 1;
}>;

export type OhOperationV1 = OhOperationPayloadV1 & Readonly<{ operationSha256: Sha256Hex }>;

function parsePayload(value: unknown): OhOperationPayloadV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["actorId", "changes", "contractId",
    "graphRevisionSha256", "instant", "operationId", "parentOperationSha256", "recordsSha256",
    "sequence", "spaceId", "v"]) || value.v !== 1 || value.contractId !== OH_CONTRACT_ID_V1
    || !Array.isArray(value.changes)) return null;
  const actorId = safeCode(value.actorId);
  const operationId = safeCode(value.operationId);
  const spaceId = safeCode(value.spaceId);
  const graphRevisionSha256 = parseSha256Hex(value.graphRevisionSha256);
  const parentOperationSha256 = value.parentOperationSha256 === null
    ? null : parseSha256Hex(value.parentOperationSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const instant = parseCanonicalInstantV1(value.instant);
  const sequence = Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0
    ? value.sequence as number : null;
  let changes: readonly KnowledgeGraphChangeV1[];
  try { changes = canonicalKnowledgeGraphChangesV1(value.changes as KnowledgeGraphChangeV1[]); } catch { return null; }
  if (changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation) return null;
  return actorId !== null && operationId !== null && spaceId !== null
      && graphRevisionSha256 !== null && recordsSha256 !== null && instant !== null && sequence !== null
      && (value.parentOperationSha256 === null || parentOperationSha256 !== null)
      && ((sequence === 1) === (parentOperationSha256 === null))
    ? { actorId, changes, contractId: OH_CONTRACT_ID_V1, graphRevisionSha256, instant,
        operationId, parentOperationSha256, recordsSha256, sequence, spaceId, v: 1 }
    : null;
}

export function createOhOperationV1(input: OhOperationPayloadV1): OhOperationV1 {
  const payload = parsePayload(input);
  if (payload === null) throw new TypeError("Invalid Oh operation payload.");
  const operation = { ...payload, operationSha256: canonicalSha256(payload) };
  if (Buffer.byteLength(canonicalJson(operation), "utf8") > OH_OPERATION_MAX_BYTES_V1) {
    throw new RangeError("Oh operation exceeds its canonical byte limit.");
  }
  return operation;
}

export function parseOhOperationV1(value: unknown): OhOperationV1 | null {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "operationSha256")) return null;
  const operationSha256 = parseSha256Hex(value.operationSha256);
  const { operationSha256: _digest, ...input } = value;
  const payload = parsePayload(input);
  return operationSha256 !== null && payload !== null
      && Buffer.byteLength(canonicalJson({ ...payload, operationSha256 }), "utf8") <= OH_OPERATION_MAX_BYTES_V1
      && canonicalSha256(payload) === operationSha256
    ? { ...payload, operationSha256 } : null;
}
