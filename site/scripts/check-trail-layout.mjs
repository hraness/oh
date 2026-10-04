import assert from "node:assert/strict";
import { join } from "node:path";

/** Exercise the real stacked section after scrolling and changing its content. */
export async function inspectTrailLayout(page, label, artifacts) {
  const trace = page.locator("#trace");
  const showcase = trace.locator(".hkm-steps");
  await showcase.locator('.hkm-step-stage[data-hkm-fitted]').waitFor();
  const rows = [];
  const inspect = async (state) => {
    const geometry = await trace.evaluate((section) => {
      const box = (element) => {
        const { x, y, width, height, bottom, right } = element.getBoundingClientRect();
        return { x, y, width, height, bottom, right };
      };
      const heading = section.querySelector(":scope > .hraness-marketing-section__heading-group");
      const body = section.querySelector(":scope > .hraness-marketing-section__body");
      const figure = body.querySelector(".hkm-steps");
      const stage = figure.querySelector(".hkm-step-stage");
      const panel = stage.querySelector('[role="tabpanel"][aria-hidden="false"]');
      const terminal = panel.querySelector('[data-hkm-density="presentation"]');
      const map = panel.querySelector('.oh-trail .hkm-app-content');
      return {
        heading: box(heading), body: box(body), figure: box(figure), stage: box(stage),
        panel: box(panel), navigation: box(figure.querySelector(".hkm-step-nav")),
        following: box(figure.nextElementSibling), position: getComputedStyle(heading).position,
        panels: [...stage.querySelectorAll('[role="tabpanel"]')].map((element) => ({
          active: element.getAttribute("aria-hidden") === "false",
          visible: getComputedStyle(element).visibility === "visible", inert: element.inert,
        })),
        scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
        scaled: panel.querySelector('[data-hkm-scaled]') !== null,
        frames: [...panel.querySelectorAll('.hkm-window')].map(box),
        terminal: terminal && { size: parseFloat(getComputedStyle(terminal).fontSize),
          minimum: parseFloat(getComputedStyle(document.documentElement).fontSize),
          overflow: terminal.scrollHeight > terminal.clientHeight + 1 || terminal.scrollWidth > terminal.clientWidth + 1 },
        map: { ...box(map), overflow: map.scrollHeight > map.clientHeight + 1 || map.scrollWidth > map.clientWidth + 1,
          cards: [...map.querySelectorAll('.oh-trail-card')].map(box),
          labels: [...map.querySelectorAll('.oh-trail-role, .oh-trail-key, .oh-trail-value')].map(element => ({ text: element.textContent, clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 })),
          text: [...map.querySelectorAll('.oh-trail-role, .oh-trail-key, .oh-trail-value')].map(element => {
            let effectiveOpacity = 1;
            for (let ancestor = element; ancestor && section.contains(ancestor); ancestor = ancestor.parentElement) {
              effectiveOpacity *= Number.parseFloat(getComputedStyle(ancestor).opacity);
            }
            return { text: element.textContent, effectiveOpacity };
          }) },
      };
    });
    assert.equal(geometry.position, "static", `${label}/${state}: stacked heading stays in document flow`);
    assert.ok(geometry.heading.bottom <= geometry.body.y + 1, `${label}/${state}: heading and body must not overlap while scrolling`);
    assert.ok(geometry.figure.bottom <= geometry.following.y + 1, `${label}/${state}: next paragraph follows the complete showcase`);
    assert.ok(geometry.panel.height > 100 && geometry.panel.bottom <= geometry.stage.bottom + 1, `${label}/${state}: active panel fits its stage`);
    assert.ok(geometry.navigation.bottom <= geometry.stage.y + 1.5 || geometry.navigation.x <= geometry.stage.x, `${label}/${state}: step tabs sit on the stage's top or start edge`);
    assert.ok(geometry.navigation.bottom <= geometry.figure.bottom + 1, `${label}/${state}: controls stay inside the showcase`);
    assert.equal(geometry.panels.filter((panel) => panel.active).length, 1);
    assert.ok(geometry.panels.every((panel) => panel.active === panel.visible && panel.inert !== panel.active), `${label}/${state}: inactive panels cannot overlay the current step`);
    assert.ok(geometry.scrollWidth <= geometry.viewportWidth, `${label}/${state}: no horizontal page overflow`);
    assert.equal(geometry.scaled, false, `${label}/${state}: text stays at readable scale`);
    assert.ok(geometry.terminal && geometry.terminal.size >= geometry.terminal.minimum - 0.1 && !geometry.terminal.overflow, `${label}/${state}: complete terminal content fits at the reader's text size`);
    assert.equal(geometry.frames.length, 2, `${label}/${state}: both map and terminal remain visible`);
    assert.ok(geometry.frames.every(frame => frame.width > 1 && frame.right <= geometry.stage.right + 1 && frame.bottom <= geometry.stage.bottom + 1), `${label}/${state}: composed frames stay inside the reserved stage`);
    assert.ok(!geometry.map.overflow && geometry.map.cards.length > 0
        && geometry.map.cards.every(card => card.x >= geometry.map.x && card.y >= geometry.map.y
        && card.right <= geometry.map.right + 1 && card.bottom <= geometry.map.bottom + 1), `${label}/${state}: every map card fits inside its frame`);
    assert.ok(geometry.map.labels.every(label => !label.clipped), `${label}/${state}: every map label, identifier and summary remains complete`);
    assert.ok(geometry.map.text.length > 0 && geometry.map.text.every(text => Math.abs(text.effectiveOpacity - 1) < 0.001), `${label}/${state}: map text and its ancestors retain full opacity, including unselected records`);
    assert.ok(Math.max(...geometry.frames.map(frame => frame.bottom)) >= geometry.stage.bottom - 3, `${label}/${state}: frames fill the reserved height`);
    rows.push({ state, ...geometry });
  };
  for (const step of ["Ask", "Trace", "Check"]) {
    await showcase.getByRole("tab", { name: new RegExp(step) }).click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (const progress of [0, 0.35, 0.7]) {
      await trace.evaluate((section, progress) => {
        const rect = section.getBoundingClientRect();
        scrollTo({ top: scrollY + rect.y + rect.height * progress - 80, behavior: "instant" });
      }, progress);
      await inspect(`${step}-${progress}`);
    }
  }
  assert.ok(Math.max(...rows.map(row => row.stage.height)) - Math.min(...rows.map(row => row.stage.height)) <= 1, `${label}: switching steps preserves stage height`);
  await showcase.getByRole("tab", { name: /Ask/ }).click();
  const viewport = page.viewportSize();
  const fontSize = await page.evaluate(() => document.documentElement.style.fontSize);
  try {
    await page.setViewportSize({ ...viewport, width: Math.max(320, Math.floor(viewport.width * 0.7)) });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await inspect("resized-narrower");
    if (viewport.width === 1440) {
      await page.setViewportSize({ ...viewport, width: 390 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      const zoomRows = [];
      for (const step of ["Ask", "Trace", "Check"]) {
        await showcase.getByRole("tab", { name: new RegExp(step) }).click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await inspect(`large-text-${step}`);
        zoomRows.push(rows.at(-1).stage.height);
        if (artifacts) await showcase.screenshot({ path: join(artifacts, `${label}-large-text-${step.toLowerCase()}.png`) });
      }
      assert.ok(Math.max(...zoomRows) - Math.min(...zoomRows) <= 1, `${label}: enlarged text preserves a stable stage`);
    }
  } finally {
    await page.evaluate(value => { document.documentElement.style.fontSize = value; }, fontSize);
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await showcase.getByRole("tab", { name: /Ask/ }).click();
  await inspect("resized-back");
  if (artifacts) {
    await trace.screenshot({ path: join(artifacts, `${label}-trace.png`) });
    await trace.evaluate((section) => scrollTo({ top: scrollY + section.getBoundingClientRect().y + 320, behavior: "instant" }));
    await page.screenshot({ path: join(artifacts, `${label}-trace-scroll.png`) });
  }
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
