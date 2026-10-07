import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        headers: [
          { key: "Link", value: '</llms.txt>; rel="describedby"' },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
          },
        ],
        source: "/:path*",
      },
    ];
  },
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
