import type { LintRatchetBaseline } from "./baseline.js";
import { isJsonValue, isRecord, normalizeJsonValue } from "./baseline-hash.js";
import { parseLintRatchetBaselineItem } from "./baseline-item-parse.js";
import type { JsonValue, LintRatchetMetric, LintRatchetMode } from "./lint-ratchet-config.js";

const SHA256_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RATCHET_ID_PATTERN = /^ratchet\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BASELINE_RULE_ID_PATTERN =
  /^(?:[a-z][a-z0-9-]*|[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+|@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)$/u;

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;
type LintRatchetBaselineItem = NonNullable<LintRatchetBaselineTest["items"][string]>;

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
    const item = parseLintRatchetBaselineItem(itemPath, rawItem, `${path}.${itemPath}`, failures);
    if (item !== undefined && item.count > 0) {
      items[itemPath] = item;
    }
  }
  return items;
}

function isLintRatchetMode(value: unknown): value is LintRatchetMode {
  // Deliberately narrow: `no-new` is the only mode. `ratchet-down` was never
  // implemented and `report-only` was removed, so no committed baseline blob ever
  // carried either (registry validation rejected them before write).
  return value === "no-new";
}

function isLintRatchetMetric(value: unknown): value is LintRatchetMetric {
  return (
    value === "complexity-severity" || value === "effective-line-count" || value === "message-count"
  );
}

function isSha256Hash(value: unknown): value is string {
  return typeof value === "string" && SHA256_HASH_PATTERN.test(value);
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

// `target` was removed from the ratchet surface (never read by comparison). The
// parser simply ignores any `target` key a historical baseline blob still
// carries — no field to parse, and unknown keys are tolerated.
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
  const metric = parseBaselineMetric(testId, value, failures);
  const configHash = parseBaselineConfigHash(testId, value, failures);
  // ruleSourceHash is optional in structural parse so update mode can rewrite
  // a legacy baseline that omits the field; strict parse requires it.
  const ruleSourceHash = parseBaselineRuleSourceHash(testId, value, failures);
  validateBaselineTestRequiredFields(testId, value, failures);
  const files = parseStringArray(value.files, `${testId}.files`, failures);
  const ignores = parseStringArray(value.ignores, `${testId}.ignores`, failures);
  const ruleOptions = parseRuleOptions(value.ruleOptions, `${testId}.ruleOptions`, failures);
  const items = parseBaselineItems(value.items, `${testId}.items`, failures);
  return {
    ruleId,
    mode,
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
    metric: parts.metric,
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    configHash: parts.configHash,
    ruleSourceHash: parts.ruleSourceHash ?? "",
    items: parts.items,
  };
}
