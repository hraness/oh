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
  socialImageSiteDetails,
} from "@hraness/web-discovery/social-image/card";

import { ohDefaultAppearance } from "../appearance";
import { articleDiscovery, articles } from "../app/blog/articles";
import { ohHeaderMark } from "../app/header-mark";
import { marketing } from "../portfolio-copy";
import { articleSocialPage, blogSocialPage } from "../app/blog/social";
import {
  benchmarksSocialPage,
  compareMem0SocialPage,
  compareSocialPage,
  compareSupermemorySocialPage,
  docsSocialPages,
  homeSocialPage,
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

const routes: readonly (readonly [string, SocialImagePage])[] = [
  ["opengraph-image.tsx", homeSocialPage],
  ["spec/opengraph-image.tsx", specificationSocialPage],
  ["benchmarks/opengraph-image.tsx", benchmarksSocialPage],
  ["compare/opengraph-image.tsx", compareSocialPage],
  ["compare/mem0/opengraph-image.tsx", compareMem0SocialPage],
  ["compare/supermemory/opengraph-image.tsx", compareSupermemorySocialPage],
  ["blog/opengraph-image.tsx", blogSocialPage],
  ["docs/opengraph-image.tsx", docsSocialPages["/docs"]],
  ["docs/sdk/opengraph-image.tsx", docsSocialPages["/docs/sdk"]],
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
  test("declare Oh once with the header's foil mark, name, and Gruvbox palette", async () => {
    const mark = await readFile(join(site, "public/marks/oh-computer.svg"), "utf8");
    expect(ohSocialSite.brandMark).toBe(mark);
    expect(ohHeaderMark).toBe(mark);
    expect(ohSocialSite.brand).toBe("Oh");
    expect(ohSocialSite.name).toBe("Oh");
    expect(ohSocialSite.domain).toBe("oh.computer");
    expect(ohSocialSite.palette).toBe("gruvbox");
    expect(ohSocialSite.palette).toBe(ohDefaultAppearance.palette);
    expect(ohSocialSite.icon).toBeUndefined();
    expect(ohSocialSite.theme).toBeUndefined();
    // Every page that renders the site header paints this same mark.
    for (const file of ["page.tsx", "spec/page.tsx", "benchmarks/page.tsx", "blog/blog-header.tsx", "compare/compare.tsx", "docs/docs-page.tsx"]) {
      expect(await readFile(join(app, file), "utf8"), file).toContain('brandMark="/marks/oh-computer.svg"');
    }
  });

  test("the home card reads like the hero: category eyebrow, hero headline, tagline beneath", () => {
    expect(homeSocialPage).toEqual({
      eyebrow: marketing.category,
      headline: marketing.hero.heading,
      layout: "product",
    });
    const fit = socialImageFit(socialImageSiteDetails(ohSocialSite, homeSocialPage));
    expect(fit.layout).toBe("product");
    expect(fit.headline.lines).toEqual(["Agent memory", "that shows its work."]);
    expect(fit.description?.lines.join(" ")).toBe(ohSocialSite.description);
    expect(fit.issues.filter((issue) => !issue.includes("repeats the site tagline"))).toEqual([]);
    // The product layout shows the tagline beneath the hero headline by design;
    // v0.13.0 still reports that as a repeated tagline, and nothing else.
    expect(fit.findings.map((finding) => finding.code)).toEqual(["description-repeats-tagline"]);
    expect(socialImageFit(socialImageSiteDetails(ohSocialSite)).findings.map((finding) => finding.code)).toEqual([
      "home-headline-three-lines",
    ]);
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
    const cards: readonly (readonly [string, SocialImagePage])[] = [
      ...routes.filter(([, page]) => page !== homeSocialPage),
      ...articles.map((article) => [`blog/${article.slug}`, articleSocialPage(article)] as const),
    ];
    for (const [name, page] of cards) {
      const fit = socialImageFit(socialImageSiteDetails(ohSocialSite, page));
      expect(fit.issues, name).toEqual([]);
      // v0.12 review findings too: reduced descriptions, missing eyebrows, repeated taglines.
      expect(fit.findings, name).toEqual([]);
      // A page card never falls back to the site tagline.
      expect(page.description, name).not.toBe(ohSocialSite.description);
    }
  });
});
