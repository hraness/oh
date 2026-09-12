import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import Specification from "../app/spec/page";
import citationRecord from "../public/examples/evidence-table-2.json";
import publishedRelease from "../published-release.json";

test("makes the illustrative citation readable while keeping historical output available", () => {
  const html = renderToStaticMarkup(<Home />);
  const hero = /data-hraness-marketing="hero"[\s\S]*?<\/header>/u.exec(html)?.[0] ?? "";
  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(hero).toContain("What backs the 12-week endpoint?");
  const examples: string[] = [];
  new HTMLRewriter()
    .on('[data-hraness-marketing="hero"] p.hraness-marketing-hero__example', {
      element() { examples.push(""); },
      text(chunk) { examples[examples.length - 1] += chunk.text; },
    })
    .transform(html);
  expect(examples).toEqual(["Open-source tools for agentic research"]);
  expect(hero).not.toContain("Ask your agent to file the trial report");
  expect(hero).toContain(citationRecord.value.locator);
  expect(hero).toContain(citationRecord.value.relationship);
  for (const key of citationRecord.dependencies) expect(hero).toContain(key);
  expect(hero).not.toContain("recordsSha256");
  expect(html).toContain("An illustrative review, not evidence from a real study");
  expect(html).toContain('href="#trace"');
  expect(html).toContain('<details class="first-run-details">');
  expect(html).toContain("This historical capture predates the current install version above");
  expect(html).toContain("source CLI 0.4.0");
  expect(html).toContain("captured September 5, 2026");
  expect(html).toContain("recordsSha256");
  expect(html).not.toMatch(/<details class="first-run-details"[^>]*\bopen/u);
});

test("scopes the editorial preset to the homepage and keeps the citation in its field", () => {
  const html = renderToStaticMarkup(<Home />);
  const elements: string[] = [];
  new HTMLRewriter()
    .on('[data-hraness-marketing-preset="editorial"] .hraness-marketing-header', {
      element() { elements.push("header"); },
    })
    .on('[data-hraness-marketing-preset="editorial"] #main .hraness-marketing-field .citation-preview', {
      element() { elements.push("citation"); },
    })
    .transform(html);
  expect(elements).toEqual(["header", "citation"]);
  expect(html).toContain(`<p class="install-note">Current release · v${publishedRelease.version}</p>`);

  const specification = renderToStaticMarkup(<Specification />);
  expect(specification).not.toContain("data-hraness-marketing-preset");
  expect(specification).toContain("spec-header");
  expect(specification).toContain("spec-document");
});
