import { describe, expect, test } from "bun:test";

import { type Sha256Hex } from "./canonical";
import { createKnowledgeGraphRecordV1 } from "./graph";
import {
  createOhMemoryPageRecordV1,
  createOhMemoryPageValueV1,
  OH_MEMORY_PAGE_FORMAT_V1,
  OH_MEMORY_PAGE_LIMITS_V1,
  OH_MEMORY_PAGE_RECORD_CODEC_V1,
  parseOhMemoryPageMarkdownV1,
  parseOhMemoryPageRecordV1,
  parseOhMemoryPageValueV1,
  renderOhMemoryPageMarkdownV1,
  type OhMemoryPageSourceV1,
  type OhMemoryPageValueV1,
} from "./memory-pages";

const digestA = "a".repeat(64) as Sha256Hex;
const digestB = "b".repeat(64) as Sha256Hex;

function source(url = "https://example.com/a", overrides: Partial<OhMemoryPageSourceV1> = {}): OhMemoryPageSourceV1 {
  return {
    contentSha256: digestA,
    observedAt: "2026-08-30T10:00:00.000Z",
    title: "Primary source",
    url,
    v: 1,
    ...overrides,
  };
}

function page(overrides: Partial<OhMemoryPageValueV1> = {}): OhMemoryPageValueV1 {
  return {
    body: "A durable note with **Markdown**.",
    createdAt: "2026-08-30T10:30:00.000Z",
    format: OH_MEMORY_PAGE_FORMAT_V1,
    language: "en",
    provenance: {
      actorId: "host.memory",
      attestationSha256: digestB,
      attestedAt: "2026-08-30T12:00:00.000Z",
      kind: "host-attested",
      v: 1,
    },
    sources: [source()],
    summary: "The compact statement used for inspection and recall.",
    title: "Memory page",
    updatedAt: "2026-08-30T11:00:00.000Z",
    v: 1,
    ...overrides,
  };
}

function pageRecord(value = page(), dependencies: readonly string[] = ["activity:page-attestation"])
  : ReturnType<typeof createOhMemoryPageRecordV1> {
  return createOhMemoryPageRecordV1({ dependencies, key: "edition:memory-page", value });
}

