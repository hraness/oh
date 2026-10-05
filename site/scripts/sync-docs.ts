import { resolve } from "node:path";

import { docsSourceDigests, generatedModule, renderDocsPages } from "./docs-html";

const siteRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(siteRoot, "..");
const target = resolve(siteRoot, "app/docs/docs.generated.ts");

if (import.meta.main) {
  const next = generatedModule(await renderDocsPages(repositoryRoot), await docsSourceDigests(repositoryRoot));
  if (process.argv.includes("--check")) {
    const current = await Bun.file(target).text().catch(() => "");
    if (current !== next) {
      console.error("app/docs/docs.generated.ts is out of date. Run `bun run sync:docs` in site/.");
      process.exit(1);
    }
  } else {
    await Bun.write(target, next);
  }
}
