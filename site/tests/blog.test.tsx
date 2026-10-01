import { describe, expect, test } from "bun:test";
import {
  articleProvenanceSentence,
  assertArticleAdmissions,
  isArticleIndexable,
} from "@hraness/design-kit";
import { relatedFor } from "@hraness/design-kit/portfolio";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import RootLayout, { metadata as homeMetadata } from "../app/layout";
import { metadata as benchmarksMetadata } from "../app/benchmarks/page";
import { metadata as compareMetadata } from "../app/compare/page";
import { metadata as compareMem0Metadata } from "../app/compare/mem0/page";
import { metadata as compareSupermemoryMetadata } from "../app/compare/supermemory/page";
import { metadata as specificationMetadata } from "../app/spec/page";
import BlogIndex, { metadata as blogMetadata } from "../app/blog/page";
import * as blogImage from "../app/blog/opengraph-image";
import { blogImageAlt } from "../app/blog/social";
import ArticlePage, { generateMetadata, generateStaticParams } from "../app/blog/[slug]/page";
import { GET as feed } from "../app/blog/feed.xml/route";
import { articleAdmissions } from "../app/blog/admissions";
import { articles, articleDiscovery, articleProvenance, blogName, blogTitle, indexableArticles } from "../app/blog/articles";
import sitemap from "../app/sitemap";
import publishedRelease from "../published-release.json";

const site = join(import.meta.dir, "..");
const origin = "https://oh.computer";
const quarantined = articles.filter((article) => !isArticleIndexable(article.admission));

async function renderArticle(slug: string): Promise<string> {
  const page = await ArticlePage({ params: Promise.resolve({ slug }) });
  return renderToStaticMarkup(<RootLayout>{page}</RootLayout>);
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/gu)].map(([, href]) => href ?? "");
}