describe("Oh memory page value and edition codec", () => {
  test("creates and parses a model-neutral edition record", () => {
    const value = createOhMemoryPageValueV1(page());
    expect(parseOhMemoryPageValueV1(value)).toEqual(value);
    expect(OH_MEMORY_PAGE_RECORD_CODEC_V1.parse(value)).toEqual(value);

    const record = createOhMemoryPageRecordV1({
      dependencies: ["activity:page-attestation"],
      key: "edition:memory-page",
      value,
    });
    expect(record.kind).toBe("edition");
    expect(parseOhMemoryPageRecordV1(record)).toEqual(record);
    expect(parseOhMemoryPageRecordV1({ ...record, recordSha256: digestA })).toBeNull();
    expect(parseOhMemoryPageRecordV1(createKnowledgeGraphRecordV1({
      dependencies: [], key: "entity:not-a-page", kind: "entity", v: 1, value: { name: "not a page" },
    }))).toBeNull();
  });

  test("requires exact fields, host provenance, canonical chronology, and no provider metadata", () => {
    const valid = page();
    const second = source("https://example.com/b", { contentSha256: digestB });
    const hidden = { ...valid } as Record<PropertyKey, unknown>;
    Object.defineProperty(hidden, "hidden", { value: true });
    const symbolic = { ...valid } as Record<PropertyKey, unknown>;
    symbolic[Symbol("hidden")] = true;
    let accessorReads = 0;
    const accessor = { ...valid } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessor, "title", {
      enumerable: true,
      get() { accessorReads += 1; return "must not execute"; },
    });
    const sourceAccessor = { ...source() } as Record<PropertyKey, unknown>;
    Object.defineProperty(sourceAccessor, "title", {
      enumerable: true,
      get() { accessorReads += 1; return "must not execute"; },
    });
    const sourcesWithHiddenProperty = [source()] as unknown[] & Record<string, unknown>;
    Object.defineProperty(sourcesWithHiddenProperty, "hidden", { value: true });
    const invalid: unknown[] = [
      hidden,
      symbolic,
      accessor,
      { ...valid, provider: "hosted-embedding-provider" },
      { ...valid, vector: [0, 1] },
      { ...valid, title: "Cafe\u0301" },
      { ...valid, title: "line one\nline two" },
      { ...valid, title: "line one\u2028line two" },
      { ...valid, title: "line one\u2029line two" },
      { ...valid, summary: "" },
      { ...valid, body: "" },
      { ...valid, language: "EN-us" },
      { ...valid, language: "en_US" },
      { ...valid, createdAt: "2026-08-30T10:30:00Z" },
      { ...valid, createdAt: "2026-08-30T11:30:00.000Z" },
      { ...valid, provenance: { ...valid.provenance, attestedAt: "2026-08-30T10:59:59.999Z" } },
      { ...valid, provenance: { ...valid.provenance, actorId: "model selected actor" } },
      { ...valid, provenance: { ...valid.provenance, receipt: digestA } },
      { ...valid, sources: [second, source()] },
      { ...valid, sources: [source(), source()] },
      { ...valid, sources: [source("https://user:secret@example.com/a")] },
      { ...valid, sources: [source("https://example.com")] },
      { ...valid, sources: [source("https://example.com/%")] },
      { ...valid, sources: [source("https://example.com/%zz")] },
      { ...valid, sources: [source("https://example.com/%7E")] },
      { ...valid, sources: [source("https://example.com/%7e")] },
      { ...valid, sources: [source("https://example.com/a", { title: "line\u2028break" })] },
      { ...valid, sources: [source("https://example.com/a", { observedAt: "2026-08-30T11:00:00.001Z" })] },
      { ...valid, sources: [{ ...source(), extra: true }] },
      { ...valid, sources: [sourceAccessor] },
      { ...valid, sources: sourcesWithHiddenProperty },
    ];
    invalid.forEach((candidate) => expect(parseOhMemoryPageValueV1(candidate)).toBeNull());
    expect(accessorReads).toBe(0);
    expect(parseOhMemoryPageValueV1({ ...valid, sources: [source(), second] })).not.toBeNull();
    expect(parseOhMemoryPageValueV1({ ...valid, language: null })).not.toBeNull();
  });

  test("measures NFC text limits in UTF-8 bytes", () => {
    const twoByte = "é";
    expect(parseOhMemoryPageValueV1(page({
      title: twoByte.repeat(OH_MEMORY_PAGE_LIMITS_V1.titleBytes / 2),
    }))).not.toBeNull();
    expect(parseOhMemoryPageValueV1(page({
      title: twoByte.repeat(OH_MEMORY_PAGE_LIMITS_V1.titleBytes / 2 + 1),
    }))).toBeNull();
    expect(parseOhMemoryPageValueV1(page({
      body: twoByte.repeat(OH_MEMORY_PAGE_LIMITS_V1.bodyBytes / 2),
    }))).not.toBeNull();
    expect(parseOhMemoryPageValueV1(page({
      body: twoByte.repeat(OH_MEMORY_PAGE_LIMITS_V1.bodyBytes / 2 + 1),
    }))).toBeNull();
    const maximumLanguage = `en-${"aaaaaaaa-".repeat(27)}aaaaaaaa`;
    expect(Buffer.byteLength(maximumLanguage)).toBeLessThanOrEqual(
      OH_MEMORY_PAGE_LIMITS_V1.languageBytes,
    );
    expect(parseOhMemoryPageValueV1(page({ language: maximumLanguage }))).not.toBeNull();
    expect(parseOhMemoryPageValueV1(page({ language: `${maximumLanguage}-aaaaaaaa` }))).toBeNull();
  });

  test("rejects oversized or noncanonical source collections before record creation", () => {
    const sources = Array.from({ length: OH_MEMORY_PAGE_LIMITS_V1.sources + 1 }, (_, index) =>
      source(`https://example.com/${index.toString().padStart(3, "0")}`));
    expect(parseOhMemoryPageValueV1(page({ sources }))).toBeNull();
    expect(() => createOhMemoryPageValueV1(page({ sources }))).toThrow("Invalid Oh memory page value");
    expect(() => createOhMemoryPageRecordV1({
      dependencies: [], key: "edition:bad", value: page({ sources }),
    })).toThrow("Invalid Oh memory page value");
  });
});

