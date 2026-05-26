// Validation logic extracted from generate-harness-controls.ts to stay under
// the local/max-lines ratchet cap.

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { RULE_DOC_CATEGORIES, RULE_DOC_REPAIR_KINDS, type RuleDocs } from "./lint-rule-docs.js";

import {
  KINDS,
  type ControlSlot,
  type ControlCategory,
  type ControlKind,
  type ControlValidationFailure,
  type RawControl,
  type RepairKind,
  type ResolvedControl,
} from "./generate-harness-controls.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isControlCategory(value: unknown): value is ControlCategory {
  return typeof value === "string" && RULE_DOC_CATEGORIES.some((category) => category === value);
}

function isRepairKind(value: unknown): value is RepairKind {
  return typeof value === "string" && RULE_DOC_REPAIR_KINDS.some((kind) => kind === value);
}

function isControlKind(value: unknown): value is ControlKind {
  return typeof value === "string" && KINDS.some((kind) => kind === value);
}

function isUnderRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function validatePairedGuide(repoRoot: string, value: string, failures: string[]): void {
  if (value === "none") return;
  const resolved = resolve(repoRoot, value);
  if (!isUnderRoot(repoRoot, resolved)) {
    failures.push("pairedGuide must resolve under repoRoot");
    return;
  }
  if (!existsSync(resolved)) {
    failures.push(`pairedGuide does not resolve to an existing file: ${value}`);
  }
}

function validateSource(repoRoot: string, value: string, failures: string[]): void {
  const resolved = resolve(repoRoot, value);
  if (!isUnderRoot(repoRoot, resolved)) {
    failures.push("source must resolve under repoRoot");
    return;
  }
  if (!existsSync(resolved)) {
    failures.push(`source does not resolve to an existing file: ${value}`);
  }
}

function resolveSlots(rawSlots: unknown, failures: string[]): ResolvedControl["slots"] | undefined {
  if (rawSlots === undefined) return undefined;
  if (!Array.isArray(rawSlots)) {
    failures.push("slots must be an array when present");
    return undefined;
  }
  const seen = new Set<string>();
  const slots: ControlSlot[] = [];
  for (const [index, rawSlot] of rawSlots.entries()) {
    if (!isObject(rawSlot)) {
      failures.push(`slots[${String(index)}] must be an object`);
      continue;
    }
    const { name, script, condition } = rawSlot;
    if (!isNonEmptyString(name)) {
      failures.push(`slots[${String(index)}].name must be a non-empty string`);
      continue;
    }
    if (!isNonEmptyString(script)) {
      failures.push(`slot ${name} script must be a non-empty string`);
      continue;
    }
    if (condition !== undefined && !isNonEmptyString(condition)) {
      failures.push(`slot ${name} condition must be a non-empty string`);
      continue;
    }
    if (seen.has(name)) {
      failures.push(`duplicate slot name: ${name}`);
      continue;
    }
    seen.add(name);
    slots.push({
      name,
      script,
      ...(condition !== undefined ? { condition } : {}),
    });
  }
  return slots;
}

function resolveLintRuleControl(
  raw: RawControl,
  ruleDocs: ReadonlyMap<string, RuleDocs>,
  repoRoot: string,
  failures: string[],
): ResolvedControl | undefined {
  const ruleName = raw.ruleName;
  if (!isNonEmptyString(ruleName)) {
    failures.push("lint-rule entries must declare a ruleName");
    return undefined;
  }
  const docs = ruleDocs.get(ruleName);
  if (docs === undefined) {
    failures.push(`ruleName ${ruleName} has no parseable meta.docs in eslint.config.js`);
    return undefined;
  }
  for (const field of [
    "category",
    "principle",
    "pairedGuide",
    "repairKind",
    "repairCommand",
    "slots",
  ] as const) {
    if (raw[field] !== undefined) {
      failures.push(
        `lint-rule entries must not restate ${field}; it is re-projected from meta.docs`,
      );
    }
  }
  if (!isNonEmptyString(raw.source)) {
    failures.push("source must be a non-empty string");
    return undefined;
  }
  if (!isNonEmptyString(raw.invocation)) {
    failures.push("invocation must be a non-empty string");
    return undefined;
  }
  validateSource(repoRoot, raw.source, failures);
  if (failures.length > 0) return undefined;
  return {
    id: raw.id,
    kind: "lint-rule",
    ruleName,
    category: docs.category,
    principle: docs.principle,
    pairedGuide: docs.pairedGuide,
    repairKind: docs.repairKind,
    ...(docs.repairCommand !== undefined ? { repairCommand: docs.repairCommand } : {}),
    source: raw.source,
    invocation: raw.invocation,
  };
}

