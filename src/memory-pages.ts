import {
  boundedText,
  canonicalJson,
  isPlainRecord,
  orderedUnique,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  utf8ByteLength,
  type JsonValue,
  type Sha256Hex,
} from "./canonical";
import type { OhRecordCodec } from "./contract";
import {
  createKnowledgeGraphRecordV1,
  OH_GRAPH_LIMITS_V1,
  parseKnowledgeGraphRecordV1,
  type KnowledgeGraphRecordV1,
} from "./graph";

export const OH_MEMORY_PAGE_FORMAT_V1 = "oh.memory-page.v1" as const;
export const OH_MEMORY_PAGE_MARKDOWN_EXTENSION_V1 = ".oh.md" as const;

export const OH_MEMORY_PAGE_LIMITS_V1 = Object.freeze({
  bodyBytes: 512 * 1024,
  fileBytes: 1024 * 1024,
  frontmatterLines: 18 + OH_GRAPH_LIMITS_V1.dependenciesPerRecord + 5 * 128,
  languageBytes: 255,
  sourceTitleBytes: 1024,
  sourceUrlBytes: 4096,
  sources: 128,
  summaryBytes: 8192,
  titleBytes: 512,
  valueBytes: 768 * 1024,
});

export type OhMemoryPageSourceV1 = Readonly<{
  contentSha256: Sha256Hex;
  observedAt: string;
  title: string;
  url: string;
  v: 1;
}>;

/**
 * A pointer to a host-owned attestation receipt. Parsing confirms the receipt
 * identity, not the receipt's existence, signature, or authorization.
 */
export type OhMemoryPageProvenanceV1 = Readonly<{
  actorId: string;
  attestationSha256: Sha256Hex;
  attestedAt: string;
  kind: "host-attested";
  v: 1;
}>;

export type OhMemoryPageValueV1 = Readonly<{
  body: string;
  createdAt: string;
  format: typeof OH_MEMORY_PAGE_FORMAT_V1;
  language: string | null;
  provenance: OhMemoryPageProvenanceV1;
  sources: readonly OhMemoryPageSourceV1[];
  summary: string;
  title: string;
  updatedAt: string;
  v: 1;
}>;

export type OhMemoryPageRecordV1 = Omit<KnowledgeGraphRecordV1, "kind" | "value"> & Readonly<{
  kind: "edition";
  value: OhMemoryPageValueV1;
}>;

export type OhMemoryPageRecordInputV1 = Readonly<{
  dependencies: readonly string[];
  key: string;
  value: OhMemoryPageValueV1;
}>;

function singleLineText(value: unknown, maximumBytes: number): string | null {
  const parsed = boundedText(value, maximumBytes);
  return parsed !== null && !/[\r\n\u0085\u2028\u2029]/u.test(parsed) ? parsed : null;
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!isPlainRecord(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string")
      || keys.some((key) => !ownKeys.includes(key))) return null;
    const detached: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable
        || descriptor.get !== undefined || descriptor.set !== undefined) return null;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch {
    return null;
  }
}

function exactDataArray(value: unknown, maximumLength: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length)
      || length < 0 || length > maximumLength) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key !== "string")
      || !ownKeys.includes("length")) return null;
    const detached: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable
        || descriptor.get !== undefined || descriptor.set !== undefined) return null;
      detached.push(descriptor.value);
    }
    return detached;
  } catch {
    return null;
  }
}

function parseLanguage(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && utf8ByteLength(value) <= OH_MEMORY_PAGE_LIMITS_V1.languageBytes
      && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value)
    ? value
    : undefined;
}

function parseCanonicalSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.normalize("NFC") !== value
    || utf8ByteLength(value) > OH_MEMORY_PAGE_LIMITS_V1.sourceUrlBytes) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:")
      || url.username !== "" || url.password !== "" || url.href !== value) return null;
    for (let index = value.indexOf("%"); index >= 0; index = value.indexOf("%", index + 3)) {
      const encoded = value.slice(index + 1, index + 3);
      if (!/^[0-9A-F]{2}$/u.test(encoded)) return null;
      const decoded = String.fromCharCode(Number.parseInt(encoded, 16));
      if (/^[A-Za-z0-9._~-]$/u.test(decoded)) return null;
    }
    return value;
  } catch {
    return null;
  }
}

