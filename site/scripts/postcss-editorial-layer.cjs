// eslint-disable-next-line @typescript-eslint/no-require-imports -- Next loads PostCSS factories as CommonJS.
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This plugin is loaded as CommonJS.
const { createHash } = require("node:crypto");

const preset = path.resolve(__dirname, "../vendor/hraness-marketing/product-marketing-preset.css");
const presetSha256 = "4dd3eb9fa525c157727a8bd7618a942fd0834553c5e5bdf9772783ce8c9bf9b1";
const material = path.resolve(__dirname, "../vendor/hraness-lantern/lantern-material.css");
const materialSha256 = "b5f45a3675cfd05b33b991e28dc417e852a81aaf5a8eac58c058dd87e9003c86";

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
