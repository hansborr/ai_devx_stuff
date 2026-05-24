import { createHash } from "node:crypto";

import { compareCurrentToBaseline as compareCurrentToBaselineImpl } from "./lint-ratchet-baseline-compare.js";
import { parseBaselineTest } from "./lint-ratchet-baseline-parse.js";
import type { JsonObject, JsonValue, LintRatchetConfig, LintRatchetMetric, LintRatchetMode, LintRatchetParserProfile, LintRatchetRuleSource, LintRatchetThirdPartyPluginAllowlistEntry } from "./lint-ratchet-config.js";
import { type LintRatchetMetricItem, metricItemForFormat, validateMetricItem } from "./lint-ratchet-metrics.js";

const LINT_RATCHET_BASELINE_VERSION = 1 as const;
export const LINT_RATCHET_CONFIG_HASH_PREFIX = "sha256:" as const;

type LintRatchetBaselineItem = LintRatchetMetricItem;
interface LintRatchetBaselineTest { readonly ruleId: string; readonly mode: LintRatchetMode; readonly target: number; readonly metric: LintRatchetMetric; readonly files: readonly string[]; readonly ignores: readonly string[]; readonly ruleOptions: readonly JsonValue[]; readonly configHash: string; readonly ruleSourceHash: string; readonly items: Readonly<Record<string, LintRatchetBaselineItem>>; }

export type LintRatchetRuleSourceHashesById = ReadonlyMap<string, string>;

export interface LintRatchetBaseline { readonly version: typeof LINT_RATCHET_BASELINE_VERSION; readonly tests: Readonly<Record<string, LintRatchetBaselineTest>>; }

export interface LintRatchetCurrentItem extends LintRatchetBaselineItem { readonly firstLine?: number; }

export type LintRatchetCurrentById = ReadonlyMap<string, ReadonlyMap<string, LintRatchetCurrentItem>>;

export interface LintRatchetRegression { readonly testId: string; readonly ruleId: string; readonly path: string; readonly baselineCount: number; readonly currentCount: number; readonly baselineLines?: number; readonly currentLines?: number; readonly baselineComplexity?: number; readonly currentComplexity?: number; readonly line?: number; readonly reason: "new-path" | "increased-count" | "increased-lines" | "increased-complexity"; }

export interface LintRatchetImprovement { readonly testId: string; readonly ruleId: string; readonly path: string; readonly baselineCount: number; readonly currentCount: number; readonly baselineLines?: number; readonly currentLines?: number; readonly baselineComplexity?: number; readonly currentComplexity?: number; readonly reason: "removed-path" | "lower-count" | "lower-lines" | "lower-complexity"; }

export interface LintRatchetComparison { readonly regressions: readonly LintRatchetRegression[]; readonly improvements: readonly LintRatchetImprovement[]; }

export interface LintRatchetUpdateDecision extends LintRatchetComparison { readonly allowed: boolean; readonly failures: readonly string[]; }

export interface ParsedLintRatchetBaseline { readonly baseline?: LintRatchetBaseline; readonly failures: readonly string[]; }

export interface StructuralLintRatchetBaseline { readonly baseline?: LintRatchetBaseline; readonly failures: readonly string[]; }

const IMPLEMENTED_MODES = new Set<LintRatchetMode>(["no-new"]);
const IMPLEMENTED_METRICS = new Set<LintRatchetMetric>(["complexity-severity", "effective-line-count", "message-count"]);
const IMPLEMENTED_PARSER_PROFILES = new Set<LintRatchetParserProfile>(["minimal-ts", "type-aware-ts"]);
const RATCHET_ID_PATTERN = /^ratchet\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LOCAL_RULE_ID_PATTERN = /^local\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CORE_RULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
export const RULE_ID_PATTERN = /^(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+|@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)$/u;
const PACKAGE_SPECIFIER_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

interface ValidateLintRatchetRegistryOptions { readonly localRuleIds?: ReadonlySet<string>; readonly thirdPartyPlugins?: readonly LintRatchetThirdPartyPluginAllowlistEntry[]; }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => isJsonValue(entry));
}

