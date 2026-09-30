import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  createSiteSocialImageResponse,
  socialImageAlt,
  type SocialImagePage,
} from "@hraness/web-discovery/social-image";
import {
  socialImageFit,
  socialImageIconShape,
  socialImageSiteDetails,
} from "@hraness/web-discovery/social-image/card";

import { articleDiscovery, articles } from "../app/blog/articles";
import { articleSocialPage, blogSocialPage } from "../app/blog/social";
import {
  benchmarksSocialPage,
  compareMem0SocialPage,
  compareSocialPage,
  compareSupermemorySocialPage,
  ohSocialSite,
  specificationSocialPage,
} from "../app/social";

const site = join(import.meta.dir, "..");
const app = join(site, "app");

type ImageModule = {
  alt: string;
  contentType: string;
  default: (props: { params: Promise<{ slug: string }> }) => Response | Promise<Response>;
  size: { height: number; width: number };
};

const routes: readonly (readonly [string, SocialImagePage | undefined])[] = [
  ["opengraph-image.tsx", undefined],
  ["spec/opengraph-image.tsx", specificationSocialPage],
  ["benchmarks/opengraph-image.tsx", benchmarksSocialPage],
  ["compare/opengraph-image.tsx", compareSocialPage],
  ["compare/mem0/opengraph-image.tsx", compareMem0SocialPage],
  ["compare/supermemory/opengraph-image.tsx", compareSupermemorySocialPage],
  ["blog/opengraph-image.tsx", blogSocialPage],
];

async function imageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true });
  return entries
    .filter((entry) => /(?:^|\/)(?:opengraph|twitter)-image\.[jt]sx?$/u.test(entry))
    .map((entry) => relative(app, join(directory, entry)))
    .sort();
}

async function bytes(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe("Oh share images", () => {
  test("declare Oh once with its app icon and gruvbox light colors", async () => {
    const favicon = await readFile(join(site, "public/favicon.svg"));
    const icon = ohSocialSite.icon;
    expect(icon?.kind).toBe("app");
    const prefix = "data:image/svg+xml;base64,";
    expect(icon?.src.startsWith(prefix)).toBe(true);
    expect(Buffer.from(icon?.src.slice(prefix.length) ?? "", "base64").equals(favicon)).toBe(true);
    expect(ohSocialSite.name).toBe("Oh");
    expect(ohSocialSite.domain).toBe("oh.computer");
    expect(ohSocialSite.theme).toEqual({
      accent: "#065968",
      background: "#FBF1C7",
      foreground: "#393533",
      muted: "#584F48",
    });
  });

  test("every image route renders through the shared template and draws nothing itself", async () => {
    const files = await imageFiles(app);
    expect(files).toEqual([...routes.map(([file]) => file), "blog/[slug]/opengraph-image.tsx"].sort());
    for (const file of files) {
      const source = await readFile(join(app, file), "utf8");
      expect(source, file).toContain("createSiteSocialImageResponse(ohSocialSite");
      expect(source, file).not.toMatch(/new ImageResponse|\bcreateSocialImageResponse|<svg|<div|mark:|theme:/u);
    }
  });

  test("each route serves a 1200x630 PNG from the site declaration and its page copy", async () => {
    for (const [file, page] of routes) {
      const image = (await import(join(app, file))) as ImageModule;
      expect(image.size, file).toEqual({ height: 630, width: 1200 });
      expect(image.contentType, file).toBe("image/png");
      expect(image.alt.length, file).toBeGreaterThan(0);
      expect(image.alt.length, file).toBeLessThanOrEqual(125);
      const response = await image.default({ params: Promise.resolve({ slug: "" }) });
      expect(response.headers.get("content-type"), file).toContain("image/png");
      const expected = await bytes(createSiteSocialImageResponse(ohSocialSite, page));
      expect((await bytes(response)).equals(expected), file).toBe(true);
    }
  }, 60_000);

  test("each article card carries that article's copy", async () => {
    const image = (await import(join(app, "blog/[slug]/opengraph-image.tsx"))) as ImageModule;
    expect(image.size).toEqual({ height: 630, width: 1200 });
    expect(image.contentType).toBe("image/png");
    const article = articles[0];
    expect(article).toBeDefined();
    if (article === undefined) return;
    expect(articleSocialPage(article)).toEqual({
      description: article.card.description,
      eyebrow: article.eyebrow,
      headline: article.card.headline ?? article.title,
    });
    expect(articleDiscovery(article).image?.alt).toBe(socialImageAlt(ohSocialSite, articleSocialPage(article)));
    const response = await image.default({ params: Promise.resolve({ slug: article.slug }) });
    const expected = await bytes(createSiteSocialImageResponse(ohSocialSite, articleSocialPage(article)));
    expect((await bytes(response)).equals(expected)).toBe(true);
  }, 30_000);

  test("every card shows its copy whole at standard size, with an eyebrow, and nothing stripped", () => {
    const cards: readonly (readonly [string, SocialImagePage | undefined])[] = [
      ...routes,
      ...articles.map((article) => [`blog/${article.slug}`, articleSocialPage(article)] as const),
    ];
    for (const [name, page] of cards) {
      const fit = socialImageFit(socialImageSiteDetails(ohSocialSite, page));
      expect(fit.issues, name).toEqual([]);
      // v0.12 review findings too: reduced descriptions, missing eyebrows, repeated taglines.
      expect(fit.findings, name).toEqual([]);
      // A page card never falls back to the site tagline.
      if (page !== undefined) expect(page.description, name).not.toBe(ohSocialSite.description);
    }
  });

  test("the Oh disc is drawn full-bleed, with no tile rim behind it", () => {
    expect(ohSocialSite.icon).toBeDefined();
    if (ohSocialSite.icon === undefined) return;
    expect(socialImageIconShape(ohSocialSite.icon)).toBe("solid");
  });
});
