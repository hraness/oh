import { describe, expect, test } from "bun:test";
import { buildAskAiProviderLinks } from "@hraness/ui";
import { join } from "node:path";

const site = join(import.meta.dir, "..");

async function startBuiltSite() {
  const process_ = Bun.spawn([
    join(site, "node_modules/.bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: site,
    env: { ...process.env, NODE_ENV: "production" },
    stderr: "pipe",
    stdout: "pipe",
  });
  let output = "";
  let startupSettled = false;
  let rejectStartup: (error: Error) => void = () => {};
  let resolveStartup: (origin: string) => void = () => {};
  const startup = new Promise<string>((resolve, reject) => {
    rejectStartup = reject;
    resolveStartup = resolve;
  });
  const settleFromOutput = (): void => {
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/u);
    if (match === null || !output.includes("Ready in") || startupSettled) return;
    startupSettled = true;
    resolveStartup(`http://127.0.0.1:${match[1]}`);
  };
  const capture = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        settleFromOutput();
      }
      output += decoder.decode();
      settleFromOutput();
    } catch (error) {
      if (!startupSettled) {
        startupSettled = true;
        rejectStartup(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      reader.releaseLock();
    }
  };
  const captureTasks = [capture(process_.stdout), capture(process_.stderr)];
  const exitTask = process_.exited.then((exitCode) => {
    if (startupSettled) return;
    startupSettled = true;
    rejectStartup(new Error(`Next exited with code ${exitCode} before startup.\n${output}`));
  });
  const timeout = setTimeout(() => {
    if (startupSettled) return;
    startupSettled = true;
    rejectStartup(new Error(`Next did not start within 10 seconds.\n${output}`));
  }, 10_000);

  try {
    const origin = await startup;
    clearTimeout(timeout);
    return { captureTasks, exitTask, origin, process_ };
  } catch (error) {
    clearTimeout(timeout);
    if (process_.exitCode === null) process_.kill("SIGTERM");
    await process_.exited;
    await Promise.allSettled(captureTasks);
    throw error;
  }
}

async function stopBuiltSite(server: Awaited<ReturnType<typeof startBuiltSite>>): Promise<void> {
  if (server.process_.exitCode === null) server.process_.kill("SIGTERM");
  const stoppedGracefully = await Promise.race([
    server.process_.exited.then(() => true),
    Bun.sleep(2_000).then(() => false),
  ]);
  if (!stoppedGracefully && server.process_.exitCode === null) {
    server.process_.kill("SIGKILL");
    await server.process_.exited;
  }
  await server.exitTask;
  await Promise.allSettled(server.captureTasks);
}

