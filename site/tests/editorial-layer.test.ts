import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nextConfig from "../next.config";
import createPlugin from "../scripts/postcss-editorial-layer.cjs";
import { withReducedTransparency } from "../scripts/browser-transparency.mjs";

const preset = fileURLToPath(new URL("../vendor/hraness-marketing/product-marketing-preset.css", import.meta.url));
const css = readFileSync(preset, "utf8");
const material = fileURLToPath(new URL("../vendor/hraness-lantern/lantern-material.css", import.meta.url));
const materialCss = readFileSync(material, "utf8");
const layer = (params = "components.hraness-design-kit.legacy") => ({ type: "atrule", name: "layer", params });
const root = (file: string, nodes: ReturnType<typeof layer>[]) => ({
  source: { input: { file, css } }, nodes, error: (message: string) => new Error(message),
});

test("relocates only the checked editorial layer and preserves all other AST nodes", () => {
  const font = { type: "atrule", name: "font-face", params: "" };
  const editorial = layer();
  const input = root(preset, [font, editorial]);
  createPlugin().Once(input);
  expect(input.nodes).toEqual([font, layer("oh-marketing")]);
  expect(input.nodes[0]).toBe(font);
  expect(input.nodes[1]).toBe(editorial);
});

test("never rewrites package styles or a same-named file elsewhere", () => {
  for (const file of [preset.replace("/vendor/", "/node_modules/"), `${preset}.other`]) {
    const input = root(file, [layer()]);
    createPlugin().Once(input);
    expect(input.nodes).toEqual([layer()]);
  }
});

test("fails closed when the checked snapshot changes its layer inventory", () => {
  for (const nodes of [[], [layer("other")], [layer(), layer()]]) {
    const input = root(preset, nodes);
    const before = structuredClone(nodes);
    expect(() => createPlugin().Once(input)).toThrow("Unexpected editorial snapshot layer");
    expect(nodes).toEqual(before);
  }
});

test("fails closed on changed vendor bytes without touching the AST", () => {
  const input = root(preset, [layer()]);
  input.source.input.css += "\n/* unreviewed snapshot change */";
  expect(() => createPlugin().Once(input)).toThrow("Unexpected editorial snapshot bytes");
  expect(input.nodes).toEqual([layer()]);
});

test("tracks both PostCSS inputs without replacing other Webpack cache dependencies", () => {
  const configure = nextConfig.webpack;
  if (!configure) throw new Error("The PostCSS cache bridge must be configured.");
  const config = { cache: {
    type: "filesystem", version: "retained", buildDependencies: { config: ["next.config.ts"], postcss: ["existing.cjs"] },
  } };
  const result = configure(config, {} as Parameters<typeof configure>[1]);
  expect(result).toBe(config);
  expect(config.cache.version).toBe("retained");
  expect(config.cache.buildDependencies.config).toEqual(["next.config.ts"]);
  expect(config.cache.buildDependencies.postcss).toEqual([
    "existing.cjs",
    fileURLToPath(new URL("../postcss.config.mjs", import.meta.url)),
    fileURLToPath(new URL("../scripts/postcss-editorial-layer.cjs", import.meta.url)),
  ]);
  for (const cache of [false, undefined, { type: "memory" }]) {
    const other = { cache };
    expect(configure(other, {} as Parameters<typeof configure>[1])).toBe(other);
    expect(other.cache).toBe(cache);
  }
});

test("relocates only the admitted Lantern paint layer, preserving base tokens and node identities", () => {
  const base = layer("base"), paint = layer(), comment = { type: "comment", name: "", params: "retained" };
  const input = root(material, [base, comment, paint]);
  input.source.input.css = materialCss;
  createPlugin().Once(input);
  expect(input.nodes).toEqual([layer("base"), comment, layer("oh-material")]);
  expect(input.nodes[0]).toBe(base);
  expect(input.nodes[1]).toBe(comment);
  expect(input.nodes[2]).toBe(paint);
});

test("Lantern refuses unknown, missing, duplicate or reordered layers before changing any node", () => {
  for (const nodes of [[], [layer()], [layer("base")], [layer("base"), layer(), layer()],
    [layer(), layer("base")], [layer("other"), layer()], [layer("base"), layer("other")]]) {
    const input = root(material, nodes); input.source.input.css = materialCss;
    const before = structuredClone(nodes);
    expect(() => createPlugin().Once(input)).toThrow("Unexpected Lantern snapshot layer");
    expect(nodes).toEqual(before);
  }
  const changed = root(material, [layer("base"), layer()]);
  changed.source.input.css = `${materialCss}\n/* changed */`;
  expect(() => createPlugin().Once(changed)).toThrow("Unexpected Lantern snapshot bytes");
  expect(changed.nodes).toEqual([layer("base"), layer()]);
  for (const file of [material.replace("/vendor/", "/node_modules/"), `${material}.other`]) {
    const input = root(file, [layer("base"), layer()]); input.source.input.css = materialCss;
    createPlugin().Once(input);
    expect(input.nodes).toEqual([layer("base"), layer()]);
  }
});

test("Lantern layer relocation preserves arbitrary interleaved inert nodes and their identities", () => {
  let seed = 0x19f081ac;
  for (let run = 0; run < 64; run++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const inert = Array.from({ length: seed % 17 }, (_, index) => ({
      type: "comment", name: "", params: `inert-${seed}-${index}`,
    }));
    const base = layer("base"), paint = layer();
    const split = seed % (inert.length + 1);
    const nodes = [...inert.slice(0, split), base, ...inert.slice(split), paint];
    const before = nodes.slice(), input = root(material, nodes);
    input.source.input.css = materialCss;
    createPlugin().Once(input);
    expect(input.nodes.length).toBe(before.length);
    for (let index = 0; index < nodes.length; index++) expect(nodes[index]).toBe(before[index]);
    expect(base.params).toBe("base");
    expect(paint.params).toBe("oh-material");
    expect(nodes.filter(node => node !== base && node !== paint)).toEqual(inert);
  }
});

test("native transparency override changes only its preference and restores media, scroll and session on success or failure", async () => {
  for (const failure of [false, true]) {
    const initial = { scrollX: 0, scrollY: 321, features: [
      { name: "prefers-color-scheme", value: "dark" },
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-reduced-transparency", value: "no-preference" },
      { name: "forced-colors", value: "none" },
    ] };
    const sent: unknown[] = [], scrolled: unknown[] = [];
    let detached = false, verified = 0;
    const session = {
      send: async (name: string, input: unknown) => { expect(name).toBe("Emulation.setEmulatedMedia"); sent.push(input); },
      detach: async () => { detached = true; },
    };
    const page = {
      context: () => ({ newCDPSession: async () => session }),
      evaluate: async (_callback: unknown, input?: unknown) => {
        if (input === undefined) return structuredClone(initial);
        if (Array.isArray(input)) { verified++; return true; }
        scrolled.push(input);
      },
    };
    const cause = new Error("inspection failed");
    const operation = withReducedTransparency(page, async () => { if (failure) throw cause; });
    if (failure) await expect(operation).rejects.toBe(cause);
    else await operation;
    expect(sent).toEqual([
      { features: initial.features.map(feature => feature.name === "prefers-reduced-transparency" ? { ...feature, value: "reduce" } : feature) },
      { features: initial.features },
    ]);
    expect(verified).toBe(2);
    expect(scrolled).toEqual([initial]);
    expect(detached).toBe(true);
  }
});
