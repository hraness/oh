import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import RootLayout from "../app/layout";
import CompareIndex, { metadata as indexMetadata } from "../app/compare/page";
import CompareMem0, { metadata as mem0Metadata } from "../app/compare/mem0/page";
import CompareSupermemory, { metadata as supermemoryMetadata } from "../app/compare/supermemory/page";
import sitemap from "../app/sitemap";
import { compareMem0Title, compareSupermemoryTitle, compareTitle } from "../app/metadata-copy";
import pilotResult from "../../benchmarks/results/memory-framework-pilot-v1.json";
import memEval from "../../benchmarks/results/memory-evolution-memeval-102-v1.json";

const site = join(import.meta.dir, "..");
const origin = "https://oh.computer";

const pages = [
  ["index", <CompareIndex key="index" />, indexMetadata, "/compare"],
  ["mem0", <CompareMem0 key="mem0" />, mem0Metadata, "/compare/mem0"],
  ["supermemory", <CompareSupermemory key="supermemory" />, supermemoryMetadata, "/compare/supermemory"],
] as const;

const fixed = (value: number) => value.toFixed(2);
const pilotRate = (arm: string) =>
  `${fixed((pilotResult.quality.arms.find((row) => row.arm === arm)?.conservativeSuccessRate.value ?? Number.NaN) * 100)}%`;
const signed = (value: number) => `${value < 0 ? "−" : "+"}${fixed(Math.abs(value))}`;

