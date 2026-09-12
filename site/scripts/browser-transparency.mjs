import assert from "node:assert/strict";

// Playwright 1.62 has no reduced-transparency option. Use its owned Chromium
// session for this one preference, preserving all existing media and scroll.
export async function withReducedTransparency(page, inspect) {
  const initial = await page.evaluate(() => ({
    scrollX, scrollY,
    features: [
      { name: "prefers-color-scheme", value: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" },
      { name: "prefers-reduced-motion", value: matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference" },
      { name: "prefers-reduced-transparency", value: matchMedia("(prefers-reduced-transparency: reduce)").matches ? "reduce" : "no-preference" },
      { name: "forced-colors", value: matchMedia("(forced-colors: active)").matches ? "active" : "none" },
    ],
  }));
  const session = await page.context().newCDPSession(page);
  const select = async (features) => {
    await session.send("Emulation.setEmulatedMedia", { features });
    assert.equal(await page.evaluate((features) => features.every(({ name, value }) =>
      matchMedia(`(${name}: ${value})`).matches), features), true, "Native media override must apply");
  };
  const failures = [];
  try {
    await select(initial.features.map(feature => feature.name === "prefers-reduced-transparency"
      ? { ...feature, value: "reduce" } : feature));
    await inspect();
  } catch (error) { failures.push(error); }
  finally {
    try { await select(initial.features); } catch (error) { failures.push(error); }
    try {
      await page.evaluate(({ scrollX, scrollY }) => scrollTo({ left: scrollX, top: scrollY, behavior: "instant" }), initial);
    } catch (error) { failures.push(error); }
    try { await session.detach(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Native transparency inspection and cleanup failed");
}
