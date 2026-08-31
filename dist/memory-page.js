// src/canonical.ts
import { createHash, randomBytes } from "node:crypto";

class OhValidationError extends Error {
  code;
  path;
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = "OhValidationError";
    this.code = code;
    this.path = path;
  }
}
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function assertUnicodeScalarString(value, path) {
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) {
        throw new OhValidationError("invalid-unicode", path, "contains an unpaired surrogate");
      }
      index += 1;
    } else if (code >= 56320 && code <= 57343) {
      throw new OhValidationError("invalid-unicode", path, "contains an unpaired surrogate");
    }
  }
}
function encodeCanonical(value, path, ancestors) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new OhValidationError("non-json-number", path, "must be finite");
    }
    if (Object.is(value, -0)) {
      throw new OhValidationError("noncanonical-number", path, "negative zero is not canonical");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === null) {
    throw new OhValidationError("non-json-value", path, `cannot encode ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new OhValidationError("cycle", path, "contains a cycle");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const encoded = [];
      for (let index = 0;index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new OhValidationError("sparse-array", `${path}[${index}]`, "must not contain holes");
        }
        encoded.push(encodeCanonical(value[index], `${path}[${index}]`, ancestors));
      }
      const extraKeys = Reflect.ownKeys(value).filter((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length));
      if (extraKeys.length > 0) {
        throw new OhValidationError("non-json-property", path, "array has non-index properties");
      }
      return `[${encoded.join(",")}]`;
    }
    if (!isPlainRecord(value)) {
      throw new OhValidationError("non-plain-object", path, "must be a plain object");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new OhValidationError("non-json-property", path, "object has a symbol property");
    }
    const keys = ownKeys;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new OhValidationError("non-json-property", `${path}.${key}`, "must be an enumerable data property");
      }
    }
    keys.sort();
    const entries = keys.map((key) => {
      assertUnicodeScalarString(key, `${path}.<key>`);
      return `${JSON.stringify(key)}:${encodeCanonical(value[key], `${path}.${key}`, ancestors)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
function canonicalJson(value) {
  return encodeCanonical(value, "$", new Set);
}
function parseCanonicalJson(text, maximumBytes = 16 * 1024 * 1024) {
  if (utf8ByteLength(text) > maximumBytes) {
    throw new OhValidationError("limit-exceeded", "$", "canonical JSON exceeds its byte limit");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OhValidationError("invalid-json", "$", "is not valid JSON");
  }
  if (canonicalJson(value) !== text) {
    throw new OhValidationError("noncanonical-json", "$", "keys or values are not canonical");
  }
  return value;
}
function utf8ByteLength(value) {
  return Buffer.byteLength(value, "utf8");
}
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function canonicalSha256(value) {
  return sha256Hex(canonicalJson(value));
}
function parseSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}
function parseCanonicalInstantV1(value) {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : null;
}
function canonicalNow() {
  return new Date().toISOString();
}
function safeCode(value, maximumLength = 128) {
  return typeof value === "string" && value.length <= maximumLength && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function boundedText(value, maximumBytes = 64 * 1024) {
  if (typeof value !== "string" || value.length === 0 || value.normalize("NFC") !== value || utf8ByteLength(value) > maximumBytes)
    return null;
  try {
    assertUnicodeScalarString(value, "$text");
  } catch {
    return null;
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code >= 11 && code <= 12 || code >= 14 && code <= 31 || code >= 127 && code <= 159)
      return null;
  }
  return value;
}
function orderedUnique(values, key) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}
function sortUnique(values, key) {
  const sorted = [...values].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (!orderedUnique(sorted, key)) {
    throw new OhValidationError("duplicate", "$", "contains duplicate canonical values");
  }
  return sorted;
}

// src/graph.ts
var OH_GRAPH_FORMAT_VERSION_V1 = 1;
var OH_GRAPH_LIMITS_V1 = Object.freeze({
  changesPerOperation: 8192,
  dependenciesPerRecord: 4096,
  recordBytes: 1024 * 1024,
  recordsPerSnapshot: 65536
});
var OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 = [
  "activity",
  "assertion",
  "context",
  "dependency-manifest",
  "edition",
  "entity",
  "evidence",
  "identity-operation",
  "inquiry",
  "inquiry-event",
  "review-decision",
  "rights-decision",
  "schema",
  "shape",
  "statement",
  "type-membership",
  "view",
  "vocabulary"
];
var KNOWLEDGE_GRAPH_RECORD_KEYS_V1 = [
  "dependencies",
  "key",
  "kind",
  "recordSha256",
  "v",
  "value"
];
function exactKnowledgeGraphRecordEnvelopeV1(value) {
  try {
    if (!isPlainRecord(value))
      return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== KNOWLEDGE_GRAPH_RECORD_KEYS_V1.length || ownKeys.some((key) => typeof key !== "string") || KNOWLEDGE_GRAPH_RECORD_KEYS_V1.some((key) => !ownKeys.includes(key)))
      return null;
    const detached = {};
    for (const key of KNOWLEDGE_GRAPH_RECORD_KEYS_V1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch {
    return null;
  }
}
function recordKey(value) {
  return typeof value === "string" && value.length <= 512 && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function createKnowledgeGraphRecordV1(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["dependencies", "key", "kind", "v", "value"]) || input.v !== 1 || !Array.isArray(input.dependencies))
    throw new TypeError("Invalid graph record input.");
  const key = recordKey(input.key);
  const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === input.kind);
  if (key === null || kind === undefined || input.dependencies.length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord)
    throw new TypeError("Invalid graph record identity.");
  const dependencies = input.dependencies.map(recordKey);
  if (dependencies.some((dependency) => dependency === null) || !orderedUnique(dependencies, String) || dependencies.includes(key)) {
    throw new TypeError("Graph dependencies must be ordered, unique, and non-reflexive.");
  }
  const valueJson = canonicalJson(input.value);
  if (Buffer.byteLength(valueJson, "utf8") > OH_GRAPH_LIMITS_V1.recordBytes) {
    throw new RangeError("Graph record value exceeds its canonical byte limit.");
  }
  const payload = { dependencies, key, kind, v: 1, value: input.value };
  return { ...payload, recordSha256: canonicalSha256(payload) };
}
function parseKnowledgeGraphRecordV1(value) {
  const envelope = exactKnowledgeGraphRecordEnvelopeV1(value);
  if (envelope === null)
    return null;
  const recordSha256 = parseSha256Hex(envelope.recordSha256);
  const input = {
    dependencies: envelope.dependencies,
    key: envelope.key,
    kind: envelope.kind,
    v: envelope.v,
    value: envelope.value
  };
  try {
    const created = createKnowledgeGraphRecordV1(input);
    return recordSha256 !== null && created.recordSha256 === recordSha256 ? { ...created, recordSha256 } : null;
  } catch {
    return null;
  }
}
function knowledgeGraphRecordRefV1(record) {
  return {
    dependencies: record.dependencies,
    key: record.key,
    kind: record.kind,
    sha256: record.recordSha256,
    v: 1
  };
}
function changeKey(change) {
  return change.kind === "put" ? change.record.key : change.key;
}
function canonicalKnowledgeGraphChangesV1(changes) {
  const normalized = [];
  for (const change of changes) {
    if (!isPlainRecord(change) || change.v !== 1)
      throw new TypeError("Invalid graph change.");
    if (change.kind === "put") {
      const record = parseKnowledgeGraphRecordV1(change.record);
      if (record === null)
        throw new TypeError("Invalid graph record in change.");
      normalized.push({ kind: "put", record, v: 1 });
    } else if (change.kind === "tombstone") {
      const key = recordKey(change.key);
      const priorSha256 = parseSha256Hex(change.priorSha256);
      if (key === null || priorSha256 === null)
        throw new TypeError("Invalid graph tombstone.");
      normalized.push({ key, kind: "tombstone", priorSha256, v: 1 });
    } else
      throw new TypeError("Unknown graph change kind.");
  }
  return sortUnique(normalized, changeKey);
}
function graphRevisionSha256V1(input) {
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  const operationId = safeCode(input.operationId);
  const parentGraphRevisionSha256 = input.parentGraphRevisionSha256 === null ? null : parseSha256Hex(input.parentGraphRevisionSha256);
  const recordsSha256 = parseSha256Hex(input.recordsSha256);
  const revision = Number.isSafeInteger(input.revision) && input.revision > 0 ? input.revision : null;
  if (changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation || operationId === null || recordsSha256 === null || revision === null || input.parentGraphRevisionSha256 !== null && parentGraphRevisionSha256 === null || revision === 1 !== (parentGraphRevisionSha256 === null)) {
    throw new TypeError("Invalid graph revision digest input.");
  }
  return canonicalSha256({ changes, operationId, parentGraphRevisionSha256, recordsSha256, revision, v: 1 });
}

