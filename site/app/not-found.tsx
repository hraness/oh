import { marketing } from "../portfolio-copy";
import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { DesignPaletteMenuButton, RouteNotFoundPage } from "@hraness/design-kit/react";

import { articlePath, blogPath, blogTitle, indexableArticles } from "./blog/articles";

/** The status page caps route labels at 48 characters; cut a long title at a word. */
function routeLabel(title: string): string {
  if (title.length <= 48) return title;
  const cut = title.slice(0, 47);
  const space = cut.lastIndexOf(" ");
  return `${(space > 24 ? cut.slice(0, space) : cut).replace(/[\s,:;–—-]+$/u, "")}…`;
}

/** The pages the sitemap lists; a mistyped address is matched against them for "Did you mean". */
const knownPages = [
  { href: "/", label: "Oh" },
  { href: "/spec", label: "Oh specification" },
  { href: blogPath, label: blogTitle },
  ...indexableArticles.map((article) => ({ href: articlePath(article), label: routeLabel(article.title) })),
];

/** An unknown address keeps the site's header and palette instead of the framework's default page. */
export default function NotFound() {
  return (
    <>
      <MarketingSiteHeader
        trailing={<DesignPaletteMenuButton />}
        action={{ href: "/#install", label: "Install Oh" }}
        ariaLabel="Site navigation"
        brand={marketing.names.name}
        brandMark="/marks/oh-computer.svg"
        brandLabel={`${marketing.names.name} home`}
        className="spec-header"
        links={[
          { href: "/", label: "Overview" },
          { href: "/blog", label: "Blog" },
          { href: "/spec", label: "Specification" },
          { href: "https://github.com/hraness/oh", label: "GitHub" },
        ]}
      />
      <RouteNotFoundPage
        agentIndexHref="/llms.txt"
        next={[
          {
            href: "/blog/introducing-oh",
            label: "Introducing Oh",
            description: "Who Oh is for, and a first run from a question to a cited brief.",
          },
          {
            href: "/spec",
            label: "Specification",
            description: "The records, digests, storage, and sync another implementation needs.",
          },
          {
            href: blogPath,
            label: "Blog",
            description: "Release notes, benchmark reports, and how Oh is tested.",
          },
        ]}
        primaryAction={{ href: "/#install", label: "Install Oh" }}
        routes={knownPages}
        siteName="Oh"
      />
    </>
  );
}