function isJsonObjectValue(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }
  if (isJsonObjectValue(value)) {
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeJsonValue(value[key] ?? null);
    }
    return normalized;
  }
  return value;
}

function normalizeStringList(values: readonly string[]): readonly string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function normalizeRuleOptions(values: readonly JsonValue[]): readonly JsonValue[] {
  return values.map((value) => normalizeJsonValue(value));
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(normalizeJsonValue(value));
}

function lintRatchetSource(config: LintRatchetConfig): LintRatchetRuleSource {
  return config.source ?? { kind: "local" };
}

function lintRatchetParserProfile(config: LintRatchetConfig): LintRatchetParserProfile {
  return config.parserProfile ?? "minimal-ts";
}

function assertNever(value: never): never {
  throw new Error(`unhandled lint ratchet source kind: ${JSON.stringify(value)}`);
}

export function ruleNamespace(ruleId: string): string | undefined {
  if (!RULE_ID_PATTERN.test(ruleId)) return undefined;
  const parts = ruleId.split("/");
  if (parts.length >= 3 && parts[0]?.startsWith("@") === true) {
    const scope = parts[0];
    const packageName = parts[1];
    return packageName === undefined ? undefined : `${scope}/${packageName}`;
  }
  return parts[0];
}

function ruleSourceHashInput(config: LintRatchetConfig): JsonObject | undefined {
  const source = lintRatchetSource(config);
  const parserProfile = lintRatchetParserProfile(config);
  switch (source.kind) {
    case "local":
      if (parserProfile === "minimal-ts") return undefined;
      return {
        parserProfile,
        source: { kind: "local" },
      };
    case "third-party":
      return {
        parserProfile,
        source: {
          kind: "third-party",
          pluginModule: source.pluginModule,
        },
      };
    case "core":
      return {
        parserProfile,
        source: { kind: "core" },
      };
    default:
      return assertNever(source);
  }
}

function configHashInput(config: LintRatchetConfig): JsonObject {
  const base: JsonObject = {
    files: normalizeStringList(config.files),
    ignores: normalizeStringList(config.ignores),
    metric: config.metric,
    mode: config.mode,
    ruleId: config.ruleId,
    ruleOptions: normalizeRuleOptions(config.ruleOptions),
    target: config.target,
  };
  const sourceInput = ruleSourceHashInput(config);
  return sourceInput === undefined ? base : { ...base, ...sourceInput };
}

export function computeLintRatchetConfigHash(config: LintRatchetConfig): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(configHashInput(config)))
    .digest("hex");
  return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
}

export function computeCoreLintRatchetRuleSourceHash(
  config: LintRatchetConfig,
  eslintVersion: string,
): string {
  const source = lintRatchetSource(config);
  if (source.kind !== "core") {
    throw new Error(`ratchet ${config.id}: expected core source`);
  }
  const sourceIdentity: JsonObject = {
    kind: "core",
    ruleId: config.ruleId,
    ruleOptions: normalizeRuleOptions(config.ruleOptions),
    eslintVersion,
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(sourceIdentity))
    .digest("hex");
  return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
}

function isSortedUnique(values: readonly string[]): boolean {
  let previous: string | undefined;
  for (const value of values) {
    if (previous !== undefined && previous.localeCompare(value) >= 0) {
      return false;
    }
    previous = value;
  }
  return true;
}

function hasNormalizedPath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && !value.startsWith("./");
}

function duplicateScopeKey(config: LintRatchetConfig): string {
  const base: JsonObject = {
    files: normalizeStringList(config.files),
    ignores: normalizeStringList(config.ignores),
    mode: config.mode,
    ruleId: config.ruleId,
    ruleOptions: normalizeRuleOptions(config.ruleOptions),
  };
  const sourceInput = ruleSourceHashInput(config);
  return JSON.stringify(sourceInput === undefined ? base : { ...base, ...sourceInput });
}

function thirdPartyAllowlistKey(pluginModule: string, ruleNamespace: string): string {
  return `${pluginModule}\u0000${ruleNamespace}`;
}

function isReadonlyStringSet(
  value: ReadonlySet<string> | ValidateLintRatchetRegistryOptions,
): value is ReadonlySet<string> {
  if (!isRecord(value)) return false;
  return typeof value.has === "function" && typeof value.forEach === "function";
}