function resolveNonLintControl(
  raw: RawControl,
  kind: ControlKind,
  repoRoot: string,
  failures: string[],
): ResolvedControl | undefined {
  if (raw.ruleName !== undefined) {
    failures.push("ruleName is only allowed on lint-rule entries");
  }
  if (!isControlCategory(raw.category)) {
    failures.push(`category must be one of: ${RULE_DOC_CATEGORIES.join(", ")}`);
  }
  if (!isNonEmptyString(raw.principle)) {
    failures.push("principle must be a non-empty string");
  }
  if (!isNonEmptyString(raw.pairedGuide)) {
    failures.push('pairedGuide must be "none" or a non-empty path string');
  } else {
    validatePairedGuide(repoRoot, raw.pairedGuide, failures);
  }
  if (!isRepairKind(raw.repairKind)) {
    failures.push(`repairKind must be one of: ${RULE_DOC_REPAIR_KINDS.join(", ")}`);
  }
  const hasRepairCommand = raw.repairCommand !== undefined;
  if (raw.repairKind === "codemod") {
    if (!isNonEmptyString(raw.repairCommand)) {
      failures.push("repairCommand must be a non-empty string when repairKind is codemod");
    }
  } else if (hasRepairCommand) {
    failures.push("repairCommand must be absent unless repairKind is codemod");
  }
  if (!isNonEmptyString(raw.source)) {
    failures.push("source must be a non-empty string");
  } else {
    validateSource(repoRoot, raw.source, failures);
  }
  if (!isNonEmptyString(raw.invocation)) {
    failures.push("invocation must be a non-empty string");
  }
  const slots = resolveSlots(raw.slots, failures);
  if (failures.length > 0) return undefined;
  /*
   * type-assertion-boundary: json - each field above was shape-validated by an
   * `isControlCategory` / `isRepairKind` / `isNonEmptyString` type guard, but
   * the guards push into `failures` rather than early-returning (so the caller
   * sees every problem at once), and TypeScript can't carry the per-field
   * narrowings through the intermediate `failures.push(...)` statements. The
   * casts narrow back to the validated shape at the single return point.
   */
  return {
    id: raw.id,
    kind,
    category: raw.category as ControlCategory,
    principle: raw.principle as string,
    pairedGuide: raw.pairedGuide as string,
    repairKind: raw.repairKind as RepairKind,
    ...(raw.repairCommand !== undefined ? { repairCommand: raw.repairCommand } : {}),
    source: raw.source as string,
    invocation: raw.invocation as string,
    ...(slots !== undefined ? { slots } : {}),
  };
}

export function resolveControl(
  raw: RawControl,
  ruleDocs: ReadonlyMap<string, RuleDocs>,
  repoRoot: string,
): ResolvedControl | ControlValidationFailure {
  const failures: string[] = [];
  if (!isControlKind(raw.kind)) {
    failures.push(`kind must be one of: ${KINDS.join(", ")}`);
    return { id: raw.id, failures };
  }
  const resolved =
    raw.kind === "lint-rule"
      ? resolveLintRuleControl(raw, ruleDocs, repoRoot, failures)
      : resolveNonLintControl(raw, raw.kind, repoRoot, failures);
  if (resolved === undefined) {
    return { id: raw.id, failures };
  }
  return resolved;
}

export function formatValidationFailures(failures: readonly ControlValidationFailure[]): string {
  const lines = ["Invalid harness manifest entries:"];
  for (const failure of failures) {
    lines.push(`- ${failure.id}: ${failure.failures.join("; ")}`);
  }
  return lines.join("\n");
}
