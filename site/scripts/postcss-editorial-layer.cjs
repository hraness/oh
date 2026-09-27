// eslint-disable-next-line @typescript-eslint/no-require-imports -- Next loads PostCSS factories as CommonJS.
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This plugin is loaded as CommonJS.
const { createHash } = require("node:crypto");

const preset = path.resolve(__dirname, "../vendor/hraness-marketing/product-marketing-preset.css");
const presetSha256 = "f410fdaec2bc7b5d3316b499689b060c34cb38e66662e0ed2bbfbd7dfa70ef4e";
const material = path.resolve(__dirname, "../vendor/hraness-lantern/lantern-material.css");
const materialSha256 = "7d455c4eabdf3204f2b5cf3b0497de1f722f007ab0bd25013e9ba5691a60c863";

// Next's CSS loader does not retain an @import layer() qualifier. Relocate only
// these verified snapshots' layers in the build AST, keeping immutable bytes,
// relative assets, and every shared-package layer unchanged.
module.exports = () => ({
  postcssPlugin: "oh-editorial-layer",
  Once(root) {
    const file = root.source?.input.file;
    if (file !== preset && file !== material) return;
    const lantern = file === material;
    const name = lantern ? "Lantern" : "editorial";
    if (createHash("sha256").update(root.source.input.css).digest("hex") !== (lantern ? materialSha256 : presetSha256)) {
      throw root.error(`Unexpected ${name} snapshot bytes; review its updated contract before building.`);
    }
    const layers = root.nodes.filter((node) => node.type === "atrule" && node.name === "layer");
    const expected = lantern ? ["base", "components.hraness-design-kit.legacy"] : ["components.hraness-design-kit.legacy"];
    if (layers.length !== expected.length || layers.some((node, index) => node.params !== expected[index])) {
      throw root.error(`Unexpected ${name} snapshot layer; review its updated contract before building.`);
    }
    layers[lantern ? 1 : 0].params = lantern ? "oh-material" : "oh-marketing";
  },
});
module.exports.postcss = true;
