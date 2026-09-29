import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import Benchmarks from "../app/benchmarks/page";
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
import locomoSealed from "../../benchmarks/results/memory-evolution-locomo-sealed-1540-v1.json";
import memEvalResult from "../../benchmarks/results/memory-evolution-memeval-102-v1.json";
import releaseMini from "../../benchmarks/results/memory-evolution-full-release-500-mini-v1.json";
import releaseNano from "../../benchmarks/results/memory-evolution-full-release-500-v1.json";
import releaseFullContext from "../../benchmarks/results/memory-evolution-full-context-500-v1.json";

test("the homepage summarizes the recorded search result with its main limit and full evidence link", () => {
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>);
  let copy = "";
  new HTMLRewriter().on("#benchmarks", { text(chunk) { copy += chunk.text; } }).transform(html);
  const text = copy.replace(/\s+/gu, " ");
  const system = (id: string) => `${(longMemEval.systems.find((entry) => entry.id === id)?.percent ?? Number.NaN).toFixed(2)}%`;
  expect(text).toContain(system("oh-semantic-96k"));
  expect(text).toContain(system("bm25-96k"));
  const comparison = longMemEval.comparisons.find((entry) => entry.left === "oh-semantic-96k" && entry.right === "bm25-96k")?.correctInTwoOrThreeRuns;
  expect(comparison).toBeDefined();
  expect(text).toContain(`${comparison!.differencePoints.toFixed(1)} points`);
  expect(text).toContain(`from ${comparison!.interval95[0].toFixed(1)} to ${comparison!.interval95[1].toFixed(1)}`);
  expect(text).toContain("does not rule out a tie");
  expect(html).toContain('href="/benchmarks"');
  expect(html.indexOf('id="benchmarks"')).toBeGreaterThan(html.indexOf('id="interfaces"'));
  expect(html.indexOf('id="benchmarks"')).toBeLessThan(html.indexOf('id="kernel"'));
});

