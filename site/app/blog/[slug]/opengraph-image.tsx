import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { ohSocialSite } from "../../social";
import { articles, findArticle } from "../articles";
import { articleSocialPage, blogSocialPage } from "../social";

export const alt = "Oh blog article";
export { contentType, size };

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

export default async function ArticleImage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const article = findArticle((await params).slug);
  return createSiteSocialImageResponse(ohSocialSite, article === undefined ? blogSocialPage : articleSocialPage(article));
}
