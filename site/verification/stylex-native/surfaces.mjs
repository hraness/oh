import assert from "node:assert/strict";

export const roles = Object.freeze({
  home: {
    header: ".hraness-marketing-header", hero: ".oh-marketing-hero", citation: ".citation-preview",
    citationRows: ".citation-preview dl > div", stats: ".hraness-marketing-stats",
    trace: "#trace", traceHeading: "#trace > .hraness-marketing-section__heading-group",
    record: "#trace .record-link a", interfaces: "#interfaces", commands: ".install-command",
    disclosure: ".first-run-details", questions: "#questions", maker: "#maker",
    ask: ".ask-ai", footer: ".site-footer",
  },
  spec: {
    header: ".hraness-marketing-header", nav: ".spec-nav", intro: ".spec-intro", article: ".spec-document",
    sections: ".spec-section", facts: ".fact-grid", kinds: ".kind-grid", code: ".spec-code",
    sequence: ".sequence", actions: ".spec-actions", ask: ".ask-ai",
  },
});

export function linkStateTargets(home) {
  assert.equal(typeof home, "boolean");
  const common = [
    { name: "header-brand", selector: ".hraness-marketing-header__brand" },
    { name: "header-nav", selector: '.hraness-marketing-header__nav a:not([aria-current="page"])' },
    { name: "header-action", selector: ".hraness-marketing-header__actions a" },
  ];
  return home ? [...common,
    { name: "hero-primary", selector: '.oh-marketing-hero .hraness-marketing-action[data-emphasis="primary"]' },
    { name: "hero-secondary", selector: '.oh-marketing-hero .hraness-marketing-action[data-emphasis="secondary"]' },
    { name: "cta-primary", selector: '.hraness-marketing-cta .hraness-marketing-action[data-emphasis="primary"]' },
    { name: "cta-secondary", selector: '.hraness-marketing-cta .hraness-marketing-action[data-emphasis="secondary"]' },
    { name: "first-run-summary", selector: ".first-run-details > summary" },
    { name: "record", selector: ".record-link a" },
    { name: "interface", selector: ".interface-link a" },
    { name: "install-note", selector: ".install-note a" },
    { name: "maker", selector: ".hraness-marketing-maker__links a" },
    { name: "ask-ai", selector: ".ask-ai a" },
    { name: "footer", selector: ".site-footer a" },
  ] : [...common,
    { name: "header-current", selector: '.hraness-marketing-header__nav a[aria-current="page"]' },
    { name: "spec-primary", selector: '.spec-actions a[data-emphasis="primary"]' },
    { name: "spec-secondary", selector: '.spec-actions a[data-emphasis="secondary"]' },
    { name: "ask-ai", selector: ".ask-ai a" }];
}

