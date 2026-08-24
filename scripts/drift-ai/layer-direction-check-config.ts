import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiLayerDirectionConfig, DriftAiLayerDirectionRule } from "./config.js";
import { normalizePairPath, normalizePrefix } from "./config-paths.js";
import { assertConfigObject, assertKnownKeys } from "./config-readers.js";
import { DriftAiError } from "./errors.js";

// Zero rules by default: layering policy is repo policy, so a foreign target
// never inherits Musi's server topology (README "Config discovery" contract; the
// comments.ts excludePrefixes precedent). Musi's own rules live in the committed
// drift-ai.config.json.
const DEFAULT_LAYER_DIRECTION_CONFIG: DriftAiLayerDirectionConfig = {
  rules: [],
  allowedEdges: [],
};

const RULE_KEYS = [
  "id",
  "sourceLayer",
  "sourcePrefix",
  "targetLayer",
  "targetPrefix",
  "hint",
] as const;

// Opt-in: server layer direction is advisory until field runs prove the first
// rules are low-noise, and building the resolved module graph is whole-project
// work even when findings are changed-scope-filtered.
export const layerDirectionCheckConfig: CheckConfigMetadata<
  DriftAiLayerDirectionConfig,
  "layer-direction"
> = {
  id: "layer-direction",
  usage: "layer-direction",
  defaultConfig: DEFAULT_LAYER_DIRECTION_CONFIG,
  parseConfig: parseLayerDirectionConfig,
  selectConfig: (config) => config.checks["layer-direction"],
  runByDefault: false,
};

function parseLayerDirectionConfig(raw: unknown, keyPath: string): DriftAiLayerDirectionConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["rules", "allowedEdges"], keyPath);
  return {
    rules:
      record["rules"] === undefined
        ? DEFAULT_LAYER_DIRECTION_CONFIG.rules
        : readRules(record["rules"], `${keyPath}.rules`),
    allowedEdges:
      record["allowedEdges"] === undefined
        ? DEFAULT_LAYER_DIRECTION_CONFIG.allowedEdges
        : readAllowedEdges(record["allowedEdges"], `${keyPath}.allowedEdges`),
  };
}

function readRules(raw: unknown, keyPath: string): readonly DriftAiLayerDirectionRule[] {
  if (!Array.isArray(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  const rules = raw.map((item, index) => readRule(item, `${keyPath}[${index}]`));
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new DriftAiError(`drift:ai config '${keyPath}' has duplicate rule id '${rule.id}'.`);
    }
    seen.add(rule.id);
  }
  return rules;
}

function readRule(raw: unknown, keyPath: string): DriftAiLayerDirectionRule {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, RULE_KEYS, keyPath);
  const field = (name: (typeof RULE_KEYS)[number]): string => {
    const value = record[name];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DriftAiError(`drift:ai config '${keyPath}.${name}' must be a non-empty string.`);
    }
    return value;
  };
  return {
    id: field("id"),
    sourceLayer: field("sourceLayer"),
    sourcePrefix: normalizePrefix(field("sourcePrefix")),
    targetLayer: field("targetLayer"),
    targetPrefix: normalizePrefix(field("targetPrefix")),
    hint: field("hint"),
  };
}

function readAllowedEdges(raw: unknown, keyPath: string): readonly (readonly [string, string])[] {
  if (!Array.isArray(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  return raw.map((item, index) => readAllowedEdge(item, `${keyPath}[${index}]`));
}

function readAllowedEdge(raw: unknown, keyPath: string): readonly [string, string] {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new DriftAiError(
      `drift:ai config '${keyPath}' must be a two-path [source, target] array.`,
    );
  }
  const rawSource: unknown = raw[0];
  const rawTarget: unknown = raw[1];
  const readPath = (value: unknown, pathKey: string): string => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DriftAiError(`drift:ai config '${pathKey}' must be a non-empty string.`);
    }
    return normalizePairPath(value, pathKey);
  };
  const source = readPath(rawSource, `${keyPath}[0]`);
  const target = readPath(rawTarget, `${keyPath}[1]`);
  if (source === target) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must contain two distinct paths.`);
  }
  return [source, target];
}
