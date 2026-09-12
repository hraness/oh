import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nextConfig from "../next.config";
import createPlugin from "../scripts/postcss-editorial-layer.cjs";

const preset = fileURLToPath(new URL("../vendor/hraness-marketing/product-marketing-preset.css", import.meta.url));
const css = readFileSync(preset, "utf8");
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
