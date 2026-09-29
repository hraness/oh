import { MarketingSiteFooter } from "@hraness/design-kit/react/server";
import { homeDescription } from "./metadata-copy";

const repository = "https://github.com/hraness/oh";

export function OhContentFooter() {
  return (
    <MarketingSiteFooter
      ariaLabel="Oh"
      brand={null}
      brandMark="/marks/oh-computer.svg"
      brandHref="/"
      brandLabel="Oh home"
      links={[
        { href: "/blog", label: "Blog" },
        { href: "/benchmarks", label: "Benchmarks" },
        { href: "/compare", label: "Compare" },
        { href: "/spec", label: "Specification" },
        { href: repository, label: "hraness/oh" },
        { href: "https://hraness.com/projects", label: "Hraness projects" },
      ]}
      name="Oh"
    >
      <p>{homeDescription}</p>
    </MarketingSiteFooter>
  );
}
