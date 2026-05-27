import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
  type HarnessFinding,
  summarizeHarnessFindings,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import type {
  LintRatchetComparison,
  LintRatchetImprovement,
  LintRatchetRegression,
} from "../lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { ConfigError } from "../lint-ratchet-metrics.js";
import { formatRuleDocsFailures, loadLintRuleDocs, type RuleDocsEntry } from "../lint-rule-docs.js";
import { WorseBaselineError } from "./errors.js";
import { BASELINE_FILENAME, repoRoot } from "./paths.js";
import { assertNever, ratchetSource } from "./runtime-config.js";

function ratchetFixText(regression: LintRatchetRegression): string {
  if (regression.currentLines !== undefined) {
    const target =
      regression.baselineLines === undefined
        ? "until this new path has no ratcheted finding"
        : `back to the committed baseline (${String(regression.baselineLines)})`;
    return (
      `Reduce this file's ${regression.ruleId} effective line count from ${String(regression.currentLines)} ${target}, or run ` +
      "`bun run lint:ratchet:update` in a cleanup PR when the baseline movement is intentional."
    );
  }
  if (regression.currentComplexity !== undefined) {
    const target =
      regression.baselineComplexity === undefined
        ? "until this new path has no ratcheted finding"
        : `back to the committed baseline (${String(regression.baselineComplexity)})`;
    return (
      `Reduce this file's ${regression.ruleId} complexity from ${String(regression.currentComplexity)} ${target}, or run ` +
      "`bun run lint:ratchet:update` in a cleanup PR when the baseline movement is intentional."
    );
  }
  return (
    `Reduce this file's ${regression.ruleId} finding count from ${String(regression.currentCount)} ` +
    `back to the committed baseline (${String(regression.baselineCount)}), or run ` +
    "`bun run lint:ratchet:update` in a cleanup PR when the baseline movement is intentional."
  );
}

function regressionDetail(regression: LintRatchetRegression): string {
  if (regression.currentLines !== undefined) {
    return regression.baselineLines === undefined
      ? `${regression.testId} ${regression.path}: new path has ${String(regression.currentLines)} effective lines`
      : `${regression.testId} ${regression.path}: effective lines increased from ${String(regression.baselineLines)} to ${String(regression.currentLines)}`;
  }
  if (regression.currentComplexity !== undefined) {
    return regression.baselineComplexity === undefined
      ? `${regression.testId} ${regression.path}: new path has complexity ${String(regression.currentComplexity)}`
      : `${regression.testId} ${regression.path}: complexity increased from ${String(regression.baselineComplexity)} to ${String(regression.currentComplexity)}`;
  }
  return `${regression.testId} ${regression.path}: finding count increased from ${String(regression.baselineCount)} to ${String(regression.currentCount)}`;
}

function improvementDetail(improvement: LintRatchetImprovement): string {
  if (improvement.currentLines !== undefined) {
    return `${improvement.testId} ${improvement.path}: effective lines decreased from ${String(improvement.baselineLines)} to ${String(improvement.currentLines)}`;
  }
  if (improvement.currentComplexity !== undefined) {
    return `${improvement.testId} ${improvement.path}: complexity decreased from ${String(improvement.baselineComplexity)} to ${String(improvement.currentComplexity)}`;
  }
  return `${improvement.testId} ${improvement.path}: finding count decreased from ${String(improvement.baselineCount)} to ${String(improvement.currentCount)}`;
}

export function assertCheckBaselineComparisonClean(comparison: LintRatchetComparison): void {
  const regressionMessage =
    comparison.regressions.length === 0
      ? undefined
      : `current findings are worse than ${BASELINE_FILENAME} for ${String(comparison.regressions.length)} path(s): ${comparison.regressions.map(regressionDetail).join("; ")}`;
  const improvementMessage =
    comparison.improvements.length === 0
      ? undefined
      : `current findings are better than ${BASELINE_FILENAME} for ${String(comparison.improvements.length)} path(s): ${comparison.improvements.map(improvementDetail).join("; ")}`;
  if (regressionMessage === undefined && improvementMessage === undefined) return;
  const suffix =
    improvementMessage === undefined
      ? "run bun run lint:ratchet for details"
      : comparison.regressions.length === 0
        ? "run bun run lint:ratchet:update"
        : "fix regressions, then run bun run lint:ratchet:update";
  const message = [regressionMessage, improvementMessage]
    .filter((entry): entry is string => entry !== undefined)
    .join("; ");
  throw new WorseBaselineError(`${message}; ${suffix}`);
}

