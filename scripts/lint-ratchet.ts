import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { HARNESS_DIAGNOSTICS_SCHEMA_VERSION, harnessDiagnosticsSchema, summarizeHarnessFindings, type HarnessDiagnostics, type HarnessFinding } from "../packages/shared/src/schemas/harness-diagnostics.js";
import { LINT_RATCHET_CONFIG_HASH_PREFIX, buildLintRatchetBaseline, compareCurrentToBaseline, computeCoreLintRatchetRuleSourceHash, computeLintRatchetConfigHash, decideLintRatchetUpdate, formatLintRatchetBaseline, parseLintRatchetBaseline, parseLintRatchetBaselineStructure, ruleNamespace, validateLintRatchetRegistry, type LintRatchetComparison, type LintRatchetCurrentById, type LintRatchetCurrentItem, type LintRatchetImprovement, type LintRatchetRegression, type LintRatchetRuleSourceHashesById } from "./lint-ratchet-baseline.js";
import { lintRatchetThirdPartyPluginAllowlist, lintRatchets, type LintRatchetConfig, type LintRatchetParserProfile, type LintRatchetRuleSource, type LintRatchetThirdPartyPluginAllowlistEntry } from "./lint-ratchet-config.js";
import { ConfigError, parseComplexitySeverityMessage, type LintRatchetComplexityFunction } from "./lint-ratchet-metrics.js";
import { emitHarnessDiagnosticsEnvelope } from "./lint-ratchet-output.js";
import { LINT_RATCHET_REPORT_ARTIFACT_URL_ENV, runLintRatchetReport } from "./lint-ratchet-report.js";
import { runLintRatchetSummary } from "./lint-ratchet-summary.js";
import { formatRuleDocsFailures, loadLintRuleDocs, type RuleDocsEntry } from "./lint-rule-docs.js";

const PROCESS_ARG_OFFSET = 2;
const ESLINT_SEVERITY_ERROR = 2;
const BASELINE_FILENAME = "lint-ratchet.baseline.json";
const CACHE_HASH_PREFIX_LENGTH = 12;
const MAX_LINES_MESSAGE_PATTERN = /This file has (?<lines>\d+) effective lines, above the (?<max>\d+) line limit/u;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, BASELINE_FILENAME);

interface ESLintMessage { readonly ruleId: string | null; readonly severity: number; readonly message: string; readonly line?: number; readonly nodeType?: string; readonly messageId?: string; readonly fatal?: boolean; }
interface ESLintFileResult { readonly filePath: string; readonly messages: readonly ESLintMessage[]; }
interface ParsedArgs { readonly mode: "default" | "update" | "check-baseline" | "check-registry" | "summary" | "report"; readonly allowWorse: boolean; readonly reason?: string; }
interface ParsedArgsState { mode: ParsedArgs["mode"]; allowWorse: boolean; reason?: string; }

class UsageError extends Error {}
class WorseBaselineError extends Error {}