function parseSource(value: unknown): OhMemoryPageSourceV1 | null {
  const source = exactDataRecord(value, ["contentSha256", "observedAt", "title", "url", "v"]);
  if (source === null || source.v !== 1) return null;
  const contentSha256 = parseSha256Hex(source.contentSha256);
  const observedAt = parseCanonicalInstantV1(source.observedAt);
  const title = singleLineText(source.title, OH_MEMORY_PAGE_LIMITS_V1.sourceTitleBytes);
  const url = parseCanonicalSourceUrl(source.url);
  return contentSha256 !== null && observedAt !== null && title !== null && url !== null
    ? { contentSha256, observedAt, title, url, v: 1 }
    : null;
}

function parseProvenance(value: unknown): OhMemoryPageProvenanceV1 | null {
  const provenance = exactDataRecord(value,
    ["actorId", "attestationSha256", "attestedAt", "kind", "v"]);
  if (provenance === null || provenance.kind !== "host-attested" || provenance.v !== 1) return null;
  const actorId = safeCode(provenance.actorId);
  const attestationSha256 = parseSha256Hex(provenance.attestationSha256);
  const attestedAt = parseCanonicalInstantV1(provenance.attestedAt);
  return actorId !== null && attestationSha256 !== null && attestedAt !== null
    ? { actorId, attestationSha256, attestedAt, kind: "host-attested", v: 1 }
    : null;
}

/** Parses only the exact, bounded, model-neutral V1 page value. */
export function parseOhMemoryPageValueV1(value: unknown): OhMemoryPageValueV1 | null {
  const page = exactDataRecord(value,
    ["body", "createdAt", "format", "language", "provenance", "sources", "summary", "title",
      "updatedAt", "v"]);
  if (page === null || page.format !== OH_MEMORY_PAGE_FORMAT_V1 || page.v !== 1) return null;
  const sourceValues = exactDataArray(page.sources, OH_MEMORY_PAGE_LIMITS_V1.sources);
  if (sourceValues === null) return null;

  const body = boundedText(page.body, OH_MEMORY_PAGE_LIMITS_V1.bodyBytes);
  const createdAt = parseCanonicalInstantV1(page.createdAt);
  const language = parseLanguage(page.language);
  const provenance = parseProvenance(page.provenance);
  const sources = sourceValues.map(parseSource);
  const summary = boundedText(page.summary, OH_MEMORY_PAGE_LIMITS_V1.summaryBytes);
  const title = singleLineText(page.title, OH_MEMORY_PAGE_LIMITS_V1.titleBytes);
  const updatedAt = parseCanonicalInstantV1(page.updatedAt);
  if (body === null || createdAt === null || language === undefined || provenance === null
    || sources.some((source) => source === null) || summary === null || title === null || updatedAt === null) {
    return null;
  }
  const parsedSources = sources as OhMemoryPageSourceV1[];
  if (!orderedUnique(parsedSources, (source) => source.url)
    || Date.parse(createdAt) > Date.parse(updatedAt)
    || Date.parse(updatedAt) > Date.parse(provenance.attestedAt)
    || parsedSources.some((source) => Date.parse(source.observedAt) > Date.parse(updatedAt))) return null;

  const parsed: OhMemoryPageValueV1 = {
    body,
    createdAt,
    format: OH_MEMORY_PAGE_FORMAT_V1,
    language,
    provenance,
    sources: parsedSources,
    summary,
    title,
    updatedAt,
    v: 1,
  };
  return utf8ByteLength(canonicalJson(parsed)) <= OH_MEMORY_PAGE_LIMITS_V1.valueBytes ? parsed : null;
}

export function createOhMemoryPageValueV1(value: OhMemoryPageValueV1): OhMemoryPageValueV1 {
  const parsed = parseOhMemoryPageValueV1(value);
  if (parsed === null) throw new TypeError("Invalid Oh memory page value.");
  return parsed;
}

/** Creates an ordinary content-addressed Oh `edition` record. */
export function createOhMemoryPageRecordV1(input: OhMemoryPageRecordInputV1): OhMemoryPageRecordV1 {
  const parsedInput = exactDataRecord(input, ["dependencies", "key", "value"]);
  if (parsedInput === null) {
    throw new TypeError("Invalid Oh memory page record input.");
  }
  const value = createOhMemoryPageValueV1(parsedInput.value as OhMemoryPageValueV1);
  const record = createKnowledgeGraphRecordV1({
    dependencies: parsedInput.dependencies as readonly string[],
    key: parsedInput.key as string,
    kind: "edition",
    v: 1,
    value: value as unknown as JsonValue,
  });
  return { ...record, kind: "edition", value };
}