export async function loadRuleDocsById(): Promise<ReadonlyMap<string, RuleDocsEntry>> {
  const { entries, failures } = await loadLintRuleDocs(repoRoot);
  if (failures.length > 0) throw new ConfigError(formatRuleDocsFailures(failures));
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function howToFixFor(entry: RuleDocsEntry, regression: LintRatchetRegression): string {
  const ratchetFix = ratchetFixText(regression);
  if (entry.repairKind === "codemod") {
    if (entry.repairCommand === undefined) {
      throw new ConfigError(`Rule ${entry.id} declares repairKind=codemod without repairCommand`);
    }
    return `Run \`${entry.repairCommand}\`, then ${ratchetFix}`;
  }
  if (entry.repairKind === "autofix") return `Run \`bun run lint:fix\`, then ${ratchetFix}`;
  if (entry.repairKind === "suggestion") return `Apply the ESLint suggestion, then ${ratchetFix}`;
  return `Repair manually following the paired guide (${entry.pairedGuide}), then ${ratchetFix}`;
}

function structuredRatchetFields(delta: LintRatchetRegression | LintRatchetImprovement) {
  return {
    reason: delta.reason,
    baselineCount: delta.baselineCount,
    currentCount: delta.currentCount,
    ...(delta.baselineLines === undefined ? {} : { baselineLines: delta.baselineLines }),
    ...(delta.currentLines === undefined ? {} : { currentLines: delta.currentLines }),
    ...(delta.baselineComplexity === undefined
      ? {}
      : { baselineComplexity: delta.baselineComplexity }),
    ...(delta.currentComplexity === undefined
      ? {}
      : { currentComplexity: delta.currentComplexity }),
  };
}

function buildLocalFinding(
  regression: LintRatchetRegression,
  ruleDocsById: ReadonlyMap<string, RuleDocsEntry>,
): HarnessFinding {
  const entry = ruleDocsById.get(regression.ruleId);
  if (entry === undefined)
    throw new ConfigError(`No local rule metadata found for ${regression.ruleId}`);
  const base = {
    control: regression.testId,
    severity: "block",
    path: regression.path,
    ruleId: regression.ruleId,
    ...structuredRatchetFields(regression),
    why: `Ratchet regression: ${entry.principle}`,
    howToFix: howToFixFor(entry, regression),
    repairKind: entry.repairKind,
  } as const;
  const withLine = regression.line === undefined ? base : { ...base, line: regression.line };
  if (entry.repairKind === "codemod" && entry.repairCommand !== undefined) {
    return { ...withLine, repairCommand: entry.repairCommand };
  }
  return withLine;
}

function buildGenericFinding(regression: LintRatchetRegression): HarnessFinding {
  const base = {
    control: regression.testId,
    severity: "block",
    path: regression.path,
    ruleId: regression.ruleId,
    ...structuredRatchetFields(regression),
    why: `Ratchet regression for ${regression.ruleId}.`,
    howToFix: ratchetFixText(regression),
    repairKind: "manual",
  } as const;
  return regression.line === undefined ? base : { ...base, line: regression.line };
}

function buildFinding(
  regression: LintRatchetRegression,
  ruleDocsById: ReadonlyMap<string, RuleDocsEntry>,
  ratchetsById: ReadonlyMap<string, LintRatchetConfig>,
): HarnessFinding {
  const ratchet = ratchetsById.get(regression.testId);
  if (ratchet === undefined) {
    throw new ConfigError(`No ratchet registry entry found for ${regression.testId}`);
  }
  const source = ratchetSource(ratchet);
  switch (source.kind) {
    case "local":
      return buildLocalFinding(regression, ruleDocsById);
    case "third-party":
    case "core":
      return buildGenericFinding(regression);
    default:
      return assertNever(source);
  }
}

function buildImprovementFinding(improvement: LintRatchetImprovement): HarnessFinding {
  return {
    control: improvement.testId,
    severity: "block",
    path: improvement.path,
    ruleId: improvement.ruleId,
    ...structuredRatchetFields(improvement),
    why: `Current tree is better than the committed baseline for ${improvement.ruleId}; lock it in.`,
    howToFix:
      "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
    repairKind: "manual",
  };
}

export function buildEnvelope(
  regressions: readonly LintRatchetRegression[],
  improvements: readonly LintRatchetImprovement[],
  ruleDocsById: ReadonlyMap<string, RuleDocsEntry>,
  ratchets: readonly LintRatchetConfig[],
): HarnessDiagnostics {
  const ratchetsById = new Map(ratchets.map((ratchet) => [ratchet.id, ratchet]));
  const findings = [
    ...regressions.map((regression) => buildFinding(regression, ruleDocsById, ratchetsById)),
    ...improvements.map(buildImprovementFinding),
  ];
  findings.sort((left, right) => {
    const controlCompare = left.control.localeCompare(right.control);
    if (controlCompare !== 0) return controlCompare;
    const pathCompare = (left.path ?? "").localeCompare(right.path ?? "");
    if (pathCompare !== 0) return pathCompare;
    return (left.line ?? 0) - (right.line ?? 0);
  });
  return {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: "lint:ratchet",
    findings,
    summary: summarizeHarnessFindings(findings),
  };
}

export function validateEnvelope(envelope: HarnessDiagnostics): void {
  const result = harnessDiagnosticsSchema.safeParse(envelope);
  if (!result.success) {
    throw new ConfigError(
      `lint:ratchet produced an envelope that failed schema validation:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
}
