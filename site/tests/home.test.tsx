import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import Specification from "../app/spec/page";
import citationRecord from "../public/examples/evidence-table-2.json";
import publishedRelease from "../published-release.json";
import RootLayout from "../app/layout";
import longMemEval from "../../benchmarks/results/memory-longmemeval-s-500-v1.json";
import pilotResult from "../../benchmarks/results/memory-framework-pilot-v1.json";
import sdkResult from "../../benchmarks/results/memory-sdk-retrieval-qualification-v1.json";
import rerankResult from "../../benchmarks/results/memory-clonemem-rerank-confirm-v1.json";
import locomoAnswers from "../../benchmarks/results/memory-locomo-window-qa-v1.json";
import locomoRecall from "../../benchmarks/results/memory-locomo-window-confirmation-v1.json";
import { indexableArticles } from "../app/blog/articles";

test("leads the benchmarks with the LongMemEval-S result and ties every figure to its result file", () => {
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>);
  const values: string[] = [];
  let copy = "";
  new HTMLRewriter()
    .on("#benchmarks .hraness-design-chart-row__value", { text(chunk) { if (chunk.text) values.push(chunk.text); } })
    .on("#benchmarks", { text(chunk) { copy += chunk.text; } })
    .transform(html);
  const text = copy.replace(/\s+/gu, " ");
  const fixed = (value: number) => value.toFixed(2);
  const system = (id: string) => `${fixed(longMemEval.systems.find((entry) => entry.id === id)?.percent ?? Number.NaN)}%`;
  const pilotRate = (arm: string) => `${fixed((pilotResult.quality.arms.find((row) => row.arm === arm)?.conservativeSuccessRate.value ?? Number.NaN) * 100)}%`;
  const share = (value: number) => `${fixed(value * 100)}%`;
  const signed = (value: number) => `${value < 0 ? "\u2212" : "+"}${fixed(Math.abs(value))}`;
  expect(values).toEqual([
    system("oh-reading-pipeline"), system("oh-semantic-96k"), system("bm25-96k"),
    pilotRate("supermemory"), pilotRate("oh"), pilotRate("bm25"),
  ]);

  let heading = "";
  new HTMLRewriter().on("#benchmarks-title", { text(chunk) { heading += chunk.text; } }).transform(html);
  expect(heading).toContain(system("oh-semantic-96k"));
  const frozen = longMemEval.comparisons.find((entry) => entry.left === "oh-semantic-96k" && entry.right === "bm25-96k")?.correctInTwoOrThreeRuns;
  const tenth = (value: number | undefined) => (value ?? Number.NaN).toFixed(1);

  const pilot = pilotResult.quality.comparisons.primary;
  const sdk = sdkResult.primary.reader.pairedQuestions;
  const locomo = locomoAnswers.scores.reader.comparison;
  for (const fact of [
    `Oh semantic retrieval scored ${system("oh-semantic-96k")}`,
    `BM25 ${system("bm25-96k")}`,
    `scored ${system("oh-reading-pipeline")}`,
    "GPT-5 mini answered every question three times",
    `lead over BM25 is ${tenth(frozen?.differencePoints)} points with a 95% interval from ${tenth(frozen?.interval95[0])} to ${tenth(frozen?.interval95[1])}`,
    "in-sample",
    "not part of the Oh package",
    "up to 97%",
    `${signed(pilot.estimate)} points, with a 95% interval from ${signed(pilot.interval95.lower)} to ${signed(pilot.interval95.upper)}`,
    `${share(sdk.candidate)} correctly against ${share(sdk.baseline)}`,
    `${(sdkResult.primary.native.warmRerankerMs.p50 / 1000).toFixed(1)} seconds of reranking per search`,
    `${share(rerankResult.pooledReader.candidate)} correctly against ${share(rerankResult.pooledReader.baseline)}`,
    `from ${fixed(rerankResult.bootstrap.lowerBound95 * 100)} to ${fixed(rerankResult.bootstrap.upperBound95 * 100)}`,
    `${share(locomoRecall.summaries["anchors-query-4"].turnRecall)} of the marked evidence against ${share(locomoRecall.summaries["vector-window"].turnRecall)}`,
    `answers scored ${share(locomo.candidate)} against ${share(locomo.baseline)}`,
    `${signed(locomo.paired.delta * 100)} points with a 95% interval from ${signed(locomo.paired.lower * 100)} to ${signed(locomo.paired.upper * 100)}`,
    "AI agents ran these studies",
  ]) expect(text).toContain(fact);

  for (const file of [
    "LONGMEMEVAL_S_500_RESULT_V1.md", "results/memory-longmemeval-s-500-v1.json",
    "FRAMEWORK_PILOT_RESULT_V1.md", "results/memory-framework-pilot-v1.json",
    "SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md", "CLONEMEM_RERANK_CONFIRM_RESULT_V1.md", "LOCOMO_WINDOW_QA_V1.md",
  ]) expect(html).toContain(`href="https://github.com/hraness/oh/blob/main/benchmarks/${file}"`);
  const postIndexable = indexableArticles.some((article) => article.slug === "longmemeval-s-user-log");
  expect(html.includes('href="/blog/longmemeval-s-user-log"')).toBe(postIndexable);

  expect(html.indexOf('id="benchmarks"')).toBeGreaterThan(html.indexOf('id="interfaces"'));
  expect(html.indexOf('id="benchmarks"')).toBeLessThan(html.indexOf('id="kernel"'));
  expect(html).toContain("Markdown files stay authoritative");
  expect(html).toContain("do not carry over");
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
    expect(html).toContain("Oh is open-source memory for agents that stores each fact with its sources and every change in a history you can replay.");
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
  expect(examples).toEqual(["Memory for agents that stores each fact with its sources and history"]);
  expect(hero).not.toContain("Ask your agent to file the trial report");
  expect(hero).toContain(citationRecord.value.locator);
  expect(hero).toContain(citationRecord.value.relationship);
  for (const key of citationRecord.dependencies) expect(hero).toContain(key);
  expect(hero).not.toContain("recordsSha256");
  expect(html).toContain("An illustrative review of a fictional trial report");
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
  expect(html).toContain(`<p class="install-note">Latest release: v${publishedRelease.version}</p>`);

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
