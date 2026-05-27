import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { computeLintRatchetConfigHash, ruleNamespace } from "../lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { ConfigError } from "../lint-ratchet-metrics.js";
import { repoRoot, safeRatchetId } from "./paths.js";
import { localRuleName, localRulePath, thirdPartySupportFor } from "./rule-source.js";
import { assertNever, ratchetParserProfile, ratchetSource } from "./runtime-config.js";

export const CACHE_HASH_PREFIX_LENGTH = 12;

export function cacheKeyHashFor(ratchet: LintRatchetConfig, ruleSourceHash: string): string {
  const eslintConfigRatchet = { ...ratchet, metric: "message-count" } satisfies LintRatchetConfig;
  const combined = createHash("sha256")
    .update(computeLintRatchetConfigHash(eslintConfigRatchet))
    .update("|")
    .update(ruleSourceHash)
    .digest("hex");
  return combined.slice(0, CACHE_HASH_PREFIX_LENGTH);
}

function eslintConfigPathFor(ratchet: LintRatchetConfig, ruleSourceHash: string): string {
  return join(
    repoRoot,
    "node_modules/.cache/eslint-ratchet/configs",
    `${safeRatchetId(ratchet.id)}-${cacheKeyHashFor(ratchet, ruleSourceHash)}.mjs`,
  );
}

export function eslintCachePathFor(ratchet: LintRatchetConfig, ruleSourceHash: string): string {
  return join(
    repoRoot,
    "node_modules/.cache/eslint-ratchet",
    `${safeRatchetId(ratchet.id)}-${cacheKeyHashFor(ratchet, ruleSourceHash)}`,
    ".eslintcache",
  );
}

export function usesEslintCache(ratchet: LintRatchetConfig): boolean {
  return ratchetParserProfile(ratchet) === "minimal-ts";
}

function writeLocalEslintConfig(ratchet: LintRatchetConfig, configPath: string): void {
  const rulePath = pathToFileURL(localRulePath(ratchet)).href;
  const ruleName = localRuleName(ratchet.ruleId);
  const rendered = [
    'import tseslint from "typescript-eslint";',
    `import ratchetedRule from ${JSON.stringify(rulePath)};`,
    "",
    "export default [",
    `  { ignores: ${JSON.stringify(ratchet.ignores)} },`,
    "  {",
    `    files: ${JSON.stringify(ratchet.files)},`,
    "    languageOptions: {",
    "      parser: tseslint.parser,",
    "      parserOptions: {",
    '        ecmaVersion: "latest",',
    '        sourceType: "module",',
    "        ecmaFeatures: { jsx: true },",
    "      },",
    "    },",
    `    plugins: { local: { rules: { ${JSON.stringify(ruleName)}: ratchetedRule } } },`,
    `    rules: { ${JSON.stringify(ratchet.ruleId)}: ${JSON.stringify(["error", ...ratchet.ruleOptions])} },`,
    "  },",
    "];",
    "",
  ].join("\n");
  writeFileSync(configPath, rendered);
}

function usesScriptsProject(ratchet: LintRatchetConfig): boolean {
  return ratchet.files.every((filePattern) => filePattern.startsWith("scripts/"));
}

function parserOptionsLines(ratchet: LintRatchetConfig): readonly string[] {
  const profile = ratchetParserProfile(ratchet);
  const common = [
    "      parserOptions: {",
    '        ecmaVersion: "latest",',
    '        sourceType: "module",',
    "        ecmaFeatures: { jsx: true },",
  ];
  if (profile === "minimal-ts") return [...common, "      },"];
  if (usesScriptsProject(ratchet)) {
    return [
      ...common,
      "        projectService: false,",
      '        project: "./tsconfig.scripts.json",',
      `        tsconfigRootDir: ${JSON.stringify(repoRoot)},`,
      "      },",
    ];
  }
  return [
    ...common,
    "        projectService: true,",
    `        tsconfigRootDir: ${JSON.stringify(repoRoot)},`,
    "      },",
  ];
}

function thirdPartyPluginImportLines(
  pluginModule: string,
  pluginExport: "default" | "plugin",
): readonly string[] {
  if (pluginExport === "default") {
    return [`import ratchetedPlugin from ${JSON.stringify(pluginModule)};`];
  }
  return [
    `import ratchetedPluginModule from ${JSON.stringify(pluginModule)};`,
    "const ratchetedPlugin = ratchetedPluginModule.plugin;",
  ];
}

function writeThirdPartyEslintConfig(ratchet: LintRatchetConfig, configPath: string): void {
  const source = ratchetSource(ratchet);
  if (source.kind !== "third-party") {
    throw new ConfigError(`ratchet ${ratchet.id}: expected third-party source`);
  }
  const support = thirdPartySupportFor(ratchet);
  const namespace = ruleNamespace(ratchet.ruleId);
  if (namespace === undefined) {
    throw new ConfigError(`ratchet ${ratchet.id}: ruleId is not namespaced`);
  }
  const rendered = [
    'import tseslint from "typescript-eslint";',
    ...thirdPartyPluginImportLines(source.pluginModule, support.pluginExport ?? "default"),
    "",
    "export default [",
    `  { ignores: ${JSON.stringify(ratchet.ignores)} },`,
    "  {",
    `    files: ${JSON.stringify(ratchet.files)},`,
    "    languageOptions: {",
    "      parser: tseslint.parser,",
    ...parserOptionsLines(ratchet),
    "    },",
    `    plugins: { ${JSON.stringify(namespace)}: ratchetedPlugin },`,
    `    rules: { ${JSON.stringify(ratchet.ruleId)}: ${JSON.stringify(["error", ...ratchet.ruleOptions])} },`,
    "  },",
    "];",
    "",
  ].join("\n");
  writeFileSync(configPath, rendered);
}

function writeCoreEslintConfig(ratchet: LintRatchetConfig, configPath: string): void {
  const source = ratchetSource(ratchet);
  if (source.kind !== "core") {
    throw new ConfigError(`ratchet ${ratchet.id}: expected core source`);
  }
  const rendered = [
    'import tseslint from "typescript-eslint";',
    "",
    "export default [",
    `  { ignores: ${JSON.stringify(ratchet.ignores)} },`,
    "  {",
    `    files: ${JSON.stringify(ratchet.files)},`,
    "    languageOptions: {",
    "      parser: tseslint.parser,",
    ...parserOptionsLines(ratchet),
    "    },",
    `    rules: { ${JSON.stringify(ratchet.ruleId)}: ${JSON.stringify(["error", ...ratchet.ruleOptions])} },`,
    "  },",
    "];",
    "",
  ].join("\n");
  writeFileSync(configPath, rendered);
}

export function writeEslintConfig(ratchet: LintRatchetConfig, ruleSourceHash: string): string {
  const configPath = eslintConfigPathFor(ratchet, ruleSourceHash);
  mkdirSync(dirname(configPath), { recursive: true });
  const source = ratchetSource(ratchet);
  switch (source.kind) {
    case "local":
      writeLocalEslintConfig(ratchet, configPath);
      break;
    case "third-party":
      writeThirdPartyEslintConfig(ratchet, configPath);
      break;
    case "core":
      writeCoreEslintConfig(ratchet, configPath);
      break;
    default:
      assertNever(source);
  }
  return configPath;
}