function normalizeRegistryOptions(
  optionsOrLocalRuleIds?: ReadonlySet<string> | ValidateLintRatchetRegistryOptions,
): ValidateLintRatchetRegistryOptions {
  if (optionsOrLocalRuleIds === undefined) return {};
  if (isReadonlyStringSet(optionsOrLocalRuleIds)) {
    return { localRuleIds: optionsOrLocalRuleIds };
  }
  return optionsOrLocalRuleIds;
}

type ThirdPartyRatchetSource = Extract<LintRatchetRuleSource, { readonly kind: "third-party" }>;

interface ValidateRatchetEntryContext {
  readonly localRuleIds: ReadonlySet<string> | undefined;
  readonly allowedThirdPartyPlugins: ReadonlySet<string>;
  readonly seenScopes: Map<string, string>;
}

function validateThirdPartyPluginAllowlistEntry(
  entry: LintRatchetThirdPartyPluginAllowlistEntry,
  allowedThirdPartyPlugins: Set<string>,
  seenThirdPartyPlugins: Set<string>,
  failures: string[],
): void {
  const key = thirdPartyAllowlistKey(entry.pluginModule, entry.ruleNamespace);
  if (!PACKAGE_SPECIFIER_PATTERN.test(entry.pluginModule)) {
    failures.push(`third-party allowlist: pluginModule must be a package name: ${entry.pluginModule}`);
  }
  if (ruleNamespace(`${entry.ruleNamespace}/fixture-rule`) !== entry.ruleNamespace) {
    failures.push(`third-party allowlist: ruleNamespace is invalid: ${entry.ruleNamespace}`);
  }
  if (entry.pluginExport !== undefined && entry.pluginExport !== "default" && entry.pluginExport !== "plugin") {
    failures.push(`third-party allowlist: pluginExport is invalid for ${entry.pluginModule}`);
  }
  if (seenThirdPartyPlugins.has(key)) {
    failures.push(
      `third-party allowlist: duplicate pluginModule/ruleNamespace entry for ${entry.pluginModule} ${entry.ruleNamespace}`,
    );
  }
  seenThirdPartyPlugins.add(key);
  allowedThirdPartyPlugins.add(key);
}

function validateThirdPartyPluginAllowlist(
  thirdPartyPlugins: readonly LintRatchetThirdPartyPluginAllowlistEntry[],
  failures: string[],
): ReadonlySet<string> {
  const allowedThirdPartyPlugins = new Set<string>();
  const seenThirdPartyPlugins = new Set<string>();
  for (const entry of thirdPartyPlugins) {
    validateThirdPartyPluginAllowlistEntry(
      entry,
      allowedThirdPartyPlugins,
      seenThirdPartyPlugins,
      failures,
    );
  }
  return allowedThirdPartyPlugins;
}

function validateRatchetIdAndParserProfile(
  ratchet: LintRatchetConfig,
  parserProfile: LintRatchetParserProfile,
  failures: string[],
): void {
  if (!RATCHET_ID_PATTERN.test(ratchet.id)) {
    failures.push(`${ratchet.id}: id must match ratchet/<name>`);
  }
  if (!IMPLEMENTED_PARSER_PROFILES.has(parserProfile)) {
    failures.push(`${ratchet.id}: parserProfile ${parserProfile} is not implemented`);
  }
}

function validateLocalSource(
  ratchet: LintRatchetConfig,
  parserProfile: LintRatchetParserProfile,
  localRuleIds: ReadonlySet<string> | undefined,
  failures: string[],
): void {
  if (parserProfile !== "minimal-ts") {
    failures.push(`${ratchet.id}: local ratchets must use parserProfile minimal-ts`);
  }
  if (!LOCAL_RULE_ID_PATTERN.test(ratchet.ruleId)) {
    failures.push(`${ratchet.id}: local source ruleId must match local/<rule-name>`);
  } else if (localRuleIds !== undefined && !localRuleIds.has(ratchet.ruleId)) {
    failures.push(`${ratchet.id}: ruleId ${ratchet.ruleId} is not registered`);
  }
}

