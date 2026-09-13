import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/** Read-only fixture acquisition. Importing this file performs no I/O. */
export const WIKIDATA_INVENTORY_LIMITS_V1 = Object.freeze({
  sources: 512, properties: 20_000, listingPages: 40, selectedEntities: 96,
  responseBytes: 2 * 1024 * 1024, archiveBytes: 16 * 1024 * 1024,
  expandedArchiveBytes: 48 * 1024 * 1024, manifestBytes: 8 * 1024 * 1024,
  requestMilliseconds: 30_000, captureMilliseconds: 20 * 60_000,
});

export const WIKIDATA_CORPUS_SELECTION_V1 = Object.freeze([
  ["P31", "instance membership"], ["P279", "subclass membership"], ["P361", "part membership"],
  ["P527", "parts"], ["P2302", "property constraints"], ["P2303", "constraint exceptions"],
  ["P2308", "constraint classes"], ["P2309", "constraint relations"], ["P2316", "constraint status"],
  ["P18", "media"], ["P50", "authorship"], ["P170", "creation"], ["P921", "subject"],
  ["P625", "coordinates"], ["P2048", "quantities"], ["P577", "publication time"],
  ["P580", "valid from"], ["P582", "valid through"], ["P571", "inception"],
  ["P144", "derivation"], ["P1889", "distinct identity"], ["P460", "reported identity"],
  ["P629", "editions and translations"], ["P747", "editions"], ["P407", "language"],
  ["P136", "genre"], ["P175", "performance"], ["P3616", "geographic external identifiers"],
  ["P356", "publication identifiers"], ["P249", "ticker assignments"], ["P414", "listings"],
  ["P274", "chemical notation"], ["P231", "chemical identifiers"], ["P703", "organism context"],
  ["P348", "software versions"], ["P277", "programming languages"], ["P155", "sequence"],
  ["P156", "sequence"], ["P1545", "ordering"], ["P854", "source URLs"],
  ["Q35120", "entity"], ["Q5", "people"], ["Q43229", "organizations"],
  ["Q783794", "companies"], ["Q431289", "brands"], ["Q726", "horses"],
  ["Q16521", "taxa"], ["Q8074", "clouds"], ["Q712378", "anatomy"],
  ["Q12136", "disease"], ["Q172847", "peptides"], ["Q13442814", "publications"],
  ["Q46857", "research methods"], ["Q1656682", "events"], ["Q7397", "software"],
  ["Q117349473", "AI models"], ["Q2539", "machine learning"], ["Q7366", "music"],
  ["Q853725", "social relations"], ["Q247506", "financial instruments"],
  ["Q189156", "cellular automata"], ["Q111352", "lexemes"], ["L1", "forms and senses"],
  ["Q11573", "metre"], ["Q1985727", "Gregorian calendar model"],
  ["Q1985786", "Julian calendar model"], ["Q11902211", "WGS 84"],
] as const);

const API = "https://www.wikidata.org/w/api.php";
const PROPERTY = /^P[1-9][0-9]{0,11}$/u;
const ENTITY = /^(?:P|Q|L)[1-9][0-9]{0,11}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const KINDS = ["listing", "property-metadata", "entity"] as const;
type SourceKind = (typeof KINDS)[number];
type ObjectValue = Record<string, unknown>;
export type WikidataInventorySourceV1 = {
  key: string; kind: SourceKind; sourceUri: string; capturedAt: string;
  body: string; bodyBytes: number; bodySha256: string;
};
export type WikidataInventoryPropertyV1 = {
  id: string; datatype: string; revision: number; sourceSha256: string;
};
type EntitySummary = {
  id: string; type: string; revision: number; sourceSha256: string;
  englishLabel: string | null; statementCount: number; constraintCount: number;
  forms: number; senses: number;
};
type ClassEdge = {
  subject: string; predicate: string; object: string; rank: string;
  statementId: string; revision: number; sourceSha256: string;
};

