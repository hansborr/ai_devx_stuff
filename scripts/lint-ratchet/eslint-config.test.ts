import { describe, expect, it } from "vitest";

import { CACHE_HASH_PREFIX_LENGTH, cacheKeyHashFor, usesEslintCache } from "./eslint-config.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";

const minimalRatchet = {
  id: "ratchet/cache-key-test",
  ruleId: "local/cache-key-test",
  files: ["scripts/**/*.ts"],
  ignores: ["**/node_modules/**"],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
  principle: "Keep the cache-key unit test fixture small and deterministic.",
} satisfies LintRatchetConfig;

const typeAwareRatchet = {
  ...minimalRatchet,
  id: "ratchet/cache-key-type-aware-test",
  ruleId: "@typescript-eslint/strict-boolean-expressions",
  source: { kind: "third-party", pluginModule: "typescript-eslint" },
  parserProfile: "type-aware-ts",
} satisfies LintRatchetConfig;

describe("cacheKeyHashFor", () => {
  it("returns a stable 12-character hex hash for the same ratchet and rule source", () => {
    const firstHash = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");
    const secondHash = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toHaveLength(CACHE_HASH_PREFIX_LENGTH);
    expect(firstHash).toMatch(/^[0-9a-f]{12}$/u);
  });

  it("changes when the ratchet config changes", () => {
    const originalHash = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");
    const changedRatchet = {
      ...minimalRatchet,
      target: 1,
    } satisfies LintRatchetConfig;

    expect(cacheKeyHashFor(changedRatchet, "sha256:rule-source-a")).not.toBe(originalHash);
  });

  it("changes when the rule source hash changes", () => {
    const originalHash = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");

    expect(cacheKeyHashFor(minimalRatchet, "sha256:rule-source-b")).not.toBe(originalHash);
  });
});

describe("usesEslintCache", () => {
  it("returns true only for minimal-ts parser profiles", () => {
    expect(usesEslintCache(minimalRatchet)).toBe(true);
    expect(usesEslintCache(typeAwareRatchet)).toBe(false);
  });
});