describe("Oh comparison pages", () => {
  test("every comparison page renders one heading, the skip link, and both footers", () => {
    for (const [name, page] of pages) {
      const html = renderToStaticMarkup(<RootLayout>{page}</RootLayout>);
      expect(html.match(/<h1\b/gu), name).toHaveLength(1);
      expect(html).toContain('href="#compare-main"');
      expect(html).toContain('id="compare-main"');
      expect(html).toContain('tabindex="-1"');
      expect(html.match(/<footer\b/gu)).toHaveLength(2);
      expect(html).toContain('data-hraness-marketing="footer"');
      expect(html).toContain('id="hraness-site-footer"');
      expect(html).toContain('aria-label="Ask AI about this"');
      expect(html).toContain('aria-label="Comparison navigation"');
      expect(html).toContain('href="/compare"');
      expect(html).not.toContain("—");
    }
  });

  test("each comparison page keeps a canonical URL and a sized description", () => {
    for (const [name, , metadata, path] of pages) {
      expect(metadata.alternates?.canonical, name).toBe(path);
      expect(metadata.openGraph && "url" in metadata.openGraph ? metadata.openGraph.url : undefined, name).toBe(path);
      const description = metadata.description ?? "";
      expect(description.length, name).toBeGreaterThanOrEqual(110);
      expect(description.length, name).toBeLessThanOrEqual(160);
      const images = (metadata.openGraph?.images ?? []) as { alt?: string; url?: string }[];
      expect(images[0]?.url, name).toBe(`${path}/opengraph-image`);
      expect(images[0]?.alt?.length ?? 0, name).toBeLessThanOrEqual(125);
    }
    expect(indexMetadata.title).toBe(compareTitle);
    expect(mem0Metadata.title).toBe(compareMem0Title);
    expect(supermemoryMetadata.title).toBe(compareSupermemoryTitle);
    for (const title of [compareTitle, compareMem0Title, compareSupermemoryTitle]) {
      expect(title.length, title).toBeLessThanOrEqual(60);
      expect(title).toMatch(/memory/);
    }
  });

  test("the index table sets six memory tools side by side with dated sources", () => {
    const html = renderToStaticMarkup(<RootLayout><CompareIndex /></RootLayout>);
    const columns: string[] = [];
    const rows: string[] = [];
    let cell = "";
    new HTMLRewriter()
      .on('#at-a-glance th[scope="col"]', { text(chunk) { cell += chunk.text; if (chunk.lastInTextNode) { columns.push(cell); cell = ""; } } })
      .transform(html);
    new HTMLRewriter()
      .on('#at-a-glance th[scope="row"]', { text(chunk) { cell += chunk.text; if (chunk.lastInTextNode) { rows.push(cell); cell = ""; } } })
      .transform(html);
    expect(columns).toEqual(["Oh", "Mem0", "Supermemory", "Zep and Graphiti", "Letta", "Claude memory tool"]);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(html.match(/<tr>/gu)?.length).toBe(rows.length + 1);
    for (const href of [
      "https://github.com/getzep/graphiti",
      "https://github.com/letta-ai/letta-code",
      "https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toMatch(/aria-label="Six ways to give an agent memory[^"]*" role="region" tabindex="0"/u);
    expect(html).toContain('src="/marks/oh-computer.svg"');
    expect(html).toContain("Oh has run no matched benchmark against these three.");
    expect(html).toMatch(/Checked [A-Z][a-z]+ \d{1,2}, \d{4}\./u);
  });

  test("the index links both comparisons and the evidence directory", () => {
    const html = renderToStaticMarkup(<RootLayout><CompareIndex /></RootLayout>);
    expect(html).toContain('href="/compare/mem0"');
    expect(html).toContain('href="/compare/supermemory"');
    expect(html).toContain("https://github.com/hraness/oh/blob/main/benchmarks");
    expect(html).toContain('href="/benchmarks"');
    expect(html).toContain('"@type":"CollectionPage"');
  });

  test("the Supermemory page renders only the checked-in pilot numbers", () => {
    const html = renderToStaticMarkup(<RootLayout><CompareSupermemory /></RootLayout>);
    const primary = pilotResult.quality.comparisons.primary;
    expect(html).toContain(`${pilotRate("supermemory")} correctly`);
    expect(html).toContain(pilotRate("oh"));
    expect(html).toContain(pilotRate("bm25"));
    expect(html).toContain(
      `difference is ${signed(primary.estimate)} points with a 95%`,
    );
    expect(html).toContain(`${signed(primary.interval95.lower)} to ${signed(primary.interval95.upper)}`);
    for (const arm of pilotResult.quality.arms) {
      for (const row of arm.byType) {
        expect(html).toContain(`<code>${row.questionType}</code>`);
        expect(html).toContain(`<td>${row.correct}</td>`);
      }
    }
    for (const file of ["FRAMEWORK_PILOT_RESULT_V1.md", "results/memory-framework-pilot-v1.json"]) {
      expect(html).toContain(`href="https://github.com/hraness/oh/blob/main/benchmarks/${file}"`);
    }
    expect(html).toContain("https://supermemory.ai/pricing");
    expect(html).toContain("https://supermemory.ai/docs/connectors/overview");
    expect(html).toContain("https://supermemory.ai/docs/concepts/container-tags");
    expect(html).toContain("https://supermemory.ai/docs/self-hosting/overview");
    expect(html).toContain("checked September 26, 2026");
    expect(html).toContain("no person or outside group has audited it");
  });

  test("the Mem0 page renders only the checked-in MemEval numbers", () => {
    const html = renderToStaticMarkup(<RootLayout><CompareMem0 /></RootLayout>);
    const mem0 = memEval.systems.find((entry) => entry.system === "mem0");
    const ohMini = memEval.systems.find((entry) => entry.system === "oh" && "reader" in entry && entry.reader === "openai/gpt-4.1-mini");
    const ohFull = memEval.systems.find((entry) => entry.system === "oh" && "reader" in entry && entry.reader === "openai/gpt-4.1");
    if (!mem0 || !ohMini || !ohFull) throw new Error("MemEval fixture shape changed.");
    const matchedOh = "matchedOhOnSameQuestions" in mem0 ? mem0.matchedOhOnSameQuestions : undefined;
    const mem0Questions = "questions" in mem0 ? mem0.questions : undefined;
    if (!matchedOh || typeof mem0Questions !== "number") throw new Error("MemEval fixture shape changed.");
    const tenth = (value: number) => `${(value * 100).toFixed(1)}%`;
    const matchedRow = (entry: { correct: number; of: number }) => `${tenth(entry.correct / entry.of)} (${entry.correct}/${entry.of})`;
    expect(html).toContain(`${tenth(mem0.accuracy)} (${Math.round(mem0.accuracy * mem0Questions)}/${mem0Questions})`);
    expect(html).toContain(`${tenth(ohMini.accuracy)}`);
    expect(html).toContain(`${tenth(ohFull.accuracy)}`);
    expect(html).toContain(matchedRow(matchedOh["openai/gpt-4.1-mini"]));
    expect(html).toContain(matchedRow(matchedOh["openai/gpt-4.1"]));
    expect(html).toContain(mem0.tokens.calls.toLocaleString("en-US"));
    expect(html).toContain("matched observation");
    expect(html).toContain("not a superiority claim");
    for (const path of ["platform/platform-vs-oss", "platform/overview"]) {
      expect(html).toContain(`href="https://docs.mem0.ai/${path}"`);
    }
    expect(html).toContain('href="https://github.com/mem0ai/mem0"');
    expect(html).toContain("Apache-2.0");
    for (const file of ["EVOLUTION_RELEASE_RESULTS.md", "results/memory-evolution-memeval-102-v1.json"]) {
      expect(html).toContain(`href="https://github.com/hraness/oh/blob/main/benchmarks/${file}"`);
    }
    expect(html).toContain("checked September 26, 2026");
  });

  test("the sitemap and llms.txt list the comparison routes", async () => {
    const urls = sitemap().map(({ url }) => url);
    const llms = await readFile(join(site, "public/llms.txt"), "utf8");
    for (const [, , , path] of pages) {
      expect(urls).toContain(`${origin}${path}`);
      expect(llms).toContain(`](${origin}${path})`);
    }
  });
});
