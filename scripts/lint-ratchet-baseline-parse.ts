import type { LintRatchetBaseline } from "./lint-ratchet-baseline.js";
import type {
  JsonObject,
  JsonValue,
  LintRatchetMetric,
  LintRatchetMode,
} from "./lint-ratchet-config.js";
import { parseMetricFields } from "./lint-ratchet-metrics.js";

const LINT_RATCHET_CONFIG_HASH_PREFIX = "sha256:" as const;
const RATCHET_ID_PATTERN = /^ratchet\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BASELINE_RULE_ID_PATTERN =
  /^(?:[a-z][a-z0-9-]*|[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+|@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)$/u;

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;
type LintRatchetBaselineItem = NonNullable<LintRatchetBaselineTest["items"][string]>;

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
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => isJsonValue(entry));
}

function isJsonObjectValue(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => normalizeJsonValue(entry));
  if (!isJsonObjectValue(value)) return value;
  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeJsonValue(value[key] ?? null);
  }
  return normalized;
}

function hasNormalizedPath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && !value.startsWith("./");
}

function parseStringArray(
  value: unknown,
  path: string,
  failures: string[],
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    failures.push(`${path} must be an array`);
    return undefined;
  }
  const parsed: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      failures.push(`${path} must contain only strings`);
      return undefined;
    }
    parsed.push(entry);
  }
  return parsed;
}

function parseRuleOptions(
  value: unknown,
  path: string,
  failures: string[],
): readonly JsonValue[] | undefined {
  if (!Array.isArray(value)) {
    failures.push(`${path} must be an array`);
    return undefined;
  }
  const parsed: JsonValue[] = [];
  for (const entry of value) {
    if (!isJsonValue(entry)) {
      failures.push(`${path} must contain only JSON values`);
      return undefined;
    }
    parsed.push(normalizeJsonValue(entry));
  }
  return parsed;
}

function parseBaselineItems(
  value: unknown,
  path: string,
  failures: string[],
): Readonly<Record<string, LintRatchetBaselineItem>> | undefined {
  if (!isRecord(value)) {
    failures.push(`${path} must be an object`);
    return undefined;
  }
  const items: Record<string, LintRatchetBaselineItem> = {};
  for (const [itemPath, rawItem] of Object.entries(value)) {
    if (!hasNormalizedPath(itemPath)) {
      failures.push(`${path}.${itemPath}: path must be normalized`);
      continue;
    }
    if (!isRecord(rawItem)) {
      failures.push(`${path}.${itemPath} must be an object`);
      continue;
    }
    const count = rawItem.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      failures.push(`${path}.${itemPath}.count must be a non-negative integer`);
      continue;
    }
    const metricFields = parseMetricFields(rawItem, `${path}.${itemPath}`, failures);
    if (count > 0) items[itemPath] = { count, ...(metricFields ?? {}) };
  }
  return items;
}

function isLintRatchetMode(value: unknown): value is LintRatchetMode {
  return value === "no-new" || value === "ratchet-down" || value === "report-only";
}

