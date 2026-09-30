// Writes the launch social kit to site/app/launch/social-kit.md. Run with `bun run launch:kit`.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { renderSocialKitMarkdown } from "../app/launch/social-kit-markdown";

const out = join(import.meta.dir, "../app/launch/social-kit.md");
await writeFile(out, renderSocialKitMarkdown());
console.log(`Wrote ${out}`);
