// Shared loader for the `local/*` ESLint rule `meta.docs` contract.
// Consumed by scripts/generate-lint-guidance.ts, scripts/generate-harness-controls.ts,
// and scripts/lint-agent.ts. The vocabulary intentionally re-declares
// the `as const` arrays in plain TS rather than reusing the Zod enums in
// packages/shared/src/schemas/harness-diagnostics.ts — defence in depth
// against a single typo silently widening acceptance (matches PR 1's
// generator/test split rationale).

import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RULE_DOC_CATEGORIES = ["maintainability", "architecture-fitness", "behavior"] as const;

export const RULE_DOC_REPAIR_KINDS = ["autofix", "suggestion", "codemod", "manual"] as const;

export type RuleDocCategory = (typeof RULE_DOC_CATEGORIES)[number];
export type RuleDocRepairKind = (typeof RULE_DOC_REPAIR_KINDS)[number];

export interface RuleDocs {
  readonly description: string;
  readonly principle: string;
  readonly category: RuleDocCategory;
  readonly pairedGuide: string;
  readonly repairKind: RuleDocRepairKind;
  readonly repairCommand?: string;
}

export interface RuleDocsEntry extends RuleDocs {
  readonly id: string;
}

export interface RuleDocsFailure {
  readonly id: string;
  readonly failures: readonly string[];
}

export interface LintRuleDocsResult {
  readonly entries: readonly RuleDocsEntry[];
  readonly failures: readonly RuleDocsFailure[];
}

interface LocalPlugin {
  readonly rules: Record<string, { readonly meta?: { readonly docs?: unknown } }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRuleDocCategory(value: unknown): value is RuleDocCategory {
  return typeof value === "string" && RULE_DOC_CATEGORIES.some((category) => category === value);
}

function isRuleDocRepairKind(value: unknown): value is RuleDocRepairKind {
  return typeof value === "string" && RULE_DOC_REPAIR_KINDS.some((kind) => kind === value);
}

function isUnderRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function hasLocalRules(value: unknown): value is LocalPlugin {
  if (!isObject(value)) return false;
  return isObject(value.rules);
}

function blockLocalPlugin(block: unknown): LocalPlugin | undefined {
  if (!isObject(block)) return undefined;
  const plugins = block.plugins;
  if (!isObject(plugins)) return undefined;
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

function validateStringField(
  docs: Record<string, unknown>,
  field: "description" | "principle",
  failures: string[],
): string {
  const value = docs[field];
  if (isNonEmptyString(value)) return value;
  failures.push(`${field} must be a non-empty string`);
  return "";
}

function validateCategory(docs: Record<string, unknown>, failures: string[]): RuleDocCategory {
  const category = docs.category;
  if (isRuleDocCategory(category)) return category;
  failures.push(`category must be one of: ${RULE_DOC_CATEGORIES.join(", ")}`);
  return "maintainability";
}

function validatePairedGuide(
  docs: Record<string, unknown>,
  repoRoot: string,
  failures: string[],
): string {
  const pairedGuide = docs.pairedGuide;
  if (!isNonEmptyString(pairedGuide)) {
    failures.push('pairedGuide must be "none" or a non-empty path string');
    return "none";
  }
  if (pairedGuide === "none") return pairedGuide;

  const resolvedGuide = resolve(repoRoot, pairedGuide);
  if (!isUnderRoot(repoRoot, resolvedGuide)) {
    failures.push("pairedGuide must resolve under repoRoot");
    return pairedGuide;
  }
  if (!existsSync(resolvedGuide)) {
    failures.push(`pairedGuide does not resolve to an existing file: ${pairedGuide}`);
  }
  return pairedGuide;
}

function validateRepairKind(docs: Record<string, unknown>, failures: string[]): RuleDocRepairKind {
  const repairKind = docs.repairKind;
  if (isRuleDocRepairKind(repairKind)) return repairKind;
  failures.push(`repairKind must be one of: ${RULE_DOC_REPAIR_KINDS.join(", ")}`);
  return "manual";
}

function validateRepairCommand(
  docs: Record<string, unknown>,
  repairKind: RuleDocRepairKind,
  failures: string[],
): string | undefined {
  const repairCommand = docs.repairCommand;
  if (repairKind !== "codemod") {
    if (Object.hasOwn(docs, "repairCommand")) {
      failures.push("repairCommand must be absent unless repairKind is codemod");
    }
    return undefined;
  }
  if (isNonEmptyString(repairCommand)) return repairCommand;
  failures.push("repairCommand must be a non-empty string when repairKind is codemod");
  return undefined;
}

function validateRuleDocs(
  id: string,
  docsValue: unknown,
  repoRoot: string,
): RuleDocsEntry | RuleDocsFailure {
  const failures: string[] = [];
  const docs = isObject(docsValue) ? docsValue : {};

  if (docsValue === undefined) {
    failures.push("meta.docs is missing");
  } else if (!isObject(docsValue)) {
    failures.push("meta.docs must be an object");
  }

  const description = validateStringField(docs, "description", failures);
  const principle = validateStringField(docs, "principle", failures);
  const category = validateCategory(docs, failures);
  const pairedGuide = validatePairedGuide(docs, repoRoot, failures);
  const repairKind = validateRepairKind(docs, failures);
  const repairCommand = validateRepairCommand(docs, repairKind, failures);

  if (failures.length > 0) {
    return { id, failures };
  }

  if (repairKind === "codemod") {
    if (!isNonEmptyString(repairCommand)) {
      throw new Error(`Unexpected missing repairCommand for ${id}`);
    }
    return { id, description, principle, category, pairedGuide, repairKind, repairCommand };
  }

  return { id, description, principle, category, pairedGuide, repairKind };
}

export function formatRuleDocsFailures(failures: readonly RuleDocsFailure[]): string {
  const lines = ["Invalid local ESLint rule metadata:"];
  for (const failure of failures) {
    lines.push(`- ${failure.id}: ${failure.failures.join("; ")}`);
  }
  return lines.join("\n");
}

export async function loadLintRuleDocs(repoRoot: string): Promise<LintRuleDocsResult> {
  const configPath = join(repoRoot, "eslint.config.js");
  const configModule: unknown = await import(pathToFileURL(configPath).href);
  if (!isObject(configModule) || !Array.isArray(configModule.default)) {
    throw new Error("eslint.config.js did not export a config array");
  }
  const localPlugin = findLocalPlugin(configModule.default);
  if (localPlugin === undefined) {
    throw new Error("Could not find local plugin in eslint.config.js");
  }

  const entries: RuleDocsEntry[] = [];
  const failures: RuleDocsFailure[] = [];
  for (const [ruleName, rule] of Object.entries(localPlugin.rules)) {
    const id = `local/${ruleName}`;
    const result = validateRuleDocs(id, rule.meta?.docs, repoRoot);
    if ("failures" in result) {
      failures.push(result);
    } else {
      entries.push(result);
    }
  }

  return { entries, failures };
}