function isLintRatchetMetric(value: unknown): value is LintRatchetMetric {
  return (
    value === "complexity-severity" || value === "effective-line-count" || value === "message-count"
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSha256Hash(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(LINT_RATCHET_CONFIG_HASH_PREFIX);
}

function parseBaselineRuleId(
  testId: string,
  value: Record<string, unknown>,
  failures: string[],
): string | undefined {
  const ruleId = value.ruleId;
  if (typeof ruleId === "string" && BASELINE_RULE_ID_PATTERN.test(ruleId)) return ruleId;
  failures.push(`${testId}.ruleId must be a bare or namespaced ESLint rule id`);
  return undefined;
}

function parseBaselineMode(
  testId: string,
  value: Record<string, unknown>,
  failures: string[],
): LintRatchetMode | undefined {
  const mode = value.mode;
  if (isLintRatchetMode(mode)) return mode;
  failures.push(`${testId}.mode is unknown`);
  return undefined;
}

function parseBaselineTarget(
  testId: string,
  value: Record<string, unknown>,
  failures: string[],
): number | undefined {
  const target = value.target;
  if (isNonNegativeInteger(target)) return target;
  failures.push(`${testId}.target must be a non-negative integer`);
  return undefined;
}

function parseBaselineMetric(
  testId: string,
  value: Record<string, unknown>,
  failures: string[],
): LintRatchetMetric | undefined {
  const metric = value.metric;
  if (isLintRatchetMetric(metric)) return metric;
  failures.push(`${testId}.metric is unknown`);
  return undefined;
}

function parseBaselineConfigHash(
  testId: string,
  value: Record<string, unknown>,
  failures: string[],
): string | undefined {
  const configHash = value.configHash;
  if (isSha256Hash(configHash)) return configHash;
  failures.push(`${testId}.configHash must be a sha256 hash`);
  return undefined;
}

function parseBaselineRuleSourceHash(
  testId: string,
  value: Record<string, unknown>,
  failures: string[],
): string | undefined {
  const rawRuleSourceHash = value.ruleSourceHash;
  const parsedRuleSourceHash = isSha256Hash(rawRuleSourceHash) ? rawRuleSourceHash : undefined;
  if (Object.hasOwn(value, "ruleSourceHash") && parsedRuleSourceHash === undefined) {
    failures.push(`${testId}.ruleSourceHash must be a sha256 hash`);
  }
  return parsedRuleSourceHash;
}

function validateBaselineTestRequiredFields(
  testId: string,
  value: Record<string, unknown>,
  failures: string[],
): void {
  if (!Object.hasOwn(value, "files")) failures.push(`${testId}.files is required`);
  if (!Object.hasOwn(value, "ruleOptions")) failures.push(`${testId}.ruleOptions is required`);
}

interface ParsedBaselineTestParts {
  readonly ruleId: string | undefined;
  readonly mode: LintRatchetMode | undefined;
  readonly target: number | undefined;
  readonly metric: LintRatchetMetric | undefined;
  readonly configHash: string | undefined;
  readonly ruleSourceHash: string | undefined;
  readonly files: readonly string[] | undefined;
  readonly ignores: readonly string[] | undefined;
  readonly ruleOptions: readonly JsonValue[] | undefined;
  readonly items: Readonly<Record<string, LintRatchetBaselineItem>> | undefined;
}

interface CompleteBaselineTestParts extends ParsedBaselineTestParts {
  readonly ruleId: string;
  readonly mode: LintRatchetMode;
  readonly target: number;
  readonly metric: LintRatchetMetric;
  readonly configHash: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly items: Readonly<Record<string, LintRatchetBaselineItem>>;
}

function completeBaselineTestParts(
  parts: ParsedBaselineTestParts,
): CompleteBaselineTestParts | undefined {
  if (
    parts.ruleId === undefined ||
    parts.mode === undefined ||
    parts.target === undefined ||
    parts.metric === undefined ||
    parts.configHash === undefined ||
    parts.files === undefined ||
    parts.ignores === undefined ||
    parts.ruleOptions === undefined ||
    parts.items === undefined
  ) {
    return undefined;
  }
  return {
    ...parts,
    ruleId: parts.ruleId,
    mode: parts.mode,
    target: parts.target,
    metric: parts.metric,
    configHash: parts.configHash,
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    items: parts.items,
  };
}

function parseBaselineTestFields(
  testId: string,
  value: Record<string, unknown>,
  failures: string[],
): ParsedBaselineTestParts {
  const ruleId = parseBaselineRuleId(testId, value, failures);
  const mode = parseBaselineMode(testId, value, failures);
  const target = parseBaselineTarget(testId, value, failures);
  const metric = parseBaselineMetric(testId, value, failures);
  const configHash = parseBaselineConfigHash(testId, value, failures);
  // ruleSourceHash is optional in structural parse so update mode can rewrite
  // a pre-Leaf-01 baseline that omits the field; strict parse requires it.
  const ruleSourceHash = parseBaselineRuleSourceHash(testId, value, failures);
  validateBaselineTestRequiredFields(testId, value, failures);
  const files = parseStringArray(value.files, `${testId}.files`, failures);
  const ignores = parseStringArray(value.ignores, `${testId}.ignores`, failures);
  const ruleOptions = parseRuleOptions(value.ruleOptions, `${testId}.ruleOptions`, failures);
  const items = parseBaselineItems(value.items, `${testId}.items`, failures);
  return {
    ruleId,
    mode,
    target,
    metric,
    configHash,
    ruleSourceHash,
    files,
    ignores,
    ruleOptions,
    items,
  };
}

export function parseBaselineTest(
  testId: string,
  value: unknown,
  failures: string[],
): LintRatchetBaselineTest | undefined {
  if (!RATCHET_ID_PATTERN.test(testId)) failures.push(`${testId}: id must match ratchet/<name>`);
  if (!isRecord(value)) {
    failures.push(`${testId} must be an object`);
    return undefined;
  }

  const parts = completeBaselineTestParts(parseBaselineTestFields(testId, value, failures));
  if (parts === undefined) return undefined;
  return {
    ruleId: parts.ruleId,
    mode: parts.mode,
    target: parts.target,
    metric: parts.metric,
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    configHash: parts.configHash,
    ruleSourceHash: parts.ruleSourceHash ?? "",
    items: parts.items,
  };
}
