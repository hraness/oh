import { ohDefaultAppearance } from "../appearance";
import { marketing } from "../portfolio-copy";
import { ohHeaderMark } from "./header-mark";
// The one declaration every Oh share image is rendered from. Routes pass page
// copy only; the shared @hraness/web-discovery template draws the card.
import { defineSocialImageSite, socialImageAlt, type SocialImagePage } from "@hraness/web-discovery/social-image";
import {
  benchmarksCardDescription,
  compareCardDescription,
  compareMem0CardDescription,
  compareSupermemoryCardDescription,
  homeCardDescription,
  specificationCardDescription,
} from "./metadata-copy";
import { docsPages, type DocsPath } from "./docs/catalog";

export const ohSocialSite = defineSocialImageSite({
  // The header shows the product name beside this foil mark on a Gruvbox page.
  brand: marketing.names.name,
  brandMark: ohHeaderMark,
  description: homeCardDescription,
  domain: "oh.computer",
  // Product names the card must not break across lines.
  keepTogether: ["GPT-5 mini", "Claude’s memory tool"],
  name: marketing.names.name,
  palette: ohDefaultAppearance.palette,
});

// The home card reads like the hero: its eyebrow and short headline, with the
// tagline beneath, because the tagline alone would run to three lines.
export const homeSocialPage = {
  eyebrow: marketing.category,
  headline: marketing.hero.heading,
  layout: "product",
} as const satisfies SocialImagePage;

export const specificationSocialPage = {
  description: specificationCardDescription,
  eyebrow: "Specification",
  headline: "Ontology specification v1",
} as const satisfies SocialImagePage;
export const benchmarksSocialPage = {
  description: benchmarksCardDescription,
  eyebrow: "Research",
  headline: "Benchmark results",
} as const satisfies SocialImagePage;
export const compareSocialPage = {
  description: compareCardDescription,
  eyebrow: "Comparison",
  headline: "Agent memory compared",
} as const satisfies SocialImagePage;
export const compareMem0SocialPage = {
  description: compareMem0CardDescription,
  eyebrow: "Comparison",
  headline: "Oh vs Mem0",
} as const satisfies SocialImagePage;
export const compareSupermemorySocialPage = {
  description: compareSupermemoryCardDescription,
  eyebrow: "Comparison",
  headline: "Oh vs Supermemory",
} as const satisfies SocialImagePage;

export const docsSocialPages = Object.fromEntries(
  docsPages.map((page) => [page.path, {
    description: page.cardDescription,
    eyebrow: "Documentation",
    headline: page.cardHeadline,
  } satisfies SocialImagePage]),
) as Readonly<Record<DocsPath, SocialImagePage>>;
export const docsImageAlt = (path: DocsPath): string => socialImageAlt(ohSocialSite, docsSocialPages[path]);

export const homeImageAlt = socialImageAlt(ohSocialSite);
export const specificationImageAlt = socialImageAlt(ohSocialSite, specificationSocialPage);
export const benchmarksImageAlt = socialImageAlt(ohSocialSite, benchmarksSocialPage);
export const compareImageAlt = socialImageAlt(ohSocialSite, compareSocialPage);
export const compareMem0ImageAlt = socialImageAlt(ohSocialSite, compareMem0SocialPage);
export const compareSupermemoryImageAlt = socialImageAlt(ohSocialSite, compareSupermemorySocialPage);
