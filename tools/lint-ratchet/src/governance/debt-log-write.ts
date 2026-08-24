import { appendFileSync, existsSync, readFileSync } from "node:fs";

import type {
  LintRatchetMetricMigration,
  LintRatchetRegression,
  LintRatchetUpdateDecision,
} from "../kernel/baseline.js";
import { ConfigError } from "../kernel/metrics-types.js";
import {
  type LintRatchetAcceptedDebtLogEntry,
  type LintRatchetCoverageShrinkLogEntry,
  type LintRatchetDebtLogEntry,
  type LintRatchetMetricMigrationLogEntry,
  type LintRatchetRetirementLogEntry,
  parseLintRatchetDebtLogEntry,
} from "./debt-log-schema.js";

// Filesystem seam for the append path. Narrowed to the exact call shapes used so
// tests can inject trivial fakes; defaults forward to node:fs.
export interface DebtLogAppendDeps {
  readonly existsSync: (path: string) => boolean;
  readonly readFileSync: (path: string, encoding: "utf8") => string;
  readonly appendFileSync: (path: string, data: string) => void;
}

const defaultDebtLogAppendDeps: DebtLogAppendDeps = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  appendFileSync: (path, data) => {
    appendFileSync(path, data);
  },
};

function hasExplicitDebtLogKind(value: unknown): value is { readonly kind: unknown } {
  return typeof value === "object" && value !== null && "kind" in value && value.kind !== undefined;
}

function debtLogRegressionFor(regression: LintRatchetRegression): LintRatchetRegression {
  return {
    testId: regression.testId,
    ruleId: regression.ruleId,
    path: regression.path,
    baselineCount: regression.baselineCount,
    currentCount: regression.currentCount,
    reason: regression.reason,
    ...(regression.baselineLines === undefined ? {} : { baselineLines: regression.baselineLines }),
    ...(regression.currentLines === undefined ? {} : { currentLines: regression.currentLines }),
    ...(regression.baselineComplexity === undefined
      ? {}
      : { baselineComplexity: regression.baselineComplexity }),
    ...(regression.currentComplexity === undefined
      ? {}
      : { currentComplexity: regression.currentComplexity }),
    ...(regression.line === undefined ? {} : { line: regression.line }),
  };
}

// Pure mapping from an approved update decision to one debt-log line. The entry
// strips current-run diagnostic text from regression rows while keeping the
// accepted count/metric deltas and orphan-removal snapshots.
export function buildLintRatchetDebtLogEntry(
  decision: LintRatchetUpdateDecision,
  acceptanceReason: string,
): LintRatchetAcceptedDebtLogEntry {
  return {
    version: "1",
    kind: "accepted-debt",
    acceptanceReason,
    regressions: decision.regressions.map(debtLogRegressionFor),
    orphansRemoved: decision.orphanRemovals,
  };
}

export function buildLintRatchetRetirementLogEntry(
  ratchetId: string,
  optionsAttestation?: LintRatchetRetirementLogEntry["optionsAttestation"],
): LintRatchetRetirementLogEntry {
  return {
    version: "1",
    kind: "retirement",
    ratchetId,
    promotionProof: "normal-lint-error",
    ...(optionsAttestation === undefined ? {} : { optionsAttestation }),
  };
}

export function buildLintRatchetMetricMigrationLogEntry(
  migration: LintRatchetMetricMigration,
  reason: string,
): LintRatchetMetricMigrationLogEntry {
  return {
    version: "1",
    kind: "metric-migration",
    ratchetId: migration.ratchetId,
    fromMetric: migration.fromMetric,
    toMetric: migration.toMetric,
    reason,
  };
}

export function buildLintRatchetCoverageShrinkLogEntry(
  shrink: LintRatchetUpdateDecision["coverageShrinks"][number],
  reason: string,
): LintRatchetCoverageShrinkLogEntry {
  return {
    version: "1",
    kind: "coverage-shrink",
    ratchetId: shrink.ratchetId,
    previousFiles: shrink.previousFiles,
    currentFiles: shrink.currentFiles,
    previousIgnores: shrink.previousIgnores,
    currentIgnores: shrink.currentIgnores,
    removedPaths: shrink.removedPaths,
    reason,
  };
}

// Validate the whole batch before one append so a crash between the debt-log
// update and baseline write can retry by matching the exact batch at the tail.
export function appendValidatedDebtLogEntries(
  entries: readonly LintRatchetDebtLogEntry[],
  path: string,
  deps: DebtLogAppendDeps = defaultDebtLogAppendDeps,
): boolean {
  if (entries.length === 0) return false;
  for (const entry of entries) {
    if (!hasExplicitDebtLogKind(entry)) {
      throw new ConfigError(
        "refusing to append an invalid debt-log entry:\nkind: required for newly authored debt-log entries",
      );
    }
    const parsed = parseLintRatchetDebtLogEntry(entry);
    if (parsed.entry === undefined) {
      throw new ConfigError(
        `refusing to append an invalid debt-log entry:\n${parsed.failures.join("\n")}`,
      );
    }
  }
  const batch = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const existing = deps.existsSync(path) ? deps.readFileSync(path, "utf8") : "";
  if (existing.endsWith(batch)) return false;
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  deps.appendFileSync(path, `${separator}${batch}`);
  return true;
}
