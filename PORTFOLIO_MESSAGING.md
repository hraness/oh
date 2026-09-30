# Canonical portfolio messaging

Product names, descriptions, marketing heroes, and named section headings are authored in [hraness/jungle](https://github.com/hraness/jungle/blob/main/portfolio-projects.json). Do not copy new prose into the site or edit the generated snapshot by hand.

`site/portfolio-messaging.generated.json` pins the public portfolio digest and carries this product's messaging plus canonical related-product names, descriptions, URLs, and relationships. Website builds use the checked snapshot offline.

From this repository root, with `PORTFOLIO_SOURCE_CHECKOUT` pointing to a validated Jungle checkout:

```sh
bun "${PORTFOLIO_SOURCE_CHECKOUT}/scripts/sync-product-messaging.ts" \
  --portfolio "${PORTFOLIO_SOURCE_CHECKOUT}/portfolio.public.generated.json" \
  --product oh-computer --output site/portfolio-messaging.generated.json --write
```

Drop `--write` to verify the checked snapshot against that catalog. Commit the snapshot and the generated artifacts after the site checks pass.

`site/portfolio-copy.ts` supplies marketing metadata, the home hero, section headings, and related-card copy.

From `site/`, validate changes with `bun run test`, `bun run lint`, `bun run typecheck`, and `bun run build`.

Technical documentation, research records, release evidence, and runtime copy retain their existing owners.
