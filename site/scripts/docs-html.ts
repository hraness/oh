import { highlightCode } from "@hraness/design-kit/syntax-highlighting";

import { docsPages, type DocsPageEntry } from "../app/docs/catalog";

export const REPOSITORY_URL = "https://github.com/hraness/oh";
export const REPOSITORY_BLOB_ROOT = `${REPOSITORY_URL}/blob/main/`;

export interface DocsTocItem {
  readonly href: `#${string}`;
  readonly label: string;
}

export interface RenderedDocsPage {
  readonly html: string;
  readonly toc: readonly DocsTocItem[];
}

const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** GitHub's heading fragment: lower case, punctuation removed, each space a hyphen. */
export function headingFragment(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Mark}\p{Number}\s_-]/gu, "")
    .replace(/\s/gu, "-");
}

export function textContent(html: string): string {
  let text = html;
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/<[^>]*>/gu, "");
  }
  return decodeEntities(text);
}

/** One `##` section of a Markdown file, from its heading to the next `##` or the end. */
export function markdownSection(source: string, heading: string): string {
  const lines = source.split("\n");
  let fenced = false;
  const starts: number[] = [];
  const headings: number[] = [];
  lines.forEach((line, index) => {
    if (/^(```|~~~)/u.test(line)) fenced = !fenced;
    if (fenced) return;
    if (/^## /u.test(line)) headings.push(index);
    if (line === `## ${heading}`) starts.push(index);
  });
  if (starts.length !== 1) {
    throw new Error(`Expected exactly one "## ${heading}" heading, found ${starts.length}.`);
  }
  const start = starts[0]!;
  const end = headings.find((index) => index > start) ?? lines.length;
  return lines.slice(start, end).join("\n").trim();
}

/** Resolves a repository-relative target against the directory of the file that links it. */
export function resolveRepositoryPath(base: string, target: string): string {
  const resolved: string[] = [];
  for (const part of `${base}/${target}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolved.pop() === undefined) throw new Error(`Link escapes the repository: ${JSON.stringify(target)}`);
      continue;
    }
    resolved.push(part);
  }
  return resolved.join("/");
}

/** The site path for a repository file that has its own documentation page, if any. */
function sitePathFor(repositoryPath: string): string | null {
  for (const page of docsPages as readonly DocsPageEntry[]) {
    if (page.sections === undefined && page.source === repositoryPath) return page.path;
  }
  return null;
}

interface LinkContext {
  /** Directory of the source file inside the repository: "" for the root. */
  readonly base: string;
  /** Fragments of README headings that this page does not render. */
  readonly readmeOnlyFragments: ReadonlySet<string>;
}

function rewriteHref(target: string, context: LinkContext): string {
  const decoded = decodeEntities(target).trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(decoded)?.[1]?.toLowerCase();
  if (decoded.startsWith("//")) throw new Error(`Protocol-relative link: ${JSON.stringify(decoded)}`);
  if (scheme !== undefined) {
    if (!EXTERNAL_SCHEMES.has(scheme)) throw new Error(`Disallowed link scheme: ${JSON.stringify(decoded)}`);
    return decoded;
  }
  if (decoded.startsWith("#")) {
    const fragment = decoded.slice(1);
    return context.readmeOnlyFragments.has(fragment) ? `${REPOSITORY_URL}#${fragment}` : decoded;
  }
  if (decoded.startsWith("/")) throw new Error(`Root-relative link in repository Markdown: ${JSON.stringify(decoded)}`);
  const hash = decoded.indexOf("#");
  const path = resolveRepositoryPath(context.base, hash === -1 ? decoded : decoded.slice(0, hash));
  const fragment = hash === -1 ? "" : decoded.slice(hash);
  if (path === "README.md") {
    const id = fragment.slice(1);
    return id !== "" && !context.readmeOnlyFragments.has(id) ? `/docs${fragment}` : `${REPOSITORY_URL}${fragment}`;
  }
  const page = sitePathFor(path);
  if (page !== null) return `${page}${fragment}`;
  return `${REPOSITORY_BLOB_ROOT}${path}${fragment}`;
}

function highlightBlocks(html: string): string {
  return html.replace(
    /<pre><code(?:\s+class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/gu,
    (_, language: string | undefined, body: string) => {
      const highlighted = highlightCode(decodeEntities(body).replace(/\n$/u, ""), language, { styles: "classes" });
      return `<pre tabindex="0"><code class="${highlighted.className}" data-language="${highlighted.language}">${highlighted.html}</code></pre>`;
    },
  );
}

/** Renders repository Markdown for a documentation page with stable fragments and site links. */
export function renderDocsMarkdown(source: string, context: LinkContext, aliases: ReadonlyMap<string, string> = new Map()): RenderedDocsPage {
  const raw = Bun.markdown.html(source, { noHtmlBlocks: true, noHtmlSpans: true, tagFilter: true });
  const seen = new Map<string, number>();
  const toc: DocsTocItem[] = [];
  const withIds = raw.replace(/<h([2-6])>([\s\S]*?)<\/h\1>/gu, (_, level: string, body: string) => {
    const text = textContent(body);
    const base = headingFragment(text);
    if (base === "") throw new Error(`Heading without a fragment: ${JSON.stringify(text)}`);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    if (level === "2") toc.push({ href: `#${id}`, label: text });
    const alias = level === "2" ? aliases.get(text) : undefined;
    const anchor = alias === undefined ? "" : `<span class="docs-anchor" id="${alias}"></span>`;
    return `${anchor}<h${level} id="${id}">${body}</h${level}>`;
  });
  if (/<script|<iframe|<style|\son[a-z]+=/iu.test(withIds)) throw new Error("Documentation Markdown produced active HTML.");
  const linked = withIds.replace(/\shref="([^"]*)"/gu, (_, target: string) => ` href="${escapeAttribute(rewriteHref(target, context))}"`);
  if (/\ssrc="/u.test(linked)) throw new Error("Documentation pages do not embed images; link to them instead.");
  const ids = new Set([...linked.matchAll(/\sid="([^"]+)"/gu)].map(([, id]) => id));
  for (const [, fragment] of linked.matchAll(/\shref="#([^"]+)"/gu)) {
    if (!ids.has(decodeURIComponent(fragment ?? ""))) throw new Error(`In-page link has no target: #${fragment}`);
  }
  const html = highlightBlocks(linked)
    .replace(/<table>/gu, "<figure class=\"docs-table\"><table>")
    .replace(/<\/table>/gu, "</table></figure>");
  return { html: html.trim(), toc };
}

/** Every page in the catalog, rendered from the current repository files. */
export async function renderDocsPages(repositoryRoot: string): Promise<Readonly<Record<string, RenderedDocsPage>>> {
  const readme = await Bun.file(`${repositoryRoot}/README.md`).text();
  const readmeFragments = new Set<string>();
  for (const [, heading] of readme.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gmu)) readmeFragments.add(headingFragment(heading ?? ""));
  const rendered: Record<string, RenderedDocsPage> = {};
  for (const page of docsPages as readonly DocsPageEntry[]) {
    if (page.sections !== undefined) {
      const markdown = page.sections.map(({ heading }) => markdownSection(readme, heading)).join("\n\n");
      const included = new Set<string>();
      for (const [, heading] of markdown.matchAll(/^#{2,6}\s+(.+?)\s*#*$/gmu)) included.add(headingFragment(heading ?? ""));
      const readmeOnlyFragments = new Set([...readmeFragments].filter((fragment) => !included.has(fragment)));
      const aliases = new Map(page.sections.flatMap(({ alias, heading }) => (alias === undefined ? [] : [[heading, alias] as const])));
      rendered[page.path] = renderDocsMarkdown(markdown, { base: "", readmeOnlyFragments }, aliases);
    } else {
      const source = await Bun.file(`${repositoryRoot}/${page.source}`).text();
      const lines = source.split("\n");
      if (lines[0] !== `# ${page.heading}`) throw new Error(`${page.source} must start with "# ${page.heading}".`);
      const base = page.source.includes("/") ? page.source.slice(0, page.source.lastIndexOf("/")) : "";
      rendered[page.path] = renderDocsMarkdown(lines.slice(1).join("\n").trim(), { base, readmeOnlyFragments: new Set() });
    }
  }
  return rendered;
}

/**
 * SHA-256 of each file rendered whole, so the repository check, which runs
 * without site dependencies, can spot a stale page. Site CI already runs the
 * full comparison when README.md changes.
 */
export async function docsSourceDigests(repositoryRoot: string): Promise<Readonly<Record<string, string>>> {
  const digests: Record<string, string> = {};
  for (const page of docsPages as readonly DocsPageEntry[]) {
    if (page.sections !== undefined) continue;
    const source = page.source;
    const bytes = await Bun.file(`${repositoryRoot}/${source}`).bytes();
    digests[source] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  }
  return digests;
}

export function generatedModule(
  pages: Readonly<Record<string, RenderedDocsPage>>,
  digests: Readonly<Record<string, string>>,
): string {
  return [
    "// Generated from ../README.md and ../docs/sdk.md by scripts/sync-docs.ts. Do not edit.",
    "// Run `bun run sync:docs` after changing either file.",
    "export const docsSourceSha256 = " + JSON.stringify(digests, null, 2) + " as const;",
    "",
    "export const docsHtml = " + JSON.stringify(pages, null, 2) + " as const;",
    "",
  ].join("\n");
}
