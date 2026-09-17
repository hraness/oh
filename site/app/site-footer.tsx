import { MarketingSiteFooter } from "@hraness/design-kit/react/server";

const repository = "https://github.com/hraness/oh";

export function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="brand-mark">
      <circle cx="12" cy="12" r="12" fill="currentColor" />
      <circle cx="7.7" cy="13.2" r="3" fill="none" stroke="var(--background)" strokeWidth="2.1" />
      <path
        d="M12.8 6.7v9.5m0-3.2c.1-2.2 1.3-3.5 3-3.5 1.8 0 2.8 1.2 2.8 3.3v3.4"
        fill="none"
        stroke="var(--background)"
        strokeLinecap="round"
        strokeWidth="2.1"
      />
    </svg>
  );
}

export function OhContentFooter() {
  return (
    <MarketingSiteFooter
      ariaLabel="Oh"
      brand={<BrandMark />}
      brandHref="/"
      brandLabel="Oh home"
      links={[
        { href: "/spec", label: "Ontology v1" },
        { href: repository, label: "hraness/oh" },
        { href: "https://hraness.com/projects", label: "Hraness projects" },
      ]}
      name="Oh"
    >
      <p>Oh is open source for researchers and the agents working beside them.</p>
    </MarketingSiteFooter>
  );
}