function validateCoreSource(
  ratchet: LintRatchetConfig,
  failures: string[],
): void {
  if (!CORE_RULE_ID_PATTERN.test(ratchet.ruleId)) {
    failures.push(
      `${ratchet.id}: core ruleId must be a bare ESLint built-in id (no slash): ${ratchet.ruleId}`,
    );
  }
}

function validateThirdPartySource(
  ratchet: LintRatchetConfig,
  source: ThirdPartyRatchetSource,
  allowedThirdPartyPlugins: ReadonlySet<string>,
  failures: string[],
): void {
  const namespace = ruleNamespace(ratchet.ruleId);
  if (!PACKAGE_SPECIFIER_PATTERN.test(source.pluginModule)) {
    failures.push(
      `${ratchet.id}: third-party pluginModule must be a package name: ${source.pluginModule}`,
    );
  }
  if (namespace === undefined) {
    failures.push(
      `${ratchet.id}: third-party source ruleId is not a valid lint rule identifier`,
    );
  } else if (namespace === "local") {
    failures.push(
      `${ratchet.id}: third-party source ruleId must be a non-local namespaced rule id`,
    );
  } else if (!allowedThirdPartyPlugins.has(thirdPartyAllowlistKey(source.pluginModule, namespace))) {
    failures.push(
      `${ratchet.id}: third-party plugin ${source.pluginModule} for namespace ${namespace} is not allowlisted`,
    );
  }
}

function validateRatchetSource(
  ratchet: LintRatchetConfig,
  source: LintRatchetRuleSource,
  parserProfile: LintRatchetParserProfile,
  ctx: ValidateRatchetEntryContext,
  failures: string[],
): void {
  switch (source.kind) {
    case "local":
      validateLocalSource(ratchet, parserProfile, ctx.localRuleIds, failures);
      return;
    case "core":
      validateCoreSource(ratchet, failures);
      return;
    case "third-party":
      validateThirdPartySource(ratchet, source, ctx.allowedThirdPartyPlugins, failures);
      return;
    default:
      assertNever(source);
  }
}

function validateSortedPathList(
  ratchetId: string,
  fieldName: "files" | "ignores",
  itemLabel: "file glob" | "ignore glob",
  values: readonly string[],
  failures: string[],
): void {
  if (!isSortedUnique(values)) {
    failures.push(`${ratchetId}: ${fieldName} must be sorted and duplicate-free`);
  }
  for (const value of values) {
    if (!hasNormalizedPath(value)) {
      failures.push(`${ratchetId}: ${itemLabel} must be normalized: ${value}`);
    }
  }
}

function validateRatchetGlobs(
  ratchet: LintRatchetConfig,
  failures: string[],
): void {
  if (ratchet.files.length === 0) {
    failures.push(`${ratchet.id}: files must be non-empty`);
  }
  validateSortedPathList(ratchet.id, "files", "file glob", ratchet.files, failures);
  validateSortedPathList(ratchet.id, "ignores", "ignore glob", ratchet.ignores, failures);
}

function validateRatchetModeAndMetric(
  ratchet: LintRatchetConfig,
  source: LintRatchetRuleSource,
  failures: string[],
): void {
  if (!IMPLEMENTED_MODES.has(ratchet.mode)) {
    failures.push(`${ratchet.id}: mode ${ratchet.mode} is reserved but not implemented`);
  }
  if (!IMPLEMENTED_METRICS.has(ratchet.metric)) {
    failures.push(`${ratchet.id}: metric ${ratchet.metric} is not implemented`);
  }
  if (ratchet.metric === "effective-line-count" && ratchet.ruleId !== "local/max-lines") {
    failures.push(`${ratchet.id}: effective-line-count metric requires ruleId local/max-lines`);
  }
  if (ratchet.metric === "complexity-severity" && (source.kind !== "core" || ratchet.ruleId !== "complexity")) {
    failures.push(`${ratchet.id}: complexity-severity metric requires core ruleId complexity`);
  }
}

