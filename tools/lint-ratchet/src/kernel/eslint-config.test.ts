import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { LintRatchetConfig } from "./config-types.js";
import type { LintRatchetEngineBinding } from "./engine-context.js";
import {
  CACHE_HASH_PREFIX_LENGTH,
  cacheKeyHashFor,
  typeAwareProjectFor,
  usesEslintCache,
  writeEslintConfig,
} from "./eslint-config.js";

const minimalRatchet = {
  id: "ratchet/cache-key-test",
  ruleId: "local/cache-key-test",
  files: ["scripts/**/*.ts"],
  ignores: ["**/node_modules/**"],
  ruleOptions: [],
  mode: "no-new",
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

const coreRatchet = {
  ...minimalRatchet,
  id: "ratchet/cache-key-core-test",
  ruleId: "no-debugger",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
} satisfies LintRatchetConfig;

// Fixture binding: real repo root so version/rule-source reads resolve, plus the
// one third-party allowlist entry the typeAwareRatchet fixture needs.
const binding: LintRatchetEngineBinding = {
  repoRoot: fileURLToPath(new URL("../../../../", import.meta.url)),
  thirdPartyPluginAllowlist: [
    { pluginModule: "typescript-eslint", ruleNamespace: "@typescript-eslint" },
  ],
};

describe("cacheKeyHashFor", () => {
  it("returns a stable 12-character hex hash for the same ratchet and rule source", () => {
    const firstHash = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");
    const secondHash = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toHaveLength(CACHE_HASH_PREFIX_LENGTH);
    expect(firstHash).toMatch(/^[0-9a-f]{12}$/u);
  });

  it("changes when a config field that reaches the ESLint config changes", () => {
    const originalHash = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");
    const changedRatchet = {
      ...minimalRatchet,
      ruleOptions: [{ allowExtra: true }],
    } satisfies LintRatchetConfig;

    expect(cacheKeyHashFor(changedRatchet, "sha256:rule-source-a")).not.toBe(originalHash);
  });

  it("ignores metric changes that never reach the ESLint config", () => {
    // The metric affects post-parse interpretation only, so the same ESLint
    // invocation should share a cache entry rather than needlessly re-linting.
    const base = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");
    expect(
      cacheKeyHashFor(
        { ...minimalRatchet, metric: "effective-line-count" },
        "sha256:rule-source-a",
      ),
    ).toBe(base);
  });

  it("changes when the rule source hash changes", () => {
    const originalHash = cacheKeyHashFor(minimalRatchet, "sha256:rule-source-a");

    expect(cacheKeyHashFor(minimalRatchet, "sha256:rule-source-b")).not.toBe(originalHash);
  });
});

describe("typeAwareProjectFor", () => {
  it("prefers an explicit typeAwareProject override", () => {
    expect(
      typeAwareProjectFor({ ...minimalRatchet, typeAwareProject: "./tsconfig.custom.json" }),
    ).toBe("./tsconfig.custom.json");
  });

  it("infers the scripts tsconfig for a scripts/-only ratchet with no override", () => {
    expect(typeAwareProjectFor(minimalRatchet)).toBe("./tsconfig.scripts.json");
  });

  it("returns undefined (projectService default) otherwise", () => {
    expect(typeAwareProjectFor({ ...minimalRatchet, files: ["packages/**/*.ts"] })).toBeUndefined();
  });
});

describe("usesEslintCache", () => {
  it("returns true only for minimal-ts parser profiles", () => {
    expect(usesEslintCache(minimalRatchet)).toBe(true);
    expect(usesEslintCache(typeAwareRatchet)).toBe(false);
  });
});

describe("writeEslintConfig", () => {
  it("disables inline config comments for local, third-party, and core ratchets", () => {
    for (const ratchet of [minimalRatchet, typeAwareRatchet, coreRatchet]) {
      const configPath = writeEslintConfig(ratchet, "sha256:rule-source-a", binding);
      const rendered = readFileSync(configPath, "utf8");

      expect(rendered).toContain("  { linterOptions: { noInlineConfig: true } },\n");
    }
  });

  it("repairs a corrupt content-addressed config and reuses byte-identical content", () => {
    const configDirectory = mkdtempSync(join(tmpdir(), "lint-ratchet-config-"));
    try {
      const configPath = writeEslintConfig(coreRatchet, "sha256:rule-source-a", binding, {
        configDirectory,
      });
      writeFileSync(configPath, "truncated");
      const corruptInode = statSync(configPath).ino;

      writeEslintConfig(coreRatchet, "sha256:rule-source-a", binding, { configDirectory });
      expect(readFileSync(configPath, "utf8")).toContain("export default");
      const repairedInode = statSync(configPath).ino;
      expect(repairedInode).not.toBe(corruptInode);

      writeEslintConfig(coreRatchet, "sha256:rule-source-a", binding, { configDirectory });
      expect(statSync(configPath).ino).toBe(repairedInode);
    } finally {
      rmSync(configDirectory, { recursive: true, force: true });
    }
  });
});
