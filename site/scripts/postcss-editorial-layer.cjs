// eslint-disable-next-line @typescript-eslint/no-require-imports -- Next loads PostCSS factories as CommonJS.
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This plugin is loaded as CommonJS.
const { createHash } = require("node:crypto");

const preset = path.resolve(__dirname, "../vendor/hraness-marketing/product-marketing-preset.css");
const presetSha256 = "221fd555f9c9c15e26fc8d7d8ad3a536e3dfb138df699b449adb9c45919e66cb";
const material = path.resolve(__dirname, "../vendor/hraness-lantern/lantern-material.css");
const materialSha256 = "003034ac332f392a16950495ad4967a1ba78c61eda8035aa914cd4da18a70f1e";

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
