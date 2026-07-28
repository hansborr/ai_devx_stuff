import { pathToFileURL } from "node:url";

import { isObjectLike } from "../lib/records.js";

interface LocalPlugin {
  readonly rules: Record<string, { readonly meta?: { readonly docs?: unknown } }>;
}

export interface LocalRuleConfig {
  readonly registeredRuleNames: ReadonlySet<string>;
  readonly enabledRuleNames: ReadonlySet<string>;
}

function hasLocalRules(value: unknown): value is LocalPlugin {
  if (!isObjectLike(value)) return false;
  return isObjectLike(value.rules);
}

function blockLocalPlugin(block: unknown): LocalPlugin | undefined {
  if (!isObjectLike(block)) return undefined;
  const plugins = block.plugins;
  if (!isObjectLike(plugins)) return undefined;
  const local = plugins.local;
  return hasLocalRules(local) ? local : undefined;
}

function findLocalPlugin(config: readonly unknown[]): LocalPlugin | undefined {
  for (const block of config) {
    const localPlugin = blockLocalPlugin(block);
    if (localPlugin !== undefined) return localPlugin;
  }
  return undefined;
}

function blockRules(block: unknown): Record<string, unknown> | undefined {
  if (!isObjectLike(block)) return undefined;
  return isObjectLike(block.rules) ? block.rules : undefined;
}

function firstArrayValue(value: readonly unknown[]): unknown {
  return value[0];
}

function isEnabledRuleSetting(setting: unknown): boolean {
  const severity: unknown = Array.isArray(setting) ? firstArrayValue(setting) : setting;
  return severity !== undefined && severity !== null && severity !== 0 && severity !== "off";
}

function enabledLocalRuleNames(config: readonly unknown[]): Set<string> {
  const enabled = new Set<string>();
  for (const block of config) {
    const rules = blockRules(block);
    if (rules === undefined) continue;
    for (const [ruleName, setting] of Object.entries(rules)) {
      if (ruleName.startsWith("local/") && isEnabledRuleSetting(setting)) enabled.add(ruleName);
    }
  }
  return enabled;
}

export async function loadLocalRuleConfig(configPath: string): Promise<LocalRuleConfig> {
  const configModule: unknown = await import(pathToFileURL(configPath).href);
  if (!isObjectLike(configModule) || !Array.isArray(configModule.default)) {
    throw new Error("eslint.config.js did not export a config array");
  }
  const localPlugin = findLocalPlugin(configModule.default);
  if (localPlugin === undefined) {
    throw new Error("Could not find local plugin in eslint.config.js");
  }
  return {
    registeredRuleNames: new Set(Object.keys(localPlugin.rules).map((id) => `local/${id}`)),
    enabledRuleNames: enabledLocalRuleNames(configModule.default),
  };
}
