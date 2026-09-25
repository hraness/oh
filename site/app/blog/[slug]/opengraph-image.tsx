import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { articles, findArticle } from "../articles";
import { OhSocialMark, ohSocialTheme } from "../../social-mark";

export const alt = "Oh blog article";
export { contentType, size };

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

export default async function ArticleImage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const article = findArticle((await params).slug);
  return createSocialImageResponse({
    description: article?.dek ?? "",
    domain: "oh.computer/blog",
    eyebrow: "Oh",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: article?.title ?? "Oh blog",
  });
}
