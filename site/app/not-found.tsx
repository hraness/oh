import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { DesignPaletteMenuButton, RouteNotFoundPage } from "@hraness/design-kit/react";

/** An unknown address keeps the site's header and palette instead of the framework's default page. */
export default function NotFound() {
  return (
    <>
      <MarketingSiteHeader
        trailing={<DesignPaletteMenuButton />}
        action={{ href: "/#install", label: "Install Oh" }}
        ariaLabel="Site navigation"
        brand="Oh"
        brandMark="/marks/oh-computer.svg"
        brandLabel="Oh home"
        className="spec-header"
        links={[
          { href: "/", label: "Overview" },
          { href: "/blog", label: "Blog" },
          { href: "/spec", label: "Specification" },
          { href: "https://github.com/hraness/oh", label: "GitHub" },
        ]}
      />
      <RouteNotFoundPage />
    </>
  );
}
