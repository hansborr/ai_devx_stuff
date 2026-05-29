import { appendFileSync, existsSync, readFileSync } from "node:fs";

import type { LintRatchetUpdateDecision } from "../lint-ratchet-baseline.js";
import { ConfigError } from "../lint-ratchet-metrics.js";
import { type LintRatchetDebtLogEntry, parseLintRatchetDebtLogEntry } from "./debt-log-schema.js";
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

// Pure mapping from an approved update decision to one debt-log line. The entry
// reuses the decision's regression rows and orphan-removal snapshots verbatim so
// the log records exactly what the gate approved.
export function buildLintRatchetDebtLogEntry(
  decision: LintRatchetUpdateDecision,
  acceptanceReason: string,
): LintRatchetDebtLogEntry {
  return {
    version: "1",
    acceptanceReason,
    regressions: decision.regressions,
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