export function assertInteractionInventory(settings, result) {
  if (settings.expectedStatus === 404 || settings.media === "print") {
    assert.equal(result.applicable, false); return;
  }
  assert.equal(result.applicable, true);
  assert.deepEqual(result.links.map((entry) => entry.name), linkStateTargets(settings.route === "/").map((entry) => entry.name));
  if (settings.route === "/") {
    assert.equal(result.commands.length, 2);
    assert.deepEqual(result.commands.map((entry) => entry.index), [0, 1]);
    assert.equal(result.questions.length, 8);
    assert.deepEqual(result.questions.map((entry) => entry.index), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.ok(result.questions.every((entry) => entry.opened && entry.closed));
  }
}

export async function tabTo(page, target, limit = 180) {
  assert.equal(await target.count(), 1, "Keyboard target must be unique");
  for (let presses = 0; presses <= limit; presses++) {
    if (await target.evaluate((node) => node === document.activeElement)) return presses;
    if (presses < limit) await page.keyboard.press("Tab");
  }
  throw new Error("Native Tab did not reach the exact target");
}

export async function focusEvidence(target) {
  const state = await target.evaluate((node) => {
    const style = getComputedStyle(node);
    const fragments = [...node.getClientRects()].map((box) => {
      const left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
      const top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return { left, right, top, bottom, width: box.width, height: box.height,
        visible: right > left && bottom > top, ownedHit: hit === node || node.contains(hit) };
    });
    return { active: document.activeElement === node, visible: node.matches(":focus-visible"), fragments,
      outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset,
      outlineColor: style.outlineColor, boxShadow: style.boxShadow };
  });
  assert.ok(state.active && state.visible && state.fragments.some((box) => box.visible && box.ownedHit), "Native keyboard focus is not visible/hittable");
  assert.ok(state.outlineStyle !== "none" && Number.parseFloat(state.outlineWidth) > 0 || state.boxShadow !== "none", "Native focus ring missing");
  return state;
}

export async function proveRoles(page, settings) {
  if (settings.expectedStatus === 404) {
    assert.equal(await page.locator("h1").innerText(), "404");
    assert.match(await page.locator("body").innerText(), /This page could not be found/);
    assert.equal(await page.locator(".ask-ai").count(), 0);
    return { family: "missing", heading: "404" };
  }
  const home = settings.route === "/";
  assert.equal(await page.locator("main").count(), 1);
  assert.equal(await page.locator("main h1").count(), 1);
  assert.ok(await page.locator("main h1").isVisible());
  const counts = {};
  for (const [role, selector] of Object.entries(roles[home ? "home" : "spec"])) {
    counts[role] = await page.locator(selector).count();
    assert.ok(counts[role] > 0, "Missing native role: " + role);
  }
  assert.equal(counts.header, 1); assert.equal(counts.ask, 1);
  const ai = page.locator('.ask-ai a');
  assert.equal(await ai.count(), 4);
  const links = await ai.evaluateAll((nodes) => nodes.map((node) => ({ href: node.href, target: node.target, rel: node.rel })));
  for (const link of links) {
    assert.equal(new URL(link.href).protocol, "https:");
    assert.equal(link.target, "_blank"); assert.ok(link.rel.split(/\s+/).includes("noopener"));
  }
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  assert.equal(canonical, home ? "https://oh.computer" : "https://oh.computer/spec");
  if (home) {
    assert.equal(counts.citationRows, 4); assert.equal(counts.commands, 2); assert.equal(counts.footer, 1);
    assert.equal(counts.disclosure, 1);
    assert.equal(await page.locator("details.hraness-marketing-question").count(), 8);
    assert.equal(await page.locator("details.hraness-marketing-question[open]").count(), 0);
    assert.equal(await page.locator(".first-run-details").getAttribute("open"), null);
    assert.equal(await page.locator(".site-footer a").count(), 3);
    assert.equal(await page.locator(".interface-link").count(), 3);
    assert.match(await page.locator(".install-command").first().innerText(), /@hraness\/oh@0\.4\.3/);
  } else {
    assert.equal(counts.sections, 9);
    assert.equal(await page.locator(".spec-nav a").count(), 9);
    assert.equal(await page.locator(".fact-grid > div").count(), 6);
    assert.equal(await page.locator(".sequence > li").count(), 4);
    assert.equal(await page.locator(".spec-actions a").count(), 2);
    assert.equal(await page.locator(".site-footer").count(), 0);
  }
  const overflow = await page.locator("body").evaluate(() => ({
    width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(overflow.scroll <= overflow.width, "Document horizontal overflow");
  return { family: home ? "home" : "spec", counts, links, canonical, overflow };
}

async function stickyProof(page, settings, settle, record) {
  const home = settings.route === "/";
  const target = page.locator(home ? roles.home.traceHeading : roles.spec.nav);
  const container = page.locator(home ? "#trace" : ".spec-shell");
  const read = () => target.evaluate((node) => {
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return { position: style.position, top: box.top, height: box.height, inset: Number.parseFloat(style.top), scrollY };
  });
  // Scroll only the viewport; no CSS, focus, DOM or event-handler injection.
  await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: "instant" })); await settle();
  const initial = await read();
  const desktop = settings.width > 768;
  assert.equal(initial.position, desktop ? "sticky" : "static");
  if (desktop) {
    const bounds = await container.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top + scrollY, bottom: box.bottom + scrollY,
        maximum: document.documentElement.scrollHeight - innerHeight };
    });
    assert.ok(Number.isFinite(initial.inset));
    const firstY = Math.max(0, Math.ceil(initial.top - initial.inset + 20));
    const secondY = firstY + 40;
    assert.ok(secondY <= bounds.maximum && secondY + initial.inset + initial.height < bounds.bottom, "Sticky probe lacks genuine containing-block travel");
    await page.evaluate((top) => scrollTo({ top, left: 0, behavior: "instant" }), firstY); await settle();
    const first = await read();
    await page.evaluate((top) => scrollTo({ top, left: 0, behavior: "instant" }), secondY); await settle();
    const second = await read();
    assert.ok(Math.abs(first.top - initial.inset) <= 1 && Math.abs(second.top - initial.inset) <= 1);
    assert.ok(second.scrollY > first.scrollY);
    await record("sticky-active", false);
    return { initial, first, second, bounds };
  }
  await page.evaluate(() => scrollTo({ top: 200, left: 0, behavior: "instant" })); await settle();
  const moved = await read();
  assert.ok(Math.abs((initial.top - moved.top) - (moved.scrollY - initial.scrollY)) <= 1, "Static surface unexpectedly pins");
  await record("mobile-static", false);
  return { initial, moved };
}

