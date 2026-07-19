import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { writeFileAtomicallySync } from "./atomic-write.js";
import { ruleNamespace } from "./baseline.js";
import { normalizeRuleOptions, normalizeStringList } from "./baseline-hash.js";
import type { LintRatchetConfig } from "./config-types.js";
import { type LintRatchetEngineBinding, safeRatchetId } from "./engine-context.js";
import { ConfigError } from "./metrics-types.js";
import { localRuleName, localRulePath, thirdPartySupportFor } from "./rule-source.js";
import { assertNever, ratchetParserProfile, ratchetSource } from "./runtime-config.js";

export const CACHE_HASH_PREFIX_LENGTH = 12;

interface WriteEslintConfigOptions {
  readonly configDirectory?: string;
}

// The ESLint cache is keyed by exactly what changes the generated config text
// and its findings — files/ignores/ruleId/ruleOptions/source/parserProfile plus
// the rule-source hash — and NOTHING else. Reusing computeLintRatchetConfigHash
// here pulled in `mode` and `target`, which never reach writeEslintConfig, so
// editing either needlessly invalidated the cache. `metric` is likewise excluded
// (it only affects post-parse interpretation, not the ESLint invocation).
export function cacheKeyHashFor(ratchet: LintRatchetConfig, ruleSourceHash: string): string {
  const cacheKeyInput = {
    files: normalizeStringList(ratchet.files),
    ignores: normalizeStringList(ratchet.ignores),
    ruleId: ratchet.ruleId,
    ruleOptions: normalizeRuleOptions(ratchet.ruleOptions),
    source: ratchetSource(ratchet),
    parserProfile: ratchetParserProfile(ratchet),
    // Only the explicit override needs listing; the scripts/-prefix inference is
    // a pure function of `files`, already covered above. Undefined ⇒ dropped by
    // JSON.stringify ⇒ no cache-key change for ratchets that don't set it.
    typeAwareProject: ratchet.typeAwareProject,
    ruleSourceHash,
  };
  const combined = createHash("sha256").update(JSON.stringify(cacheKeyInput)).digest("hex");
  return combined.slice(0, CACHE_HASH_PREFIX_LENGTH);
}

function defaultEslintConfigDirectory(repoRoot: string): string {
  return join(repoRoot, "node_modules/.cache/eslint-ratchet/configs");
}

function eslintConfigPathFor(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
  repoRoot: string,
  options: WriteEslintConfigOptions,
): string {
  return join(
    options.configDirectory ?? defaultEslintConfigDirectory(repoRoot),
    `${safeRatchetId(ratchet.id)}-${cacheKeyHashFor(ratchet, ruleSourceHash)}.mjs`,
  );
}

