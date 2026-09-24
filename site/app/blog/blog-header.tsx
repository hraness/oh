import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { DesignPaletteMenuButton } from "@hraness/design-kit/react";

export function BlogHeader({ current }: Readonly<{ current: "index" | "post" }>) {
  return (
    <MarketingSiteHeader
      trailing={<DesignPaletteMenuButton />}
      action={{ href: "/#install", label: "Install Oh" }}
      ariaLabel="Blog navigation"
      brand="Oh"
      brandMark="/marks/oh-computer.svg"
      brandLabel="Oh home"
      className="spec-header"
      links={[
        { href: "/", label: "Overview" },
        { current: current === "index", href: "/blog", label: "Blog" },
        { href: "/spec", label: "Specification" },
        { href: "https://github.com/hraness/oh", label: "GitHub" },
      ]}
    />
  );
}
