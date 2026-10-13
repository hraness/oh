import assert from "node:assert/strict";
import { join } from "node:path";

/** The hero's two-frame evidence trail: cards, labels and both frames stay complete at every width and text size. */
export async function inspectTrailLayout(page, label, artifacts) {
  const hero = page.locator(".oh-hero");
  const stage = hero.locator(".oh-trail-stage");
  await stage.locator(".oh-trail .hkm-app-content").waitFor();
  const rows = [];
  const inspect = async (state) => {
    const geometry = await stage.evaluate((element) => {
      const box = (node) => {
        const { x, y, width, height, bottom, right } = node.getBoundingClientRect();
        return { x, y, width, height, bottom, right };
      };
      const map = element.querySelector(".oh-trail .hkm-app-content");
      const terminal = element.querySelector(".oh-mock-terminal");
      const clipped = (node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
      const effectiveOpacity = (node) => {
        let value = 1;
        for (let current = node; current && current !== document.body; current = current.parentElement) {
          value *= Number.parseFloat(getComputedStyle(current).opacity);
        }
        return value;
      };
      return {
        stage: box(element),
        viewportWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        frames: [...element.querySelectorAll(".hkm-window")].map(box),
        terminal: terminal ? { ...box(terminal), overflow: terminal.scrollWidth > terminal.clientWidth + 1, lines: terminal.querySelectorAll(".hkm-terminal-line, [data-hkm-line], pre > span, code > span").length } : null,
        map: {
          overflow: map.scrollWidth > map.clientWidth + 1,
          cards: [...map.querySelectorAll(".oh-trail-card")].map(box),
          labels: [...map.querySelectorAll(".oh-trail-role, .oh-trail-key, .oh-trail-value")].map((node) => ({ text: node.textContent, clipped: clipped(node), opacity: effectiveOpacity(node) })),
        },
      };
    });
    assert.ok(geometry.scrollWidth <= geometry.viewportWidth, `${label}/${state}: no horizontal page overflow`);
    assert.equal(geometry.frames.length, 2, `${label}/${state}: the review brief and the terminal are both framed`);
    assert.ok(geometry.frames.every((frame) => frame.width > 1 && frame.right <= geometry.stage.right + 1), `${label}/${state}: both frames stay inside the stage`);
    assert.ok(geometry.terminal && !geometry.terminal.overflow, `${label}/${state}: the terminal shows its whole transcript`);
    assert.ok(!geometry.map.overflow && geometry.map.cards.length === 7, `${label}/${state}: seven record cards fit the review brief`);
    assert.ok(geometry.map.labels.length === 21 && geometry.map.labels.every((item) => !item.clipped), `${label}/${state}: every record label, identifier and summary remains complete`);
    assert.ok(geometry.map.labels.every((item) => Math.abs(item.opacity - 1) < 0.001), `${label}/${state}: record text and its ancestors retain full opacity`);
    rows.push({ state, ...geometry });
  };
  await inspect("initial");
  const viewport = page.viewportSize();
  const fontSize = await page.evaluate(() => document.documentElement.style.fontSize);
  try {
    await page.setViewportSize({ ...viewport, width: Math.max(320, Math.floor(viewport.width * 0.7)) });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await inspect("resized-narrower");
    if (viewport.width === 1440) {
      await page.setViewportSize({ ...viewport, width: 390 });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await inspect("large-text");
      if (artifacts) await stage.screenshot({ path: join(artifacts, `${label}-large-text.png`) });
    }
  } finally {
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, fontSize);
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await inspect("resized-back");
  if (artifacts) await hero.screenshot({ path: join(artifacts, `${label}-hero.png`) });
  return rows;
}

/** Article maps use their natural height, including full fixture prose. */
export async function inspectArticleTrailCases(browser, origin, artifacts) {
  const rows = [];
  for (const width of [320, 390, 768, 1440]) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
    try {
      const page = await context.newPage();
      const failures = [];
      page.on("pageerror", error => failures.push(error.message));
      page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
      page.on("requestfailed", request => {
        // Chromium cancels a video's metadata range request once it has what it needs.
        if (request.resourceType() === "media" && request.failure()?.errorText === "net::ERR_ABORTED") return;
        failures.push(`${request.failure()?.errorText} ${request.url()}`);
      });
      assert.equal((await page.goto(`${origin}/blog/introducing-oh`, { waitUntil: "networkidle" })).status(), 200);
      for (const textSize of width === 390 ? [100, 200] : [100]) {
        const label = `article-maps-${width}-${colorScheme}-${textSize}text`;
        const metrics = await page.evaluate(async size => {
          document.documentElement.style.fontSize = `${size}%`;
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const box = element => {
            const { x, y, right, bottom } = element.getBoundingClientRect();
            return { x, y, right, bottom };
          };
          return {
            scrollWidth: document.documentElement.scrollWidth,
            rootSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
            maps: [...document.querySelectorAll(".oh-trail")].map(map => ({
              frame: box(map),
              text: [...map.querySelectorAll(".oh-trail-role, .oh-trail-key, .oh-trail-value")].map(element => {
                const range = document.createRange();
                range.selectNodeContents(element);
                let opacity = 1;
                for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) opacity *= Number.parseFloat(getComputedStyle(ancestor).opacity);
                return { text: element.textContent, box: box(element), ink: box(range), card: box(element.closest(".oh-trail-card")),
                  size: Number.parseFloat(getComputedStyle(element).fontSize), opacity,
                  clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 };
              }),
            })),
          };
        }, textSize);
        assert.ok(metrics.scrollWidth <= width, `${label}: no page overflow`);
        assert.ok(metrics.maps.length > 0, `${label}: launch maps are present`);
        for (const map of metrics.maps) {
          assert.equal(map.text.length, 21, `${label}: seven records retain all three labels`);
          for (const text of map.text) {
            assert.ok(!text.clipped && text.ink.x >= text.box.x - 1 && text.ink.right <= text.box.right + 1
              && text.ink.y >= text.box.y - 1 && text.ink.bottom <= text.box.bottom + 1, `${label}: complete text remains visible: ${text.text}`);
            assert.ok(text.card.x >= map.frame.x - 1 && text.card.right <= map.frame.right + 1
              && text.card.y >= map.frame.y - 1 && text.card.bottom <= map.frame.bottom + 1, `${label}: natural-height cards remain inside the map`);
            assert.ok(text.size >= metrics.rootSize * 0.75 - 0.1, `${label}: labels respect reader text size`);
            assert.ok(Math.abs(text.opacity - 1) < 0.001, `${label}: full text opacity`);
          }
        }
        assert.deepEqual(failures, [], `${label}: no runtime or resource failures`);
        if (artifacts) await page.locator(".oh-trail").first().screenshot({ path: join(artifacts, `${label}.png`) });
        rows.push({ label, metrics });
      }
    } finally { await context.close(); }
  }
  return rows;
}
