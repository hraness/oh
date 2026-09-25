import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import Specification from "../app/spec/page";
import citationRecord from "../public/examples/evidence-table-2.json";
import publishedRelease from "../published-release.json";
import RootLayout from "../app/layout";
import rerankResult from "../../benchmarks/results/memory-clonemem-rerank-confirm-v1.json";
import sdkResult from "../../benchmarks/results/memory-sdk-retrieval-qualification-v1.json";
import pilotResult from "../../benchmarks/results/memory-framework-pilot-v1.json";

test("ties the matched chart to evidence and keeps vendor protocols separate", () => {
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>);
  const values: string[] = [];
  let copy = "";
  new HTMLRewriter()
    .on("#benchmarks .hraness-design-chart-row__value", { text(chunk) { if (chunk.text) values.push(chunk.text); } })
    .on("#benchmarks", { text(chunk) { copy += chunk.text; } })
    .transform(html);
  const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
  const pilotRate = (arm: string) => percent(pilotResult.quality.arms.find(row => row.arm === arm)?.conservativeSuccessRate.value ?? Number.NaN);
  expect(values).toEqual([pilotRate("oh"), pilotRate("supermemory"), pilotRate("bm25"), percent(sdkResult.primary.reader.pairedQuestions.candidate), percent(sdkResult.primary.reader.pairedQuestions.baseline), percent(rerankResult.pooledReader.candidate), percent(rerankResult.pooledReader.baseline)]);
  for (const qualification of ["60 previously exposed LongMemEval-S questions", "one attempt per cell", "unpinned alias", "one document per session", "not an unseen population", "No system is claimed state of the art", "does not establish superiority over either framework", "146 questions", "two previously exposed personas", "excludes semantic inference", "handled Metal startup diagnostic", "fresh reader responses", "861 questions", "prior project exposure", "immutable snapshot", "retry rule added during execution", "not every SDK integration", "not a matched ranking against Oh", "no established answer improvement"]) {
    expect(copy.replace(/\s+/gu, " ")).toContain(qualification);
  }
  expect(html).toContain("https://www.letta.com/blog/benchmarking-ai-agent-memory/");
  expect(html).toContain("https://supermemory.ai/research/longmembench/");
  expect(html).toContain("FRAMEWORK_PILOT_RESULT_V1.md");
  expect(html).toContain("memory-framework-pilot-v1.json");
  expect(html).toContain("FRAMEWORK_PILOT_EVIDENCE_V1.md");
  expect(html).toContain("CLONEMEM_RERANK_CONFIRM_RESULT_V1.md");
  expect(html).toContain("memory-clonemem-rerank-confirm-v1.json");
  expect(html).toContain("SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md");
  expect(html).toContain("memory-sdk-retrieval-qualification-v1.json");
  expect(html.indexOf('id="benchmarks"')).toBeGreaterThan(html.indexOf('id="interfaces"'));
  expect(html.indexOf('id="benchmarks"')).toBeLessThan(html.indexOf('id="kernel"'));
  expect(html).toContain("Markdown files stay authoritative");
  expect(html).toContain("does not automatically inherit");
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

test("skip links transfer keyboard focus to each page's main landmark", () => {
  for (const [Page, id] of [[Home, "main"], [Specification, "spec-main"]] as const) {
    const html = renderToStaticMarkup(<RootLayout><Page /></RootLayout>);
    const targets: string[] = [];
    new HTMLRewriter().on(`main#${id}`, {
      element(element) { targets.push(element.getAttribute("tabindex") ?? ""); },
    }).transform(html);
    expect(html).toContain(`href="#${id}"`);
    expect(targets).toEqual(["-1"]);
  }
});

test("makes the illustrative citation readable while keeping historical output available", () => {
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>);
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
  expect(examples).toEqual(["Open-source memory for agents"]);
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
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>);
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

  const specification = renderToStaticMarkup(<RootLayout><Specification /></RootLayout>);
  expect(specification).not.toContain("data-hraness-marketing-preset");
  expect(specification).toContain("spec-header");
  expect(specification).toContain("spec-document");
  expect(specification).not.toContain("data-hraness-material");
  expect(specification).not.toContain("hraness-material-");
});

test("confines Lantern to the homepage chrome, hero wall, citation plane and real disclosure", () => {
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>), hooks: string[] = [];
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
    const html = renderToStaticMarkup(<RootLayout><Page /></RootLayout>);
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