function validateRatchetTargetAndOptions(
  ratchet: LintRatchetConfig,
  failures: string[],
): void {
  if (!Number.isInteger(ratchet.target) || ratchet.target < 0) {
    failures.push(`${ratchet.id}: target must be a non-negative integer`);
  }
  for (const option of ratchet.ruleOptions) {
    if (!isJsonValue(option)) {
      failures.push(`${ratchet.id}: ruleOptions must be JSON values`);
    }
  }
}

function validateRatchetScope(
  ratchet: LintRatchetConfig,
  ctx: ValidateRatchetEntryContext,
  failures: string[],
): void {
  const scopeKey = duplicateScopeKey(ratchet);
  const previous = ctx.seenScopes.get(scopeKey);
  if (previous !== undefined) {
    failures.push(`${ratchet.id}: duplicates ratchet scope already used by ${previous}`);
  } else {
    ctx.seenScopes.set(scopeKey, ratchet.id);
  }
}

function validateRatchetEntry(
  ratchet: LintRatchetConfig,
  ctx: ValidateRatchetEntryContext,
  failures: string[],
): void {
  const source = lintRatchetSource(ratchet);
  const parserProfile = lintRatchetParserProfile(ratchet);
  validateRatchetIdAndParserProfile(ratchet, parserProfile, failures);
  validateRatchetSource(ratchet, source, parserProfile, ctx, failures);
  validateRatchetGlobs(ratchet, failures);
  validateRatchetModeAndMetric(ratchet, source, failures);
  validateRatchetTargetAndOptions(ratchet, failures);
  validateRatchetScope(ratchet, ctx, failures);
}

export function validateLintRatchetRegistry(
  ratchets: readonly LintRatchetConfig[],
  optionsOrLocalRuleIds?: ReadonlySet<string> | ValidateLintRatchetRegistryOptions,
): readonly string[] {
  const { localRuleIds, thirdPartyPlugins = [] } = normalizeRegistryOptions(
    optionsOrLocalRuleIds,
  );
  const failures: string[] = [];
  const ids = ratchets.map((ratchet) => ratchet.id);
  if (!isSortedUnique(ids)) {
    failures.push("ratchet ids must be sorted and unique");
  }

  const allowedThirdPartyPlugins = validateThirdPartyPluginAllowlist(
    thirdPartyPlugins,
    failures,
  );
  const ctx: ValidateRatchetEntryContext = {
    localRuleIds,
    allowedThirdPartyPlugins,
    seenScopes: new Map<string, string>(),
  };
  for (const ratchet of ratchets) {
    validateRatchetEntry(ratchet, ctx, failures);
  }

  return failures;
}

function baselineTestFromConfig(
  config: LintRatchetConfig,
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem> | undefined,
  ruleSourceHash: string,
): LintRatchetBaselineTest {
  const items: Record<string, LintRatchetBaselineItem> = {};
  const sortedItems = [...(currentItems?.entries() ?? [])].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [path, item] of sortedItems) {
    if (item.count > 0) {
      items[path] = metricItemForFormat(config.metric, item);
    }
  }
  return {
    ruleId: config.ruleId,
    mode: config.mode,
    target: config.target,
    metric: config.metric,
    files: normalizeStringList(config.files),
    ignores: normalizeStringList(config.ignores),
    ruleOptions: normalizeRuleOptions(config.ruleOptions),
    configHash: computeLintRatchetConfigHash(config),
    ruleSourceHash,
    items,
  };
}

function requireRuleSourceHash(
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  ratchetId: string,
): string {
  const hash = ruleSourceHashesById.get(ratchetId);
  if (hash === undefined) {
    throw new Error(`lint-ratchet: missing rule source hash for ${ratchetId}`);
  }
  return hash;
}

export function buildLintRatchetBaseline(
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): LintRatchetBaseline {
  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const ratchet of ratchets) {
    tests[ratchet.id] = baselineTestFromConfig(
      ratchet,
      currentById.get(ratchet.id),
      requireRuleSourceHash(ruleSourceHashesById, ratchet.id),
    );
  }
  return { version: LINT_RATCHET_BASELINE_VERSION, tests };
}