function metadataContent(html: string, attributeName: "name" | "property", key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return html.match(new RegExp(
    `<meta ${attributeName}="${escaped}" content="([^"]+)"`,
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
  test("serves canonical pages, redirects, and metadata through Next", async () => {
    const server = await startBuiltSite();
    try {
      const [homeResponse, specificationResponse, slashAliasResponse, versionAliasResponse,
        traceResponse, llmsResponse, missingResponse] = await Promise.all([
        fetch(`${server.origin}/`, { redirect: "manual" }),
        fetch(`${server.origin}/spec`, { redirect: "manual" }),
        fetch(`${server.origin}/spec/`, { redirect: "manual" }),
        fetch(`${server.origin}/spec/v1`, { redirect: "manual" }),
        fetch(`${server.origin}/examples/evidence-table-2.json`, { redirect: "manual" }),
        fetch(`${server.origin}/llms.txt`, { redirect: "manual" }),
        fetch(`${server.origin}/missing`, { redirect: "manual" }),
      ]);
      const [home, specification, slashAlias, versionAlias, trace, llms, missing] = await Promise.all([
        homeResponse.text(),
        specificationResponse.text(),
        slashAliasResponse.text(),
        versionAliasResponse.text(),
        traceResponse.text(),
        llmsResponse.text(),
        missingResponse.text(),
      ]);

      expect(homeResponse.status).toBe(200);
      expect(home).toContain("Current release v0.12.0");
      expect(home).toContain("@hraness/oh@0.12.0");
      expect(home).not.toContain("@hraness/oh@0.4.3");
      expect(home).toContain("source CLI 0.4.0");
      expect(home).toContain("https://github.com/hraness/oh/actions/runs/35900362605");
      expect(specificationResponse.status).toBe(200);
      expect(slashAliasResponse.status).toBe(308);
      expect(slashAliasResponse.headers.get("location")).toBe("/spec");
      expect(versionAliasResponse.status).toBe(308);
      expect(versionAliasResponse.headers.get("location")).toBe("/spec");
      expect(traceResponse.status).toBe(200);
      expect(traceResponse.headers.get("content-type")).toContain("application/json");
      expect(JSON.parse(trace)).toMatchObject({
        key: "evidence:table-2",
        kind: "evidence",
        v: 1,
      });
      expect(llmsResponse.status).toBe(200);
      expect(llmsResponse.headers.get("content-type")).toContain("text/plain");
      expect(llms).toStartWith("# Oh\n");
      expect(llms).toContain("](https://oh.computer)");
      expect(llms).toContain("](https://oh.computer/spec)");
      expect(llms).not.toContain("/spec/v1");
      expect(homeResponse.headers.get("link")).toBe('</llms.txt>; rel="describedby"');
      expect(specificationResponse.headers.get("link")).toBe('</llms.txt>; rel="describedby"');
      expect(missingResponse.status).toBe(404);
      expect(homeResponse.headers.get("x-frame-options")).toBeNull();
      expect(homeResponse.headers.get("content-security-policy") ?? "")
        .not.toContain("frame-ancestors 'none'");

      expectAskAiMarkup(home, "https://oh.computer");
      expectAskAiMarkup(specification, "https://oh.computer/spec");
      expect(slashAlias).not.toContain('aria-label="Ask AI about this"');
      expect(versionAlias).not.toContain('aria-label="Ask AI about this"');
      expect(missing).not.toContain('aria-label="Ask AI about this"');
      expect(home).toContain('rel="icon" href="/favicon.svg" type="image/svg+xml"');
      expect(home).not.toContain('href="/spec/"');
      expect(specification).toContain(
        '<link rel="canonical" href="https://oh.computer/spec"',
      );
      expect(metadataContent(specification, "property", "og:title")).toBe(
        "Oh ontology specification v1",
      );
      expect(metadataContent(specification, "property", "og:image")).toMatch(
        /^https:\/\/oh\.computer\/spec\/opengraph-image(?:\?[0-9a-f]+)?$/u,
      );
      expect(metadataContent(specification, "name", "twitter:image")).toBe(
        "https://oh.computer/spec/opengraph-image",
      );
      expect(metadataContent(specification, "name", "twitter:title")).toBe(
        "Oh ontology specification v1",
      );
      const specificationDescription = metadataContent(specification, "name", "description");
      expect(specificationDescription).not.toBe(metadataContent(home, "name", "description"));
      expect(specificationDescription?.length).toBeGreaterThanOrEqual(110);
      expect(specificationDescription?.length).toBeLessThanOrEqual(160);
      for (const key of ["og:description", "twitter:description"]) {
        const attributeName = key.startsWith("og:") ? "property" : "name";
        expect(metadataContent(specification, attributeName, key)).toBe(specificationDescription);
      }
      const specificationImage = await fetch(`${server.origin}/spec/opengraph-image`);
      expect(specificationImage.status).toBe(200);
      expect(specificationImage.headers.get("content-type")).toContain("image/png");
    } finally {
      await stopBuiltSite(server);
    }
  }, 20_000);

  test("serves the blog, its feed, and a sitemap of indexable pages only", async () => {
    const server = await startBuiltSite();
    try {
      const [indexResponse, introducingResponse, quarantinedResponse, feedResponse, sitemapResponse,
        imageResponse, missingResponse] = await Promise.all([
        fetch(`${server.origin}/blog`, { redirect: "manual" }),
        fetch(`${server.origin}/blog/introducing-oh`, { redirect: "manual" }),
        fetch(`${server.origin}/blog/built-on-oh`, { redirect: "manual" }),
        fetch(`${server.origin}/blog/feed.xml`, { redirect: "manual" }),
        fetch(`${server.origin}/sitemap.xml`, { redirect: "manual" }),
        fetch(`${server.origin}/blog/introducing-oh/opengraph-image`, { redirect: "manual" }),
        fetch(`${server.origin}/blog/not-a-post`, { redirect: "manual" }),
      ]);
      const [index, introducing, quarantined, feed, sitemap] = await Promise.all([
        indexResponse.text(),
        introducingResponse.text(),
        quarantinedResponse.text(),
        feedResponse.text(),
        sitemapResponse.text(),
      ]);

      expect(indexResponse.status).toBe(200);
      expect(index).toContain('<link rel="canonical" href="https://oh.computer/blog"');
      expect(index).toContain('type="application/atom+xml"');
      expect(index).toContain('href="/blog/introducing-oh"');
      expect(index).not.toContain("/blog/built-on-oh");

      expect(introducingResponse.status).toBe(200);
      expect(introducing).toContain('<link rel="canonical" href="https://oh.computer/blog/introducing-oh"');
      expect(introducing).toContain('<meta name="robots" content="index, follow');
      expect(metadataContent(introducing, "property", "og:type")).toBe("article");
      expect(metadataContent(introducing, "property", "og:title")).toBe("Introducing Oh");
      expect(introducing).toContain('"@type":"BlogPosting"');
      expect(introducing).toContain("reviewed by Claude Opus 5.5 (claude-opus-5-5) editorial review.");

      expect(quarantinedResponse.status).toBe(200);
      expect(quarantined).toContain('<meta name="robots" content="noindex, nofollow');
      expect(quarantined).toContain("reviewed by Claude Opus 5.5 (claude-opus-5-5) editorial review.");

      expect(feedResponse.status).toBe(200);
      expect(feedResponse.headers.get("content-type")).toContain("application/atom+xml");
      expect(feed).toContain("<id>https://oh.computer/blog/introducing-oh</id>");
      expect(feed).not.toContain("built-on-oh");

      expect(sitemapResponse.status).toBe(200);
      expect(sitemap).toContain("<loc>https://oh.computer/</loc>");
      expect(sitemap).toContain("<loc>https://oh.computer/spec</loc>");
      expect(sitemap).toContain("<loc>https://oh.computer/blog/introducing-oh</loc>");
      expect(sitemap).toContain("<lastmod>2026-09-24T00:00:00.000Z</lastmod>");
      expect(sitemap).not.toContain("built-on-oh");

      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toContain("image/png");
      expect(missingResponse.status).toBe(404);
    } finally {
      await stopBuiltSite(server);
    }
  }, 20_000);
});