export function parseOhMemoryPageRecordV1(value: unknown): OhMemoryPageRecordV1 | null {
  const record = parseKnowledgeGraphRecordV1(value);
  if (record === null || record.kind !== "edition") return null;
  const page = parseOhMemoryPageValueV1(record.value);
  return page === null ? null : { ...record, kind: "edition", value: page };
}

/** Register this only where `edition` is reserved for the memory-page profile. */
export const OH_MEMORY_PAGE_RECORD_CODEC_V1: OhRecordCodec = Object.freeze({
  kind: "edition" as const,
  parse(value: unknown): JsonValue | null {
    return parseOhMemoryPageValueV1(value) as unknown as JsonValue | null;
  },
});

type FrontmatterScalar = null | number | string;
type FrontmatterEntry = readonly [key: string, value: FrontmatterScalar];

function scalar(value: FrontmatterScalar): string {
  return JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function dependencyPrefix(index: number): string {
  return `dependency-${index.toString().padStart(4, "0")}`;
}

function sourcePrefix(index: number): string {
  return `source-${index.toString().padStart(3, "0")}`;
}

function markdownEntries(record: OhMemoryPageRecordV1): readonly FrontmatterEntry[] {
  const page = record.value;
  const entries: FrontmatterEntry[] = [
    ["format", page.format],
    ["record-v", record.v],
    ["record-kind", record.kind],
    ["record-key", record.key],
    ["record-sha256", record.recordSha256],
    ["dependency-count", record.dependencies.length],
  ];
  record.dependencies.forEach((dependency, index) => {
    entries.push([`${dependencyPrefix(index)}-key`, dependency]);
  });
  entries.push(
    ["page-v", page.v],
    ["title", page.title],
    ["summary", page.summary],
    ["language", page.language],
    ["created-at", page.createdAt],
    ["updated-at", page.updatedAt],
    ["provenance-kind", page.provenance.kind],
    ["provenance-v", page.provenance.v],
    ["provenance-actor-id", page.provenance.actorId],
    ["provenance-attested-at", page.provenance.attestedAt],
    ["provenance-attestation-sha256", page.provenance.attestationSha256],
    ["source-count", page.sources.length],
  );
  page.sources.forEach((source, index) => {
    const prefix = sourcePrefix(index);
    entries.push(
      [`${prefix}-v`, source.v],
      [`${prefix}-url`, source.url],
      [`${prefix}-title`, source.title],
      [`${prefix}-observed-at`, source.observedAt],
      [`${prefix}-content-sha256`, source.contentSha256],
    );
  });
  return entries;
}

/**
 * Renders a self-contained record transport. Oh bundles remain the
 * authoritative multi-record and operation transport.
 */
export function renderOhMemoryPageMarkdownV1(value: OhMemoryPageRecordV1): string {
  const record = parseOhMemoryPageRecordV1(value);
  if (record === null) throw new TypeError("Invalid Oh memory page record.");
  const frontmatter = markdownEntries(record).map(([key, item]) => `${key}: ${scalar(item)}`).join("\n");
  const rendered = `---\n${frontmatter}\n---\n${record.value.body}`;
  if (utf8ByteLength(rendered) > OH_MEMORY_PAGE_LIMITS_V1.fileBytes) {
    throw new RangeError("Oh memory page Markdown exceeds its byte limit.");
  }
  return rendered;
}

function parseFrontmatterLine(line: string): FrontmatterEntry | null {
  const separator = line.indexOf(": ");
  if (separator < 1 || !/^[a-z][a-z0-9-]*$/u.test(line.slice(0, separator))) return null;
  const key = line.slice(0, separator);
  const encoded = line.slice(separator + 2);
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return null;
  }
  if ((value !== null && typeof value !== "string" && typeof value !== "number")
    || (typeof value === "number" && !Number.isFinite(value))
    || scalar(value as FrontmatterScalar) !== encoded) return null;
  return [key, value as FrontmatterScalar];
}

/**
 * Parses the exact `.oh.md` scalar subset and recomputes the graph record
 * digest. Comments, aliases, tags, duplicate keys, alternate key order,
 * alternate scalar spellings, and CRLF are rejected.
 */
