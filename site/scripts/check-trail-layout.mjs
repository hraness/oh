import assert from "node:assert/strict";
import { join } from "node:path";

/** Exercise the real stacked section after scrolling and changing its content. */
export async function inspectTrailLayout(page, label, artifacts) {
  const trace = page.locator("#trace");
  const showcase = trace.locator(".hkm-steps");
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
      return {
        heading: box(heading), body: box(body), figure: box(figure), stage: box(stage),
        panel: box(panel), navigation: box(figure.querySelector(".hkm-step-nav")),
        following: box(figure.nextElementSibling), position: getComputedStyle(heading).position,
        panels: [...stage.querySelectorAll('[role="tabpanel"]')].map((element) => ({
          active: element.getAttribute("aria-hidden") === "false",
          visible: getComputedStyle(element).visibility === "visible", inert: element.inert,
        })),
        scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
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
  await showcase.getByRole("tab", { name: /Ask/ }).click();
  const viewport = page.viewportSize();
  try {
    await page.setViewportSize({ ...viewport, width: Math.max(320, Math.floor(viewport.width * 0.7)) });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await inspect("resized-narrower");
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await inspect("resized-back");
  if (artifacts) {
    await trace.screenshot({ path: join(artifacts, `${label}-trace.png`) });
    await trace.evaluate((section) => scrollTo({ top: scrollY + section.getBoundingClientRect().y + 320, behavior: "instant" }));
    await page.screenshot({ path: join(artifacts, `${label}-trace-scroll.png`) });
  }
  return rows;
}
