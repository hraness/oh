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
      };
    });
    assert.equal(geometry.position, "static", `${label}/${state}: stacked heading stays in document flow`);
    assert.ok(geometry.heading.bottom <= geometry.body.y + 1, `${label}/${state}: heading and body must not overlap while scrolling`);
    assert.ok(geometry.figure.bottom <= geometry.following.y + 1, `${label}/${state}: next paragraph follows the complete showcase`);
    assert.ok(geometry.panel.height > 100 && geometry.panel.bottom <= geometry.stage.bottom + 1, `${label}/${state}: active panel fits its stage`);
    assert.ok(geometry.stage.bottom <= geometry.navigation.y + 1, `${label}/${state}: controls follow the stage`);
    assert.ok(geometry.navigation.bottom <= geometry.figure.bottom + 1, `${label}/${state}: controls stay inside the showcase`);
    assert.equal(geometry.panels.filter((panel) => panel.active).length, 1);
    assert.ok(geometry.panels.every((panel) => panel.active === panel.visible && panel.inert !== panel.active), `${label}/${state}: inactive panels cannot overlay the current step`);
    assert.ok(geometry.scrollWidth <= geometry.viewportWidth, `${label}/${state}: no horizontal page overflow`);
    assert.equal(geometry.scaled, false, `${label}/${state}: text stays at readable scale`);
    assert.ok(geometry.terminal && geometry.terminal.size >= geometry.terminal.minimum - 0.1 && !geometry.terminal.overflow, `${label}/${state}: complete terminal content fits at the reader's text size`);
    assert.equal(geometry.frames.length, 2, `${label}/${state}: both map and terminal remain visible`);
    assert.ok(geometry.frames.every(frame => frame.width > 1 && frame.right <= geometry.stage.right + 1 && frame.bottom <= geometry.stage.bottom + 1), `${label}/${state}: composed frames stay inside the reserved stage`);
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
