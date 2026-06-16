import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultExclude, defineConfig } from "vitest/config";

// Pin root to this directory so `include` doesn't walk into compiled test
// artifacts under packages/*/dist when invoked from the repo root.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: "eslint-rules",
    clearMocks: true,
    root: here,
    include: ["*.test.js"],
    // `root` + non-recursive include already make worktree leakage impossible
    // here; kept for uniformity with the other project configs so a future
    // recursive `include` can't start sweeping git-ignored worktree duplicates.
    exclude: [...defaultExclude, "**/worktrees/**"],
    environment: "node",
  },
});