describe("canonical .oh.md interchange", () => {
  test("round-trips Unicode, JSON scalar escapes, sources, and Markdown delimiters", () => {
    const value = page({
      body: "First paragraph.\n\n---\n\n# A heading with 🧽\n",
      language: null,
      sources: [
        source("https://example.com/a?x=1#part"),
        source("https://example.com/b", { contentSha256: digestB, title: 'A "quoted" source' }),
      ],
      summary: "Line one\nLine two\u2028Line three",
      title: "Café memory",
    });
    const record = pageRecord(value, ["activity:page-attestation", "entity:source-owner"]);
    const rendered = renderOhMemoryPageMarkdownV1(record);
    expect(rendered.startsWith('---\nformat: "oh.memory-page.v1"\nrecord-v: 1\nrecord-kind: "edition"\n'))
      .toBe(true);
    expect(rendered).toContain('dependency-count: 2\ndependency-0000-key: "activity:page-attestation"');
    expect(rendered).toContain('summary: "Line one\\nLine two\\u2028Line three"');
    expect(rendered).toContain("source-001-content-sha256:");
    expect(rendered.endsWith(value.body)).toBe(true);
    expect(parseOhMemoryPageMarkdownV1(rendered)).toEqual(record);
    expect(renderOhMemoryPageMarkdownV1(parseOhMemoryPageMarkdownV1(rendered) as typeof record)).toBe(rendered);
  });

  test("rejects YAML features and alternate spellings outside the exact scalar subset", () => {
    const record = pageRecord(page(), ["activity:page-attestation", "entity:source-owner"]);
    const rendered = renderOhMemoryPageMarkdownV1(record);
    const hostile = [
      rendered.replaceAll("\n", "\r\n"),
      rendered.replace("record-v: 1", "record-v: 01"),
      rendered.replace('title: "Memory page"', "title: Memory page"),
      rendered.replace('title: "Memory page"', 'title: &title "Memory page"'),
      rendered.replace('title: "Memory page"', 'title: "\\u004demory page"'),
      rendered.replace('title: "Memory page"', 'title: "Memory page" # comment'),
      rendered.replace("summary:", 'title: "duplicate"\nsummary:'),
      rendered.replace("summary:", 'provider: "external"\nsummary:'),
      rendered.replace("source-count: 1", "source-count: 0"),
      rendered.replace("source-count: 1", `source-count: ${OH_MEMORY_PAGE_LIMITS_V1.sources + 1}`),
      rendered.replace("dependency-count: 2", "dependency-count: 1"),
      rendered.replace('dependency-0000-key: "activity:page-attestation"',
        'dependency-0000-key: "entity:source-owner"'),
      rendered.replace('record-key: "edition:memory-page"', 'record-key: "edition:other-page"'),
      rendered.replace(`record-sha256: "${record.recordSha256}"`, `record-sha256: "${digestA}"`),
      rendered.replace("A durable note", "Tampered note"),
      rendered.replace('title: "Memory page"\nsummary:', "summary:").replace(
        'summary: "The compact statement used for inspection and recall."',
        'summary: "The compact statement used for inspection and recall."\ntitle: "Memory page"'),
      rendered.slice(4),
      rendered.replace("\n---\nA durable", "\n...\nA durable"),
    ];
    hostile.forEach((candidate) => expect(parseOhMemoryPageMarkdownV1(candidate)).toBeNull());
  });

  test("rejects hostile scalar types, truncated metadata, and bounded-file attacks", () => {
    const rendered = renderOhMemoryPageMarkdownV1(pageRecord());
    expect(parseOhMemoryPageMarkdownV1(rendered.replace('language: "en"', "language: [en]"))).toBeNull();
    expect(parseOhMemoryPageMarkdownV1(rendered.replace('language: "en"', "language: true"))).toBeNull();
    expect(parseOhMemoryPageMarkdownV1(rendered.replace("source-count: 1", "source-count: 1.5"))).toBeNull();
    expect(parseOhMemoryPageMarkdownV1(rendered.replace("source-000-title:", "source-001-title:"))).toBeNull();
    expect(parseOhMemoryPageMarkdownV1(`---\nformat: "${OH_MEMORY_PAGE_FORMAT_V1}"\n---\nbody`)).toBeNull();
    const tooManyLines = `---\n${"x: 0\n".repeat(
      OH_MEMORY_PAGE_LIMITS_V1.frontmatterLines + 1,
    )}---\nbody`;
    expect(parseOhMemoryPageMarkdownV1(tooManyLines)).toBeNull();
    expect(parseOhMemoryPageMarkdownV1("x".repeat(OH_MEMORY_PAGE_LIMITS_V1.fileBytes + 1))).toBeNull();
  });
});

test("the public schema mirror is byte-identical", async () => {
  const root = new URL("../spec/v1/memory-page.schema.json", import.meta.url);
  const mirror = new URL("../site/public/spec/v1/memory-page.schema.json", import.meta.url);
  expect(await Bun.file(root).text()).toBe(await Bun.file(mirror).text());
});
