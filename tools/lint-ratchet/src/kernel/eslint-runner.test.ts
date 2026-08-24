import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { LintRatchetConfig } from "./config-types.js";
import { cacheKeyHashFor } from "./eslint-config.js";
import { resolveEslintBinPath, sweepStaleCacheSiblings } from "./eslint-runner.js";

const minimalRatchet = {
  id: "ratchet/cache-sweep-test",
  ruleId: "no-debugger",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["scripts/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  principle: "Keep the stale-cache sweep containment fixture deterministic.",
} satisfies LintRatchetConfig;

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

describe("sweepStaleCacheSiblings", () => {
  it("removes stale siblings only beneath the binding's overridden cache root", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-sweep-"));
    const cacheDirectory = ".cache/custom-ratchet";
    const customRoot = join(repoRoot, cacheDirectory);
    const defaultRoot = join(repoRoot, "node_modules/.cache/eslint-ratchet");
    const currentHash = cacheKeyHashFor(minimalRatchet, "sha256:current");
    const liveName = `ratchet-cache-sweep-test-${currentHash}`;
    const staleName = "ratchet-cache-sweep-test-aaaaaaaaaaaa";
    try {
      for (const root of [customRoot, defaultRoot]) {
        mkdirSync(join(root, "configs"), { recursive: true });
        mkdirSync(join(root, staleName), { recursive: true });
        writeFileSync(join(root, "configs", `${staleName}.mjs`), "stale");
      }
      mkdirSync(join(customRoot, liveName), { recursive: true });
      writeFileSync(join(customRoot, "configs", `${liveName}.mjs`), "live");

      sweepStaleCacheSiblings(minimalRatchet, "sha256:current", {
        repoRoot,
        thirdPartyPluginAllowlist: [],
        cacheDirectory,
      });

      expect(existsSync(join(customRoot, staleName))).toBe(false);
      expect(existsSync(join(customRoot, "configs", `${staleName}.mjs`))).toBe(false);
      expect(existsSync(join(customRoot, liveName))).toBe(true);
      expect(existsSync(join(customRoot, "configs", `${liveName}.mjs`))).toBe(true);
      expect(existsSync(join(defaultRoot, staleName))).toBe(true);
      expect(existsSync(join(defaultRoot, "configs", `${staleName}.mjs`))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
