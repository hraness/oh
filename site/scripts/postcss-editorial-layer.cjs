// eslint-disable-next-line @typescript-eslint/no-require-imports -- Next loads PostCSS factories as CommonJS.
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This plugin is loaded as CommonJS.
const { createHash } = require("node:crypto");

const preset = path.resolve(__dirname, "../vendor/hraness-marketing/product-marketing-preset.css");
const presetSha256 = "e1474dbfa5dcb17e840ecd48e2b767e88e808a1f6124cd9bb8fe720e1076a4a7";

// Next's CSS loader does not retain an @import layer() qualifier. Relocate only
// this verified snapshot's layer in the build AST, keeping its immutable bytes,
// relative assets, and every shared-package layer unchanged.
module.exports = () => ({
  postcssPlugin: "oh-editorial-layer",
  Once(root) {
    if (root.source?.input.file !== preset) return;
    if (createHash("sha256").update(root.source.input.css).digest("hex") !== presetSha256) {
      throw root.error("Unexpected editorial snapshot bytes; review its updated contract before building.");
    }
    const layers = root.nodes.filter((node) => node.type === "atrule" && node.name === "layer");
    if (layers.length !== 1 || layers[0].params !== "components.hraness-design-kit.legacy") {
      throw root.error("Unexpected editorial snapshot layer; review its updated contract before building.");
    }
    layers[0].params = "oh-marketing";
  },
});
module.exports.postcss = true;