export function currentByIdFromBaseline(
  baseline: LintRatchetBaseline,
): LintRatchetCurrentById {
  const currentById = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const [testId, test] of Object.entries(baseline.tests)) {
    const items = new Map<string, LintRatchetCurrentItem>();
    for (const [path, item] of Object.entries(test.items)) {
      items.set(path, item);
    }
    currentById.set(testId, items);
  }
  return currentById;
}

function orderedBaselineForFormat(baseline: LintRatchetBaseline): LintRatchetBaseline {
  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const testId of Object.keys(baseline.tests).sort()) {
    const test = baseline.tests[testId];
    if (test === undefined) continue;
    const items: Record<string, LintRatchetBaselineItem> = {};
    for (const path of Object.keys(test.items).sort()) {
      const item = test.items[path];
      if (item !== undefined && item.count > 0) {
        items[path] = metricItemForFormat(test.metric, item);
      }
    }
    tests[testId] = {
      ruleId: test.ruleId,
      mode: test.mode,
      target: test.target,
      metric: test.metric,
      files: normalizeStringList(test.files),
      ignores: normalizeStringList(test.ignores),
      ruleOptions: normalizeRuleOptions(test.ruleOptions),
      configHash: test.configHash,
      ruleSourceHash: test.ruleSourceHash,
      items,
    };
  }
  return { version: LINT_RATCHET_BASELINE_VERSION, tests };
}

export function formatLintRatchetBaseline(baseline: LintRatchetBaseline): string {
  return `${JSON.stringify(orderedBaselineForFormat(baseline), null, 2)}\n`;
}

function validateBaselineTestMetadata(
  testId: string,
  test: LintRatchetBaselineTest,
  expected: LintRatchetBaselineTest,
  failures: string[],
): void {
  if (test.ruleId !== expected.ruleId) failures.push(`${testId}.ruleId is stale`);
  if (test.mode !== expected.mode) failures.push(`${testId}.mode is stale`);
  if (test.target !== expected.target) failures.push(`${testId}.target is stale`);
  if (test.metric !== expected.metric) failures.push(`${testId}.metric is stale`);
  if (stableJson(test.files) !== stableJson(expected.files)) {
    failures.push(`${testId}.files is stale`);
  }
  if (stableJson(test.ignores) !== stableJson(expected.ignores)) {
    failures.push(`${testId}.ignores is stale`);
  }
  if (stableJson(test.ruleOptions) !== stableJson(expected.ruleOptions)) {
    failures.push(`${testId}.ruleOptions is stale`);
  }
  if (test.configHash !== expected.configHash) {
    failures.push(`${testId}.configHash is stale`);
  }
}

function validateBaselineRuleSourceHash(
  testId: string,
  test: LintRatchetBaselineTest,
  expected: LintRatchetBaselineTest,
  failures: string[],
): void {
  if (test.ruleSourceHash === "") {
    failures.push(`${testId}.ruleSourceHash is required`);
  } else if (test.ruleSourceHash !== expected.ruleSourceHash) {
    failures.push(`${testId}.ruleSourceHash is stale`);
  }
}

function validateBaselineMetricItems(
  testId: string,
  test: LintRatchetBaselineTest,
  failures: string[],
): void {
  for (const [itemPath, item] of Object.entries(test.items)) {
    validateMetricItem(testId, itemPath, test.metric, item, failures);
  }
}

function validateBaselineTestAgainstRatchet(
  testId: string,
  test: LintRatchetBaselineTest,
  ratchet: LintRatchetConfig,
  expectedRuleSourceHash: string,
  failures: string[],
): void {
  const expected = baselineTestFromConfig(ratchet, undefined, expectedRuleSourceHash);
  validateBaselineTestMetadata(testId, test, expected, failures);
  validateBaselineRuleSourceHash(testId, test, expected, failures);
  validateBaselineMetricItems(testId, test, failures);
}

function validateBaselineAgainstRegistry(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  failures: string[],
): void {
  const registryById = new Map(ratchets.map((ratchet) => [ratchet.id, ratchet]));
  for (const testId of Object.keys(baseline.tests)) {
    const ratchet = registryById.get(testId);
    if (ratchet === undefined) {
      failures.push(`${testId}: baseline has no matching ratchet registry entry`);
      continue;
    }
    const test = baseline.tests[testId];
    if (test === undefined) continue;
    const expectedRuleSourceHash = ruleSourceHashesById.get(testId) ?? "";
    validateBaselineTestAgainstRatchet(
      testId,
      test,
      ratchet,
      expectedRuleSourceHash,
      failures,
    );
  }
  for (const ratchet of ratchets) {
    if (baseline.tests[ratchet.id] === undefined) {
      failures.push(`${ratchet.id}: baseline is missing registry ratchet`);
    }
  }
}

