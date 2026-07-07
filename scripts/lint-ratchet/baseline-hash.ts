import { createHash } from "node:crypto";

import { LINT_RATCHET_CONFIG_HASH_PREFIX } from "./baseline-constants.js";
import type {
  JsonObject,
  JsonValue,
  LintRatchetConfig,
  LintRatchetParserProfile,
  LintRatchetRuleSource,
} from "./lint-ratchet-config.js";

export { LINT_RATCHET_CONFIG_HASH_PREFIX } from "./baseline-constants.js";

const RULE_ID_PATTERN =
  /^(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+|@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)$/u;
const SCOPED_RULE_NAMESPACE_PARTS = 3;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
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

function isJsonArrayValue(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function normalizeJsonValue(value: JsonValue): JsonValue {
  if (isJsonArrayValue(value)) return value.map((entry) => normalizeJsonValue(entry));
  if (!isJsonObjectValue(value)) return value;
  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeJsonValue(value[key] ?? null);
  }
  return normalized;
}

export function normalizeStringList(values: readonly string[]): readonly string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function normalizeRuleOptions(values: readonly JsonValue[]): readonly JsonValue[] {
  return values.map((value) => normalizeJsonValue(value));
}

export function stableJson(value: JsonValue): string {
  return JSON.stringify(normalizeJsonValue(value));
}

export function lintRatchetSource(config: LintRatchetConfig): LintRatchetRuleSource {
  return config.source ?? { kind: "local" };
}

export function lintRatchetParserProfile(config: LintRatchetConfig): LintRatchetParserProfile {
  return config.parserProfile ?? "minimal-ts";
}

export function assertNever(value: never): never {
  throw new Error(`unhandled lint ratchet source kind: ${JSON.stringify(value)}`);
}

export function ruleNamespace(ruleId: string): string | undefined {
  if (!RULE_ID_PATTERN.test(ruleId)) return undefined;
  const parts = ruleId.split("/");
  if (parts.length >= SCOPED_RULE_NAMESPACE_PARTS && parts[0]?.startsWith("@") === true) {
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
      return { parserProfile, source: { kind: "local" } };
    case "third-party":
      return {
        parserProfile,
        source: { kind: "third-party", pluginModule: source.pluginModule },
      };
    case "core":
      return { parserProfile, source: { kind: "core" } };
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

export function duplicateScopeKey(config: LintRatchetConfig): string {
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
  const hash = createHash("sha256").update(JSON.stringify(sourceIdentity)).digest("hex");
  return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
}
