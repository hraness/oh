import { describe, expect, test } from "bun:test";
import { buildAskAiProviderLinks } from "@hraness/ui";

type BuiltWorker = Readonly<{
  fetch(
    request: Request,
    environment: Record<string, never>,
    context: Readonly<{ passThroughOnException(): void; waitUntil(promise: Promise<unknown>): void }>,
  ): Promise<Response>;
}>;

const serverUrl = new URL("../dist/server/index.js", import.meta.url).href;

async function fetchBuilt(path: string): Promise<Response> {
  const builtModule = await import(serverUrl) as Readonly<{ default: BuiltWorker }>;
  return await builtModule.default.fetch(
    new Request(`https://oh.computer${path}`),
    {},
    {
      passThroughOnException() {},
      waitUntil() {},
    },
  );
}

function metadataContent(html: string, attribute: "name" | "property", key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return html.match(new RegExp(
    `<meta ${attribute}="${escaped}" content="([^"]+)"`,
    "u",
  ))?.[1] ?? null;
}

function attribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return tag.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, "u"))?.[1] ?? null;
}

function askAiLinkTags(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*data-slot="ask-ai-about-this-link"[^>]*>/gu)]
    .map(([tag]) => tag);
}

function decodeHtmlAttribute(value: string): string {
  return value.replaceAll("&amp;", "&");
}

function expectAskAiMarkup(html: string, canonicalUrl: string): void {
  expect(html.match(/aria-label="Ask AI about this"/gu)).toHaveLength(1);
  const tags = askAiLinkTags(html);
  expect(tags).toHaveLength(4);
  expect(tags.map((tag) => decodeHtmlAttribute(attribute(tag, "href") ?? ""))).toEqual(
    buildAskAiProviderLinks(canonicalUrl).map(({ href }) => href),
  );
  expect(tags.map((tag) => attribute(tag, "target"))).toEqual(
    Array.from({ length: 4 }, () => "_blank"),
  );
  expect(tags.map((tag) => attribute(tag, "rel"))).toEqual(
    Array.from({ length: 4 }, () => "noopener noreferrer nofollow"),
  );
}

describe("built Oh site", () => {
  test("server-renders exact Ask AI links only on canonical public pages", async () => {
    const [homeResponse, specificationResponse, redirectResponse, missingResponse] =
      await Promise.all([
        fetchBuilt("/"),
        fetchBuilt("/spec"),
        fetchBuilt("/spec/v1"),
        fetchBuilt("/missing"),
      ]);
    const [home, specification, redirect, missing] = await Promise.all([
      homeResponse.text(),
      specificationResponse.text(),
      redirectResponse.text(),
      missingResponse.text(),
    ]);

    expect(homeResponse.status).toBe(200);
    expect(specificationResponse.status).toBe(200);
    expect(redirectResponse.status).toBe(308);
    expect(missingResponse.status).toBe(404);
    expectAskAiMarkup(home, "https://oh.computer");
    expectAskAiMarkup(specification, "https://oh.computer/spec");
    expect(redirect).not.toContain('aria-label="Ask AI about this"');
    expect(missing).not.toContain('aria-label="Ask AI about this"');
  });

  test("serves the canonical specification URL and permanently redirects aliases", async () => {
    const [canonical, slashAlias, versionAlias] = await Promise.all([
      fetchBuilt("/spec"),
      fetchBuilt("/spec/"),
      fetchBuilt("/spec/v1"),
    ]);

    expect(canonical.status).toBe(200);
    expect(slashAlias.status).toBe(308);
    expect(slashAlias.headers.get("location")).toBe("/spec");
    expect(versionAlias.status).toBe(308);
    expect(versionAlias.headers.get("location")).toBe("/spec");
  });

  test("renders canonical, social, icon, and internal-link metadata without inheritance drift", async () => {
    const [homeResponse, specificationResponse] = await Promise.all([
      fetchBuilt("/"),
      fetchBuilt("/spec"),
    ]);
    const [home, specification] = await Promise.all([
      homeResponse.text(),
      specificationResponse.text(),
    ]);

    expect(home).toContain('rel="icon" href="/favicon.svg" type="image/svg+xml"');
    expect(home).not.toContain('href="/spec/"');
    expect(specification).toContain(
      '<link rel="canonical" href="https://oh.computer/spec"',
    );
    expect(metadataContent(specification, "property", "og:title")).toBe(
      "Oh ontology specification v1",
    );
    expect(metadataContent(specification, "property", "og:image")).toBe(
      "https://oh.computer/og.png",
    );
    expect(metadataContent(specification, "name", "twitter:title")).toBe(
      "Oh ontology specification v1",
    );
    expect(metadataContent(specification, "name", "twitter:description")).toBe(
      "The current, local-first ontology and storage contract behind Oh.",
    );
  });
});
