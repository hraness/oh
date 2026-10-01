import { socialImageAlt, type SocialImagePage } from "@hraness/web-discovery/social-image";
import { ohSocialSite } from "../social";
import { blogName } from "./articles";

export { articleSocialPage } from "./articles";

export const blogCardDescription =
  "How Oh works and how it is tested: benchmark runs and encoder property tests.";

export const blogSocialPage = {
  description: blogCardDescription,
  eyebrow: "Blog",
  headline: blogName,
} as const satisfies SocialImagePage;

export const blogImageAlt = socialImageAlt(ohSocialSite, blogSocialPage);
