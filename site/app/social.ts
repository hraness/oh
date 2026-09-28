// The one declaration every Oh share image is rendered from. Routes pass page
// copy only; the shared @hraness/web-discovery template draws the card.
import { defineSocialImageSite, socialImageAlt, type SocialImagePage } from "@hraness/web-discovery/social-image";
import {
  benchmarksDescription,
  compareDescription,
  compareMem0Description,
  compareSupermemoryDescription,
  homeDescription,
  specificationDescription,
} from "./metadata-copy";

// public/favicon.svg, the Oh app icon, embedded so the card never fetches it.
const ohAppIcon = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+CiAgPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9IiNiNDNhMWQiLz4KICA8Y2lyY2xlIGN4PSI3LjciIGN5PSIxMy4yIiByPSIzIiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMi4xIi8+CiAgPHBhdGggZD0iTTEyLjggNi43djkuNW0wLTMuMmMuMS0yLjIgMS4zLTMuNSAzLTMuNSAxLjggMCAyLjggMS4yIDIuOCAzLjN2My40IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLXdpZHRoPSIyLjEiLz4KPC9zdmc+Cg==";

export const ohSocialSite = defineSocialImageSite({
  description: homeDescription,
  domain: "oh.computer",
  icon: { kind: "app", src: ohAppIcon },
  name: "Oh",
  theme: { accent: "#065968", background: "#FBF1C7", foreground: "#393533", muted: "#584F48" },
});

export const specificationSocialPage = {
  description: specificationDescription,
  eyebrow: "Specification",
  headline: "Ontology specification v1",
} as const satisfies SocialImagePage;
export const benchmarksSocialPage = {
  description: benchmarksDescription,
  eyebrow: "Benchmarks",
  headline: "Benchmark results",
} as const satisfies SocialImagePage;
export const compareSocialPage = {
  description: compareDescription,
  eyebrow: "Compare",
  headline: "Agent memory compared",
} as const satisfies SocialImagePage;
export const compareMem0SocialPage = {
  description: compareMem0Description,
  eyebrow: "Comparison",
  headline: "Oh vs Mem0",
} as const satisfies SocialImagePage;
export const compareSupermemorySocialPage = {
  description: compareSupermemoryDescription,
  eyebrow: "Comparison",
  headline: "Oh vs Supermemory",
} as const satisfies SocialImagePage;

export const homeImageAlt = socialImageAlt(ohSocialSite);
export const specificationImageAlt = socialImageAlt(ohSocialSite, specificationSocialPage);
export const benchmarksImageAlt = socialImageAlt(ohSocialSite, benchmarksSocialPage);
export const compareImageAlt = socialImageAlt(ohSocialSite, compareSocialPage);
export const compareMem0ImageAlt = socialImageAlt(ohSocialSite, compareMem0SocialPage);
export const compareSupermemoryImageAlt = socialImageAlt(ohSocialSite, compareSupermemorySocialPage);
