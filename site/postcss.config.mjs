import { fileURLToPath } from "node:url";

const config = {
  plugins: {
    [fileURLToPath(new URL("./scripts/postcss-editorial-layer.cjs", import.meta.url))]: {},
  },
};

export default config;
