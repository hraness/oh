import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import Specification from "../app/spec/page";
import citationRecord from "../public/examples/evidence-table-2.json";
import publishedRelease from "../published-release.json";
import RootLayout from "../app/layout";
import recallResult from "../../benchmarks/results/memory-locomo-window-confirmation-v1.json";
import answerResult from "../../benchmarks/results/memory-locomo-window-qa-v1.json";

test("publishes both measured benchmark outcomes with their scope and source evidence", () => {
  const html = renderToStaticMarkup(<Home />);
  const tables: string[][] = [];
  const links: string[] = [];
  let copy = "";
  new HTMLRewriter()
    .on("#benchmarks table", { element() { tables.push([]); } })
    .on("#benchmarks td", { text(chunk) { if (chunk.text) tables.at(-1)?.push(chunk.text); } })
    .on("#benchmarks a", { element(element) { links.push(element.getAttribute("href") ?? ""); } })
    .on("#benchmarks", { text(chunk) { copy += chunk.text; } })
    .transform(html);
  const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
  expect(tables).toEqual([
    [percent(recallResult.summaries["anchors-query-4"].turnRecall), percent(recallResult.summaries["vector-window"].turnRecall)],
    ["anchors-query-4", "vector-window"].map((arm) => percent(answerResult.scores.reader.arms.find((row) => row.armId === arm)!.accuracy)),
  ]);
  expect(answerResult.scores.claims.modelJudgedQaImprovement).toBe(false);
  for (const qualification of ["Agent-run benchmark", "1,224 annotated questions", "1,586 confirmation questions", "300 questions", "three reader attempts", "identical judge prompts shared one judgment", "immutable snapshot", "prior project exposure", "No established answer improvement", "multiple-choice accuracy gain", "CloneMem keyword-query test", "improved development recall but did not pass its answer-quality gate", "Defaults remain unchanged"]) {
    expect(copy.replace(/\s+/gu, " ")).toContain(qualification);
  }
  expect(links).toEqual([
    "https://github.com/hraness/oh/blob/main/benchmarks/LOCOMO_WINDOW_QA_V1.md",
    "https://github.com/hraness/oh/blob/main/benchmarks/results/memory-locomo-window-confirmation-v1.json",
    "https://github.com/hraness/oh/blob/main/benchmarks/results/memory-locomo-window-qa-v1.json",
    "https://github.com/hraness/oh/blob/main/benchmarks/CLONEMEM_TRANSFER_V1.md",
    "https://github.com/hraness/oh/blob/main/benchmarks/CLONEMEM_KEYWORD_DEV_RESULT_V1.md",
  ]);
  expect(html.indexOf('id="benchmarks"')).toBeGreaterThan(html.indexOf('id="interfaces"'));
  expect(html.indexOf('id="benchmarks"')).toBeLessThan(html.indexOf('id="kernel"'));
});

test("both public pages render the in-flow content footer above the shared footer", () => {
  for (const page of [<Home key="home" />, <Specification key="spec" />]) {
    const html = renderToStaticMarkup(<RootLayout>{page}</RootLayout>);
    expect(html.match(/<footer\b/gu)).toHaveLength(2);
    const contentFooter = html.indexOf('data-hraness-marketing="footer"');
    const networkFooter = html.indexOf('data-slot="hraness-site-footer"');
    expect(contentFooter).toBeGreaterThan(-1);
    expect(networkFooter).toBeGreaterThan(contentFooter);
    expect(html).toContain("hraness-marketing-footer__brand");
    expect(html).toContain('class="brand-mark"');
    expect(html).toContain("Oh is open source for researchers and the agents working beside them.");
    expect(html).toContain('id="hraness-site-footer"');
    expect(html).toContain("https://account.hraness.com/support?product=oh-computer&amp;source=web#support");
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("action=updates");
  }
});

