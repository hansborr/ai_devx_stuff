import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeCoreLintRatchetRuleSourceHash,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  ruleNamespace,
  type LintRatchetRuleSourceHashesById,
} from "../lint-ratchet-baseline.js";
import {
  type LintRatchetConfig,
  lintRatchetThirdPartyPluginAllowlist,
  type LintRatchetThirdPartyPluginAllowlistEntry,
} from "../lint-ratchet-config.js";
import { ConfigError } from "../lint-ratchet-metrics.js";
import { repoRoot } from "./paths.js";
import { assertNever, ratchetSource } from "./runtime-config.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function localRuleName(ruleId: string): string {
  const prefix = "local/";
  if (!ruleId.startsWith(prefix)) {
    throw new ConfigError(`local ratchet ruleId must start with local/: ${ruleId}`);
  }
  return ruleId.slice(prefix.length);
}

export function localRulePath(ratchet: LintRatchetConfig): string {
  return join(repoRoot, "eslint-rules", `${localRuleName(ratchet.ruleId)}.js`);
}

export function thirdPartySupportFor(
  ratchet: LintRatchetConfig,
): LintRatchetThirdPartyPluginAllowlistEntry {
  const source = ratchetSource(ratchet);
  if (source.kind !== "third-party") {
    throw new ConfigError(`ratchet ${ratchet.id}: expected third-party source`);
  }
  const namespace = ruleNamespace(ratchet.ruleId);
  const support = lintRatchetThirdPartyPluginAllowlist.find(
    (entry) => entry.pluginModule === source.pluginModule && entry.ruleNamespace === namespace,
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
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
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
      const hash = createHash("sha256").update(JSON.stringify(sourceIdentity)).digest("hex");
      return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
    }
    case "core":
      return computeCoreLintRatchetRuleSourceHash(ratchet, readEslintPackageVersion());
    default:
      return assertNever(source);
  }
}

export function buildRuleSourceHashesById(
  ratchets: readonly LintRatchetConfig[],
): LintRatchetRuleSourceHashesById {
  const map = new Map<string, string>();
  for (const ratchet of ratchets) map.set(ratchet.id, computeLintRatchetRuleSourceHash(ratchet));
  return map;
}