export function parseOhMemoryPageMarkdownV1(text: unknown): OhMemoryPageRecordV1 | null {
  if (typeof text !== "string" || utf8ByteLength(text) > OH_MEMORY_PAGE_LIMITS_V1.fileBytes
    || !text.startsWith("---\n")) return null;
  const closing = text.indexOf("\n---\n", 4);
  if (closing < 0) return null;
  const frontmatter = text.slice(4, closing);
  let frontmatterLines = 1;
  for (let index = frontmatter.indexOf("\n"); index >= 0;
    index = frontmatter.indexOf("\n", index + 1)) {
    frontmatterLines += 1;
    if (frontmatterLines > OH_MEMORY_PAGE_LIMITS_V1.frontmatterLines) return null;
  }
  const lines = frontmatter.split("\n");
  const entries = lines.map(parseFrontmatterLine);
  if (entries.some((entry) => entry === null) || entries.length < 18) return null;
  const parsedEntries = entries as FrontmatterEntry[];
  const dependencyCount = parsedEntries[5]?.[1];
  if (!Number.isSafeInteger(dependencyCount) || (dependencyCount as number) < 0
    || (dependencyCount as number) > OH_GRAPH_LIMITS_V1.dependenciesPerRecord) return null;
  const pageOffset = 6 + (dependencyCount as number);
  const sourceCount = parsedEntries[pageOffset + 11]?.[1];
  if (!Number.isSafeInteger(sourceCount) || (sourceCount as number) < 0
    || (sourceCount as number) > OH_MEMORY_PAGE_LIMITS_V1.sources) return null;
  const expectedKeys = [
    "format", "record-v", "record-kind", "record-key", "record-sha256", "dependency-count",
    ...Array.from({ length: dependencyCount as number }, (_, index) => `${dependencyPrefix(index)}-key`),
    "page-v", "title", "summary", "language", "created-at", "updated-at", "provenance-kind",
    "provenance-v", "provenance-actor-id", "provenance-attested-at",
    "provenance-attestation-sha256", "source-count",
    ...Array.from({ length: sourceCount as number }, (_, index) => {
      const prefix = sourcePrefix(index);
      return [`${prefix}-v`, `${prefix}-url`, `${prefix}-title`,
        `${prefix}-observed-at`, `${prefix}-content-sha256`];
    }).flat(),
  ];
  if (parsedEntries.length !== expectedKeys.length
    || parsedEntries.some(([key], index) => key !== expectedKeys[index])) return null;

  const dependencies = Array.from({ length: dependencyCount as number },
    (_, index) => parsedEntries[6 + index]?.[1]);
  const sources: OhMemoryPageSourceV1[] = [];
  for (let index = 0; index < (sourceCount as number); index += 1) {
    const offset = pageOffset + 12 + index * 5;
    sources.push({
      v: parsedEntries[offset]?.[1] as 1,
      url: parsedEntries[offset + 1]?.[1] as string,
      title: parsedEntries[offset + 2]?.[1] as string,
      observedAt: parsedEntries[offset + 3]?.[1] as string,
      contentSha256: parsedEntries[offset + 4]?.[1] as Sha256Hex,
    });
  }
  const page = parseOhMemoryPageValueV1({
    body: text.slice(closing + 5),
    createdAt: parsedEntries[pageOffset + 4]?.[1],
    format: parsedEntries[0]?.[1],
    language: parsedEntries[pageOffset + 3]?.[1],
    provenance: {
      actorId: parsedEntries[pageOffset + 8]?.[1],
      attestationSha256: parsedEntries[pageOffset + 10]?.[1],
      attestedAt: parsedEntries[pageOffset + 9]?.[1],
      kind: parsedEntries[pageOffset + 6]?.[1],
      v: parsedEntries[pageOffset + 7]?.[1],
    },
    sources,
    summary: parsedEntries[pageOffset + 2]?.[1],
    title: parsedEntries[pageOffset + 1]?.[1],
    updatedAt: parsedEntries[pageOffset + 5]?.[1],
    v: parsedEntries[pageOffset]?.[1],
  });
  if (page === null || parsedEntries[1]?.[1] !== 1 || parsedEntries[2]?.[1] !== "edition"
    || typeof parsedEntries[3]?.[1] !== "string" || typeof parsedEntries[4]?.[1] !== "string"
    || dependencies.some((dependency) => typeof dependency !== "string")) return null;
  let record: OhMemoryPageRecordV1;
  try {
    record = createOhMemoryPageRecordV1({
      dependencies: dependencies as string[],
      key: parsedEntries[3][1] as string,
      value: page,
    });
  } catch {
    return null;
  }
  return record.recordSha256 === parsedEntries[4][1] && renderOhMemoryPageMarkdownV1(record) === text
    ? record
    : null;
}
