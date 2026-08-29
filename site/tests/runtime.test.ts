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
        missingResponse] = await Promise.all([
        fetch(`${server.origin}/`, { redirect: "manual" }),
        fetch(`${server.origin}/spec`, { redirect: "manual" }),
        fetch(`${server.origin}/spec/`, { redirect: "manual" }),
        fetch(`${server.origin}/spec/v1`, { redirect: "manual" }),
        fetch(`${server.origin}/missing`, { redirect: "manual" }),
      ]);
      const [home, specification, slashAlias, versionAlias, missing] = await Promise.all([
        homeResponse.text(),
        specificationResponse.text(),
        slashAliasResponse.text(),
        versionAliasResponse.text(),
        missingResponse.text(),
      ]);

      expect(homeResponse.status).toBe(200);
      expect(specificationResponse.status).toBe(200);
      expect(slashAliasResponse.status).toBe(308);
      expect(slashAliasResponse.headers.get("location")).toBe("/spec");
      expect(versionAliasResponse.status).toBe(308);
      expect(versionAliasResponse.headers.get("location")).toBe("/spec");
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
      expect(metadataContent(specification, "property", "og:image")).toBe(
        "https://oh.computer/og.png",
      );
      expect(metadataContent(specification, "name", "twitter:title")).toBe(
        "Oh ontology specification v1",
      );
      expect(metadataContent(specification, "name", "twitter:description")).toBe(
        "The current, local-first ontology and storage contract behind Oh.",
      );
    } finally {
      await stopBuiltSite(server);
    }
  }, 20_000);
});