export async function proveInteractions(page, settings, settle, record) {
  if (settings.media === "print" || settings.expectedStatus === 404) return { applicable: false, reason: settings.media === "print" ? "print" : "missing" };
  const home = settings.route === "/";
  const result = { applicable: true, javaScriptEnabled: settings.javaScriptEnabled };
  const skip = page.locator("a.skip-link");
  await page.keyboard.press("Tab");
  assert.ok(await skip.evaluate((node) => node === document.activeElement), "First native Tab must reach skip link");
  await settle(); result.skip = await focusEvidence(skip); await record("skip-focus", false);
  await page.keyboard.press("Enter"); await settle();
  assert.equal(await page.evaluate(() => location.hash), home ? "#main" : "#spec-main");
  if (home) assert.equal(await page.evaluate(() => document.activeElement.id), "main");
  // The existing spec main has no tabindex. Do not manufacture focus on it.
  result.skipDestination = await page.evaluate(() => ({ id: document.activeElement.id, tag: document.activeElement.tagName, scrollY }));
  const link = page.locator(home ? ".citation-preview > a" : ".spec-nav a").first();
  result.linkTabs = await tabTo(page, link); await settle();
  result.linkFocus = await focusEvidence(link); await record("link-focus", false);
  if (!settings.coarse) {
    await link.hover(); await settle();
    result.hover = await link.evaluate((node) => ({ color: getComputedStyle(node).color, decoration: getComputedStyle(node).textDecoration }));
    await record("link-hover", false);
  }
  if (settings.coarse) {
    const targets = page.locator(home ? ".site-footer a, .hraness-marketing-header__nav a" : ".spec-nav a, .hraness-marketing-header__nav a");
    result.coarseTargets = await targets.evaluateAll((nodes) => nodes.map((node) => ({ href: node.getAttribute("href"), height: node.getBoundingClientRect().height })));
    assert.ok(result.coarseTargets.length > 0 && result.coarseTargets.every((node) => node.height >= 48), "Coarse target lost its 3rem floor");
  }
  if (home) {
    const details = page.locator(".first-run-details"), summary = details.locator(":scope > summary");
    result.summaryTabs = await tabTo(page, summary); await settle(); result.summaryFocus = await focusEvidence(summary);
    await page.keyboard.press("Enter"); await settle(); assert.equal(await details.getAttribute("open"), "");
    assert.ok(await details.locator("pre").isVisible()); await record("first-run-open", false);
    await page.keyboard.press("Enter"); await settle(); assert.equal(await details.getAttribute("open"), null);
    result.commands = [];
    for (const index of [0, 1]) {
      const command = page.locator(".install-command").nth(index);
      const tabs = await tabTo(page, command); await settle(); const focus = await focusEvidence(command);
      const extent = () => command.evaluate((node) => ({ left: node.scrollLeft, width: node.clientWidth, maximum: Math.max(0, node.scrollWidth - node.clientWidth), overflow: getComputedStyle(node).overflowX }));
      const before = await extent(); let after = null;
      if (before.maximum > 0) {
        assert.ok(["auto", "scroll"].includes(before.overflow));
        await page.keyboard.press("ArrowRight"); await settle();
        after = await extent(); assert.ok(after.left > before.left && after.left <= after.maximum);
      }
      result.commands.push({ index, tabs, focus, before, after }); await record("command-" + index, false);
    }
    result.questions = [];
    const questions = page.locator("details.hraness-marketing-question");
    for (let index = 0; index < 8; index++) {
      const question = questions.nth(index), summary = question.locator(":scope > summary");
      const tabs = await tabTo(page, summary); await settle(); const focus = await focusEvidence(summary);
      const closedPseudo = await summary.evaluate((node) => getComputedStyle(node, "::after").transform);
      await page.keyboard.press("Enter"); await settle(); assert.equal(await question.getAttribute("open"), "");
      assert.ok(await question.locator(".hraness-marketing-question__answer").isVisible());
      const openPseudo = await summary.evaluate((node) => getComputedStyle(node, "::after").transform);
      assert.equal(closedPseudo, "none"); assert.notEqual(openPseudo, "none");
      result.questions.push({ index, tabs, focus, closedPseudo, openPseudo, opened: true, closed: false });
    }
    await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: "instant" })); await settle();
    await record("faq-all-open", true);
    for (let index = 0; index < 8; index++) {
      const question = questions.nth(index), summary = question.locator(":scope > summary");
      await tabTo(page, summary); await page.keyboard.press("Enter"); await settle();
      assert.equal(await question.getAttribute("open"), null); result.questions[index].closed = true;
    }
    await record("faq-all-closed", false);
  }
  result.links = [];
  for (const definition of linkStateTargets(home)) {
    const target = page.locator(definition.selector).first();
    const tabs = await tabTo(page, target); await settle();
    const focused = await focusEvidence(target); await record(definition.name + "-focus", false);
    let hover = null;
    if (!settings.coarse) {
      await target.hover(); await settle();
      hover = await target.evaluate((node) => ({ color: getComputedStyle(node).color,
        borderColor: getComputedStyle(node).borderColor, decoration: getComputedStyle(node).textDecoration }));
      await record(definition.name + "-hover", false);
    }
    result.links.push({ name: definition.name, tabs, focused, hover });
  }
  result.sticky = await stickyProof(page, settings, settle, record);
  assertInteractionInventory(settings, result);
  return result;
}
