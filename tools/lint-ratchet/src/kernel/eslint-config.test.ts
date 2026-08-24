import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { LintRatchetConfig } from "./config-types.js";
import type { LintRatchetEngineBinding } from "./engine-context.js";
import {
  CACHE_HASH_PREFIX_LENGTH,
  cacheKeyHashFor,
  eslintCachePathFor,
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

describe("LintRatchetConfig", () => {
  it("rejects typeAwareProject on a minimal-ts ratchet", () => {
    expectTypeOf({
      ...minimalRatchet,
      typeAwareProject: "./tsconfig.custom.json",
    }).not.toExtend<LintRatchetConfig>();
    expect(minimalRatchet).not.toHaveProperty("typeAwareProject");
  });
});

describe("usesEslintCache", () => {
  it("returns true only for minimal-ts parser profiles", () => {
    expect(usesEslintCache(minimalRatchet)).toBe(true);
    expect(usesEslintCache(typeAwareRatchet)).toBe(false);
  });
});

describe("eslintCachePathFor", () => {
  it("keeps the default cache path and supports a repository-relative override", () => {
    const defaultPath = eslintCachePathFor(minimalRatchet, "sha256:rule-source-a", binding);
    const explicitDefaultPath = eslintCachePathFor(minimalRatchet, "sha256:rule-source-a", {
      ...binding,
      cacheDirectory: "node_modules/.cache/eslint-ratchet",
    });
    const overridePath = eslintCachePathFor(minimalRatchet, "sha256:rule-source-a", {
      ...binding,
      cacheDirectory: ".cache/custom-ratchet",
    });

    expect(explicitDefaultPath).toBe(defaultPath);
    expect(defaultPath).toContain("/node_modules/.cache/eslint-ratchet/");
    expect(overridePath).toContain("/.cache/custom-ratchet/");
  });
});

describe("writeEslintConfig", () => {
  it("renders projectService by default and an explicit type-aware project when configured", () => {
    const defaultPath = writeEslintConfig(typeAwareRatchet, "sha256:rule-source-a", binding);
    const explicitRatchet = {
      ...typeAwareRatchet,
      typeAwareProject: "./tsconfig.custom.json",
    } satisfies LintRatchetConfig;
    const explicitPath = writeEslintConfig(explicitRatchet, "sha256:rule-source-a", binding);
    const defaultRendered = readFileSync(defaultPath, "utf8");
    const explicitRendered = readFileSync(explicitPath, "utf8");

    expect(defaultRendered).toContain("        projectService: true,");
    expect(explicitRendered).toContain("        projectService: false,");
    expect(explicitRendered).toContain('        project: "./tsconfig.custom.json",');
  });

  it("loads named plugin exports without requiring a default export", () => {
    const configPath = writeEslintConfig(typeAwareRatchet, "sha256:rule-source-a", {
      ...binding,
      thirdPartyPluginAllowlist: [
        {
          pluginModule: "typescript-eslint",
          ruleNamespace: "@typescript-eslint",
          pluginExport: "plugin",
        },
      ],
    });
    const rendered = readFileSync(configPath, "utf8");

    expect(rendered).toContain('import * as ratchetedPluginModule from "typescript-eslint";');
    expect(rendered).toContain("const ratchetedPlugin = ratchetedPluginModule.plugin;");
    expect(rendered).not.toContain('import ratchetedPluginModule from "typescript-eslint";');
  });

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

  it("writes generated configs beneath an overridden cache directory", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-layout-"));
    try {
      const configPath = writeEslintConfig(coreRatchet, "sha256:rule-source-a", {
        ...binding,
        repoRoot,
        cacheDirectory: ".cache/custom-ratchet",
      });

      expect(configPath).toContain(`${repoRoot}/.cache/custom-ratchet/configs/`);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("renders a local rule import URL from the overridden rules directory", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-local-rules-"));
    const configDirectory = join(repoRoot, "generated-configs");
    try {
      const configPath = writeEslintConfig(
        minimalRatchet,
        "sha256:rule-source-a",
        {
          ...binding,
          repoRoot,
          localRulesDirectory: "build/lint-rules",
        },
        { configDirectory },
      );
      const expectedRuleUrl = pathToFileURL(
        join(repoRoot, "build/lint-rules/cache-key-test.js"),
      ).href;

      expect(readFileSync(configPath, "utf8")).toContain(
        `import ratchetedRule from ${JSON.stringify(expectedRuleUrl)};`,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
