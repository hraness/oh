import assert from "node:assert/strict";
import { join } from "node:path";

const evidenceLinks = [
  "https://github.com/hraness/oh/blob/main/benchmarks/LOCOMO_WINDOW_QA_V1.md",
  "https://github.com/hraness/oh/blob/main/benchmarks/results/memory-locomo-window-confirmation-v1.json",
  "https://github.com/hraness/oh/blob/main/benchmarks/results/memory-locomo-window-qa-v1.json",
  "https://github.com/hraness/oh/blob/main/benchmarks/CLONEMEM_TRANSFER_V1.md",
  "https://github.com/hraness/oh/blob/main/benchmarks/LOCOMO_COMPOSITION_DEV_RESULT_V1.md",
];

async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export async function inspectBenchmark(page, label, artifacts) {
  await page.locator("#benchmarks").scrollIntoViewIfNeeded();
  await settled(page);
  const metrics = await page.evaluate(() => {
    const section = document.querySelector("#benchmarks");
    if (!section) throw new Error("Missing benchmark section");
    const issues = [];
    const epsilon = 1;
    const viewport = document.documentElement.clientWidth;
    const rectOf = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const describe = (e) => e.tagName.toLowerCase() + (e.className ? `.${String(e.className).trim().replaceAll(" ", ".")}` : "");
    const textRects = [];
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    let node;
    let textNodes = 0;
    let accessibleOnlyHeaders = 0;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      if (++textNodes > 512) throw new Error("Benchmark text-node bound exceeded");
      const parent = node.parentElement;
      const header = parent.closest("thead");
      // At 320px the semantic column headers remain accessible, while each
      // visible row stacks its label and value below the metric caption.
      if (header && header.getBoundingClientRect().width <= 1) {
        accessibleOnlyHeaders++;
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        if (textRects.length >= 1024) throw new Error("Benchmark text-rectangle bound exceeded");
        const cell = parent.closest("td, th");
        const record = { element: describe(parent), cell: cell ? [...section.querySelectorAll("td,th")].indexOf(cell) : null, ...rectOf(rect) };
        textRects.push(record);
        if (rect.left < -epsilon || rect.right > viewport + epsilon) issues.push({ kind: "viewport-text-clip", ...record });
        for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) issues.push({ kind: "hidden-text", element: describe(ancestor) });
          const box = ancestor.getBoundingClientRect();
          const left = box.left + ancestor.clientLeft;
          const right = left + ancestor.clientWidth;
          if (["clip", "hidden", "auto", "scroll"].includes(style.overflowX) && (rect.left < left - epsilon || rect.right > right + epsilon)) {
            issues.push({ kind: "ancestor-horizontal-clip", ancestor: describe(ancestor), ...record });
          }
          if (section.contains(ancestor) && ["clip", "hidden"].includes(style.overflowY)) {
            const top = box.top + ancestor.clientTop;
            if (rect.top < top - epsilon || rect.bottom > top + ancestor.clientHeight + epsilon) issues.push({ kind: "ancestor-vertical-clip", ancestor: describe(ancestor), ...record });
          }
          if (style.textOverflow === "ellipsis" || !["none", "0", ""].includes(style.webkitLineClamp)) issues.push({ kind: "truncated-text", element: describe(ancestor) });
        }
      }
    }
    for (const [i, left] of textRects.entries()) {
      if (left.cell === null) continue;
      for (const right of textRects.slice(i + 1)) {
        if (right.cell === null || right.cell === left.cell) continue;
        if (Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) > epsilon && Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) > epsilon) {
          issues.push({ kind: "cell-text-overlap", first: left.cell, second: right.cell });
        }
      }
    }
    const cells = [...section.querySelectorAll("table, td, th")].filter((e) => !e.closest("thead") || e.closest("thead").getBoundingClientRect().width > 1).map((e) => {
      const result = { element: describe(e), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, ...rectOf(e.getBoundingClientRect()) };
      if (e.scrollWidth > e.clientWidth + epsilon) issues.push({ kind: "cell-scroll-overflow", ...result });
      return result;
    });
    return { viewport, innerWidth, visualViewport: visualViewport?.width, textNodes, textRectangles: textRects.length, accessibleOnlyHeaders, cells, issues, section: rectOf(section.getBoundingClientRect()) };
  });
  if (artifacts) {
    const clip = await page.locator("#benchmarks").evaluate((element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    });
    // Capture document coordinates from the top, so fixed chrome stays at the
    // top of the document rather than being stitched through this tall section.
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await settled(page);
    await page.screenshot({ path: join(artifacts, `${label}-benchmark.png`), fullPage: true, clip, animations: "disabled" });
  }
  assert.deepEqual(metrics.issues, [], `${label}: benchmark text clipping or overlap`);
  assert.equal(await page.locator("#benchmarks table").count(), 2);
  assert.deepEqual(await page.locator("#benchmarks a").evaluateAll((links) => links.map((link) => link.href)), evidenceLinks);
  return metrics;
}

