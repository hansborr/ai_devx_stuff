import type { LintRatchetBaselineTest } from "./baseline.js";
import { isJsonValue, normalizeJsonValue } from "./baseline-hash.js";
import type { JsonValue, LintRatchetMetric, LintRatchetMode } from "./config-types.js";

const SHA256_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RATCHET_ID_PATTERN = /^ratchet\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BASELINE_RULE_ID_PATTERN =
  /^(?:[a-z][a-z0-9-]*|[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+|@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)$/u;

export type LintRatchetBaselineGroupMeta = Omit<LintRatchetBaselineTest, "items">;

function parseStringArray(
  value: unknown,
  field: string,
  failures: string[],
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    failures.push(`${field} must be an array`);
    return undefined;
  }
  const parsed: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      failures.push(`${field} must contain only strings`);
      return undefined;
    }
    parsed.push(entry);
  }
  return parsed;
}

function parseRuleOptions(value: unknown, failures: string[]): readonly JsonValue[] | undefined {
  if (!Array.isArray(value)) {
    failures.push("ruleOptions must be an array");
    return undefined;
  }
  const parsed: JsonValue[] = [];
  for (const entry of value) {
    if (!isJsonValue(entry)) {
      failures.push("ruleOptions must contain only JSON values");
      return undefined;
    }
    parsed.push(normalizeJsonValue(entry));
  }
  return parsed;
}

function isLintRatchetMode(value: unknown): value is LintRatchetMode {
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

interface ParsedGroupMetaParts {
  readonly ruleId: string | undefined;
  readonly mode: LintRatchetMode | undefined;
  readonly metric: LintRatchetMetric | undefined;
  readonly configHash: string | undefined;
  readonly ruleSourceHash: string | undefined;
  readonly files: readonly string[] | undefined;
  readonly ignores: readonly string[] | undefined;
  readonly ruleOptions: readonly JsonValue[] | undefined;
}

function parseRuleId(
  value: Readonly<Record<string, unknown>>,
  failures: string[],
): string | undefined {
  const ruleId = value.ruleId;
  if (typeof ruleId === "string" && BASELINE_RULE_ID_PATTERN.test(ruleId)) return ruleId;
  failures.push("ruleId must be a bare or namespaced ESLint rule id");
  return undefined;
}

function parseMode(
  value: Readonly<Record<string, unknown>>,
  failures: string[],
): LintRatchetMode | undefined {
  if (isLintRatchetMode(value.mode)) return value.mode;
  failures.push("mode is unknown");
  return undefined;
}

function parseMetric(
  value: Readonly<Record<string, unknown>>,
  failures: string[],
): LintRatchetMetric | undefined {
  if (isLintRatchetMetric(value.metric)) return value.metric;
  failures.push("metric is unknown");
  return undefined;
}

function parseConfigHash(
  value: Readonly<Record<string, unknown>>,
  failures: string[],
): string | undefined {
  if (isSha256Hash(value.configHash)) return value.configHash;
  failures.push("configHash must be a sha256 hash");
  return undefined;
}

function parseRuleSourceHash(
  value: Readonly<Record<string, unknown>>,
  failures: string[],
): string | undefined {
  const parsed = isSha256Hash(value.ruleSourceHash) ? value.ruleSourceHash : undefined;
  if (Object.hasOwn(value, "ruleSourceHash") && parsed === undefined) {
    failures.push("ruleSourceHash must be a sha256 hash");
  }
  return parsed;
}

function parseGroupMetaParts(
  value: Readonly<Record<string, unknown>>,
  failures: string[],
): ParsedGroupMetaParts {
  if (!Object.hasOwn(value, "files")) failures.push("files is required");
  if (!Object.hasOwn(value, "ruleOptions")) failures.push("ruleOptions is required");
  return {
    ruleId: parseRuleId(value, failures),
    mode: parseMode(value, failures),
    metric: parseMetric(value, failures),
    configHash: parseConfigHash(value, failures),
    ruleSourceHash: parseRuleSourceHash(value, failures),
    files: parseStringArray(value.files, "files", failures),
    ignores: parseStringArray(value.ignores, "ignores", failures),
    ruleOptions: parseRuleOptions(value.ruleOptions, failures),
  };
}

function completeGroupMeta(parts: ParsedGroupMetaParts): LintRatchetBaselineGroupMeta | undefined {
  if (
    parts.ruleId === undefined ||
    parts.mode === undefined ||
    parts.metric === undefined ||
    parts.configHash === undefined ||
    parts.files === undefined ||
    parts.ignores === undefined ||
    parts.ruleOptions === undefined
  ) {
    return undefined;
  }
  return {
    ruleId: parts.ruleId,
    mode: parts.mode,
    metric: parts.metric,
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    configHash: parts.configHash,
    ruleSourceHash: parts.ruleSourceHash ?? "",
  };
}

export function parseLintRatchetGroupMeta(
  testId: string,
  raw: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly value: LintRatchetBaselineGroupMeta }
  | { readonly ok: false; readonly error: string; readonly errors: readonly string[] } {
  const failures: string[] = [];
  if (!RATCHET_ID_PATTERN.test(testId)) failures.push("id must match ratchet/<name>");
  const meta = completeGroupMeta(parseGroupMetaParts(raw, failures));
  if (meta !== undefined && failures.length === 0) return { ok: true, value: meta };
  const errors = failures.length > 0 ? failures : ["metadata is invalid"];
  return { ok: false, error: errors[0] ?? "metadata is invalid", errors };
}

export function relativeLintRatchetItemFailure(location: string, failure: string): string {
  const fieldPrefix = `${location}.`;
  if (failure.startsWith(fieldPrefix)) return failure.slice(fieldPrefix.length);
  const labelPrefix = `${location}: `;
  if (failure.startsWith(labelPrefix)) return failure.slice(labelPrefix.length);
  return failure;
}