describe("Oh blog", () => {
  test("validates every article's review record", () => {
    expect(() => assertArticleAdmissions(articleAdmissions)).not.toThrow();
    expect(articles.map((article) => `/blog/${article.slug}`).sort())
      .toEqual(articleAdmissions.map((record) => record.href).sort());
    for (const record of articleAdmissions) {
      expect(record.review.reviewerType).toBe("ai");
      expect(record.humanReview).toBeNull();
    }
    expect(indexableArticles.map((article) => article.slug)).toEqual(["longmemeval-s-user-log", "introducing-oh", "oh-rust-typescript-parity", "built-on-oh"]);
    expect(quarantined.map((article) => article.slug)).toEqual([]);
  });

  test("prerenders one page per article", () => {
    expect(generateStaticParams()).toEqual(articles.map((article) => ({ slug: article.slug })));
  });

  test("renders the Hraness byline and the recorded review note on every article", async () => {
    for (const article of articles) {
      const html = await renderArticle(article.slug);
      const sentence = articleProvenanceSentence(articleProvenance(article));
      expect(sentence).toBe(
        "Drafted with AI from the source code and reviewed by Codex AI independent editorial review.",
      );
      expect(html).toContain(sentence);
      expect(html).toContain('data-reviewer-type="ai"');
      expect(html).toMatch(/By <a href="https:\/\/hraness\.com" rel="author">Hraness<\/a>/u);
      expect(sentence).not.toMatch(/human/iu);
      expect(html).not.toContain("Ben Guo");
      expect(html.match(/<h1\b/gu)).toHaveLength(1);
      expect(html).toContain('"@type":"BlogPosting"');
      expect(html).toContain(`"@id":"${origin}/blog/${article.slug}#article"`);
      expect(html).toContain('data-hraness-marketing="footer"');
      expect(html).not.toMatch(/\{\{|\}\}/u);
      expect(html).not.toContain("—");
    }
  });

  test("renders the release version from the release record", async () => {
    const html = await renderArticle("introducing-oh");
    expect(html).toContain(`Latest release: v${publishedRelease.version}.`);
    for (const slug of ["longmemeval-s-user-log", "introducing-oh", "built-on-oh", "oh-rust-typescript-parity"]) {
      const source = await readFile(join(site, "app/blog/content", `${slug}.tsx`), "utf8");
      expect(source).not.toContain(publishedRelease.version);
    }
  });

  test("the index names its social image and site", () => {
    const openGraph = blogMetadata.openGraph as { images?: { alt?: string; url?: string }[]; siteName?: string };
    expect(openGraph.siteName).toBe("Oh");
    expect(openGraph.images?.[0]).toMatchObject({ alt: blogImageAlt, url: "/blog/opengraph-image" });
    expect(blogImage.alt).toBe(blogImageAlt);
    expect(blogImageAlt.length).toBeLessThanOrEqual(125);
  });

  test("adds search context without rewriting editorial headlines, deks, feed titles, or article schema", async () => {
    expect(blogMetadata.title).toBe(blogTitle);
    expect(blogTitle.length).toBeGreaterThanOrEqual(30);
    expect(blogTitle.length).toBeLessThanOrEqual(60);
    const atom = await feed().text();
    expect(atom).toContain(`<title type="text">${blogName}</title>`);
    const titles = new Set<string>();
    for (const article of indexableArticles) {
      const title = article.metaTitle ?? article.title;
      const metadata = await generateMetadata({ params: Promise.resolve({ slug: article.slug }) });
      expect(metadata.title).toBe(title);
      expect((metadata.openGraph as { title?: string }).title).toBe(title);
      expect((metadata.twitter as { title?: string }).title).toBe(title);
      expect(metadata.description).toBe(article.metaDescription ?? article.dek);
      expect(articleDiscovery(article).description).toBe(article.dek);
      expect(title.length).toBeGreaterThanOrEqual(30);
      expect(title.length).toBeLessThanOrEqual(60);
      expect(titles.has(title)).toBe(false);
      titles.add(title);
      expect(atom).toContain(`<title type="text">${article.title}</title>`);
      if (article.metaTitle === undefined) continue;
      const html = await renderArticle(article.slug);
      expect(html).toContain(`>${article.title}</h1>`);
      expect(html).toContain(`"headline":"${article.title}"`);
      expect(html).not.toContain(article.metaTitle);
      expect(atom).not.toContain(article.metaTitle);
      if (article.metaDescription !== undefined) {
        expect(html).toContain(article.dek);
        expect(html).not.toContain(article.metaDescription);
        expect(atom).not.toContain(article.metaDescription);
      }
    }
  });

  test("gives every canonical sitemap page a distinct nonempty search description", async () => {
    const pages = [
      { path: "/", metadata: homeMetadata },
      { path: "/benchmarks", metadata: benchmarksMetadata },
      { path: "/compare", metadata: compareMetadata },
      { path: "/compare/mem0", metadata: compareMem0Metadata },
      { path: "/compare/supermemory", metadata: compareSupermemoryMetadata },
      { path: "/spec", metadata: specificationMetadata },
      { path: "/blog", metadata: blogMetadata },
      ...await Promise.all(indexableArticles.map(async (article) => ({
        path: `/blog/${article.slug}`,
        metadata: await generateMetadata({ params: Promise.resolve({ slug: article.slug }) }),
      }))),
    ];
    expect(pages.map(({ path }) => `${origin}${path}`).sort())
      .toEqual(sitemap().map(({ url }) => url).sort());
    const descriptions = new Set<string>();
    for (const { path, metadata } of pages) {
      const description = metadata.description;
      if (typeof description !== "string" || description.trim() === "") {
        throw new Error(`${path} has no search description.`);
      }
      if (descriptions.has(description)) throw new Error(`${path} duplicates a search description.`);
      descriptions.add(description);
    }
  });

  test("marks quarantined articles noindex and keeps indexable ones indexable", async () => {
    for (const article of articles) {
      const metadata = await generateMetadata({ params: Promise.resolve({ slug: article.slug }) });
      const robots = metadata.robots as { index: boolean };
      expect(robots.index).toBe(isArticleIndexable(article.admission));
      expect(metadata.alternates?.canonical).toBe(`${origin}/blog/${article.slug}`);
      expect((metadata.openGraph as { type?: string }).type).toBe("article");
    }
  });

  test("keeps quarantined articles out of the index, sitemap, feed, and llms.txt", async () => {
    const index = renderToStaticMarkup(<RootLayout><BlogIndex /></RootLayout>);
    const urls = sitemap().map(({ url }) => url);
    const atom = await feed().text();
    const llms = await readFile(join(site, "public/llms.txt"), "utf8");
    for (const article of indexableArticles) {
      const url = `${origin}/blog/${article.slug}`;
      expect(index).toContain(`href="/blog/${article.slug}"`);
      expect(urls).toContain(url);
      expect(atom).toContain(`<id>${url}</id>`);
      expect(llms).toContain(`](${url})`);
    }
    for (const article of quarantined) {
      expect(index).not.toContain(`/blog/${article.slug}`);
      expect(urls.some((url) => url.includes(article.slug))).toBe(false);
      expect(atom).not.toContain(article.slug);
      expect(llms).not.toContain(article.slug);
    }
    expect(urls).toContain(`${origin}/blog`);
    for (const [, url] of llms.matchAll(/\]\((https:\/\/oh\.computer\/blog[^)\s]*)\)/gu)) {
      expect(urls.includes(url ?? "") || url === `${origin}/blog/feed.xml`).toBe(true);
    }
    expect(urls).toContain(`${origin}/spec`);
    expect(urls).toContain(`${origin}/benchmarks`);
    expect(urls.filter((url) => url.startsWith(`${origin}/spec/`))).toEqual([]);
    const entries = sitemap().filter(({ url }) => url.startsWith(`${origin}/blog`));
    for (const entry of entries) expect(entry.lastModified).toBeDefined();
    expect(index).toContain('"@type":"Blog"');
    expect(atom).toContain("<name>Hraness</name>");
  });

  test("links only to published routes, manifest articles, and live product homepages", async () => {
    const internal = new Set(["/", "/blog", "/spec", "/#install", ...articles.map((article) => `/blog/${article.slug}`)]);
    const external = new Set([
      "https://sponge.computer",
      "https://wordcell.io",
    ]);
    for (const article of articles) {
      const html = await renderArticle(article.slug);
      const body = /<div class="plain-publication__article-body">([\s\S]*?)<\/div><\/div>/u.exec(html)?.[1] ?? "";
      expect(body.length).toBeGreaterThan(0);
      for (const href of hrefs(body)) {
        if (href.startsWith("#")) continue;
        if (href.startsWith("/")) expect(internal.has(href)).toBe(true);
        else if (!href.startsWith("https://github.com/hraness/")) expect(external.has(href)).toBe(true);
      }
    }
  });

  test("shows related products only from registered relations", async () => {
    const related = relatedFor("oh-computer");
    const html = await renderArticle("introducing-oh");
    if (related.length === 0) expect(html).not.toContain("plain-publication__related-products");
    else for (const item of related) {
      // Cards show the mark, name, and one-line role; the relation sentence is not rendered.
      expect(html).toContain(`href="${item.href}"`);
      expect(html).toContain(item.name);
      expect(html).toContain(item.role);
      expect(html).not.toContain(item.relationship.replaceAll("'", "&#x27;"));
      expect(item.mark).toStartWith("data:image/svg+xml,");
    }
    if (related.length > 0) expect(html).toContain("hraness-marketing-related__card-mark");
  });
});
