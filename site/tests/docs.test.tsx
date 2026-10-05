import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import RootLayout from "../app/layout";
import Docs, { metadata as docsMetadata } from "../app/docs/page";
import SdkDocs, { metadata as sdkMetadata } from "../app/docs/sdk/page";
import { docsPages } from "../app/docs/catalog";
import { docsHtml } from "../app/docs/docs.generated";
import sitemap from "../app/sitemap";
import { docsSourceDigests, generatedModule, headingFragment, markdownSection, renderDocsPages, textContent } from "../scripts/docs-html";

const site = join(import.meta.dir, "..");
const repository = join(site, "..");

function hrefs(html: string): string[] {
  return [...html.matchAll(/\shref="([^"]+)"/gu)].map(([, href]) => href ?? "");
}

describe("documentation rendered from repository Markdown", () => {
  test("the committed pages match README.md and docs/sdk.md exactly", async () => {
    const current = await readFile(join(site, "app/docs/docs.generated.ts"), "utf8");
    expect(current).toBe(generatedModule(await renderDocsPages(repository), await docsSourceDigests(repository)));
  });

  test("every README section the getting-started page names exists once and keeps its order", async () => {
    const readme = await readFile(join(repository, "README.md"), "utf8");
    const page = docsPages.find(({ path }) => path === "/docs");
    if (page === undefined || !("sections" in page)) throw new Error("Missing the /docs catalog entry.");
    expect(docsHtml["/docs"].toc.map(({ label }) => label)).toEqual(page.sections.map(({ heading }) => heading));
    let previous = -1;
    for (const { heading } of page.sections) {
      expect(markdownSection(readme, heading).startsWith(`## ${heading}\n`)).toBe(true);
      const offset = readme.indexOf(`\n## ${heading}\n`);
      expect(offset).toBeGreaterThan(previous);
      previous = offset;
    }
  });

  test("keeps the short anchors for agents and troubleshooting beside the README fragments", () => {
    const html = docsHtml["/docs"].html;
    expect(html).toContain('<span class="docs-anchor" id="agents"></span><h2 id="give-oh-to-a-coding-agent">');
    expect(html).toContain('<span class="docs-anchor" id="troubleshooting"></span><h2 id="troubleshooting-the-first-run">');
    expect(textContent(html)).toContain("npx skills add hraness/oh#v0.14.1 --skill oh");
    expect(html).toContain("<code>~/.claude/skills/oh</code>");
    expect(html).toContain("<code>~/.agents/skills/oh</code>");
  });

  test("links resolve to site pages, in-page headings, or absolute public URLs", () => {
    for (const { path } of docsPages) {
      const { html } = docsHtml[path];
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/gu)].map(([, id]) => id));
      for (const href of hrefs(html)) {
        if (href.startsWith("#")) {
          expect(ids.has(href.slice(1)), `${path} ${href}`).toBe(true);
        } else if (href.startsWith("/")) {
          const [target, fragment] = href.split("#");
          const page = docsPages.find((candidate) => candidate.path === target);
          expect(page, `${path} ${href}`).toBeDefined();
          if (page !== undefined && fragment !== undefined) {
            expect(docsHtml[page.path].html, `${path} ${href}`).toContain(` id="${fragment}"`);
          }
        } else {
          expect(href, path).toMatch(/^https:\/\//u);
        }
      }
      expect(html).not.toMatch(/<script|<iframe|\ssrc="/u);
    }
  });

  test("states the first-run output the v0.14.1 release prints", () => {
    const html = docsHtml["/docs"].html;
    expect(html).toContain("fcfe318e7248366d2408d1fa392268ac16490e72487079956c20db96b8369449");
    expect(html).toContain("No Oh store at .oh/oh.sqlite");
    expect(html).toContain("The expected head does not match the current space head.");
    expect(docsHtml["/docs/sdk"].html).toContain('id="handle-errors"');
    expect(headingFragment("Give Oh to a coding agent")).toBe("give-oh-to-a-coding-agent");
  });
});

describe("documentation pages", () => {
  test("render the header, contents, body, and canonical metadata", () => {
    for (const [Page, metadata, path] of [[Docs, docsMetadata, "/docs"], [SdkDocs, sdkMetadata, "/docs/sdk"]] as const) {
      const entry = docsPages.find((page) => page.path === path)!;
      const html = renderToStaticMarkup(<RootLayout><Page /></RootLayout>);
      expect(html).toContain(`<h1 id="docs-title">${entry.heading}</h1>`);
      expect(html).toContain('href="/docs"');
      for (const item of docsHtml[path].toc) expect(html).toContain(`href="${item.href}"`);
      expect(metadata.title).toBe(entry.title);
      expect(metadata.description).toBe(entry.description);
      expect(entry.description.length).toBeGreaterThanOrEqual(110);
      expect(entry.description.length).toBeLessThanOrEqual(160);
      expect(metadata.alternates?.canonical).toBe(path);
      expect(sitemap().map(({ url }) => url)).toContain(`https://oh.computer${path}`);
    }
  });

  test("are listed in llms.txt and linked from every site header and the footer", async () => {
    const llms = await readFile(join(site, "public/llms.txt"), "utf8");
    for (const { path } of docsPages) expect(llms).toContain(`](https://oh.computer${path})`);
    for (const file of ["app/page.tsx", "app/spec/page.tsx", "app/benchmarks/page.tsx", "app/blog/blog-header.tsx", "app/compare/compare.tsx", "app/not-found.tsx", "app/site-footer.tsx", "app/docs/docs-page.tsx"]) {
      expect(await readFile(join(site, file), "utf8"), file).toMatch(/href: "\/docs", label: "Docs" \}/u);
    }
  });
});
