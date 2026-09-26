import { MarketingSiteFooter } from "@hraness/design-kit/react/server";
import { homeDescription } from "./metadata-copy";

const repository = "https://github.com/hraness/oh";

export function BrandMark() {
  // eslint-disable-next-line @next/next/no-img-element -- the canonical mark is a fixed-size authored SVG
  return <img alt="" aria-hidden="true" className="brand-mark" height={20} src="/marks/oh-computer.svg" width={20} />;
}

export function OhContentFooter() {
  return (
    <MarketingSiteFooter
      ariaLabel="Oh"
      brand={<BrandMark />}
      brandHref="/"
      brandLabel="Oh home"
      links={[
        { href: "/blog", label: "Blog" },
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
