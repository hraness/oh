import {
  boundedText,
  canonicalSha256,
  parseSha256Hex,
  sha256Hex,
  utf8ByteLength,
  type Sha256Hex,
} from "./canonical";
import { normalizeOhEmbeddingV1 } from "./semantic";

const cloudflareEmbeddingProfilePayload = Object.freeze({
  dimensions: 768,
  distance: "cosine",
  documentFormat: "title: {title} | text: {content}",
  inputUtf8Bytes: 448,
  model: "@cf/google/embeddinggemma-300m",
  normalization: "l2",
  profileId: "oh.cloudflare.embeddinggemma.v1",
  provider: "cloudflare.workers-ai",
  queryFormat: "task: search result | query: {query}",
  v: 1 as const,
});

/** A hosted embedding space. It is intentionally distinct from the local QMD profile. */
export const OH_CLOUDFLARE_EMBEDDING_PROFILE_V1 = Object.freeze({
  ...cloudflareEmbeddingProfilePayload,
  profileSha256: canonicalSha256(cloudflareEmbeddingProfilePayload),
});

const semanticRendererPayload = Object.freeze({
  documentFormat: cloudflareEmbeddingProfilePayload.documentFormat,
  inputUtf8Bytes: cloudflareEmbeddingProfilePayload.inputUtf8Bytes,
  rendererId: "oh.embedding-input.utf8-chunks.v1",
  split: "unicode-scalar-greedy",
  v: 1 as const,
});

export const OH_SEMANTIC_RENDERER_V1 = Object.freeze({
  ...semanticRendererPayload,
  rendererSha256: canonicalSha256(semanticRendererPayload),
});

export const OH_CLOUDFLARE_EMBEDDING_LIMITS_V1 = Object.freeze({
  batchInputs: 32,
  deadlineMs: 30_000,
  documentBytes: 8 * 1024 * 1024,
  inputUtf8Bytes: 448,
  responseBytes: 8 * 1024 * 1024,
  renderedChunks: 256,
  titleBytes: 16 * 1024,
});

export type OhRenderedEmbeddingInputV1 = Readonly<{
  input: string;
  inputSha256: Sha256Hex;
  kind: "document" | "query";
  utf8Bytes: number;
  v: 1;
}>;

export type OhRenderedDocumentChunkV1 = Readonly<{
  content: string;
  input: OhRenderedEmbeddingInputV1;
  ordinal: number;
  title: string;
  v: 1;
}>;

export type OhRenderedDocumentV1 = Readonly<{
  chunks: readonly OhRenderedDocumentChunkV1[];
  diagnostic: null | Readonly<{
    code: "oversize-prefix" | "partial";
    maximumChunks: number;
    omittedUtf8Bytes: number;
    v: 1;
  }>;
  sourceUtf8Bytes: number;
  status: "complete" | "oversize" | "partial";
  v: 1;
}>;

export class OhCloudflareEmbeddingError extends Error {
  readonly code: "aborted" | "invalid-input" | "invalid-response" | "provider-unavailable";
  readonly status: number | null;

  constructor(
    code: OhCloudflareEmbeddingError["code"],
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "OhCloudflareEmbeddingError";
    this.code = code;
    this.status = status;
  }
}

const renderedEmbeddingInputs = new WeakSet<object>();

function formattedInput(kind: "document" | "query", input: string): OhRenderedEmbeddingInputV1 {
  const utf8Bytes = utf8ByteLength(input);
  if (utf8Bytes > OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes) {
    throw new OhCloudflareEmbeddingError(
      "invalid-input",
      `A formatted embedding input exceeds ${OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes} UTF-8 bytes.`,
    );
  }
  const rendered: OhRenderedEmbeddingInputV1 = {
    input,
    inputSha256: sha256Hex(input),
    kind,
    utf8Bytes,
    v: 1,
  };
  renderedEmbeddingInputs.add(rendered);
  return Object.freeze(rendered);
}

export function renderOhCloudflareEmbeddingQueryV1(query: string): OhRenderedEmbeddingInputV1 {
  const parsed = boundedText(query, OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes);
  if (parsed === null) {
    throw new OhCloudflareEmbeddingError("invalid-input", "An embedding query must be bounded NFC text.");
  }
  return formattedInput("query", `task: search result | query: ${parsed}`);
}