test("both public pages attribute the site to Hraness through the shared footer only", () => {
  for (const page of [<Home key="home" />, <Specification key="spec" />]) {
    const html = renderToStaticMarkup(<RootLayout>{page}</RootLayout>);
    expect(html.match(/aria-label="Hraness home"/gu)).toHaveLength(1);
    expect(html).toContain(">by Hraness</span>");
    expect(html).not.toContain("Ben Guo");
    expect(html).not.toContain("hraness-marketing-maker");
    expect(html).not.toContain('id="maker"');
  }
});

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
  expect(html).toContain('<details class="first-run-details hraness-material-disclosure">');
  expect(html).toContain("This historical capture predates the current install version above");
  expect(html).toContain("source CLI 0.4.0");
  expect(html).toContain("captured September 5, 2026");
  expect(html).toContain("recordsSha256");
  expect(html).not.toMatch(/<details class="first-run-details hraness-material-disclosure"[^>]*\bopen/u);
});

test("scopes the editorial preset to the homepage and keeps the citation in its field", () => {
  const html = renderToStaticMarkup(<Home />);
  const elements: string[] = [];
  new HTMLRewriter()
    .on('[data-hraness-marketing-preset="editorial"] .hraness-marketing-header', {
      element() { elements.push("header"); },
    })
    .on('[data-hraness-marketing-preset="editorial"] #main .hraness-material-wall .citation-preview', {
      element() { elements.push("citation"); },
    })
    .transform(html);
  expect(elements).toEqual(["header", "citation"]);
  expect(html).toContain(`<p class="install-note">Current release · v${publishedRelease.version}</p>`);

  const specification = renderToStaticMarkup(<Specification />);
  expect(specification).not.toContain("data-hraness-marketing-preset");
  expect(specification).toContain("spec-header");
  expect(specification).toContain("spec-document");
  expect(specification).not.toContain("data-hraness-material");
  expect(specification).not.toContain("hraness-material-");
});

test("confines Lantern to the homepage chrome, hero wall, citation plane and real disclosure", () => {
  const html = renderToStaticMarkup(<Home />), hooks: string[] = [];
  new HTMLRewriter()
    .on('[data-hraness-material="lantern"]', { element() { hooks.push("island"); } })
    .on('header.hraness-material-chrome', { element() { hooks.push("chrome"); } })
    .on('#main .hraness-material-wall:not(.hraness-marketing-field)', { element() { hooks.push("hero"); } })
    .on('.hraness-material-pane .citation-preview', { element() { hooks.push("citation"); } })
    .on('details.hraness-material-disclosure:not([open])', { element() { hooks.push("disclosure"); } })
    .transform(html);
  expect(hooks).toEqual(["island", "chrome", "hero", "citation", "disclosure"]);
  expect(html).not.toContain('data-selected');
  expect(html).not.toContain('hraness-marketing-field');
});


test("the header keeps a named home link and exact-artwork foil fallback", () => {
  for (const Page of [Home, Specification]) {
    const html = renderToStaticMarkup(<Page />);
    const homeLinks: string[] = [];
    const marks: string[] = [];
    const fallbackImages: string[] = [];
    const masks: string[] = [];
    new HTMLRewriter()
      .on('header a[aria-label="Oh home"]', {
        element(element) {
          homeLinks.push(element.getAttribute("href") ?? "");
          expect(element.hasAttribute("data-foil")).toBe(true);
        },
      })
      .on('header a[aria-label="Oh home"] .hraness-foil-mark', {
        element(element) { marks.push(element.getAttribute("aria-hidden") ?? ""); },
      })
      .on('header a[aria-label="Oh home"] .hraness-foil-mark img', {
        element(element) {
          fallbackImages.push(element.getAttribute("src") ?? "");
          expect(element.hasAttribute("alt")).toBe(true);
          expect(element.getAttribute("alt") ?? "").toBe("");
        },
      })
      .on('header a[aria-label="Oh home"] .hraness-foil-mark__paint', {
        element(element) { masks.push((element.getAttribute("style") ?? "").replaceAll("&quot;", '"')); },
      })
      .transform(html);
    expect(homeLinks).toEqual(["/"]);
    expect(marks).toEqual(["true"]);
    expect(fallbackImages).toEqual(["/marks/oh-computer.svg"]);
    expect(masks).toEqual(['--hraness-foil-mask:url("/marks/oh-computer.svg")']);
  }
});