async function textOverrides(page, scale, spacing) {
  return await page.evaluate(({ scale, spacing }) => {
    const elements = [...document.querySelectorAll("body, body *")];
    if (elements.length > 10_000) throw new Error("Text-resize element bound exceeded");
    const snapshots = elements.map((element) => {
      const style = getComputedStyle(element);
      return { element, font: Number.parseFloat(style.fontSize), line: Number.parseFloat(style.lineHeight), margin: Number.parseFloat(style.marginBlockEnd) };
    });
    // Snapshot all values before changing any inherited font; this is text-only
    // resize simulation, not device scaling or a claim of native browser zoom.
    for (const { element, font, line, margin } of snapshots) {
      if (scale !== 1) {
        element.style.setProperty("font-size", `${font * scale}px`, "important");
        if (Number.isFinite(line)) element.style.setProperty("line-height", `${line * scale}px`, "important");
      }
      if (spacing) {
        element.style.setProperty("line-height", `${Math.max(Number.isFinite(line) ? line * scale : 0, font * scale * 1.5)}px`, "important");
        element.style.setProperty("letter-spacing", "0.12em", "important");
        element.style.setProperty("word-spacing", "0.16em", "important");
        if (element.tagName === "P") element.style.setProperty("margin-block-end", `${Math.max(margin, font * scale * 2)}px`, "important");
      }
    }
    const probes = ["#benchmarks-title", "#benchmarks td", "#benchmarks .benchmark-note", "#benchmarks a"].map((selector) => {
      const element = document.querySelector(selector);
      const snapshot = snapshots.find((row) => row.element === element);
      const style = getComputedStyle(element);
      return { selector, baselineFont: snapshot.font, font: Number.parseFloat(style.fontSize), line: Number.parseFloat(style.lineHeight), letter: Number.parseFloat(style.letterSpacing), word: Number.parseFloat(style.wordSpacing) };
    });
    return { method: "computed-font text-only resize simulation", scale, spacing, probes };
  }, { scale, spacing });
}

async function inspectKeyboard(page, origin) {
  await page.locator("#interfaces a").last().focus();
  const records = [];
  for (const [index, href] of evidenceLinks.entries()) {
    await page.keyboard.press("Tab");
    const link = page.locator("#benchmarks a").nth(index);
    assert.equal(await link.evaluate((element) => document.activeElement === element), true, "Evidence link tab order");
    // Native focus scroll inherits the page's smooth-scroll behavior. Wait for
    // it to settle before testing geometry; do not programmatically reposition.
    await page.waitForFunction(() => {
      const element = document.activeElement;
      if (!element?.closest("#benchmarks")) return false;
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].some((r) => {
        if (!r.width || !r.height || r.top < 0 || r.bottom > innerHeight) return false;
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!top && (top === element || element.contains(top));
      });
    }, undefined, { timeout: 3000 });
    const record = await link.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const visibleRect = [...range.getClientRects()].find((r) => r.width && r.height && r.top >= 0 && r.bottom <= innerHeight);
      const topElement = visibleRect ? document.elementFromPoint(visibleRect.x + visibleRect.width / 2, visibleRect.y + visibleRect.height / 2) : null;
      return { href: element.href, text: element.textContent.trim(), focusVisible: element.matches(":focus-visible"), outline: Number.parseFloat(getComputedStyle(element).outlineWidth), height: rect.height, visibleText: !!visibleRect, unobscured: !!topElement && (element === topElement || element.contains(topElement)) };
    });
    assert.equal(record.href, href);
    assert.equal(record.focusVisible && record.outline >= 2 && record.visibleText && record.unobscured, true, `Visible unobscured keyboard focus: ${JSON.stringify(record)}`);
    if (index < 3) assert.ok(record.height >= 48, "Standalone evidence target must be at least48px");
    records.push(record);
  }
  for (let index = evidenceLinks.length - 2; index >= 0; index--) {
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.locator("#benchmarks a").nth(index).evaluate((element) => document.activeElement === element), true, "Evidence link reverse tab order");
  }
  // Capture exact keyboard navigation without contacting external GitHub.
  await page.route(evidenceLinks[0], (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Keyboard navigation verified</title><p>Keyboard navigation verified.</p>" }), { times: 1 });
  await Promise.all([page.waitForURL(evidenceLinks[0]), page.keyboard.press("Enter")]);
  await page.goto(origin, { waitUntil: "networkidle" });
  return { records, reverseTraversal: true, enterNavigation: evidenceLinks[0], externalResponse: "intercepted locally; public link health is a separate check" };
}

export async function runBenchmarkAccessibilityCases(browser, origin, artifacts) {
  const evidence = [];
  for (const colorScheme of ["light", "dark"]) {
    for (const [scale, spacing] of [[1, false], [2, false], [1, true], [2, true]]) {
      const context = await browser.newContext({ viewport: { width: 320, height: 900 }, isMobile: true, hasTouch: true, colorScheme });
      try {
        const page = await context.newPage();
        const failures = [];
        page.on("pageerror", (error) => failures.push(error.message));
        page.on("response", (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
        page.on("requestfailed", (request) => failures.push(`Request failed: ${new URL(request.url()).pathname}`));
        assert.equal((await page.goto(origin, { waitUntil: "networkidle" })).status(), 200);
        await settled(page);
        const override = await textOverrides(page, scale, spacing);
        for (const probe of override.probes) {
          assert.ok(Math.abs(probe.font - probe.baselineFont * scale) < 0.15, "Text resize override took effect");
          if (spacing) {
            assert.ok(probe.line >= probe.font * 1.5 - 0.15);
            assert.ok(Math.abs(probe.letter - probe.font * 0.12) < 0.15);
            assert.ok(Math.abs(probe.word - probe.font * 0.16) < 0.15);
          }
        }
        const label = `narrow-${colorScheme}-${scale * 100}text-${spacing ? "spaced" : "normal"}`;
        const metrics = await inspectBenchmark(page, label, artifacts);
        const keyboard = scale === 1 && !spacing || scale === 2 && spacing ? await inspectKeyboard(page, origin) : null;
        assert.deepEqual(failures, [], `${label}: runtime/resource failures`);
        evidence.push({ label, override, metrics, keyboard });
      } finally { await context.close(); }
    }
  }
  return evidence;
}
