import { socialImageAlt, type SocialImagePage } from "@hraness/web-discovery/social-image";
import { ohSocialSite } from "../social";
import { blogDescription, type OhArticle } from "./articles";

export const blogSocialPage = {
  description: blogDescription,
  headline: "Blog",
} as const satisfies SocialImagePage;

export const blogImageAlt = socialImageAlt(ohSocialSite, blogSocialPage);

export function articleSocialPage(article: Pick<OhArticle, "dek" | "eyebrow" | "title">): SocialImagePage {
  return { description: article.dek, eyebrow: article.eyebrow, headline: article.title };
}
