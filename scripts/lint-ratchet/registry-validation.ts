import {
  assertNever,
  duplicateScopeKey,
  isJsonValue,
  isRecord,
  lintRatchetParserProfile,
  lintRatchetSource,
  ruleNamespace,
} from "./baseline-hash.js";
import type {
  LintRatchetConfig,
  LintRatchetMetric,
  LintRatchetMode,
  LintRatchetParserProfile,
  LintRatchetRuleSource,
  LintRatchetThirdPartyPluginAllowlistEntry,
} from "./lint-ratchet-config.js";
import { validateZeroBaselineDisposition } from "./zero-baseline-disposition.js";

const IMPLEMENTED_MODES = new Set<LintRatchetMode>(["no-new"]);
const IMPLEMENTED_METRICS = new Set<LintRatchetMetric>([
  "complexity-severity",
  "effective-line-count",
  "message-count",
]);
const IMPLEMENTED_PARSER_PROFILES = new Set<LintRatchetParserProfile>([
  "minimal-ts",
  "type-aware-ts",
]);
const RATCHET_ID_PATTERN = /^ratchet\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LOCAL_RULE_ID_PATTERN = /^local\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CORE_RULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const PACKAGE_SPECIFIER_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

interface ValidateLintRatchetRegistryOptions {
  readonly localRuleIds?: ReadonlySet<string>;
  readonly thirdPartyPlugins?: readonly LintRatchetThirdPartyPluginAllowlistEntry[];
}

type ThirdPartyRatchetSource = Extract<LintRatchetRuleSource, { readonly kind: "third-party" }>;

interface ValidateRatchetEntryContext {
  readonly localRuleIds: ReadonlySet<string> | undefined;
  readonly allowedThirdPartyPlugins: ReadonlySet<string>;
  readonly seenScopes: Map<string, string>;
}

interface ValidateRatchetSourceContext extends ValidateRatchetEntryContext {
  readonly parserProfile: LintRatchetParserProfile;
}

type PathListDescriptor = readonly ["files" | "ignores", "file glob" | "ignore glob"];

function isSortedUnique(values: readonly string[]): boolean {
  let previous: string | undefined;
  for (const value of values) {
    if (previous !== undefined && previous.localeCompare(value) >= 0) return false;
    previous = value;
  }
  return true;
}

function hasNormalizedPath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && !value.startsWith("./");
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

function validateThirdPartyPluginAllowlistEntry(
  entry: Readonly<{ pluginModule: string; ruleNamespace: string; pluginExport?: unknown }>,
  allowedThirdPartyPlugins: Set<string>,
  seenThirdPartyPlugins: Set<string>,
  failures: string[],
): void {
  const key = thirdPartyAllowlistKey(entry.pluginModule, entry.ruleNamespace);
  if (!PACKAGE_SPECIFIER_PATTERN.test(entry.pluginModule)) {
    failures.push(
      `third-party allowlist: pluginModule must be a package name: ${entry.pluginModule}`,
    );
  }
  if (ruleNamespace(`${entry.ruleNamespace}/fixture-rule`) !== entry.ruleNamespace) {
    failures.push(`third-party allowlist: ruleNamespace is invalid: ${entry.ruleNamespace}`);
  }
  if (
    entry.pluginExport !== undefined &&
    entry.pluginExport !== "default" &&
    entry.pluginExport !== "plugin"
  ) {
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

function validateCoreSource(ratchet: LintRatchetConfig, failures: string[]): void {
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
    failures.push(`${ratchet.id}: third-party source ruleId is not a valid lint rule identifier`);
  } else if (namespace === "local") {
    failures.push(
      `${ratchet.id}: third-party source ruleId must be a non-local namespaced rule id`,
    );
  } else if (
    !allowedThirdPartyPlugins.has(thirdPartyAllowlistKey(source.pluginModule, namespace))
  ) {
    failures.push(
      `${ratchet.id}: third-party plugin ${source.pluginModule} for namespace ${namespace} is not allowlisted`,
    );
  }
}

function validateRatchetSource(
  ratchet: LintRatchetConfig,
  source: LintRatchetRuleSource,
  ctx: ValidateRatchetSourceContext,
  failures: string[],
): void {
  switch (source.kind) {
    case "local":
      validateLocalSource(ratchet, ctx.parserProfile, ctx.localRuleIds, failures);
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
  values: readonly string[],
  [fieldName, itemLabel]: PathListDescriptor,
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

function validateRatchetEntry(
  ratchet: LintRatchetConfig,
  ctx: ValidateRatchetEntryContext,
  failures: string[],
): void {
  const source = lintRatchetSource(ratchet);
  const parserProfile = lintRatchetParserProfile(ratchet);
  validateRatchetIdAndParserProfile(ratchet, parserProfile, failures);
  validateRatchetSource(ratchet, source, { ...ctx, parserProfile }, failures);
  if (ratchet.files.length === 0) failures.push(`${ratchet.id}: files must be non-empty`);
  validateSortedPathList(ratchet.id, ratchet.files, ["files", "file glob"], failures);
  validateSortedPathList(ratchet.id, ratchet.ignores, ["ignores", "ignore glob"], failures);
  validateRatchetModeAndMetric(ratchet, source, failures);
  validateRatchetTargetAndOptions(ratchet, failures);
  if (ratchet.principle.trim().length === 0) {
    failures.push(`${ratchet.id}: principle must be a non-empty string`);
  }
  validateZeroBaselineDisposition(ratchet, failures);
  validateRatchetScope(ratchet, ctx, failures);
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
  if (
    ratchet.metric === "complexity-severity" &&
    (source.kind !== "core" || ratchet.ruleId !== "complexity")
  ) {
    failures.push(`${ratchet.id}: complexity-severity metric requires core ruleId complexity`);
  }
}

function validateRatchetTargetAndOptions(ratchet: LintRatchetConfig, failures: string[]): void {
  if (!Number.isInteger(ratchet.target) || ratchet.target < 0) {
    failures.push(`${ratchet.id}: target must be a non-negative integer`);
  }
  for (const option of ratchet.ruleOptions) {
    if (!isJsonValue(option)) failures.push(`${ratchet.id}: ruleOptions must be JSON values`);
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

export function validateLintRatchetRegistry(
  ratchets: readonly LintRatchetConfig[],
  optionsOrLocalRuleIds?: ReadonlySet<string> | ValidateLintRatchetRegistryOptions,
): readonly string[] {
  const { localRuleIds, thirdPartyPlugins = [] } = normalizeRegistryOptions(optionsOrLocalRuleIds);
  const failures: string[] = [];
  const ids = ratchets.map((ratchet) => ratchet.id);
  if (!isSortedUnique(ids)) failures.push("ratchet ids must be sorted and unique");

  const ctx: ValidateRatchetEntryContext = {
    localRuleIds,
    allowedThirdPartyPlugins: validateThirdPartyPluginAllowlist(thirdPartyPlugins, failures),
    seenScopes: new Map<string, string>(),
  };
  for (const ratchet of ratchets) validateRatchetEntry(ratchet, ctx, failures);

  return failures;
}