export function eslintCachePathFor(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
  repoRoot: string,
): string {
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

const noInlineConfigEntry = "  { linterOptions: { noInlineConfig: true } },";

function renderLocalEslintConfig(ratchet: LintRatchetConfig, repoRoot: string): string {
  const rulePath = pathToFileURL(localRulePath(ratchet, repoRoot)).href;
  const ruleName = localRuleName(ratchet.ruleId);
  return [
    'import tseslint from "typescript-eslint";',
    `import ratchetedRule from ${JSON.stringify(rulePath)};`,
    "",
    "export default [",
    noInlineConfigEntry,
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
}

// The tsconfig a type-aware ratchet's generated config should use, or undefined
// for the `projectService: true` default. An explicit `typeAwareProject` wins;
// otherwise a ratchet scoped entirely to `scripts/` infers the scripts tsconfig
// (a Musi-registry convenience — see LintRatchetConfig.typeAwareProject).
export function typeAwareProjectFor(ratchet: LintRatchetConfig): string | undefined {
  if (ratchet.typeAwareProject !== undefined) return ratchet.typeAwareProject;
  if (ratchet.files.every((filePattern) => filePattern.startsWith("scripts/"))) {
    return "./tsconfig.scripts.json";
  }
  return undefined;
}

function parserOptionsLines(ratchet: LintRatchetConfig, repoRoot: string): readonly string[] {
  const profile = ratchetParserProfile(ratchet);
  const common = [
    "      parserOptions: {",
    '        ecmaVersion: "latest",',
    '        sourceType: "module",',
    "        ecmaFeatures: { jsx: true },",
  ];
  if (profile === "minimal-ts") return [...common, "      },"];
  const project = typeAwareProjectFor(ratchet);
  if (project !== undefined) {
    return [
      ...common,
      "        projectService: false,",
      `        project: ${JSON.stringify(project)},`,
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

function renderThirdPartyEslintConfig(
  ratchet: LintRatchetConfig,
  binding: LintRatchetEngineBinding,
): string {
  const source = ratchetSource(ratchet);
  if (source.kind !== "third-party") {
    throw new ConfigError(`ratchet ${ratchet.id}: expected third-party source`);
  }
  const support = thirdPartySupportFor(ratchet, binding.thirdPartyPluginAllowlist);
  const namespace = ruleNamespace(ratchet.ruleId);
  if (namespace === undefined) {
    throw new ConfigError(`ratchet ${ratchet.id}: ruleId is not namespaced`);
  }
  return [
    'import tseslint from "typescript-eslint";',
    ...thirdPartyPluginImportLines(source.pluginModule, support.pluginExport ?? "default"),
    "",
    "export default [",
    noInlineConfigEntry,
    `  { ignores: ${JSON.stringify(ratchet.ignores)} },`,
    "  {",
    `    files: ${JSON.stringify(ratchet.files)},`,
    "    languageOptions: {",
    "      parser: tseslint.parser,",
    ...parserOptionsLines(ratchet, binding.repoRoot),
    "    },",
    `    plugins: { ${JSON.stringify(namespace)}: ratchetedPlugin },`,
    `    rules: { ${JSON.stringify(ratchet.ruleId)}: ${JSON.stringify(["error", ...ratchet.ruleOptions])} },`,
    "  },",
    "];",
    "",
  ].join("\n");
}

function renderCoreEslintConfig(ratchet: LintRatchetConfig, repoRoot: string): string {
  const source = ratchetSource(ratchet);
  if (source.kind !== "core") {
    throw new ConfigError(`ratchet ${ratchet.id}: expected core source`);
  }
  return [
    'import tseslint from "typescript-eslint";',
    "",
    "export default [",
    noInlineConfigEntry,
    `  { ignores: ${JSON.stringify(ratchet.ignores)} },`,
    "  {",
    `    files: ${JSON.stringify(ratchet.files)},`,
    "    languageOptions: {",
    "      parser: tseslint.parser,",
    ...parserOptionsLines(ratchet, repoRoot),
    "    },",
    `    rules: { ${JSON.stringify(ratchet.ruleId)}: ${JSON.stringify(["error", ...ratchet.ruleOptions])} },`,
    "  },",
    "];",
    "",
  ].join("\n");
}

function renderEslintConfig(ratchet: LintRatchetConfig, binding: LintRatchetEngineBinding): string {
  const source = ratchetSource(ratchet);
  switch (source.kind) {
    case "local":
      return renderLocalEslintConfig(ratchet, binding.repoRoot);
    case "third-party":
      return renderThirdPartyEslintConfig(ratchet, binding);
    case "core":
      return renderCoreEslintConfig(ratchet, binding.repoRoot);
    default:
      return assertNever(source);
  }
}

export function writeEslintConfig(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
  binding: LintRatchetEngineBinding,
  options: WriteEslintConfigOptions = {},
): string {
  const configPath = eslintConfigPathFor(ratchet, ruleSourceHash, binding.repoRoot, options);
  mkdirSync(dirname(configPath), { recursive: true });
  const rendered = renderEslintConfig(ratchet, binding);
  if (!existsSync(configPath) || readFileSync(configPath, "utf8") !== rendered) {
    writeFileAtomicallySync(configPath, rendered);
  }
  return configPath;
}