// src/memory-pages.ts
var OH_MEMORY_PAGE_FORMAT_V1 = "oh.memory-page.v1";
var OH_MEMORY_PAGE_MARKDOWN_EXTENSION_V1 = ".oh.md";
var OH_MEMORY_PAGE_LIMITS_V1 = Object.freeze({
  bodyBytes: 512 * 1024,
  fileBytes: 1024 * 1024,
  frontmatterLines: 18 + OH_GRAPH_LIMITS_V1.dependenciesPerRecord + 5 * 128,
  languageBytes: 255,
  sourceTitleBytes: 1024,
  sourceUrlBytes: 4096,
  sources: 128,
  summaryBytes: 8192,
  titleBytes: 512,
  valueBytes: 768 * 1024
});
function singleLineText(value, maximumBytes) {
  const parsed = boundedText(value, maximumBytes);
  return parsed !== null && !/[\r\n\u0085\u2028\u2029]/u.test(parsed) ? parsed : null;
}
function exactDataRecord(value, keys) {
  try {
    if (!isPlainRecord(value))
      return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string") || keys.some((key) => !ownKeys.includes(key)))
      return null;
    const detached = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch {
    return null;
  }
}
function exactDataArray(value, maximumLength) {
  try {
    if (!Array.isArray(value))
      return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maximumLength)
      return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key !== "string") || !ownKeys.includes("length"))
      return null;
    const detached = [];
    for (let index = 0;index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      detached.push(descriptor.value);
    }
    return detached;
  } catch {
    return null;
  }
}
function parseLanguage(value) {
  if (value === null)
    return null;
  return typeof value === "string" && utf8ByteLength(value) <= OH_MEMORY_PAGE_LIMITS_V1.languageBytes && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value) ? value : undefined;
}
function parseCanonicalSourceUrl(value) {
  if (typeof value !== "string" || value.normalize("NFC") !== value || utf8ByteLength(value) > OH_MEMORY_PAGE_LIMITS_V1.sourceUrlBytes)
    return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username !== "" || url.password !== "" || url.href !== value)
      return null;
    for (let index = value.indexOf("%");index >= 0; index = value.indexOf("%", index + 3)) {
      const encoded = value.slice(index + 1, index + 3);
      if (!/^[0-9A-F]{2}$/u.test(encoded))
        return null;
      const decoded = String.fromCharCode(Number.parseInt(encoded, 16));
      if (/^[A-Za-z0-9._~-]$/u.test(decoded))
        return null;
    }
    return value;
  } catch {
    return null;
  }
}
function parseSource(value) {
  const source = exactDataRecord(value, ["contentSha256", "observedAt", "title", "url", "v"]);
  if (source === null || source.v !== 1)
    return null;
  const contentSha256 = parseSha256Hex(source.contentSha256);
  const observedAt = parseCanonicalInstantV1(source.observedAt);
  const title = singleLineText(source.title, OH_MEMORY_PAGE_LIMITS_V1.sourceTitleBytes);
  const url = parseCanonicalSourceUrl(source.url);
  return contentSha256 !== null && observedAt !== null && title !== null && url !== null ? { contentSha256, observedAt, title, url, v: 1 } : null;
}
function parseProvenance(value) {
  const provenance = exactDataRecord(value, ["actorId", "attestationSha256", "attestedAt", "kind", "v"]);
  if (provenance === null || provenance.kind !== "host-attested" || provenance.v !== 1)
    return null;
  const actorId = safeCode(provenance.actorId);
  const attestationSha256 = parseSha256Hex(provenance.attestationSha256);
  const attestedAt = parseCanonicalInstantV1(provenance.attestedAt);
  return actorId !== null && attestationSha256 !== null && attestedAt !== null ? { actorId, attestationSha256, attestedAt, kind: "host-attested", v: 1 } : null;
}
function parseOhMemoryPageValueV1(value) {
  const page = exactDataRecord(value, [
    "body",
    "createdAt",
    "format",
    "language",
    "provenance",
    "sources",
    "summary",
    "title",
    "updatedAt",
    "v"
  ]);
  if (page === null || page.format !== OH_MEMORY_PAGE_FORMAT_V1 || page.v !== 1)
    return null;
  const sourceValues = exactDataArray(page.sources, OH_MEMORY_PAGE_LIMITS_V1.sources);
  if (sourceValues === null)
    return null;
  const body = boundedText(page.body, OH_MEMORY_PAGE_LIMITS_V1.bodyBytes);
  const createdAt = parseCanonicalInstantV1(page.createdAt);
  const language = parseLanguage(page.language);
  const provenance = parseProvenance(page.provenance);
  const sources = sourceValues.map(parseSource);
  const summary = boundedText(page.summary, OH_MEMORY_PAGE_LIMITS_V1.summaryBytes);
  const title = singleLineText(page.title, OH_MEMORY_PAGE_LIMITS_V1.titleBytes);
  const updatedAt = parseCanonicalInstantV1(page.updatedAt);
  if (body === null || createdAt === null || language === undefined || provenance === null || sources.some((source) => source === null) || summary === null || title === null || updatedAt === null) {
    return null;
  }
  const parsedSources = sources;
  if (!orderedUnique(parsedSources, (source) => source.url) || Date.parse(createdAt) > Date.parse(updatedAt) || Date.parse(updatedAt) > Date.parse(provenance.attestedAt) || parsedSources.some((source) => Date.parse(source.observedAt) > Date.parse(updatedAt)))
    return null;
  const parsed = {
    body,
    createdAt,
    format: OH_MEMORY_PAGE_FORMAT_V1,
    language,
    provenance,
    sources: parsedSources,
    summary,
    title,
    updatedAt,
    v: 1
  };
  return utf8ByteLength(canonicalJson(parsed)) <= OH_MEMORY_PAGE_LIMITS_V1.valueBytes ? parsed : null;
}
function createOhMemoryPageValueV1(value) {
  const parsed = parseOhMemoryPageValueV1(value);
  if (parsed === null)
    throw new TypeError("Invalid Oh memory page value.");
  return parsed;
}
function createOhMemoryPageRecordV1(input) {
  const parsedInput = exactDataRecord(input, ["dependencies", "key", "value"]);
  if (parsedInput === null) {
    throw new TypeError("Invalid Oh memory page record input.");
  }
  const value = createOhMemoryPageValueV1(parsedInput.value);
  const record = createKnowledgeGraphRecordV1({
    dependencies: parsedInput.dependencies,
    key: parsedInput.key,
    kind: "edition",
    v: 1,
    value
  });
  return { ...record, kind: "edition", value };
}
function parseOhMemoryPageRecordV1(value) {
  const envelope = exactDataRecord(value, [
    "dependencies",
    "key",
    "kind",
    "recordSha256",
    "v",
    "value"
  ]);
  if (envelope === null)
    return null;
  const record = parseKnowledgeGraphRecordV1(envelope);
  if (record === null || record.kind !== "edition")
    return null;
  const page = parseOhMemoryPageValueV1(record.value);
  return page === null ? null : { ...record, kind: "edition", value: page };
}
var OH_MEMORY_PAGE_RECORD_CODEC_V1 = Object.freeze({
  kind: "edition",
  parse(value) {
    return parseOhMemoryPageValueV1(value);
  }
});
function scalar(value) {
  return JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}
