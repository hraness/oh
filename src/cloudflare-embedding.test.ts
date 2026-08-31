import { describe, expect, test } from "bun:test";

import { canonicalSha256, sha256Hex, utf8ByteLength } from "./canonical";
import {
  OH_CLOUDFLARE_EMBEDDING_LIMITS_V1,
  OH_CLOUDFLARE_EMBEDDING_PROFILE_V1,
  OH_SEMANTIC_RENDERER_V1,
  OhCloudflareEmbeddingClientV1,
  OhCloudflareEmbeddingError,
  renderOhCloudflareEmbeddingDocumentV1,
  renderOhCloudflareEmbeddingQueryV1,
  type OhEmbeddingFetchV1,
  type OhRenderedEmbeddingInputV1,
} from "./cloudflare-embedding";

const accountId = "0123456789abcdef0123456789abcdef";
const apiToken = "cloudflare-test-token-never-a-real-secret";

function unitVector(index = 0): number[] {
  return Array.from(
    { length: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions },
    (_, ordinal) => ordinal === index ? 1 : 0,
  );
}

function success(vectors: readonly (readonly number[])[]): Response {
  return Response.json({
    result: {
      data: vectors,
      shape: [vectors.length, OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions],
    },
    success: true,
  });
}

describe("Cloudflare EmbeddingGemma profile", () => {
  test("pins a provider-specific, rebuildable embedding and renderer identity", () => {
    expect(OH_CLOUDFLARE_EMBEDDING_PROFILE_V1).toMatchObject({
      dimensions: 768,
      distance: "cosine",
      inputUtf8Bytes: 448,
      model: "@cf/google/embeddinggemma-300m",
      normalization: "l2",
      profileId: "oh.cloudflare.embeddinggemma.v1",
      provider: "cloudflare.workers-ai",
      v: 1,
    });
    const { profileSha256, ...profile } = OH_CLOUDFLARE_EMBEDDING_PROFILE_V1;
    const { rendererSha256, ...renderer } = OH_SEMANTIC_RENDERER_V1;
    expect(profileSha256).toBe(canonicalSha256(profile));
    expect(rendererSha256).toBe(canonicalSha256(renderer));
    expect(profileSha256).not.toBe(rendererSha256);
  });

  test("renders bounded query and complete Unicode-scalar document inputs", () => {
    const query = renderOhCloudflareEmbeddingQueryV1("where did the session stop?");
    expect(query).toEqual({
      input: "task: search result | query: where did the session stop?",
      inputSha256: sha256Hex(query.input),
      kind: "query",
      utf8Bytes: utf8ByteLength(query.input),
      v: 1,
    });

    const source = `${"a".repeat(420)}🧠${"b".repeat(420)}`;
    const rendered = renderOhCloudflareEmbeddingDocumentV1({
      content: source,
      title: "session",
    });
    expect(rendered.status).toBe("complete");
    expect(rendered.diagnostic).toBeNull();
    expect(rendered.chunks.length).toBeGreaterThan(1);
    expect(rendered.chunks.map(({ content }) => content).join("")).toBe(source);
    for (const [ordinal, chunk] of rendered.chunks.entries()) {
      expect(chunk.ordinal).toBe(ordinal);
      expect(chunk.input.kind).toBe("document");
      expect(chunk.input.utf8Bytes).toBeLessThanOrEqual(448);
      expect(chunk.input.inputSha256).toBe(sha256Hex(chunk.input.input));
      expect(/[\ud800-\udbff]$/u.test(chunk.content)).toBeFalse();
      expect(/^[\udc00-\udfff]/u.test(chunk.content)).toBeFalse();
    }
  });

  test("makes truncation and an overlarge prefix explicit", () => {
    const partial = renderOhCloudflareEmbeddingDocumentV1({
      content: "x".repeat(2_000),
      maximumChunks: 1,
      title: "bounded",
    });
    expect(partial.status).toBe("partial");
    expect(partial.diagnostic).toMatchObject({
      code: "partial",
      maximumChunks: 1,
    });
    expect(partial.diagnostic?.omittedUtf8Bytes).toBeGreaterThan(0);

    const oversize = renderOhCloudflareEmbeddingDocumentV1({
      content: "content",
      title: "t".repeat(448),
    });
    expect(oversize).toMatchObject({
      chunks: [],
      diagnostic: { code: "oversize-prefix" },
      status: "oversize",
    });

    const fixedPrefixBytes = utf8ByteLength("title:  | text: ");
    for (const residualBytes of [1, 2, 3]) {
      const scalarOversize = renderOhCloudflareEmbeddingDocumentV1({
        content: "🧠",
        title: "t".repeat(448 - fixedPrefixBytes - residualBytes),
      });
      expect(scalarOversize).toMatchObject({
        chunks: [],
        diagnostic: { code: "oversize-prefix", omittedUtf8Bytes: 4 },
        status: "oversize",
      });
    }

    const scalarPartial = renderOhCloudflareEmbeddingDocumentV1({
      content: "a🧠",
      title: "t".repeat(448 - fixedPrefixBytes - 1),
    });
    expect(scalarPartial).toMatchObject({
      chunks: [{ content: "a", ordinal: 0 }],
      diagnostic: { code: "partial", omittedUtf8Bytes: 4 },
      status: "partial",
    });
  });

  test("rejects noncanonical text and formatted inputs over the byte boundary", () => {
    expect(() => renderOhCloudflareEmbeddingQueryV1("e\u0301"))
      .toThrow(OhCloudflareEmbeddingError);
    expect(() => renderOhCloudflareEmbeddingQueryV1("q".repeat(448)))
      .toThrow("formatted embedding input exceeds");
    expect(() => renderOhCloudflareEmbeddingDocumentV1({
      content: "text",
      maximumChunks: OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.renderedChunks + 1,
      title: "title",
    })).toThrow(OhCloudflareEmbeddingError);
  });
});