export function wikidataSourceSha256V1(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

async function readBoundedRegularFile(path: string, maximum: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw new Error("file size out of bounds");
    const output = Buffer.alloc(Math.min(info.size + 1, maximum + 1));
    let length = 0;
    while (length < output.length) {
      const { bytesRead } = await handle.read(output, length, output.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== info.size || length > maximum) throw new Error("file changed during bounded read");
    return output.subarray(0, length);
  } finally { await handle.close(); }
}

function object(value: unknown, where: string): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: expected object`);
  return value as ObjectValue;
}
function array(value: unknown, maximum: number, where: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${where}: invalid array bound`);
  return value as unknown[];
}
function string(value: unknown, where: string, maximum = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new Error(`${where}: invalid string`);
  return value;
}
function positiveInteger(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${where}: invalid integer`);
  return value;
}
function exactKeys(value: ObjectValue, keys: readonly string[], where: string): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new Error(`${where}: unexpected keys`);
}
function instant(value: unknown, where: string): string {
  const result = string(value, where, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) || new Date(result).toISOString() !== result) {
    throw new Error(`${where}: invalid instant`);
  }
  return result;
}
function apiUrl(parameters: Record<string, string>): string {
  const url = new URL(API);
  for (const [key, value] of Object.entries({ ...parameters, format: "json", maxlag: "5" })) url.searchParams.set(key, value);
  return url.toString();
}
function listingUrl(continuation?: string): string {
  return apiUrl({ action: "query", list: "allpages", apnamespace: "120", aplimit: "500", apfilterredir: "nonredirects",
    ...(continuation === undefined ? {} : { apcontinue: continuation }) });
}
function metadataUrl(ids: readonly string[]): string {
  return apiUrl({ action: "wbgetentities", ids: ids.join("|"), props: "datatype|info" });
}
function entityUrl(id: string): string { return apiUrl({ action: "wbgetentities", ids: id }); }
function parsedBody(source: WikidataInventorySourceV1): ObjectValue {
  const result = object(JSON.parse(source.body) as unknown, source.key);
  if ("error" in result || "warnings" in result) throw new Error(`${source.key}: source API did not complete cleanly`);
  return result;
}
function parseSource(value: unknown): WikidataInventorySourceV1 {
  const item = object(value, "source");
  exactKeys(item, ["key", "kind", "sourceUri", "capturedAt", "body", "bodyBytes", "bodySha256"], "source");
  const key = string(item.key, "source.key", 64);
  if (!/^(?:listing-[0-9]{3}|properties-[0-9]{3}|entity-[PQL][1-9][0-9]{0,11})$/u.test(key)) throw new Error("source: invalid key");
  if (!KINDS.includes(item.kind as SourceKind)) throw new Error("source: invalid kind");
  const body = string(item.body, "source.body", WIKIDATA_INVENTORY_LIMITS_V1.responseBytes);
  const bodyBytes = positiveInteger(item.bodyBytes, "source.bodyBytes");
  const bodySha256 = string(item.bodySha256, "source.bodySha256", 64);
  if (bodyBytes > WIKIDATA_INVENTORY_LIMITS_V1.responseBytes || Buffer.byteLength(body) !== bodyBytes
    || !SHA256.test(bodySha256) || wikidataSourceSha256V1(body) !== bodySha256) throw new Error(`${key}: source byte digest mismatch`);
  const sourceUri = string(item.sourceUri, "source.sourceUri", 4096);
  const url = new URL(sourceUri);
  if (url.origin + url.pathname !== API || url.hash || url.username || url.password) throw new Error(`${key}: invalid API source`);
  return { key, kind: item.kind as SourceKind, sourceUri, capturedAt: instant(item.capturedAt, "source.capturedAt"), body, bodyBytes, bodySha256 };
}

/** Verifies the exact completed traversal, source bytes and every derived row. No network. */
export function deriveWikidataInventoryV1(sourceValues: readonly unknown[]) {
  if (sourceValues.length < 3 || sourceValues.length > WIKIDATA_INVENTORY_LIMITS_V1.sources) throw new Error("source count out of bounds");
  const sources = sourceValues.map(parseSource);
  if (new Set(sources.map((source) => source.key)).size !== sources.length) throw new Error("duplicate source key");
  const listed: string[] = [];
  const listings = sources.filter((source) => source.kind === "listing");
  if (listings.length === 0 || listings.length > WIKIDATA_INVENTORY_LIMITS_V1.listingPages) throw new Error("listing count out of bounds");
  let continuation: string | undefined;
  let completed = false;
  for (const [index, source] of listings.entries()) {
    if (completed || source.key !== `listing-${String(index).padStart(3, "0")}` || source.sourceUri !== listingUrl(continuation)) {
      throw new Error("listing traversal discontinuity");
    }
    const result = parsedBody(source);
    for (const value of array(object(result.query, source.key).allpages, 500, source.key)) {
      const page = object(value, source.key);
      const title = string(page.title, "page.title", 64);
      if (page.ns !== 120 || !/^Property:P[1-9][0-9]{0,11}$/u.test(title)) throw new Error("non-property listing entry");
      positiveInteger(page.pageid, "page.pageid");
      listed.push(title.slice("Property:".length));
    }
    if (result.continue === undefined) completed = true;
    else continuation = string(object(result.continue, source.key).apcontinue, "apcontinue", 64);
  }
  if (!completed || listed.length === 0 || listed.length > WIKIDATA_INVENTORY_LIMITS_V1.properties
    || new Set(listed).size !== listed.length || [...listed].sort().join("|") !== listed.join("|")) throw new Error("incomplete or inconsistent property traversal");
  const properties: WikidataInventoryPropertyV1[] = [];
  const omissions: { id: string; reason: "missing-during-metadata-capture"; sourceSha256: string }[] = [];
  const batches = sources.filter((source) => source.kind === "property-metadata");
  if (batches.length !== Math.ceil(listed.length / 50)) throw new Error("incomplete metadata batches");
  for (const [index, source] of batches.entries()) {
    const requested = listed.slice(index * 50, (index + 1) * 50);
    if (source.key !== `properties-${String(index).padStart(3, "0")}` || source.sourceUri !== metadataUrl(requested)) throw new Error("metadata batch mismatch");
    const entities = object(parsedBody(source).entities, source.key);
    exactKeys(entities, requested, source.key);
    for (const id of requested) {
      const entity = object(entities[id], id);
      if (entity.id !== id) throw new Error(`${id}: source identity mismatch`);
      if ("missing" in entity) { omissions.push({ id, reason: "missing-during-metadata-capture", sourceSha256: source.bodySha256 }); continue; }
      if (entity.type !== "property" || entity.ns !== 120 || entity.title !== `Property:${id}`) throw new Error(`${id}: non-property metadata`);
      const datatype = string(entity.datatype, `${id}.datatype`, 64);
      if (!/^[a-zA-Z][a-zA-Z0-9-]*$/u.test(datatype)) throw new Error(`${id}: invalid datatype`);
      properties.push({ id, datatype, revision: positiveInteger(entity.lastrevid, `${id}.lastrevid`), sourceSha256: source.bodySha256 });
    }
  }
  const captures = sources.filter((source) => source.kind === "entity");
  if (captures.length === 0 || captures.length > WIKIDATA_INVENTORY_LIMITS_V1.selectedEntities) throw new Error("corpus count out of bounds");
  const entities: EntitySummary[] = [];
  const classEdges: ClassEdge[] = [];
  for (const source of captures) {
    const id = source.key.slice("entity-".length);
    if (!ENTITY.test(id) || source.sourceUri !== entityUrl(id)) throw new Error("corpus source mismatch");
    const values = object(parsedBody(source).entities, source.key);
    exactKeys(values, [id], source.key);
    const entity = object(values[id], id);
    if (entity.id !== id || "missing" in entity || "redirects" in entity) throw new Error(`${id}: missing or redirected corpus entity`);
    const type = string(entity.type, `${id}.type`, 32);
    if (type !== (id.startsWith("P") ? "property" : id.startsWith("L") ? "lexeme" : "item")) throw new Error(`${id}: corpus entity type mismatch`);
    const revision = positiveInteger(entity.lastrevid, `${id}.lastrevid`);
    const claims = object(entity.claims, `${id}.claims`);
    let statementCount = 0;
    let constraintCount = 0;
    for (const [predicate, values] of Object.entries(claims)) {
      if (!PROPERTY.test(predicate)) throw new Error(`${id}: invalid claim property`);
      const statements = array(values, 5000, `${id}.${predicate}`);
      statementCount += statements.length;
      if (predicate === "P2302") constraintCount += statements.length;
      if (!["P31", "P279", "P361"].includes(predicate)) continue;
      for (const value of statements) {
        const statement = object(value, "statement");
        const snak = object(statement.mainsnak, "mainsnak");
        if (snak.snaktype !== "value" || snak.datatype !== "wikibase-item") continue;
        const target = object(object(snak.datavalue, "datavalue").value, "datavalue.value");
        const targetId = string(target.id, "target.id", 64);
        if (!/^Q[1-9][0-9]{0,11}$/u.test(targetId)) throw new Error(`${id}: invalid class target`);
        classEdges.push({ subject: id, predicate, object: targetId, rank: string(statement.rank, "rank", 32),
          statementId: string(statement.id, "statement.id", 256), revision, sourceSha256: source.bodySha256 });
      }
    }
    const label = entity.labels === undefined ? undefined : object(entity.labels, "labels").en;
    entities.push({ id, type, revision, sourceSha256: source.bodySha256,
      englishLabel: label === undefined ? null : string(object(label, "label").value, "label.value", 4096),
      statementCount, constraintCount,
      forms: entity.forms === undefined ? 0 : array(entity.forms, 1000, "forms").length,
      senses: entity.senses === undefined ? 0 : array(entity.senses, 1000, "senses").length });
  }
  properties.sort((a, b) => compare(a.id, b.id));
  entities.sort((a, b) => compare(a.id, b.id));
  // Sorting is a presentation rule; the statement identifiers retain their exact source case.
  classEdges.sort((a, b) => compare(a.statementId.toLowerCase(), b.statementId.toLowerCase()) || compare(b.statementId, a.statementId));
  const datatypeCounts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const property of properties) datatypeCounts[property.datatype] = (datatypeCounts[property.datatype] ?? 0) + 1;
  const orderedDatatypeCounts = Object.fromEntries(Object.entries(datatypeCounts).sort(([a], [b]) => compare(a, b)));
  return {
    v: 1 as const, kind: "oh.wikidata.inventory.v1" as const,
    captureWindow: { firstResponseAt: sources.map((source) => source.capturedAt).sort()[0]!, lastResponseAt: sources.map((source) => source.capturedAt).sort().at(-1)! },
    scope: { propertyNamespace: 120, redirects: "excluded" as const, traversal: "completed-allpages" as const,
      temporalConsistency: "capture-window-not-atomic" as const, claims: "selected-complete-entities-only" as const,
      classNeighborhood: "direct-captured-P31-P279-P361-edges-only" as const,
      localNormalization: "unassessed" as const, ontologyCoverage: "not-established" as const,
      constraints: "attributed-source-guidance-with-exceptions" as const },
    license: { id: "CC0-1.0", sourceUri: "https://www.wikidata.org/wiki/Wikidata:Licensing" },
    summary: { listingPages: listings.length, listedProperties: listed.length, describedProperties: properties.length,
      omittedProperties: omissions.length, observedDatatypes: Object.keys(datatypeCounts).length,
      corpusEntities: entities.length, corpusStatements: entities.reduce((n, item) => n + item.statementCount, 0),
      capturedConstraintStatements: entities.reduce((n, item) => n + item.constraintCount, 0),
      directClassEdges: classEdges.length, sourceBytes: sources.reduce((n, source) => n + source.bodyBytes, 0),
      datatypeCounts: orderedDatatypeCounts },
    sources: sources.map(({ body: _body, ...source }) => source), properties, omissions, entities, classEdges,
  };
}

export async function readWikidataInventorySourcesV1(directory: string): Promise<WikidataInventorySourceV1[]> {
  const path = resolve(directory, "sources.jsonl.gz");
  const compressed = await readBoundedRegularFile(path, WIKIDATA_INVENTORY_LIMITS_V1.archiveBytes);
  const expanded = gunzipSync(compressed, { maxOutputLength: WIKIDATA_INVENTORY_LIMITS_V1.expandedArchiveBytes });
  if (expanded.length > WIKIDATA_INVENTORY_LIMITS_V1.expandedArchiveBytes) throw new Error("expanded archive size out of bounds");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(expanded);
  if (!text.endsWith("\n")) throw new Error("source archive must end in a newline");
  const lines = text.slice(0, -1).split("\n");
  if (lines.length > WIKIDATA_INVENTORY_LIMITS_V1.sources) throw new Error("source archive count out of bounds");
  return lines.map((line) => parseSource(JSON.parse(line) as unknown));
}

export async function verifyWikidataInventoryV1(directory: string) {
  const path = resolve(directory, "inventory.json");
  const manifestBytes = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedRegularFile(path, WIKIDATA_INVENTORY_LIMITS_V1.manifestBytes));
  const manifest = object(JSON.parse(manifestBytes) as unknown, "inventory");
  const sources = await readWikidataInventorySourcesV1(directory);
  const derived = deriveWikidataInventoryV1(sources);
  if (JSON.stringify(manifest) !== JSON.stringify(derived)) throw new Error("inventory differs from its captured source bytes");
  return derived;
}

async function captureSource(kind: SourceKind, key: string, sourceUri: string): Promise<WikidataInventorySourceV1> {
  const response = await fetch(sourceUri, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(WIKIDATA_INVENTORY_LIMITS_V1.requestMilliseconds),
    headers: { Accept: "application/json", "User-Agent": "OhResearchInventory/0.1 (https://github.com/hraness/oh)" },
  });
  if (!response.ok || !response.body) throw new Error(`${key}: HTTP ${response.status}; acquisition stopped, no complete snapshot emitted`);
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > WIKIDATA_INVENTORY_LIMITS_V1.responseBytes) throw new Error(`${key}: response too large`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > WIKIDATA_INVENTORY_LIMITS_V1.responseBytes) throw new Error(`${key}: response too large`);
      chunks.push(item.value);
    }
  } finally { await reader.cancel(); }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  const result = { kind, key, sourceUri, capturedAt: new Date().toISOString(), body, bodyBytes: bytes, bodySha256: wikidataSourceSha256V1(body) };
  parsedBody(result);
  return parseSource(result);
}

async function capture(directory: string): Promise<void> {
  const started = Date.now();
  const sources: WikidataInventorySourceV1[] = [];
  let aggregateBytes = 0;
  async function acquire(kind: SourceKind, key: string, uri: string) {
    if (Date.now() - started > WIKIDATA_INVENTORY_LIMITS_V1.captureMilliseconds || sources.length >= WIKIDATA_INVENTORY_LIMITS_V1.sources) throw new Error("capture bound exceeded");
    const source = await captureSource(kind, key, uri);
    aggregateBytes += source.bodyBytes;
    if (aggregateBytes > WIKIDATA_INVENTORY_LIMITS_V1.expandedArchiveBytes / 2) throw new Error("aggregate capture byte bound exceeded");
    sources.push(source);
    return parsedBody(source);
  }
  let continuation: string | undefined;
  const ids: string[] = [];
  for (let index = 0; ; index++) {
    if (index >= WIKIDATA_INVENTORY_LIMITS_V1.listingPages) throw new Error("listing page bound exceeded");
    const result = await acquire("listing", `listing-${String(index).padStart(3, "0")}`, listingUrl(continuation));
    for (const item of array(object(result.query, "query").allpages, 500, "allpages")) {
      const id = string(object(item, "page").title, "title", 64).replace(/^Property:/u, "");
      if (!PROPERTY.test(id)) throw new Error("unexpected property title");
      ids.push(id);
    }
    if (ids.length > WIKIDATA_INVENTORY_LIMITS_V1.properties) throw new Error("property bound exceeded");
    if (result.continue === undefined) break;
    continuation = string(object(result.continue, "continue").apcontinue, "apcontinue", 64);
  }
  console.log(JSON.stringify({ stage: "listing-complete", properties: ids.length }));
  for (let start = 0; start < ids.length; start += 50) {
    const index = start / 50;
    await acquire("property-metadata", `properties-${String(index).padStart(3, "0")}`, metadataUrl(ids.slice(start, start + 50)));
    if (index % 25 === 0) console.log(JSON.stringify({ stage: "metadata", completed: Math.min(start + 50, ids.length), total: ids.length }));
  }
  for (const [id] of WIKIDATA_CORPUS_SELECTION_V1) {
    await acquire("entity", `entity-${id}`, entityUrl(id));
  }
  const inventory = deriveWikidataInventoryV1(sources);
  const jsonl = sources.map((source) => JSON.stringify(source)).join("\n") + "\n";
  if (Buffer.byteLength(jsonl) > WIKIDATA_INVENTORY_LIMITS_V1.expandedArchiveBytes) throw new Error("expanded archive bound exceeded");
  const archive = gzipSync(jsonl, { level: 9 });
  const manifest = JSON.stringify(inventory) + "\n";
  if (archive.length > WIKIDATA_INVENTORY_LIMITS_V1.archiveBytes || Buffer.byteLength(manifest) > WIKIDATA_INVENTORY_LIMITS_V1.manifestBytes) throw new Error("output bound exceeded");
  // Never replace a previously reviewed fixture. Refreshes select a new empty directory.
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "sources.jsonl.gz"), archive, { flag: "wx" });
  await writeFile(resolve(directory, "inventory.json"), manifest, { flag: "wx" });
  const verified = await verifyWikidataInventoryV1(directory);
  console.log(JSON.stringify({ stage: "verified", directory, ...verified.summary, archiveBytes: archive.length }));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
      console.log("Usage: bun scripts/capture-wikidata-inventory.ts --capture NEW_DIRECTORY | --verify DIRECTORY\nCapture uses bounded public Wikidata GET requests. Verify is deterministic and offline.");
    } else if (args.length === 2 && args[0] === "--capture") {
      await capture(resolve(args[1]!));
    } else if (args.length === 2 && args[0] === "--verify") {
      console.log(JSON.stringify((await verifyWikidataInventoryV1(resolve(args[1]!))).summary));
    } else throw new Error("invalid arguments; use --help");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "inventory failed");
    process.exitCode = 1;
  }
}