const parsedArgModes = new Map<string, Exclude<ParsedArgs["mode"], "default">>([
  ["--update", "update"],
  ["--check-baseline", "check-baseline"], ["--check-registry", "check-registry"],
  ["--summary", "summary"],
  ["--report", "report"],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setMode(state: ParsedArgsState, mode: Exclude<ParsedArgs["mode"], "default">): void { if (state.mode !== "default") throw new UsageError("choose only one mode"); state.mode = mode; }

function consumeReasonArgument(state: ParsedArgsState, args: readonly string[], index: number): number {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError("--reason requires a non-empty argument");
  }
  state.reason = value;
  return index + 2;
}

function unknownArgumentMessage(arg: string): string { return arg.startsWith("--input") ? "--input is not supported; use bun run lint:ratchet:report < diagnostics.json" : `Unknown argument: ${arg}`; }

function consumeParsedArg(state: ParsedArgsState, args: readonly string[], index: number): number {
  const arg = args[index] ?? "";
  const mode = parsedArgModes.get(arg);
  if (mode !== undefined) { setMode(state, mode); return index + 1; }
  switch (arg) {
    case "--": return index + 1;
    case "--allow-worse":
      state.allowWorse = true; return index + 1;
    case "--reason":
      return consumeReasonArgument(state, args, index);
    default:
      if (!arg.startsWith("--reason=")) throw new UsageError(unknownArgumentMessage(arg));
      state.reason = arg.slice("--reason=".length);
      return index + 1;
  }
}

function parseArgFlags(args: readonly string[]): ParsedArgsState {
  const state: ParsedArgsState = { mode: "default", allowWorse: false };
  let i = 0;
  while (i < args.length) {
    i = consumeParsedArg(state, args, i);
  }
  return state;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const { mode, allowWorse, reason } = parseArgFlags(args);
  if (allowWorse && mode !== "update") throw new UsageError("--allow-worse is only valid with --update");
  if (reason !== undefined && mode !== "update") throw new UsageError("--reason is only valid with --update");
  if (allowWorse && (reason?.trim() ?? "").length === 0) throw new UsageError("--allow-worse requires a non-empty --reason");
  return reason === undefined ? { mode, allowWorse } : { mode, allowWorse, reason };
}

function usage(): string {
  return [
    "usage: bun scripts/lint-ratchet.ts [--update [--allow-worse --reason <why>] | --check-baseline | --check-registry | --summary | --report]",
    "",
    "Default mode emits a harness-diagnostics envelope and fails on ratchet regressions or uncommitted improvements.",
    "--summary prints committed baseline totals without running ESLint; --report formats a diagnostics envelope from stdin.",
  ].join("\n");
}

function relativePath(filePath: string): string {
  if (!isAbsolute(filePath)) return filePath.replaceAll("\\", "/");
  const rel = relative(repoRoot, filePath);
  return rel === "" ? filePath : rel.replaceAll("\\", "/");
}

function safeRatchetId(id: string): string {
  return id.replaceAll("/", "-").replaceAll(/[^a-z0-9-]/gu, "-");
}

function ratchetSource(ratchet: LintRatchetConfig): LintRatchetRuleSource {
  return ratchet.source ?? { kind: "local" };
}

function ratchetParserProfile(ratchet: LintRatchetConfig): LintRatchetParserProfile {
  return ratchet.parserProfile ?? "minimal-ts";
}

function assertNever(value: never): never {
  throw new ConfigError(`unhandled lint ratchet source kind: ${JSON.stringify(value)}`);
}

function localRuleName(ruleId: string): string {
  const prefix = "local/";
  if (!ruleId.startsWith(prefix)) {
    throw new ConfigError(`local ratchet ruleId must start with local/: ${ruleId}`);
  }
  return ruleId.slice(prefix.length);
}

function localRulePath(ratchet: LintRatchetConfig): string {
  return join(repoRoot, "eslint-rules", `${localRuleName(ratchet.ruleId)}.js`);
}

function thirdPartySupportFor(
  ratchet: LintRatchetConfig,
): LintRatchetThirdPartyPluginAllowlistEntry {
  const source = ratchetSource(ratchet);
  if (source.kind !== "third-party") {
    throw new ConfigError(`ratchet ${ratchet.id}: expected third-party source`);
  }
  const namespace = ruleNamespace(ratchet.ruleId);
  const support = lintRatchetThirdPartyPluginAllowlist.find(
    (entry) =>
      entry.pluginModule === source.pluginModule && entry.ruleNamespace === namespace,
  );
  if (support === undefined) {
    throw new ConfigError(
      `ratchet ${ratchet.id}: third-party plugin ${source.pluginModule} for namespace ${namespace ?? "(unknown)"} is not allowlisted`,
    );
  }
  return support;
}

function packageJsonPath(packageName: string): string {
  return join(repoRoot, "node_modules", ...packageName.split("/"), "package.json");
}

function readPackageVersion(packageName: string, packageLabel: string): string {
  const packageJsonFile = packageJsonPath(packageName);
  const displayName = `${packageLabel} ${packageName}`;
  if (!existsSync(packageJsonFile)) {
    throw new ConfigError(`${displayName} was not found at ${packageJsonFile}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(packageJsonFile, "utf8"));
  if (!isRecord(parsed) || typeof parsed.version !== "string") {
    throw new ConfigError(`${displayName} has no version`);
  }
  return parsed.version;
}

function readThirdPartyPluginVersion(pluginModule: string): string {
  return readPackageVersion(pluginModule, "third-party plugin package");
}

function readEslintPackageVersion(): string {
  return readPackageVersion("eslint", "ESLint package");
}

function computeLocalLintRatchetRuleSourceHash(ratchet: LintRatchetConfig): string {
  const path = localRulePath(ratchet);
  if (!existsSync(path)) {
    throw new ConfigError(`ratchet ${ratchet.id}: rule source not found at ${path}`);
  }
  const content = readFileSync(path);
  const hash = createHash("sha256").update(content).digest("hex");
  return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
}

function computeLintRatchetRuleSourceHash(ratchet: LintRatchetConfig): string {
  const source = ratchetSource(ratchet);
  switch (source.kind) {
    case "local":
      return computeLocalLintRatchetRuleSourceHash(ratchet);
    case "third-party": {
      const support = thirdPartySupportFor(ratchet);
      const sourceIdentity = {
        kind: "third-party",
        pluginExport: support.pluginExport ?? "default",
        pluginModule: source.pluginModule,
        pluginVersion: readThirdPartyPluginVersion(source.pluginModule),
        ruleNamespace: support.ruleNamespace,
      };
      const hash = createHash("sha256")
        .update(JSON.stringify(sourceIdentity))
        .digest("hex");
      return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
    }
    case "core":
      return computeCoreLintRatchetRuleSourceHash(ratchet, readEslintPackageVersion());
    default:
      return assertNever(source);
  }
}

function buildRuleSourceHashesById(
  ratchets: readonly LintRatchetConfig[],
): LintRatchetRuleSourceHashesById {
  const map = new Map<string, string>();
  for (const ratchet of ratchets) {
    map.set(ratchet.id, computeLintRatchetRuleSourceHash(ratchet));
  }
  return map;
}

function cacheKeyHashFor(ratchet: LintRatchetConfig, ruleSourceHash: string): string {
  // Cache identity must invalidate when EITHER the ratchet config or the
  // local rule implementation changes; the config hash alone covers config
  // drift but reuses stale findings if the rule itself is edited.
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

function eslintCachePathFor(ratchet: LintRatchetConfig, ruleSourceHash: string): string {
  return join(
    repoRoot,
    "node_modules/.cache/eslint-ratchet",
    `${safeRatchetId(ratchet.id)}-${cacheKeyHashFor(ratchet, ruleSourceHash)}`,
    ".eslintcache",
  );
}

function usesEslintCache(ratchet: LintRatchetConfig): boolean {
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
  if (profile === "minimal-ts") {
    return [...common, "      },"];
  }
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

function writeThirdPartyEslintConfig(
  ratchet: LintRatchetConfig,
  configPath: string,
): void {
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

function writeCoreEslintConfig(
  ratchet: LintRatchetConfig,
  configPath: string,
): void {
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

function writeEslintConfig(ratchet: LintRatchetConfig, ruleSourceHash: string): string {
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

function isEslintMessage(value: unknown): value is ESLintMessage {
  if (!isRecord(value)) return false;
  if (typeof value.message !== "string") return false;
  if (typeof value.severity !== "number") return false;
  const ruleId = value.ruleId;
  return ruleId === null || typeof ruleId === "string";
}

function parseEslintOutput(stdout: string): readonly ESLintFileResult[] {
  if (stdout.trim().length === 0) return [];
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new ConfigError("ESLint --format=json output is not an array");
  }
  const results: ESLintFileResult[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    if (typeof entry.filePath !== "string") continue;
    if (!Array.isArray(entry.messages)) continue;
    const messages: ESLintMessage[] = [];
    for (const raw of entry.messages) {
      if (isEslintMessage(raw)) messages.push(raw);
    }
    results.push({ filePath: entry.filePath, messages });
  }
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sweepStaleCacheSiblings(ratchet: LintRatchetConfig, currentHash: string): void {
  const id = safeRatchetId(ratchet.id);
  const liveCachePrefix = `${id}-${currentHash}`;
  const liveConfigName = `${liveCachePrefix}.mjs`;
  const cacheRoot = join(repoRoot, "node_modules/.cache/eslint-ratchet");
  const configRoot = join(cacheRoot, "configs");
  // Match `<safe-id>-<12 hex chars>` exactly so a sibling ratchet whose safe-id
  // begins with this one's safe-id as a hyphen-prefix (e.g. `foo` vs
  // `foo-extended`) is not swept. Hash length is pinned by CACHE_HASH_PREFIX_LENGTH.
  const hexHash = `[0-9a-f]{${String(CACHE_HASH_PREFIX_LENGTH)}}`;
  const cacheEntryPattern = new RegExp(`^${escapeRegExp(id)}-${hexHash}$`);
  const configEntryPattern = new RegExp(`^${escapeRegExp(id)}-${hexHash}\\.mjs$`);
  const cacheLiveEntry = usesEslintCache(ratchet) ? liveCachePrefix : undefined;
  for (const [dir, liveEntry, pattern] of [
    [cacheRoot, cacheLiveEntry, cacheEntryPattern],
    [configRoot, liveConfigName, configEntryPattern],
  ] as const) {
    if (!existsSync(dir)) continue;
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!pattern.test(entry)) continue;
      if (entry === liveEntry) continue;
      rmSync(join(dir, entry), { recursive: true, force: true });
    }
  }
}

async function runEslint(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
): Promise<readonly ESLintFileResult[]> {
  sweepStaleCacheSiblings(ratchet, cacheKeyHashFor(ratchet, ruleSourceHash));
  const configPath = writeEslintConfig(ratchet, ruleSourceHash);
  const cacheArgs: string[] = [];
  if (usesEslintCache(ratchet)) {
    const cachePath = eslintCachePathFor(ratchet, ruleSourceHash);
    mkdirSync(dirname(cachePath), { recursive: true });
    cacheArgs.push("--cache", "--cache-location", cachePath);
  }
  const args = [
    "--format=json",
    "--no-error-on-unmatched-pattern",
    ...cacheArgs,
    "--config",
    configPath,
    ...ratchet.files,
  ];

  return new Promise((resolveResults, rejectResults) => {
    const child = spawn(resolve(repoRoot, "node_modules/.bin/eslint"), args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectResults);
    child.on("close", (code) => {
      if (stdout.trim().length === 0) {
        rejectResults(
          new ConfigError(
            `ESLint produced no JSON output for ${ratchet.id}. exit=${String(code)} stderr:\n${stderr}`,
          ),
        );
        return;
      }
      if (code !== 0 && code !== 1) {
        rejectResults(
          new ConfigError(
            `ESLint failed for ${ratchet.id}. exit=${String(code)} stderr:\n${stderr}`,
          ),
        );
        return;
      }
      try {
        resolveResults(parseEslintOutput(stdout));
      } catch (error) {
        rejectResults(error);
      }
    });
  });
}

function minDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

interface MetricFinding { readonly lines?: number; readonly complexity?: LintRatchetComplexityFunction; }

function makeCurrentItem(count: number, firstLine: number | undefined, lines: number | undefined, perFunction: readonly LintRatchetComplexityFunction[] | undefined): LintRatchetCurrentItem {
  return { count, ...(firstLine === undefined ? {} : { firstLine }), ...(lines === undefined ? {} : { lines }), ...(perFunction === undefined ? {} : { perFunction }) };
}

function mergeLines(previous: LintRatchetCurrentItem | undefined, metric: MetricFinding): number | undefined {
  if (metric.lines === undefined) return previous?.lines;
  if (previous?.lines === undefined) return metric.lines;
  return Math.max(previous.lines, metric.lines);
}

function mergePerFunction(previous: LintRatchetCurrentItem | undefined, metric: MetricFinding): readonly LintRatchetComplexityFunction[] | undefined {
  return metric.complexity === undefined ? previous?.perFunction : [...(previous?.perFunction ?? []), metric.complexity];
}

function addFinding(items: Map<string, LintRatchetCurrentItem>, path: string, line: number | undefined, metric: MetricFinding): void {
  const previous = items.get(path);
  items.set(path, makeCurrentItem((previous?.count ?? 0) + 1, minDefined(previous?.firstLine, line), mergeLines(previous, metric), mergePerFunction(previous, metric)));
}

function effectiveLineCountFor(ratchet: LintRatchetConfig, path: string, message: ESLintMessage): number | undefined {
  if (ratchet.metric !== "effective-line-count") return undefined;
  if (ratchet.ruleId !== "local/max-lines") {
    throw new ConfigError(`ratchet ${ratchet.id}: effective-line-count requires local/max-lines`);
  }
  const lines = MAX_LINES_MESSAGE_PATTERN.exec(message.message)?.groups?.lines;
  if (lines === undefined) {
    throw new ConfigError(`ratchet ${ratchet.id}: could not parse effective line count for ${path}: ${message.message}`);
  }
  return Number(lines);
}

function metricFindingFor(ratchet: LintRatchetConfig, path: string, message: ESLintMessage): MetricFinding {
  if (ratchet.metric === "effective-line-count") return { lines: effectiveLineCountFor(ratchet, path, message) };
  if (ratchet.metric !== "complexity-severity") return {};
  if (ratchet.ruleId !== "complexity") throw new ConfigError(`ratchet ${ratchet.id}: complexity-severity requires complexity`);
  return { complexity: parseComplexitySeverityMessage(ratchet.id, path, message) };
}

async function collectCurrentById(
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): Promise<LintRatchetCurrentById> {
  const currentById = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const ratchet of lintRatchets) {
    const ruleSourceHash = ruleSourceHashesById.get(ratchet.id);
    if (ruleSourceHash === undefined) {
      throw new ConfigError(
        `lint:ratchet: missing rule source hash for ${ratchet.id}`,
      );
    }
    const results = await runEslint(ratchet, ruleSourceHash);
    const items = new Map<string, LintRatchetCurrentItem>();
    for (const result of results) {
      const path = relativePath(result.filePath);
      for (const message of result.messages) {
        if (message.ruleId === null && (message.fatal === true || message.severity === ESLINT_SEVERITY_ERROR)) {
          throw new ConfigError(
            `ESLint could not parse ${path}: ${message.message}`,
          );
        }
        if (message.ruleId !== ratchet.ruleId) continue;
        addFinding(items, path, message.line, metricFindingFor(ratchet, path, message));
      }
    }
    currentById.set(ratchet.id, items);
  }
  return currentById;
}

function totalCurrentCount(currentById: LintRatchetCurrentById): number {
  let total = 0;
  for (const items of currentById.values()) {
    for (const item of items.values()) {
      total += item.count;
    }
  }
  return total;
}

async function loadRuleDocsById(): Promise<ReadonlyMap<string, RuleDocsEntry>> {
  const { entries, failures } = await loadLintRuleDocs(repoRoot);
  if (failures.length > 0) {
    throw new ConfigError(formatRuleDocsFailures(failures));
  }
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function howToFixFor(entry: RuleDocsEntry, regression: LintRatchetRegression): string {
  const ratchetFix = ratchetFixText(regression);
  if (entry.repairKind === "codemod") {
    if (entry.repairCommand === undefined) {
      throw new ConfigError(`Rule ${entry.id} declares repairKind=codemod without repairCommand`);
    }
    return `Run \`${entry.repairCommand}\`, then ${ratchetFix}`;
  }
  if (entry.repairKind === "autofix") {
    return `Run \`bun run lint:fix\`, then ${ratchetFix}`;
  }
  if (entry.repairKind === "suggestion") {
    return `Apply the ESLint suggestion, then ${ratchetFix}`;
  }
  return `Repair manually following the paired guide (${entry.pairedGuide}), then ${ratchetFix}`;
}

function ratchetFixText(regression: LintRatchetRegression): string {
  if (regression.currentLines !== undefined) {
    const target = regression.baselineLines === undefined ? "until this new path has no ratcheted finding" : `back to the committed baseline (${String(regression.baselineLines)})`;
    return `Reduce this file's ${regression.ruleId} effective line count from ${String(regression.currentLines)} ${target}, or run ` + "`bun run lint:ratchet:update` in a cleanup PR when the baseline movement is intentional.";
  }
  if (regression.currentComplexity !== undefined) return `Reduce this file's ${regression.ruleId} complexity from ${String(regression.currentComplexity)} ${regression.baselineComplexity === undefined ? "until this new path has no ratcheted finding" : `back to the committed baseline (${String(regression.baselineComplexity)})`}, or run ` + "`bun run lint:ratchet:update` in a cleanup PR when the baseline movement is intentional.";
  return (
    `Reduce this file's ${regression.ruleId} finding count from ${String(regression.currentCount)} ` +
    `back to the committed baseline (${String(regression.baselineCount)}), or run ` +
    "`bun run lint:ratchet:update` in a cleanup PR when the baseline movement is intentional."
  );
}

function regressionDetail(regression: LintRatchetRegression): string {
  if (regression.currentLines !== undefined) return regression.baselineLines === undefined ? `${regression.testId} ${regression.path}: new path has ${String(regression.currentLines)} effective lines` : `${regression.testId} ${regression.path}: effective lines increased from ${String(regression.baselineLines)} to ${String(regression.currentLines)}`;
  if (regression.currentComplexity !== undefined) return regression.baselineComplexity === undefined ? `${regression.testId} ${regression.path}: new path has complexity ${String(regression.currentComplexity)}` : `${regression.testId} ${regression.path}: complexity increased from ${String(regression.baselineComplexity)} to ${String(regression.currentComplexity)}`;
  return `${regression.testId} ${regression.path}: finding count increased from ${String(regression.baselineCount)} to ${String(regression.currentCount)}`;
}

function improvementDetail(improvement: LintRatchetImprovement): string {
  if (improvement.currentLines !== undefined) return `${improvement.testId} ${improvement.path}: effective lines decreased from ${String(improvement.baselineLines)} to ${String(improvement.currentLines)}`;
  if (improvement.currentComplexity !== undefined) return `${improvement.testId} ${improvement.path}: complexity decreased from ${String(improvement.baselineComplexity)} to ${String(improvement.currentComplexity)}`;
  return `${improvement.testId} ${improvement.path}: finding count decreased from ${String(improvement.baselineCount)} to ${String(improvement.currentCount)}`;
}

export function assertCheckBaselineComparisonClean(comparison: LintRatchetComparison): void {
  const regressionMessage = comparison.regressions.length === 0 ? undefined : `current findings are worse than ${BASELINE_FILENAME} for ${String(comparison.regressions.length)} path(s): ${comparison.regressions.map(regressionDetail).join("; ")}`;
  const improvementMessage = comparison.improvements.length === 0 ? undefined : `current findings are better than ${BASELINE_FILENAME} for ${String(comparison.improvements.length)} path(s): ${comparison.improvements.map(improvementDetail).join("; ")}`;
  if (regressionMessage === undefined && improvementMessage === undefined) return;
  const suffix = improvementMessage === undefined ? "run bun run lint:ratchet for details" : comparison.regressions.length === 0 ? "run bun run lint:ratchet:update" : "fix regressions, then run bun run lint:ratchet:update";
  throw new WorseBaselineError(`${[regressionMessage, improvementMessage].filter((message): message is string => message !== undefined).join("; ")}; ${suffix}`);
}

function structuredRatchetFields(delta: LintRatchetRegression | LintRatchetImprovement) {
  return { reason: delta.reason, baselineCount: delta.baselineCount, currentCount: delta.currentCount, ...(delta.baselineLines === undefined ? {} : { baselineLines: delta.baselineLines }), ...(delta.currentLines === undefined ? {} : { currentLines: delta.currentLines }), ...(delta.baselineComplexity === undefined ? {} : { baselineComplexity: delta.baselineComplexity }), ...(delta.currentComplexity === undefined ? {} : { currentComplexity: delta.currentComplexity }) };
}

function buildLocalFinding(
  regression: LintRatchetRegression,
  ruleDocsById: ReadonlyMap<string, RuleDocsEntry>,
): HarnessFinding {
  const entry = ruleDocsById.get(regression.ruleId);
  if (entry === undefined) {
    throw new ConfigError(`No local rule metadata found for ${regression.ruleId}`);
  }
  const base = {
    control: regression.testId,
    severity: "block",
    path: regression.path,
    ruleId: regression.ruleId,
    ...structuredRatchetFields(regression),
    why: `Ratchet regression: ${entry.principle}`,
    howToFix: howToFixFor(entry, regression),
    repairKind: entry.repairKind,
  } as const;
  const withLine = regression.line === undefined ? base : { ...base, line: regression.line };
  if (entry.repairKind === "codemod" && entry.repairCommand !== undefined) {
    return { ...withLine, repairCommand: entry.repairCommand };
  }
  return withLine;
}

function buildGenericFinding(regression: LintRatchetRegression): HarnessFinding {
  const base = {
    control: regression.testId,
    severity: "block",
    path: regression.path,
    ruleId: regression.ruleId,
    ...structuredRatchetFields(regression),
    why: `Ratchet regression for ${regression.ruleId}.`,
    howToFix: ratchetFixText(regression),
    repairKind: "manual",
  } as const;
  return regression.line === undefined ? base : { ...base, line: regression.line };
}

function buildFinding(
  regression: LintRatchetRegression,
  ruleDocsById: ReadonlyMap<string, RuleDocsEntry>,
  ratchetsById: ReadonlyMap<string, LintRatchetConfig>,
): HarnessFinding {
  const ratchet = ratchetsById.get(regression.testId);
  if (ratchet === undefined) {
    throw new ConfigError(`No ratchet registry entry found for ${regression.testId}`);
  }
  const source = ratchetSource(ratchet);
  switch (source.kind) {
    case "local":
      return buildLocalFinding(regression, ruleDocsById);
    case "third-party":
    case "core":
      return buildGenericFinding(regression);
    default:
      return assertNever(source);
  }
}

function buildImprovementFinding(improvement: LintRatchetImprovement): HarnessFinding {
  return { control: improvement.testId, severity: "block", path: improvement.path, ruleId: improvement.ruleId, ...structuredRatchetFields(improvement), why: `Current tree is better than the committed baseline for ${improvement.ruleId}; lock it in.`, howToFix: "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.", repairKind: "manual" };
}

export function buildEnvelope(
  regressions: readonly LintRatchetRegression[], improvements: readonly LintRatchetImprovement[],
  ruleDocsById: ReadonlyMap<string, RuleDocsEntry>, ratchets: readonly LintRatchetConfig[],
): HarnessDiagnostics {
  const ratchetsById = new Map(ratchets.map((ratchet) => [ratchet.id, ratchet]));
  const findings = [...regressions.map((regression) => buildFinding(regression, ruleDocsById, ratchetsById)), ...improvements.map(buildImprovementFinding)];
  findings.sort((left, right) => {
    const controlCompare = left.control.localeCompare(right.control);
    if (controlCompare !== 0) return controlCompare;
    const pathCompare = (left.path ?? "").localeCompare(right.path ?? "");
    if (pathCompare !== 0) return pathCompare;
    return (left.line ?? 0) - (right.line ?? 0);
  });
  return {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: "lint:ratchet",
    findings,
    summary: summarizeHarnessFindings(findings),
  };
}

function readBaseline(): string {
  if (!existsSync(baselinePath)) {
    throw new ConfigError(`${BASELINE_FILENAME} does not exist; run bun run lint:ratchet:update`);
  }
  return readFileSync(baselinePath, "utf8");
}

async function runCheckRegistry(): Promise<void> { await (await import("./lint-ratchet-check-registry.js")).runLintRatchetCheckRegistry(); } function runSummary(): void { process.stdout.write(runLintRatchetSummary({ baselinePath, registry: lintRatchets })); }

function runReport(): void { const artifactName = process.env[LINT_RATCHET_REPORT_ARTIFACT_URL_ENV]; process.stdout.write(runLintRatchetReport(artifactName === undefined || artifactName.length === 0 ? {} : { artifactName })); }

function parseCommittedBaseline(ruleSourceHashesById: LintRatchetRuleSourceHashesById) {
  const parsed = parseLintRatchetBaseline(readBaseline(), lintRatchets, ruleSourceHashesById);
  if (parsed.baseline === undefined) {
    throw new ConfigError(parsed.failures.join("\n"));
  }
  return parsed.baseline;
}

function parseCommittedBaselineStructure() {
  const parsed = parseLintRatchetBaselineStructure(readBaseline());
  if (parsed.baseline === undefined) {
    throw new ConfigError(parsed.failures.join("\n"));
  }
  return parsed.baseline;
}

function validateEnvelope(envelope: HarnessDiagnostics): void {
  const result = harnessDiagnosticsSchema.safeParse(envelope);
  if (!result.success) {
    throw new ConfigError(
      `lint:ratchet produced an envelope that failed schema validation:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
}

async function validateRegistry(): Promise<void> {
  const ruleDocsById = await loadRuleDocsById();
  const failures = validateLintRatchetRegistry(lintRatchets, {
    localRuleIds: new Set(ruleDocsById.keys()),
    thirdPartyPlugins: lintRatchetThirdPartyPluginAllowlist,
  });
  if (failures.length > 0) {
    throw new ConfigError(`Invalid lint ratchet registry:\n${failures.join("\n")}`);
  }
}

async function runDefault(): Promise<void> {
  const ruleDocsById = await loadRuleDocsById();
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const baseline = parseCommittedBaseline(ruleSourceHashesById);
  const currentById = await collectCurrentById(ruleSourceHashesById);
  const comparison = compareCurrentToBaseline(baseline, lintRatchets, currentById);
  const envelope = buildEnvelope(comparison.regressions, comparison.improvements, ruleDocsById, lintRatchets);
  validateEnvelope(envelope);
  emitHarnessDiagnosticsEnvelope(envelope);
  const label = comparison.regressions.length + comparison.improvements.length > 0 ? "FAIL" : "OK";
  console.error(
    `lint:ratchet ${label} — ${String(totalCurrentCount(currentById))} current finding(s); ` +
      `${String(comparison.regressions.length)} regression(s); ${String(comparison.improvements.length)} improvement(s); ` +
      `blocking=${String(envelope.summary.blocking)} ` +
      `warning=${String(envelope.summary.warning)} info=${String(envelope.summary.info)}`,
  );
  if (comparison.regressions.length + comparison.improvements.length > 0) process.exitCode = 1;
}

async function runUpdate(args: ParsedArgs): Promise<void> {
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const currentById = await collectCurrentById(ruleSourceHashesById);
  const generated = buildLintRatchetBaseline(
    lintRatchets,
    currentById,
    ruleSourceHashesById,
  );
  const rendered = formatLintRatchetBaseline(generated);
  const parsedGenerated = parseLintRatchetBaseline(
    rendered, lintRatchets, ruleSourceHashesById,
  );
  if (parsedGenerated.baseline === undefined) {
    throw new ConfigError(`generated baseline failed validation:\n${parsedGenerated.failures.join("\n")}`);
  }

  if (existsSync(baselinePath)) {
    // Use structural parse: update mode must be able to refresh stale
    // metadata (files/ignores/ruleOptions/configHash drift or new/removed
    // registry entries) while still rejecting count regressions. Malformed
    // JSON remains a hard error.
    const committed = parseCommittedBaselineStructure();
    const decision = decideLintRatchetUpdate(committed, generated, lintRatchets, args);
    if (!decision.allowed) {
      throw new WorseBaselineError(decision.failures.join("\n"));
    }
  }

  const currentText = existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : "";
  if (currentText === rendered) {
    console.error(
      `lint:ratchet:update OK — ${BASELINE_FILENAME} already matches ${String(totalCurrentCount(currentById))} current finding(s).`,
    );
    return;
  }
  writeFileSync(baselinePath, rendered);
  console.error(
    `lint:ratchet:update OK — wrote ${BASELINE_FILENAME} with ${String(totalCurrentCount(currentById))} current finding(s).`,
  );
}

async function runCheckBaseline(): Promise<void> {
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const baseline = parseCommittedBaseline(ruleSourceHashesById);
  const currentById = await collectCurrentById(ruleSourceHashesById);
  const comparison = compareCurrentToBaseline(baseline, lintRatchets, currentById);
  assertCheckBaselineComparisonClean(comparison);
  const currentCount = totalCurrentCount(currentById);
  console.error(`lint:ratchet:check-baseline OK — ${String(currentCount)} current finding(s).`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  if (args.mode === "report") { runReport(); return; }
  await validateRegistry();
  if (args.mode === "check-registry") { await runCheckRegistry(); return; } if (args.mode === "summary") { runSummary(); return; }
  if (args.mode === "update") {
    await runUpdate(args);
    return;
  }
  if (args.mode === "check-baseline") {
    await runCheckBaseline();
    return;
  }
  await runDefault();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`lint:ratchet: ${error.message}\n${usage()}`);
      process.exitCode = 2;
    } else if (error instanceof ConfigError) {
      console.error(`lint:ratchet: ${error.message}`);
      process.exitCode = 2;
    } else if (error instanceof WorseBaselineError) {
      console.error(`lint:ratchet: ${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
