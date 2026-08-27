import { describe, expect, test } from "bun:test";

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

describe("built Oh site", () => {
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