describe("Cloudflare Workers AI embedding client", () => {
  test("sends one fixed no-redirect request and returns normalized vectors", async () => {
    const requests: Array<Readonly<{ body: unknown; headers: Headers; url: string }>> = [];
    const fetch: OhEmbeddingFetchV1 = async (input, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)) as unknown,
        headers: new Headers(init?.headers),
        url: String(input),
      });
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return success([unitVector(3), unitVector(4).map((value) => value * 7)]);
    };
    const client = new OhCloudflareEmbeddingClientV1({ accountId, apiToken, fetch });
    const inputs = [
      renderOhCloudflareEmbeddingQueryV1("alpha"),
      renderOhCloudflareEmbeddingQueryV1("beta"),
    ] as const;
    const vectors = await client.embed(inputs);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.[3]).toBe(1);
    expect(vectors[1]?.[4]).toBe(1);
    expect(requests).toEqual([{
      body: { text: inputs.map(({ input }) => input) },
      headers: new Headers({
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      }),
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/google/embeddinggemma-300m`,
    }]);
  });

  test("rejects forged rendered inputs before network access", async () => {
    let calls = 0;
    const client = new OhCloudflareEmbeddingClientV1({
      accountId,
      apiToken,
      fetch: async () => { calls += 1; return success([unitVector()]); },
    });
    const input = renderOhCloudflareEmbeddingQueryV1("safe");
    await expect(client.embed([{ ...input, inputSha256: "0".repeat(64) as typeof input.inputSha256 }]))
      .rejects.toMatchObject({ code: "invalid-input" });
    const forge = (text: string): OhRenderedEmbeddingInputV1 => Object.freeze({
      input: text,
      inputSha256: sha256Hex(text),
      kind: "query",
      utf8Bytes: utf8ByteLength(text),
      v: 1,
    });
    for (const forged of [
      Object.freeze({ ...input }),
      forge("task: search result | query: e\u0301"),
      forge("task: search result | query: \ud800"),
      forge("not a rendered query"),
    ]) {
      await expect(client.embed([forged])).rejects.toMatchObject({ code: "invalid-input" });
    }
    expect(calls).toBe(0);
  });

  test("normalizes extreme finite provider vectors without collapsing them to zero", async () => {
    const extreme = unitVector();
    extreme[0] = Number.MAX_VALUE;
    const client = new OhCloudflareEmbeddingClientV1({
      accountId,
      apiToken,
      fetch: async () => success([extreme]),
    });
    const [vector] = await client.embed([renderOhCloudflareEmbeddingQueryV1("query")]);
    expect(vector?.[0]).toBe(1);
    expect(vector?.reduce((sum, component) => sum + component * component, 0)).toBeCloseTo(1, 12);
  });

  test("bounds and validates every successful provider response", async () => {
    const input = renderOhCloudflareEmbeddingQueryV1("query");
    for (const response of [
      Response.json({ success: false }),
      Response.json({ result: { data: [unitVector()], shape: [1, 1] }, success: true }),
      Response.json({ result: { data: [[...unitVector().slice(1)]], shape: [1, 768] }, success: true }),
      Response.json({ result: { data: [[Number.NaN, ...unitVector().slice(1)]], shape: [1, 768] }, success: true }),
      new Response("x".repeat(1_024), { status: 200 }),
    ]) {
      const client = new OhCloudflareEmbeddingClientV1({
        accountId,
        apiToken,
        fetch: async () => response,
        maximumResponseBytes: 512,
      });
      await expect(client.embed([input])).rejects.toMatchObject({ code: "invalid-response" });
    }
  });

  test("surfaces only a bounded status classification on provider failures", async () => {
    const client = new OhCloudflareEmbeddingClientV1({
      accountId,
      apiToken,
      fetch: async () => new Response(`never echo ${apiToken}`, { status: 429 }),
    });
    const error = await client.embed([renderOhCloudflareEmbeddingQueryV1("query")])
      .then(() => null, (caught: unknown) => caught);
    expect(error).toMatchObject({ code: "provider-unavailable", status: 429 });
    expect(String(error)).not.toContain(apiToken);
    expect(String(error)).not.toContain(accountId);
  });

  test("classifies transport cancellation without retaining its cause", async () => {
    const fetch: OhEmbeddingFetchV1 = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error(`private ${apiToken}`)), { once: true });
    });
    const client = new OhCloudflareEmbeddingClientV1({
      accountId,
      apiToken,
      deadlineMs: 1,
      fetch,
    });
    const error = await client.embed([renderOhCloudflareEmbeddingQueryV1("query")])
      .then(() => null, (caught: unknown) => caught);
    expect(error).toMatchObject({ code: "aborted", status: null });
    expect(String(error)).not.toContain(apiToken);
  });

  test("classifies cancellation while reading a response body as aborted", async () => {
    const external = new AbortController();
    const fetch: OhEmbeddingFetchV1 = async (_input, init) => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(new Error(`private ${apiToken}`)),
            { once: true },
          );
          setTimeout(() => external.abort(), 0);
        },
      }),
      { status: 200 },
    );
    const client = new OhCloudflareEmbeddingClientV1({
      accountId,
      apiToken,
      deadlineMs: 1_000,
      fetch,
    });
    const error = await client.embed(
      [renderOhCloudflareEmbeddingQueryV1("query")],
      { signal: external.signal },
    ).then(() => null, (caught: unknown) => caught);
    expect(error).toMatchObject({ code: "aborted", status: null });
    expect(String(error)).not.toContain(apiToken);
  });

  test("validates credential and request-budget configuration without network access", () => {
    expect(() => new OhCloudflareEmbeddingClientV1({ accountId: "wrong", apiToken }))
      .toThrow("credentials are malformed");
    expect(() => new OhCloudflareEmbeddingClientV1({ accountId, apiToken: "short" }))
      .toThrow("credentials are malformed");
    expect(() => new OhCloudflareEmbeddingClientV1({
      accountId,
      apiToken,
      maximumBatchInputs: 33,
    })).toThrow(RangeError);
  });
});
