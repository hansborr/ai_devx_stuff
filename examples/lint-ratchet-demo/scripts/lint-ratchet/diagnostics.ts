import {
  MAX_LINES_METRIC_GUIDANCE,
  MAX_LINES_SPLIT_GUIDANCE,
} from "../../eslint-rules/max-lines.js";
import {
  buildHarnessDiagnostics,
  type HarnessDiagnosticNote,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
  type HarnessFinding,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import {
  formatRuleDocsFailures,
  loadLintRuleDocs,
  type RuleDocsEntry,
} from "../lib/lint-rule-docs.js";
import type {
  LintRatchetComparison,
  LintRatchetImprovement,
  LintRatchetInfo,
  LintRatchetRegression,
} from "./baseline.js";
import { WorseBaselineError } from "./cli-errors.js";
import { buildInfoFinding } from "./info-diagnostics.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { localRuleMessageHowToFixFor } from "./local-rule-fix-text.js";
import { ConfigError } from "./metrics.js";
import { BASELINE_FILENAME, repoRoot } from "./paths.js";
import { RATCHET_REGRESSION_UPDATE_COMMAND } from "./recovery-command.js";
import { assertNever, ratchetSource } from "./runtime-config.js";

const JSON_INDENT_SPACES = 2;
const REGRESSION_RECOVERY_NOTE: HarnessDiagnosticNote = {
  kind: "recovery-command",
  message:
    "If a ratchet regression is intentional, accept it with this full update command before committing.",
  command: RATCHET_REGRESSION_UPDATE_COMMAND,
};
const STRUCTURAL_FUNCTION_RULE_IDS = new Set(["max-depth", "max-lines-per-function"]);
const STRUCTURAL_FUNCTION_GUIDANCE =
  "Prefer early returns and guard clauses to reduce nesting, then extract focused helpers only where they clarify responsibilities. Do not compress lines, flatten branches mechanically, or inline useful helpers just to satisfy the metric.";

// ratchetFixText starts a standalone sentence ("Reduce …"); when it is appended
// mid-sentence after "…, then " its leading capital reads wrong, so callers that
// concatenate it lower-case the first character.
function lowercaseFirst(text: string): string {
  return text.slice(0, 1).toLowerCase() + text.slice(1);
}

function findingCountFixText(regression: LintRatchetRegression): string {
  return (
    `Reduce this file's ${regression.ruleId} finding count from ${String(regression.currentCount)} ` +
    `back to the committed baseline (${String(regression.baselineCount)}), or see the run summary recovery command if the new debt is intentional.`
  );
}

function ratchetFixText(regression: LintRatchetRegression): string {
  if (STRUCTURAL_FUNCTION_RULE_IDS.has(regression.ruleId)) {
    return `${STRUCTURAL_FUNCTION_GUIDANCE} ${findingCountFixText(regression)}`;
  }
  if (regression.currentLines !== undefined) {
    const target =
      regression.baselineLines === undefined
        ? "down until this new path has no ratcheted finding"
        : `back to the committed baseline (${String(regression.baselineLines)})`;
    return (
      `${MAX_LINES_SPLIT_GUIDANCE} and brings this file's ${regression.ruleId} effective line count ${target}. ` +
      `${MAX_LINES_METRIC_GUIDANCE} If a split would make the code worse, see the run summary recovery command before committing your work.`
    );
  }
  if (regression.currentComplexity !== undefined) {
    const target =
      regression.baselineComplexity === undefined
        ? "down until this new path has no ratcheted finding"
        : `back to the committed baseline (${String(regression.baselineComplexity)})`;
    return (
      `Split complex logic into focused functions, modules, helpers, or types when that makes the code clearer and brings ` +
      `this file's complexity ${target}. Do not code-golf by flattening branches, hiding conditionals, or inlining helpers ` +
      `just to satisfy the metric. If a refactor would make the code worse, see the run summary recovery command before committing your work.`
    );
  }
  return findingCountFixText(regression);
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

function baselineComparisonRecoverySuffix(comparison: LintRatchetComparison): string {
  if (comparison.improvements.length === 0) return "run bun run lint:ratchet for details";
  if (comparison.regressions.length === 0) return "run bun run lint:ratchet:update";
  return "fix regressions, then run bun run lint:ratchet:update";
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
  const suffix = baselineComparisonRecoverySuffix(comparison);
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
  const appendedRatchetFix = lowercaseFirst(ratchetFix);
  if (entry.repairKind === "codemod") {
    if (entry.repairCommand === undefined) {
      throw new ConfigError(`Rule ${entry.id} declares repairKind=codemod without repairCommand`);
    }
    return `Run \`${entry.repairCommand}\`, then ${appendedRatchetFix}`;
  }
  if (entry.repairKind === "autofix") {
    return `Run \`bun run lint:fix\`, then ${appendedRatchetFix}`;
  }
  if (entry.repairKind === "manual" && regression.firstMessage !== undefined) {
    const messageFix = localRuleMessageHowToFixFor(entry, { message: regression.firstMessage });
    return `${messageFix} Then ${appendedRatchetFix}`;
  }
  return ratchetFix;
}

function messageIdPayload(
  delta: LintRatchetRegression | LintRatchetImprovement,
): Partial<Pick<HarnessFinding, "messageId">> {
  if (!("firstMessageId" in delta)) return {};
  return delta.firstMessageId === undefined ? {} : { messageId: delta.firstMessageId };
}

function structuredRatchetFields(
  delta: LintRatchetRegression | LintRatchetImprovement,
): Record<string, number | string> {
  return {
    reason: delta.reason,
    baselineCount: delta.baselineCount,
    currentCount: delta.currentCount,
    ...messageIdPayload(delta),
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
    kind: "regression",
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

function buildGenericFinding(
  regression: LintRatchetRegression,
  ratchet: LintRatchetConfig,
): HarnessFinding {
  // Off-in-normal-lint and option-stricter rules are the ones where the ratchet
  // is the sole signal, so surface the registry's rationale instead of a bare
  // "Ratchet regression for <rule>." with no "why".
  const reason = ratchet.zeroBaselineDisposition?.reason;
  const base = {
    control: regression.testId,
    severity: "block",
    path: regression.path,
    ruleId: regression.ruleId,
    kind: "regression",
    ...structuredRatchetFields(regression),
    why:
      reason === undefined
        ? `Ratchet regression for ${regression.ruleId}.`
        : `Ratchet regression for ${regression.ruleId}: ${reason}`,
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
      return buildGenericFinding(regression, ratchet);
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
    kind: "improvement",
    ...structuredRatchetFields(improvement),
    why: `Current tree is better than the committed baseline for ${improvement.ruleId}; lock it in.`,
    howToFix:
      "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
    repairKind: "manual",
  };
}

interface BuildEnvelopeOptions {
  readonly regressions: readonly LintRatchetRegression[];
  readonly improvements: readonly LintRatchetImprovement[];
  readonly infos?: readonly LintRatchetInfo[];
  readonly ruleDocsById: ReadonlyMap<string, RuleDocsEntry>;
  readonly ratchets: readonly LintRatchetConfig[];
}

export function buildEnvelopeFromComparison(options: BuildEnvelopeOptions): HarnessDiagnostics {
  const { regressions, improvements, infos = [], ruleDocsById, ratchets } = options;
  const ratchetsById = new Map(ratchets.map((ratchet) => [ratchet.id, ratchet]));
  const findings = [
    ...regressions.map((regression) => buildFinding(regression, ruleDocsById, ratchetsById)),
    ...improvements.map(buildImprovementFinding),
    ...infos.map(buildInfoFinding),
  ];
  const notes = regressions.length === 0 ? undefined : [REGRESSION_RECOVERY_NOTE];
  return buildHarnessDiagnostics("lint:ratchet", findings, { notes });
}

export function buildEnvelope(
  regressions: readonly LintRatchetRegression[],
  improvements: readonly LintRatchetImprovement[],
  ruleDocsById: ReadonlyMap<string, RuleDocsEntry>,
  ratchets: readonly LintRatchetConfig[],
): HarnessDiagnostics {
  return buildEnvelopeFromComparison({ regressions, improvements, ruleDocsById, ratchets });
}

export function validateEnvelope(envelope: HarnessDiagnostics): void {
  const result = harnessDiagnosticsSchema.safeParse(envelope);
  if (!result.success) {
    throw new ConfigError(
      `lint:ratchet produced an envelope that failed schema validation:\n${JSON.stringify(result.error.issues, null, JSON_INDENT_SPACES)}`,
    );
  }
}