function prefixForTitle(title: string): string {
  return `title: ${title} | text: `;
}

/**
 * Renders every source scalar in order. A caller-selected chunk limit is made
 * visible as `partial`; a title that leaves no content capacity is `oversize`.
 */
export function renderOhCloudflareEmbeddingDocumentV1(input: Readonly<{
  content: string;
  maximumChunks?: number;
  title: string;
}>): OhRenderedDocumentV1 {
  const title = boundedText(input.title, OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.titleBytes);
  const content = input.content === "" ? "" : boundedText(
    input.content,
    OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.documentBytes,
  );
  const maximumChunks = input.maximumChunks ?? OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.renderedChunks;
  if (title === null || content === null || !Number.isSafeInteger(maximumChunks)
    || maximumChunks < 1 || maximumChunks > OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.renderedChunks) {
    throw new OhCloudflareEmbeddingError(
      "invalid-input",
      "A semantic document needs bounded NFC title/content and a valid chunk limit.",
    );
  }
  const sourceUtf8Bytes = utf8ByteLength(content);
  const prefix = prefixForTitle(title);
  const capacity = OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes - utf8ByteLength(prefix);
  if (capacity < 1) {
    return Object.freeze({
      chunks: Object.freeze([]),
      diagnostic: Object.freeze({ code: "oversize-prefix", maximumChunks,
        omittedUtf8Bytes: sourceUtf8Bytes, v: 1 }),
      sourceUtf8Bytes,
      status: "oversize",
      v: 1,
    });
  }

  const chunks: OhRenderedDocumentChunkV1[] = [];
  let cursor = 0;
  let emittedBytes = 0;
  chunks: while ((cursor < content.length || (content.length === 0 && chunks.length === 0))
    && chunks.length < maximumChunks) {
    const start = cursor;
    let bytes = 0;
    while (cursor < content.length) {
      const codePoint = content.codePointAt(cursor);
      if (codePoint === undefined) break;
      const scalar = String.fromCodePoint(codePoint);
      const scalarBytes = utf8ByteLength(scalar);
      if (bytes + scalarBytes > capacity) break;
      bytes += scalarBytes;
      cursor += scalar.length;
    }
    if (cursor === start && content.length > 0) {
      break chunks;
    }
    const chunkContent = content.slice(start, cursor);
    const rendered = formattedInput("document", `${prefix}${chunkContent}`);
    chunks.push(Object.freeze({ content: chunkContent, input: rendered,
      ordinal: chunks.length, title, v: 1 }));
    emittedBytes += bytes;
  }
  const omittedUtf8Bytes = sourceUtf8Bytes - emittedBytes;
  const partial = cursor < content.length;
  const oversize = partial && chunks.length === 0;
  return Object.freeze({
    chunks: Object.freeze(chunks),
    diagnostic: partial ? Object.freeze({ code: oversize ? "oversize-prefix" : "partial", maximumChunks,
      omittedUtf8Bytes, v: 1 as const }) : null,
    sourceUtf8Bytes,
    status: oversize ? "oversize" : partial ? "partial" : "complete",
    v: 1,
  });
}

export type OhEmbeddingFetchV1 = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OhCloudflareEmbeddingClientOptionsV1 = Readonly<{
  accountId: string;
  apiToken: string;
  deadlineMs?: number;
  fetch?: OhEmbeddingFetchV1;
  maximumBatchInputs?: number;
  maximumResponseBytes?: number;
}>;

function exactPositiveInteger(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumBytes) {
      throw new OhCloudflareEmbeddingError("invalid-response", "The embedding response exceeds its byte limit.");
    }
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new OhCloudflareEmbeddingError("invalid-response", "The embedding response exceeds its byte limit.");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseCloudflareVectors(value: unknown, count: number): readonly (readonly number[])[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an invalid envelope.");
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.success !== true || typeof envelope.result !== "object"
    || envelope.result === null || Array.isArray(envelope.result)) {
    throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an unsuccessful envelope.");
  }
  const result = envelope.result as Record<string, unknown>;
  if (!Array.isArray(result.data) || result.data.length !== count
    || !Array.isArray(result.shape) || result.shape.length !== 2
    || result.shape[0] !== count
    || result.shape[1] !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions) {
    throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an incompatible shape.");
  }
  const vectors = result.data.map((candidate) => {
    if (!Array.isArray(candidate)
      || candidate.length !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions
      || candidate.some((component) => typeof component !== "number" || !Number.isFinite(component))) {
      throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an invalid vector.");
    }
    try { return Object.freeze([...normalizeOhEmbeddingV1(candidate as number[])]); }
    catch { throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an invalid vector."); }
  });
  return Object.freeze(vectors);
}

