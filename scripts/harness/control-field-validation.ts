import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import {
  findBareBacklogCoordinate,
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
  "skill",
] as const;

export const CONTROL_CATEGORIES = RULE_DOC_CATEGORIES;
export const REPAIR_KINDS = RULE_DOC_REPAIR_KINDS;

const _CONTROL_FIELD_NAMES = [
  "id",
  "kind",
  "ruleName",
  "category",
  "principle",
  "pairedGuide",
  "repairKind",
  "repairCommand",
  "source",
  "invocation",
  "slots",
  "slotProfile",
  "generatedSurface",
  "hookWiring",
  "skillWiring",
] as const;

export type ControlKind = (typeof KINDS)[number];
export type ControlCategory = RuleDocCategory;
export type RepairKind = RuleDocRepairKind;
export type ControlFieldName = (typeof _CONTROL_FIELD_NAMES)[number];
export type RawControlRecord = {
  readonly [Field in ControlFieldName]?: unknown;
};

export interface ControlFieldIssue {
  readonly field: ControlFieldName;
  readonly message: string;
}

export interface NonLintFieldIssueOptions {
  readonly principleFromRegistry: boolean;
  readonly includeSource: boolean;
  readonly bareCoordinateCheck: boolean;
}

const LINT_RULE_REPROJECTED_FIELDS = [
  "category",
  "principle",
  "pairedGuide",
  "repairKind",
  "repairCommand",
  "slots",
  "slotProfile",
] as const;

interface LintRuleRestatementFields {
  readonly category?: unknown;
  readonly principle?: unknown;
  readonly pairedGuide?: unknown;
  readonly repairKind?: unknown;
  readonly repairCommand?: unknown;
  readonly slots?: unknown;
  readonly slotProfile?: unknown;
  readonly hookWiring?: unknown;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isControlKind(value: unknown): value is ControlKind {
  return typeof value === "string" && KINDS.some((kind) => kind === value);
}

function isControlCategory(value: unknown): value is ControlCategory {
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

export function validatePairedGuidePath(repoRoot: string, pairedGuide: string): string[] {
  if (pairedGuide === "none") return [];
  return validateExistingRepoPath(repoRoot, "pairedGuide", pairedGuide);
}

function validateRepairCommandPresence(repairKind: RepairKind, repairCommand: unknown): string[] {
  if (repairKind === "codemod") {
    return isNonEmptyString(repairCommand)
      ? []
      : ["repairCommand must be a non-empty string when repairKind is codemod"];
  }
  return repairCommand === undefined
    ? []
    : ["repairCommand must be absent unless repairKind is codemod"];
}

function controlFieldIssue(field: ControlFieldName, message: string): ControlFieldIssue {
  return { field, message };
}

function principleFieldIssues(
  raw: RawControlRecord,
  options: NonLintFieldIssueOptions,
): ControlFieldIssue[] {
  if (options.principleFromRegistry) {
    return ratchetPrincipleRestatementFailures(raw).map((message) =>
      controlFieldIssue("principle", message),
    );
  }
  if (!isNonEmptyString(raw.principle)) {
    return [controlFieldIssue("principle", "principle must be a non-empty string")];
  }
  if (!options.bareCoordinateCheck) return [];
  const coordinate = findBareBacklogCoordinate(raw.principle);
  return coordinate === undefined
    ? []
    : [
        controlFieldIssue(
          "principle",
          `principle contains a bare backlog coordinate: ${coordinate}`,
        ),
      ];
}

function repairFieldIssues(raw: RawControlRecord): ControlFieldIssue[] {
  if (!isRepairKind(raw.repairKind)) {
    return [
      controlFieldIssue("repairKind", `repairKind must be one of: ${REPAIR_KINDS.join(", ")}`),
    ];
  }
  return validateRepairCommandPresence(raw.repairKind, raw.repairCommand).map((message) =>
    controlFieldIssue("repairCommand", message),
  );
}

export function collectNonLintFieldIssues(
  raw: RawControlRecord,
  options: NonLintFieldIssueOptions,
): ControlFieldIssue[] {
  const issues: ControlFieldIssue[] = [];
  const push = (field: ControlFieldName, message: string): void => {
    issues.push(controlFieldIssue(field, message));
  };

  if (raw.ruleName !== undefined) {
    push("ruleName", "ruleName is only allowed on lint-rule entries");
  }
  if (!isControlCategory(raw.category)) {
    push("category", `category must be one of: ${CONTROL_CATEGORIES.join(", ")}`);
  }
  issues.push(...principleFieldIssues(raw, options));
  if (!isNonEmptyString(raw.pairedGuide)) {
    push("pairedGuide", 'pairedGuide must be "none" or a non-empty path string');
  }
  issues.push(...repairFieldIssues(raw));
  if (options.includeSource && !isNonEmptyString(raw.source)) {
    push("source", "source must be a non-empty string");
  }
  if (!isNonEmptyString(raw.invocation)) {
    push("invocation", "invocation must be a non-empty string");
  }
  return issues;
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

// Module path of the ratchet registry that owns the dedicated `principle` field.
// Used in both diagnostics below so the agent is pointed at the single source.
const LINT_RATCHET_CONFIG_PATH = "scripts/lint-ratchet/lint-ratchet-config.ts";

const RATCHET_PRINCIPLE_RESTATEMENT_MESSAGE =
  "ratchet entries must not restate principle; it is re-projected from the lint-ratchet registry";

// Ratchet `principle` is re-projected from the registry (parallel to how
// lint-rule fields flow from meta.docs), so a hand-written value in the manifest
// is rejected.
function ratchetPrincipleRestatementFailures(raw: { readonly principle?: unknown }): string[] {
  return raw.principle === undefined ? [] : [RATCHET_PRINCIPLE_RESTATEMENT_MESSAGE];
}

export function missingRatchetPrincipleMessage(id: string): string {
  return `${id} has no principle in ${LINT_RATCHET_CONFIG_PATH}`;
}
