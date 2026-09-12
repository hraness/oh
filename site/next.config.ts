import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  webpack(config) {
    // Next does not register custom PostCSS inputs in its filesystem cache.
    // Imported CSS must be reprocessed when the editorial layer bridge changes.
    if (config.cache && typeof config.cache === "object" && config.cache.type === "filesystem") {
      config.cache.buildDependencies ??= {};
      config.cache.buildDependencies.postcss = [
        ...(config.cache.buildDependencies.postcss ?? []),
        fileURLToPath(new URL("./postcss.config.mjs", import.meta.url)),
        fileURLToPath(new URL("./scripts/postcss-editorial-layer.cjs", import.meta.url)),
      ];
    }
    return config;
  },
};

export default nextConfig;
