import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import {
  RULE_DOC_CATEGORIES,
  RULE_DOC_REPAIR_KINDS,
  type RuleDocCategory,
  type RuleDocRepairKind,
} from "../lib/lint-rule-docs.js";

export const KINDS = [
  "lint-rule",
  "ratchet",
  "sensor",
  "verify-wrapper",
  "doctor-check",
  "drift-scope",
  "doc-generator",
  "check",
  "logs-audit",
  "codemod",
  "hook",
] as const;

export const CONTROL_CATEGORIES = RULE_DOC_CATEGORIES;
export const REPAIR_KINDS = RULE_DOC_REPAIR_KINDS;

export type ControlKind = (typeof KINDS)[number];
export type ControlCategory = RuleDocCategory;
export type RepairKind = RuleDocRepairKind;

const LINT_RULE_REPROJECTED_FIELDS = [
  "category",
  "principle",
  "pairedGuide",
  "repairKind",
  "repairCommand",
  "slots",
] as const;

interface LintRuleRestatementFields {
  readonly category?: unknown;
  readonly principle?: unknown;
  readonly pairedGuide?: unknown;
  readonly repairKind?: unknown;
  readonly repairCommand?: unknown;
  readonly slots?: unknown;
  readonly hookWiring?: unknown;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isControlKind(value: unknown): value is ControlKind {
  return typeof value === "string" && KINDS.some((kind) => kind === value);
}

export function isControlCategory(value: unknown): value is ControlCategory {
  return typeof value === "string" && CONTROL_CATEGORIES.some((category) => category === value);
}

export function isRepairKind(value: unknown): value is RepairKind {
  return typeof value === "string" && REPAIR_KINDS.some((kind) => kind === value);
}

function isUnderRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function validateExistingRepoPath(repoRoot: string, field: string, value: string): string[] {
  const resolved = resolve(repoRoot, value);
  if (!isUnderRoot(repoRoot, resolved)) {
    return [`${field} must resolve under repoRoot`];
  }
  if (!existsSync(resolved)) {
    return [`${field} does not resolve to an existing file: ${value}`];
  }
  return [];
}

export function validateSourcePath(repoRoot: string, source: unknown): string[] {
  if (!isNonEmptyString(source)) {
    return ["source must be a non-empty string"];
  }
  return validateExistingRepoPath(repoRoot, "source", source);
}

export function validatePairedGuidePath(repoRoot: string, pairedGuide: unknown): string[] {
  if (!isNonEmptyString(pairedGuide)) {
    return ['pairedGuide must be "none" or a non-empty path string'];
  }
  if (pairedGuide === "none") return [];
  return validateExistingRepoPath(repoRoot, "pairedGuide", pairedGuide);
}

export function validateRepairCommandPresence(
  repairKind: RepairKind,
  repairCommand: unknown,
): string[] {
  if (repairKind === "codemod") {
    return isNonEmptyString(repairCommand)
      ? []
      : ["repairCommand must be a non-empty string when repairKind is codemod"];
  }
  return repairCommand === undefined
    ? []
    : ["repairCommand must be absent unless repairKind is codemod"];
}

export function lintRuleRestatementFailures(
  raw: LintRuleRestatementFields,
  options: { readonly includeHookWiring?: boolean } = {},
): string[] {
  const fields =
    options.includeHookWiring === true
      ? ([...LINT_RULE_REPROJECTED_FIELDS, "hookWiring"] as const)
      : LINT_RULE_REPROJECTED_FIELDS;
  return fields.flatMap((field) =>
    raw[field] === undefined
      ? []
      : [`lint-rule entries must not restate ${field}; it is re-projected from meta.docs`],
  );
}