test("the benchmarks index ties every headline figure to its checked record", () => {
  const html = renderToStaticMarkup(<RootLayout><Benchmarks /></RootLayout>);
  const text = html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
  const fixed = (value: number) => value.toFixed(2);
  const share = (value: number) => `${fixed(value * 100)}%`;
  const tenth = (value: number) => `${(value * 100).toFixed(1)}%`;
  const signed = (value: number) => `${value < 0 ? "−" : "+"}${fixed(Math.abs(value))}`;
  const system = (id: string) => `${fixed(longMemEval.systems.find((entry) => entry.id === id)?.percent ?? Number.NaN)}%`;
  const arm = (
    record: { arms: readonly { variantId: string; reader: string; metrics: readonly { metric: string; overall: { mean: number } }[] }[] },
    variantId: string,
    reader: string,
  ) => tenth(record.arms.find((entry) => entry.variantId === variantId && entry.reader === reader)
    ?.metrics.find((entry) => entry.metric.startsWith("judge"))?.overall.mean ?? Number.NaN);
  const pilotRate = (armId: string) => share(pilotResult.quality.arms.find((row) => row.arm === armId)?.conservativeSuccessRate.value ?? Number.NaN);
  const memEval = (reader: string) => tenth(
    (memEvalResult.systems.find((entry) => entry.system === "oh" && "reader" in entry && entry.reader === reader) as { accuracy: number }).accuracy,
  );
  const mem0 = memEvalResult.systems.find((entry) => entry.system === "mem0");
  const mem0Matched = (mem0 && "matchedOhOnSameQuestions" in mem0
    ? mem0.matchedOhOnSameQuestions?.["openai/gpt-4.1-mini"]
    : undefined) ?? { correct: 0, of: 1 };

  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(text).toContain("Benchmark results");
  for (const fact of [
    system("oh-reading-pipeline"), system("first-pass-only"), system("oh-semantic-96k"), system("bm25-96k"),
    pilotRate("supermemory"), pilotRate("oh"), pilotRate("bm25"),
    share(sdkResult.primary.reader.pairedQuestions.candidate),
    share(sdkResult.primary.reader.pairedQuestions.baseline),
    share(rerankResult.pooledReader.candidate), share(rerankResult.pooledReader.baseline),
    share(locomoAnswers.scores.reader.comparison.candidate), share(locomoAnswers.scores.reader.comparison.baseline),
    arm(locomoSealed, "semantic-24k", "gpt5-mini-calibration-only-v1-reader"),
    arm(locomoSealed, "semantic-24k", "gpt5-nano-calibration-only-v1-reader"),
    arm(locomoSealed, "window-24k", "gpt5-mini-calibration-only-v1-reader"),
    arm(locomoSealed, "window-24k", "gpt5-nano-calibration-only-v1-reader"),
    arm(releaseNano, "semantic-96k", "gpt5-nano-explicit-abstention-composition-v1-reader"),
    arm(releaseNano, "window-96k", "gpt5-nano-explicit-abstention-composition-v1-reader"),
    arm(releaseMini, "semantic-96k", "gpt5-mini-explicit-abstention-composition-v1-reader"),
    arm(releaseMini, "window-96k", "gpt5-mini-explicit-abstention-composition-v1-reader"),
    arm(releaseFullContext, "full-history", "gpt5-nano-explicit-abstention-composition-v1-reader"),
    memEval("openai/gpt-4.1"), memEval("openai/gpt-4.1-mini"),
    tenth((mem0 && "accuracy" in mem0 ? mem0.accuracy : Number.NaN) as number),
    tenth(mem0Matched.correct / mem0Matched.of),
    "in-sample",
    "Failed its rule",
    "not run",
    "AI agents ran these studies, and no person or outside group has audited them",
    "2026-09-26", "2026-09-24", "2026-09-23", "2026-09-22", "2026-09-10",
  ]) expect(text).toContain(fact);

  const frozen = longMemEval.comparisons.find((entry) => entry.left === "oh-semantic-96k" && entry.right === "bm25-96k")?.correctInTwoOrThreeRuns;
  const one = (value: number | undefined) => (value ?? Number.NaN).toFixed(1);
  expect(text).toContain(
    `leads BM25 by ${one(frozen?.differencePoints)} points with a 95% interval from ${one(frozen?.interval95[0])} to ${one(frozen?.interval95[1])}`,
  );
  const pilot = pilotResult.quality.comparisons;
  expect(text).toContain(
    `${signed(pilot.primary.estimate)} points with a 95% interval of ${signed(pilot.primary.interval95.lower)} to ${signed(pilot.primary.interval95.upper)}`,
  );
  expect(text).toContain(
    `${signed(pilot.secondary.estimate)} points (${signed(pilot.secondary.interval95.lower)} to ${signed(pilot.secondary.interval95.upper)})`,
  );
  expect(text).toContain(`${signed(sdkResult.primary.reader.pairedQuestions.delta * 100)} points`);
  expect(text).toContain(
    `${signed(sdkResult.primary.reader.descriptiveUncertainty.lower95 * 100)} to ${signed(sdkResult.primary.reader.descriptiveUncertainty.upper95 * 100)}`,
  );
  expect(text).toContain(`${signed(rerankResult.pooledReader.delta * 100)} points`);
  expect(text).toContain(
    `${signed(rerankResult.bootstrap.lowerBound95 * 100)} to ${signed(rerankResult.bootstrap.upperBound95 * 100)}`,
  );
  expect(text).toContain(
    `${signed(locomoAnswers.scores.reader.comparison.paired.delta * 100)} points`,
  );

  for (const file of [
    "LONGMEMEVAL_S_500_RESULT_V1.md", "results/memory-longmemeval-s-500-v1.json",
    "FRAMEWORK_PILOT_RESULT_V1.md", "results/memory-framework-pilot-v1.json",
    "SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md", "results/memory-sdk-retrieval-qualification-v1.json",
    "CLONEMEM_RERANK_CONFIRM_RESULT_V1.md", "results/memory-clonemem-rerank-confirm-v1.json",
    "LOCOMO_WINDOW_QA_V1.md", "results/memory-locomo-window-qa-v1.json",
    "EVOLUTION_RELEASE_RESULTS.md", "results/memory-evolution-locomo-sealed-1540-v1.json",
    "results/memory-evolution-full-release-500-v1.json", "results/memory-evolution-memeval-102-v1.json",
    "README.md",
  ]) expect(html).toContain(`https://github.com/hraness/oh/blob/main/benchmarks/${file}`);
  expect(html).toContain('href="/blog/longmemeval-s-user-log"');
  expect(html).toContain('"@type":"CollectionPage"');
  expect(html).toContain('"@id":"https://oh.computer/benchmarks#collection"');
  expect(html).toContain('id="benchmarks-main"');
});

test("every public page renders the in-flow content footer above the shared footer", () => {
  for (const page of [<Home key="home" />, <Benchmarks key="benchmarks" />, <Specification key="spec" />]) {
    const html = renderToStaticMarkup(<RootLayout>{page}</RootLayout>);
    expect(html.match(/<footer\b/gu)).toHaveLength(2);
    const contentFooter = html.indexOf('data-hraness-marketing="footer"');
    const networkFooter = html.indexOf('data-slot="hraness-site-footer"');
    expect(contentFooter).toBeGreaterThan(-1);
    expect(networkFooter).toBeGreaterThan(contentFooter);
    expect(html).toContain("hraness-marketing-footer__brand");
    expect(html).toContain('src="/marks/oh-computer.svg"');
    expect(html).toContain("Oh is open-source memory for agents that stores each fact with its sources and every change in a history you can replay.");
    expect(html).toContain('id="hraness-site-footer"');
    expect(html).toContain("https://account.hraness.com/support?product=oh-computer&amp;source=web#support");
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("action=updates");
  }
});

