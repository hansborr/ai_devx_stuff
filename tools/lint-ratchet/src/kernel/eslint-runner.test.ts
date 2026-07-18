import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveEslintBinPath } from "./eslint-runner.js";

describe("resolveEslintBinPath", () => {
  it("resolves ESLint's JS entry to an existing file", () => {
    // Pins the expectation that eslint/package.json's bin.eslint resolves — an
    // ESLint major that relocates the bin fails here loudly, not as a spawn
    // ENOENT deep inside a ratchet run.
    const binPath = resolveEslintBinPath();
    expect(binPath.endsWith("eslint.js")).toBe(true);
    expect(existsSync(binPath)).toBe(true);
  });

  it("memoizes the resolved path across calls", () => {
    expect(resolveEslintBinPath()).toBe(resolveEslintBinPath());
  });
});
