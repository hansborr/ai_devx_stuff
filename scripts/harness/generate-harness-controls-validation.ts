// Validation logic extracted from generate-harness-controls.ts to stay under
// the local/max-lines ratchet cap.

import type { RuleDocs } from "../lib/lint-rule-docs.js";
import {
  CONTROL_CATEGORIES,
  type ControlCategory,
  type ControlKind,
  isControlCategory,
  isControlKind,
  isNonEmptyString,
  isRepairKind,
  KINDS,
  lintRuleRestatementFailures,
  REPAIR_KINDS,
  type RepairKind,
  validatePairedGuidePath,
  validateRepairCommandPresence,
  validateSourcePath,
} from "./control-field-validation.js";
import type {
  ControlValidationFailure,
  RawControl,
  ResolvedControl,
} from "./generate-harness-controls.js";
import { resolveHookWiring } from "./hook-wiring-schema.js";
import { parseVerifyStepSlots } from "./verify-step-schema.js";

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
  failures.push(...lintRuleRestatementFailures(raw, { includeHookWiring: true }));
  if (!isNonEmptyString(raw.source)) {
    failures.push("source must be a non-empty string");
    return undefined;
  }
  if (!isNonEmptyString(raw.invocation)) {
    failures.push("invocation must be a non-empty string");
    return undefined;
  }
  failures.push(...validateSourcePath(repoRoot, raw.source));
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

function pushNonLintFieldFailures(raw: RawControl, repoRoot: string, failures: string[]): void {
  if (raw.ruleName !== undefined) {
    failures.push("ruleName is only allowed on lint-rule entries");
  }
  if (!isControlCategory(raw.category)) {
    failures.push(`category must be one of: ${CONTROL_CATEGORIES.join(", ")}`);
  }
  if (!isNonEmptyString(raw.principle)) {
    failures.push("principle must be a non-empty string");
  }
  failures.push(...validatePairedGuidePath(repoRoot, raw.pairedGuide));
  if (!isRepairKind(raw.repairKind)) {
    failures.push(`repairKind must be one of: ${REPAIR_KINDS.join(", ")}`);
  } else {
    failures.push(...validateRepairCommandPresence(raw.repairKind, raw.repairCommand));
  }
  if (!isNonEmptyString(raw.source)) {
    failures.push("source must be a non-empty string");
  } else {
    failures.push(...validateSourcePath(repoRoot, raw.source));
  }
  if (!isNonEmptyString(raw.invocation)) {
    failures.push("invocation must be a non-empty string");
  }
}

function resolveOptionalHookWiring(
  raw: RawControl,
  kind: ControlKind,
  failures: string[],
): ResolvedControl["hookWiring"] {
  if (raw.hookWiring === undefined) return undefined;
  if (kind !== "hook") {
    failures.push("hookWiring is only allowed on hook entries");
    return undefined;
  }
  try {
    return resolveHookWiring(raw.id, raw.hookWiring);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function resolveNonLintControl(
  raw: RawControl,
  kind: ControlKind,
  repoRoot: string,
  failures: string[],
): ResolvedControl | undefined {
  pushNonLintFieldFailures(raw, repoRoot, failures);
  const slots = parseVerifyStepSlots(raw.slots, failures);
  const hookWiring = resolveOptionalHookWiring(raw, kind, failures);
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
    ...(hookWiring !== undefined ? { hookWiring } : {}),
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