function dependencyPrefix(index) {
  return `dependency-${index.toString().padStart(4, "0")}`;
}
function sourcePrefix(index) {
  return `source-${index.toString().padStart(3, "0")}`;
}
function markdownEntries(record) {
  const page = record.value;
  const entries = [
    ["format", page.format],
    ["record-v", record.v],
    ["record-kind", record.kind],
    ["record-key", record.key],
    ["record-sha256", record.recordSha256],
    ["dependency-count", record.dependencies.length]
  ];
  record.dependencies.forEach((dependency, index) => {
    entries.push([`${dependencyPrefix(index)}-key`, dependency]);
  });
  entries.push(["page-v", page.v], ["title", page.title], ["summary", page.summary], ["language", page.language], ["created-at", page.createdAt], ["updated-at", page.updatedAt], ["provenance-kind", page.provenance.kind], ["provenance-v", page.provenance.v], ["provenance-actor-id", page.provenance.actorId], ["provenance-attested-at", page.provenance.attestedAt], ["provenance-attestation-sha256", page.provenance.attestationSha256], ["source-count", page.sources.length]);
  page.sources.forEach((source, index) => {
    const prefix = sourcePrefix(index);
    entries.push([`${prefix}-v`, source.v], [`${prefix}-url`, source.url], [`${prefix}-title`, source.title], [`${prefix}-observed-at`, source.observedAt], [`${prefix}-content-sha256`, source.contentSha256]);
  });
  return entries;
}
function renderOhMemoryPageMarkdownV1(value) {
  const record = parseOhMemoryPageRecordV1(value);
  if (record === null)
    throw new TypeError("Invalid Oh memory page record.");
  const frontmatter = markdownEntries(record).map(([key, item]) => `${key}: ${scalar(item)}`).join(`
`);
  const rendered = `---
${frontmatter}
---
${record.value.body}`;
  if (utf8ByteLength(rendered) > OH_MEMORY_PAGE_LIMITS_V1.fileBytes) {
    throw new RangeError("Oh memory page Markdown exceeds its byte limit.");
  }
  return rendered;
}
function parseFrontmatterLine(line) {
  const separator = line.indexOf(": ");
  if (separator < 1 || !/^[a-z][a-z0-9-]*$/u.test(line.slice(0, separator)))
    return null;
  const key = line.slice(0, separator);
  const encoded = line.slice(separator + 2);
  let value;
  try {
    value = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (value !== null && typeof value !== "string" && typeof value !== "number" || typeof value === "number" && !Number.isFinite(value) || scalar(value) !== encoded)
    return null;
  return [key, value];
}
function parseOhMemoryPageMarkdownV1(text) {
  if (typeof text !== "string" || utf8ByteLength(text) > OH_MEMORY_PAGE_LIMITS_V1.fileBytes || !text.startsWith(`---
`))
    return null;
  const closing = text.indexOf(`
---
`, 4);
  if (closing < 0)
    return null;
  const frontmatter = text.slice(4, closing);
  let frontmatterLines = 1;
  for (let index = frontmatter.indexOf(`
`);index >= 0; index = frontmatter.indexOf(`
`, index + 1)) {
    frontmatterLines += 1;
    if (frontmatterLines > OH_MEMORY_PAGE_LIMITS_V1.frontmatterLines)
      return null;
  }
  const lines = frontmatter.split(`
`);
  const entries = lines.map(parseFrontmatterLine);
  if (entries.some((entry) => entry === null) || entries.length < 18)
    return null;
  const parsedEntries = entries;
  const dependencyCount = parsedEntries[5]?.[1];
  if (!Number.isSafeInteger(dependencyCount) || dependencyCount < 0 || dependencyCount > OH_GRAPH_LIMITS_V1.dependenciesPerRecord)
    return null;
  const pageOffset = 6 + dependencyCount;
  const sourceCount = parsedEntries[pageOffset + 11]?.[1];
  if (!Number.isSafeInteger(sourceCount) || sourceCount < 0 || sourceCount > OH_MEMORY_PAGE_LIMITS_V1.sources)
    return null;
  const expectedKeys = [
    "format",
    "record-v",
    "record-kind",
    "record-key",
    "record-sha256",
    "dependency-count",
    ...Array.from({ length: dependencyCount }, (_, index) => `${dependencyPrefix(index)}-key`),
    "page-v",
    "title",
    "summary",
    "language",
    "created-at",
    "updated-at",
    "provenance-kind",
    "provenance-v",
    "provenance-actor-id",
    "provenance-attested-at",
    "provenance-attestation-sha256",
    "source-count",
    ...Array.from({ length: sourceCount }, (_, index) => {
      const prefix = sourcePrefix(index);
      return [
        `${prefix}-v`,
        `${prefix}-url`,
        `${prefix}-title`,
        `${prefix}-observed-at`,
        `${prefix}-content-sha256`
      ];
    }).flat()
  ];
  if (parsedEntries.length !== expectedKeys.length || parsedEntries.some(([key], index) => key !== expectedKeys[index]))
    return null;
  const dependencies = Array.from({ length: dependencyCount }, (_, index) => parsedEntries[6 + index]?.[1]);
  const sources = [];
  for (let index = 0;index < sourceCount; index += 1) {
    const offset = pageOffset + 12 + index * 5;
    sources.push({
      v: parsedEntries[offset]?.[1],
      url: parsedEntries[offset + 1]?.[1],
      title: parsedEntries[offset + 2]?.[1],
      observedAt: parsedEntries[offset + 3]?.[1],
      contentSha256: parsedEntries[offset + 4]?.[1]
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
      v: parsedEntries[pageOffset + 7]?.[1]
    },
    sources,
    summary: parsedEntries[pageOffset + 2]?.[1],
    title: parsedEntries[pageOffset + 1]?.[1],
    updatedAt: parsedEntries[pageOffset + 5]?.[1],
    v: parsedEntries[pageOffset]?.[1]
  });
  if (page === null || parsedEntries[1]?.[1] !== 1 || parsedEntries[2]?.[1] !== "edition" || typeof parsedEntries[3]?.[1] !== "string" || typeof parsedEntries[4]?.[1] !== "string" || dependencies.some((dependency) => typeof dependency !== "string"))
    return null;
  let record;
  try {
    record = createOhMemoryPageRecordV1({
      dependencies,
      key: parsedEntries[3][1],
      value: page
    });
  } catch {
    return null;
  }
  return record.recordSha256 === parsedEntries[4][1] && renderOhMemoryPageMarkdownV1(record) === text ? record : null;
}
export {
  renderOhMemoryPageMarkdownV1,
  parseOhMemoryPageValueV1,
  parseOhMemoryPageRecordV1,
  parseOhMemoryPageMarkdownV1,
  createOhMemoryPageValueV1,
  createOhMemoryPageRecordV1,
  OH_MEMORY_PAGE_RECORD_CODEC_V1,
  OH_MEMORY_PAGE_MARKDOWN_EXTENSION_V1,
  OH_MEMORY_PAGE_LIMITS_V1,
  OH_MEMORY_PAGE_FORMAT_V1
};