export function parseLintRatchetBaselineStructure(
  text: string,
): StructuralLintRatchetBaseline {
  const failures: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    return { failures: [`baseline JSON parse failed: ${message}`] };
  }

  if (!isRecord(parsed)) {
    return { failures: ["baseline must be an object"] };
  }
  if (parsed.version !== LINT_RATCHET_BASELINE_VERSION) {
    failures.push(`version must be ${String(LINT_RATCHET_BASELINE_VERSION)}`);
  }
  if (!isRecord(parsed.tests)) {
    failures.push("tests must be an object");
    return { failures };
  }

  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const [testId, rawTest] of Object.entries(parsed.tests)) {
    const test = parseBaselineTest(testId, rawTest, failures);
    if (test !== undefined) {
      tests[testId] = test;
    }
  }

  if (failures.length > 0) {
    return { failures };
  }
  return {
    baseline: { version: LINT_RATCHET_BASELINE_VERSION, tests },
    failures: [],
  };
}

export function parseLintRatchetBaseline(
  text: string,
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): ParsedLintRatchetBaseline {
  const structural = parseLintRatchetBaselineStructure(text);
  if (structural.baseline === undefined) {
    return { failures: structural.failures };
  }
  const failures: string[] = [...structural.failures];
  validateBaselineAgainstRegistry(
    structural.baseline,
    ratchets,
    ruleSourceHashesById,
    failures,
  );
  if (failures.length === 0 && formatLintRatchetBaseline(structural.baseline) !== text) {
    failures.push("baseline JSON is not deterministic; run bun run lint:ratchet:update");
  }
  if (failures.length > 0) {
    return { failures };
  }
  return { baseline: structural.baseline, failures: [] };
}

export function compareCurrentToBaseline(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
): LintRatchetComparison {
  return compareCurrentToBaselineImpl(baseline, ratchets, currentById);
}

export function decideLintRatchetUpdate(
  committed: LintRatchetBaseline,
  generated: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  options: { readonly allowWorse: boolean; readonly reason?: string },
): LintRatchetUpdateDecision {
  const comparison = compareCurrentToBaseline(
    committed,
    ratchets,
    currentByIdFromBaseline(generated),
  );
  const failures: string[] = [];
  const reason = options.reason?.trim() ?? "";
  if (comparison.regressions.length > 0 && !options.allowWorse) {
    failures.push(
      `generated baseline is worse for ${String(comparison.regressions.length)} path(s); ` +
        "pass --allow-worse --reason \"<why>\" to accept intentional new debt",
    );
  }
  // Leaf 26: orphan committed entries (ids in the committed baseline that no
  // longer match a registry entry) bypass the count comparator above, because
  // compareCurrentToBaseline only iterates the current registry. A rename
  // looks identical to a removal at this layer, so the operator must
  // explicitly acknowledge that count protection is being bypassed via
  // --allow-worse --reason.
  const registryIds = new Set(ratchets.map((ratchet) => ratchet.id));
  const orphanIds = Object.keys(committed.tests)
    .filter((id) => !registryIds.has(id))
    .sort();
  if (orphanIds.length > 0 && !options.allowWorse) {
    failures.push(
      `committed baseline carries ${String(orphanIds.length)} entr${orphanIds.length === 1 ? "y" : "ies"} ` +
        `with no matching registry id (${orphanIds.join(", ")}); ` +
        "this looks like a rename or removal — pass --allow-worse --reason \"<why>\" " +
        "so count protection is not bypassed silently",
    );
  }
  if (options.allowWorse && reason.length === 0) {
    failures.push("--allow-worse requires a non-empty --reason");
  }
  return {
    ...comparison,
    allowed: failures.length === 0,
    failures,
  };
}
