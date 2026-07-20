// Validation logic extracted from generate-harness-controls.ts to stay under
// the local/max-lines ratchet cap.

import type { RuleDocs } from "../lib/lint-rule-docs.js";
import {
  CONTROL_CATEGORIES,
  type ControlKind,
  isControlCategory,
  isControlKind,
  isNonEmptyString,
  isRepairKind,
  KINDS,
  lintRuleRestatementFailures,
  missingRatchetPrincipleMessage,
  ratchetPrincipleRestatementFailures,
  REPAIR_KINDS,
  validatePairedGuidePath,
  validateRepairCommandPresence,
  validateSourcePath,
} from "./control-field-validation.js";
import type {
  ControlValidationFailure,
  RawControl,
  ResolvedControl,
} from "./generate-harness-controls.js";
import { categorizedControlFieldsSchema } from "./harness-manifest-schema.js";
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

function pushNonLintFieldFailures(
  raw: RawControl,
  repoRoot: string,
  failures: string[],
  options: { readonly principleFromRegistry?: boolean } = {},
): void {
  if (raw.ruleName !== undefined) {
    failures.push("ruleName is only allowed on lint-rule entries");
  }
  if (!isControlCategory(raw.category)) {
    failures.push(`category must be one of: ${CONTROL_CATEGORIES.join(", ")}`);
  }
  if (options.principleFromRegistry === true) {
    failures.push(...ratchetPrincipleRestatementFailures(raw));
  } else if (!isNonEmptyString(raw.principle)) {
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

interface NonLintResolveContext {
  readonly repoRoot: string;
  // When set, the principle is re-projected from the lint-ratchet registry
  // rather than read from the manifest (ratchet entries only).
  readonly derivedPrinciple?: string;
}

function resolveNonLintControl(
  raw: RawControl,
  kind: ControlKind,
  context: NonLintResolveContext,
  failures: string[],
): ResolvedControl | undefined {
  const { repoRoot, derivedPrinciple } = context;
  pushNonLintFieldFailures(raw, repoRoot, failures, {
    principleFromRegistry: derivedPrinciple !== undefined,
  });
  const slots = parseVerifyStepSlots(raw.slots, failures);
  const hookWiring = resolveOptionalHookWiring(raw, kind, failures);
  if (failures.length > 0) return undefined;
  // The guards above already reported every granular field failure (pinned
  // diagnostics); the schema re-parse narrows the raw record to the typed
  // field view at the single success point, replacing the per-field casts
  // that used to stand in for this. A parse failure after clean guards is a
  // guard/schema divergence and reported defensively rather than swallowed.
  const parsed = categorizedControlFieldsSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      failures.push(`schema divergence at ${issue.path.map(String).join(".")}: ${issue.message}`);
    }
    return undefined;
  }
  const fields = parsed.data;
  // For ratchets the principle is re-projected from the registry
  // (derivedPrinciple); other non-lint kinds carry it in the manifest, and the
  // guards above rejected a missing one.
  const principle = derivedPrinciple ?? fields.principle;
  if (principle === undefined) {
    failures.push("principle must be a non-empty string");
    return undefined;
  }
  return {
    id: raw.id,
    kind,
    category: fields.category,
    principle,
    pairedGuide: fields.pairedGuide,
    repairKind: fields.repairKind,
    ...(fields.repairCommand !== undefined ? { repairCommand: fields.repairCommand } : {}),
    source: fields.source,
    invocation: fields.invocation,
    ...(slots !== undefined ? { slots } : {}),
    ...(hookWiring !== undefined ? { hookWiring } : {}),
  };
}

function resolveRatchetControl(
  raw: RawControl,
  repoRoot: string,
  ratchetPrinciples: ReadonlyMap<string, string>,
  failures: string[],
): ResolvedControl | undefined {
  const derivedPrinciple = ratchetPrinciples.get(raw.id);
  if (derivedPrinciple === undefined) {
    failures.push(missingRatchetPrincipleMessage(raw.id));
    return undefined;
  }
  return resolveNonLintControl(raw, "ratchet", { repoRoot, derivedPrinciple }, failures);
}

export function resolveControl(
  raw: RawControl,
  ruleDocs: ReadonlyMap<string, RuleDocs>,
  repoRoot: string,
  ratchetPrinciples: ReadonlyMap<string, string>,
): ResolvedControl | ControlValidationFailure {
  const failures: string[] = [];
  if (!isControlKind(raw.kind)) {
    failures.push(`kind must be one of: ${KINDS.join(", ")}`);
    return { id: raw.id, failures };
  }
  let resolved: ResolvedControl | undefined;
  if (raw.kind === "lint-rule") {
    resolved = resolveLintRuleControl(raw, ruleDocs, repoRoot, failures);
  } else if (raw.kind === "ratchet") {
    resolved = resolveRatchetControl(raw, repoRoot, ratchetPrinciples, failures);
  } else {
    resolved = resolveNonLintControl(raw, raw.kind, { repoRoot }, failures);
  }
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