/** Fixed Workers AI adapter; credentials are never included in surfaced errors. */
export class OhCloudflareEmbeddingClientV1 {
  readonly profile = OH_CLOUDFLARE_EMBEDDING_PROFILE_V1;
  readonly #accountId: string;
  readonly #apiToken: string;
  readonly #deadlineMs: number;
  readonly #fetch: OhEmbeddingFetchV1;
  readonly #maximumBatchInputs: number;
  readonly #maximumResponseBytes: number;

  constructor(options: OhCloudflareEmbeddingClientOptionsV1) {
    if (!/^[a-f0-9]{32}$/iu.test(options.accountId)
      || options.apiToken.length < 16 || options.apiToken.length > 4096
      || /[\r\n]/u.test(options.apiToken)) {
      throw new OhCloudflareEmbeddingError("invalid-input", "Cloudflare credentials are malformed.");
    }
    this.#accountId = options.accountId.toLowerCase();
    this.#apiToken = options.apiToken;
    this.#deadlineMs = exactPositiveInteger(
      options.deadlineMs ?? 15_000,
      OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.deadlineMs,
      "deadlineMs",
    );
    this.#maximumBatchInputs = exactPositiveInteger(
      options.maximumBatchInputs ?? 16,
      OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.batchInputs,
      "maximumBatchInputs",
    );
    this.#maximumResponseBytes = exactPositiveInteger(
      options.maximumResponseBytes ?? OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.responseBytes,
      OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.responseBytes,
      "maximumResponseBytes",
    );
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async embed(
    inputs: readonly OhRenderedEmbeddingInputV1[],
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<readonly (readonly number[])[]> {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > this.#maximumBatchInputs) {
      throw new OhCloudflareEmbeddingError(
        "invalid-input",
        `An embedding batch must contain 1 through ${this.#maximumBatchInputs} inputs.`,
      );
    }
    const text = inputs.map((candidate) => {
      if (!renderedEmbeddingInputs.has(candidate as object)
        || candidate.v !== 1 || (candidate.kind !== "document" && candidate.kind !== "query")
        || candidate.utf8Bytes !== utf8ByteLength(candidate.input)
        || candidate.utf8Bytes > OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes
        || parseSha256Hex(candidate.inputSha256) === null
        || candidate.inputSha256 !== sha256Hex(candidate.input)) {
        throw new OhCloudflareEmbeddingError("invalid-input", "A rendered embedding input is invalid.");
      }
      return candidate.input;
    });
    const deadline = AbortSignal.timeout(this.#deadlineMs);
    const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
    let response: Response;
    try {
      response = await this.#fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.#accountId}/ai/run/${OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.model}`,
        {
          body: JSON.stringify({ text }),
          headers: {
            authorization: `Bearer ${this.#apiToken}`,
            "content-type": "application/json",
          },
          method: "POST",
          redirect: "error",
          signal,
        },
      );
    } catch {
      if (signal.aborted) {
        throw new OhCloudflareEmbeddingError("aborted", "The embedding request was aborted.");
      }
      throw new OhCloudflareEmbeddingError("provider-unavailable", "The embedding provider is unavailable.");
    }
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* The sanitized status is sufficient. */ }
      throw new OhCloudflareEmbeddingError(
        "provider-unavailable",
        `The embedding provider rejected the request with HTTP ${response.status}.`,
        response.status,
      );
    }
    let value: unknown;
    try { value = JSON.parse(await boundedResponseText(response, this.#maximumResponseBytes)); }
    catch (error) {
      if (error instanceof OhCloudflareEmbeddingError) throw error;
      if (signal.aborted) {
        throw new OhCloudflareEmbeddingError("aborted", "The embedding request was aborted.");
      }
      throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned invalid JSON.");
    }
    return parseCloudflareVectors(value, inputs.length);
  }
}
