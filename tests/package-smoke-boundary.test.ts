import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { wikidataSourceSha256V1, type WikidataInventorySourceV1 } from "../scripts/capture-wikidata-inventory";
import { auditWikidataCorpusContent, scanPackage } from "../scripts/package-smoke";

const corpusPath = "spec/research-v1/wikidata/2026-09-13/sources.jsonl.gz";
const corpusFile = resolve(import.meta.dir, "..", corpusPath);
const corpusBytes = readFile(corpusFile);

async function withPackage(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "oh-package-boundary-"));
  try {
    await Promise.all([
      ...["dist", "skills", "spec", "src"].map((name) => mkdir(join(root, name))),
      ...["LICENSE", "README.md", "package.json"].map((name) => writeFile(join(root, name), "{}\n")),
    ]);
    await mkdir(dirname(join(root, corpusPath)), { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function source(
  key: string, kind: WikidataInventorySourceV1["kind"], parameters: Record<string, string>, value: unknown,
): WikidataInventorySourceV1 {
  const url = new URL("https://www.wikidata.org/w/api.php");
  for (const [name, parameter] of Object.entries({ ...parameters, format: "json", maxlag: "5" })) {
    url.searchParams.set(name, parameter);
  }
  const body = JSON.stringify(value);
  return { key, kind, sourceUri: url.toString(), capturedAt: "2026-09-13T00:00:00.000Z", body,
    bodyBytes: Buffer.byteLength(body), bodySha256: wikidataSourceSha256V1(body) };
}

function syntheticSources(note = "public fixture"): WikidataInventorySourceV1[] {
  return [
    source("listing-000", "listing", { action: "query", list: "allpages", apnamespace: "120", aplimit: "500", apfilterredir: "nonredirects" },
      { query: { allpages: [{ pageid: 1, ns: 120, title: "Property:P31" }] } }),
    source("properties-000", "property-metadata", { action: "wbgetentities", ids: "P31", props: "datatype|info" },
      { entities: { P31: { id: "P31", type: "property", ns: 120, title: "Property:P31", datatype: "wikibase-item", lastrevid: 1 } } }),
    source("entity-Q5", "entity", { action: "wbgetentities", ids: "Q5" },
      { entities: { Q5: { id: "Q5", type: "item", lastrevid: 1, claims: {}, note } } }),
  ];
}

function jsonl(sources: readonly unknown[]): string {
  return `${sources.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

test("the package scan admits the reviewed corpus only after its decoded content audit", async () => {
  expect(auditWikidataCorpusContent(await corpusBytes)).toBe(10_342_838);
  await withPackage(async (root) => {
    await copyFile(corpusFile, join(root, corpusPath));
    await expect(scanPackage(root)).resolves.toBeUndefined();
  });
});

test("reviewed gzip bytes remain unreviewed at other paths or under different names", async () => {
  await withPackage(async (root) => {
    const otherPaths = [
      "spec/research-v1/wikidata/2026-09-14/sources.jsonl.gz",
      "spec/research-v1/wikidata/2026-09-13/copy.jsonl.gz",
      "src/sources.jsonl.gz",
    ];
    for (const path of otherPaths) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(corpusFile, join(root, path));
    }
    let failure: unknown;
    try { await scanPackage(root); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    for (const path of otherPaths) expect(String(failure)).toContain(`${path} has an unreviewed file extension`);
  });
});

test("a content audit never admits changed or arbitrary bytes at the reviewed path", async () => {
  const changed = Buffer.from(await corpusBytes);
  changed[4] = changed[4]! ^ 1; // A gzip timestamp change preserves decoded content.
  expect(auditWikidataCorpusContent(changed)).toBe(10_342_838);
  const arbitrary = gzipSync(jsonl(syntheticSources()));
  expect(auditWikidataCorpusContent(arbitrary)).toBeGreaterThan(0);
  await withPackage(async (root) => {
    for (const bytes of [changed, arbitrary, Buffer.from("invalid gzip")]) {
      await writeFile(join(root, corpusPath), bytes);
      await expect(scanPackage(root)).rejects.toThrow("does not match its reviewed SHA-256");
    }
  });
});

test("the archive exception retains symlink and per-file size rejection", async () => {
  await withPackage(async (root) => {
    const path = join(root, corpusPath);
    await symlink(corpusFile, path);
    await expect(scanPackage(root)).rejects.toThrow(`${corpusPath} is a symlink`);
    await rm(path);
    await writeFile(path, "");
    await expect(scanPackage(root)).rejects.toThrow("is not a bounded regular file");
    await truncate(path, 4 * 1_024 * 1_024 + 1);
    await expect(scanPackage(root)).rejects.toThrow(`${corpusPath} exceeds the per-file size bound`);
  });
});

test("compressed-content auditing rejects oversized expansion, invalid gzip, invalid UTF-8 and malformed JSONL", async () => {
  const oversized = gzipSync(Buffer.alloc(10_342_838 + 1, 65));
  expect(() => auditWikidataCorpusContent(oversized)).toThrow("expanded byte bound");
  expect(() => auditWikidataCorpusContent(Buffer.alloc(4 * 1_024 * 1_024 + 1))).toThrow("compressed byte bound");
  expect(() => auditWikidataCorpusContent(Buffer.from("invalid gzip"))).toThrow("invalid gzip");
  expect(() => auditWikidataCorpusContent(gzipSync(Buffer.from([0xc0, 0xaf, 10])))).toThrow();
  expect(() => auditWikidataCorpusContent(gzipSync("{}"))).toThrow("must end in a newline");
  expect(() => auditWikidataCorpusContent(gzipSync("{\n"))).toThrow();
  expect(() => auditWikidataCorpusContent(gzipSync("{}\n".repeat(513)))).toThrow("source count bound");
});

test("decoded corpus admission validates source envelope, body digest, and API provenance", () => {
  const sources = syntheticSources();
  expect(() => auditWikidataCorpusContent(gzipSync(jsonl([{ ...sources[0]!, extra: true }, ...sources.slice(1)]))))
    .toThrow("unexpected keys");
  expect(() => auditWikidataCorpusContent(gzipSync(jsonl([{ ...sources[0]!, body: sources[0]!.body + " " }, ...sources.slice(1)]))))
    .toThrow("source byte digest mismatch");
  expect(() => auditWikidataCorpusContent(gzipSync(jsonl([{ ...sources[0]!, sourceUri: "https://example.com/w/api.php" }, ...sources.slice(1)]))))
    .toThrow("invalid API source");
});

test.each([
  ["developer home path", ["", "Users", "fixture", "example"].join("/")],
  ["task-local temporary path", ["", "private", "tmp", "fixture"].join("/")],
  ["private key material", ["-----BEGIN", "PRIVATE KEY-----"].join(" ")],
  ["GitHub access token", "ghp_" + "a".repeat(24)],
  ["OpenAI-style secret", "sk-" + "a".repeat(24)],
  ["Slack access token", "xoxb-" + "a".repeat(16)],
])("existing forbidden-content rule rejects %s inside decoded JSONL", (label, marker) => {
  expect(() => auditWikidataCorpusContent(gzipSync(jsonl(syntheticSources(marker))))).toThrow(`contains ${label}`);
});

test("JSONL escaping cannot hide forbidden content in an original response body", () => {
  const marker = ["", "Users", "fixture", "example"].join("/");
  const escaped = jsonl(syntheticSources(marker)).replaceAll("/", "\\u002f");
  expect(escaped).not.toContain(marker);
  expect(() => auditWikidataCorpusContent(gzipSync(escaped))).toThrow("contains developer home path");
});

test("the archive exception preserves ordinary text scans and database artifact rejection", async () => {
  await withPackage(async (root) => {
    await copyFile(corpusFile, join(root, corpusPath));
    await writeFile(join(root, "README.md"), ["", "Users", "fixture", "example"].join("/"));
    await expect(scanPackage(root)).rejects.toThrow("README.md contains developer home path");
    await writeFile(join(root, "README.md"), "public fixture\n");
    await writeFile(join(root, "spec", "database.json"), "SQLite format 3\u0000");
    await expect(scanPackage(root)).rejects.toThrow("spec/database.json contains a database artifact");
  });
});