test("every public page attributes the site to Hraness through the shared footer only", () => {
  for (const page of [<Home key="home" />, <Benchmarks key="benchmarks" />, <Specification key="spec" />]) {
    const html = renderToStaticMarkup(<RootLayout>{page}</RootLayout>);
    expect(html.match(/aria-label="Hraness home"/gu)).toHaveLength(1);
    expect(html).toContain(">by Hraness</span>");
    expect(html).not.toContain("Ben Guo");
    expect(html).not.toContain("hraness-marketing-maker");
    expect(html).not.toContain('id="maker"');
  }
});

test("skip links transfer keyboard focus to each page's main landmark", () => {
  for (const [Page, id] of [[Home, "main"], [Benchmarks, "benchmarks-main"], [Specification, "spec-main"]] as const) {
    const html = renderToStaticMarkup(<RootLayout><Page /></RootLayout>);
    const targets: string[] = [];
    new HTMLRewriter().on(`main#${id}`, {
      element(element) { targets.push(element.getAttribute("tabindex") ?? ""); },
    }).transform(html);
    expect(html).toContain(`href="#${id}"`);
    expect(targets).toEqual(["-1"]);
  }
});

test("renders the current CLI citation proof and its exact inspectable record", () => {
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>);
  const hero = /data-hraness-marketing="hero"[\s\S]*?<\/header>/u.exec(html)?.[0] ?? "";
  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(hero).toContain('aria-label="Saving and reading a citation with the oh CLI"');
  expect(hero).toContain('tabindex="0"');
  expect(hero).toContain(citationRecord.value.locator);
  expect(hero).toContain(citationRecord.value.relationship);
  for (const key of citationRecord.dependencies) expect(hero).toContain(key);
  expect(hero).toContain("5 records and 5 changes replay to the same state");
  expect(hero).toContain("fictional trial report");
  expect(html).toContain('href="/examples/evidence-table-2.json"');
  expect(html).not.toContain("historical capture");
  let commands = "";
  new HTMLRewriter().on('.oh-terminal code[data-language="shell"]', { text(chunk) { commands += chunk.text; } }).transform(html);
  expect(commands).toContain("oh put");
  expect(commands).toContain("oh get evidence:table-2");
  expect(commands).not.toContain("Saved evidence");
  expect(commands).not.toContain("Store checked");
});

test("keeps the homepage proof flat and the specification outside its preset", () => {
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>);
  expect(html).toContain('data-hraness-marketing-preset="editorial"');
  expect(html).toContain('data-hraness-pattern="none"');
  expect(html).toContain('data-hraness-material="lantern"');
  expect(html).not.toContain('hraness-material-wall');
  expect(html).not.toContain('hraness-marketing-field');
  expect(html).toContain(`<p class="install-note">Latest release: v${publishedRelease.version}</p>`);
  const specification = renderToStaticMarkup(<RootLayout><Specification /></RootLayout>);
  expect(specification).not.toContain("data-hraness-marketing-preset");
  expect(specification).toContain("spec-header");
  expect(specification).toContain("spec-document");
  expect(specification).not.toContain("data-hraness-material");
});


test("the header keeps a named home link and exact-artwork foil fallback", () => {
  for (const Page of [Home, Benchmarks, Specification]) {
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

test("the home JSON-LD defines the website and the software the other pages reference", () => {
  const html = renderToStaticMarkup(<RootLayout><Home /></RootLayout>);
  const blocks: string[] = [];
  let current = "";
  new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element(element) { element.onEndTag(() => { blocks.push(current); current = ""; }); },
      text(chunk) { current += chunk.text; },
    })
    .transform(html);
  const nodes = blocks.flatMap((block) => {
    const parsed: unknown = JSON.parse(block);
    return Array.isArray(parsed) ? parsed : [parsed];
  }) as Record<string, unknown>[];
  const byType = (type: string) => nodes.filter((node) => node["@type"] === type);

  const [website, ...extraWebsites] = byType("WebSite");
  expect(extraWebsites).toHaveLength(0);
  expect(website?.["@id"]).toBe("https://oh.computer/#website");
  expect(website?.publisher).toEqual({ "@id": "https://hraness.com/#organization" });

  const [software] = byType("SoftwareSourceCode");
  expect(software?.["@id"]).toBe("https://oh.computer/#software");
  expect(software?.version).toBe(publishedRelease.version);
  expect((software?.publisher as Record<string, unknown>)["@id"]).toBe("https://hraness.com/#organization");
  expect(nodes.some((node) => "aggregateRating" in node || "review" in node)).toBe(false);

  // FAQ markup mirrors the visible questions.
  const question = "What is stored, and where?";
  expect(html).toContain(question);
  const [faq] = byType("FAQPage");
  const names = (faq?.mainEntity as { name: string }[]).map((entry) => entry.name);
  expect(names).toContain(question);
});
