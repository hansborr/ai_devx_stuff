import { appendFileSync, existsSync, readFileSync } from "node:fs";

import { type LintRatchetDebtLogEntry, parseLintRatchetDebtLogEntry } from "./debt-log-schema.js";
import type { LintRatchetRegression, LintRatchetUpdateDecision } from "./lint-ratchet-baseline.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { debtLogPath } from "./paths.js";

// Filesystem seam for the append path. Narrowed to the exact call shapes used so
// tests can inject trivial fakes; defaults forward to node:fs.
export interface DebtLogAppendDeps {
  readonly existsSync: (path: string) => boolean;
  readonly readFileSync: (path: string, encoding: "utf8") => string;
  readonly appendFileSync: (path: string, data: string) => void;
}

export const defaultDebtLogAppendDeps: DebtLogAppendDeps = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  appendFileSync: (path, data) => {
    appendFileSync(path, data);
  },
};

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
): LintRatchetDebtLogEntry {
  return {
    version: "1",
    acceptanceReason,
    regressions: decision.regressions.map(debtLogRegressionFor),
    orphansRemoved: decision.orphanRemovals,
  };
}

function hasLineAtTail(text: string, line: string): boolean {
  const tail = text.endsWith("\n") ? text.slice(0, -1) : text;
  const tailStart = tail.lastIndexOf("\n") + 1;
  return tail.slice(tailStart) === line;
}

// Validate before the append so a malformed entry never reaches the committed log.
// If a previous attempt appended the same line but failed before the baseline
// write, skip the duplicate append and let the retry continue to the baseline write.
export function appendValidatedDebtLogEntry(
  entry: LintRatchetDebtLogEntry,
  path = debtLogPath,
  deps: DebtLogAppendDeps = defaultDebtLogAppendDeps,
): boolean {
  const parsed = parseLintRatchetDebtLogEntry(entry);
  if (parsed.entry === undefined) {
    throw new ConfigError(
      `refusing to append an invalid debt-log entry:\n${parsed.failures.join("\n")}`,
    );
  }
  const line = JSON.stringify(entry);
  if (deps.existsSync(path) && hasLineAtTail(deps.readFileSync(path, "utf8"), line)) return false;
  deps.appendFileSync(path, `${line}\n`);
  return true;
}
