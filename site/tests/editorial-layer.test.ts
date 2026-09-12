import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import createPlugin from "../scripts/postcss-editorial-layer.cjs";

const preset = fileURLToPath(new URL("../vendor/hraness-marketing/product-marketing-preset.css", import.meta.url));
const layer = (params = "components.hraness-design-kit.legacy") => ({ type: "atrule", name: "layer", params });
const root = (file: string, nodes: ReturnType<typeof layer>[]) => ({
  source: { input: { file } }, nodes, error: (message: string) => new Error(message),
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
