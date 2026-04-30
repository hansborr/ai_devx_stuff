import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Pin root to this directory so `include` doesn't walk into compiled test
// artifacts under packages/*/dist when invoked from the repo root.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: "eslint-rules",
    root: here,
    include: ["*.test.js"],
    environment: "node",
  },
});
