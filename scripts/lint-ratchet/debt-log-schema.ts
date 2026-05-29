import type { LintRatchetOrphanRemoval, LintRatchetRegression } from "../lint-ratchet-baseline.js";
import { isRecord, parseArrayOf, rejectUnknownKeys } from "./debt-log-parse-helpers.js";
import { parseDebtLogOrphanRemoval } from "./debt-log-orphan-schema.js";
import { parseDebtLogRegression } from "./debt-log-regression-schema.js";

// Hand-rolled (deliberately NOT zod) validator for one committed debt-log line.
// This file is part of the portable lint-ratchet runtime: the import-boundary
// smoke (scripts/test-lint-ratchet.sh) allows only eslint + sibling runtime
// files, and zod resolves neither at the repo root nor in the smoke fixture.
// The entry reuses LintRatchetRegression and LintRatchetOrphanRemoval so a future
// shape change is a TypeScript compile error here and in the writer/renderer.

export interface LintRatchetDebtLogEntry {
  readonly version: "1";
  readonly acceptanceReason: string;
  readonly regressions: readonly LintRatchetRegression[];
  readonly orphansRemoved: readonly LintRatchetOrphanRemoval[];
}

export interface ParsedLintRatchetDebtLogEntry {
  readonly entry?: LintRatchetDebtLogEntry;
  readonly failures: string[];
}

interface DebtLogEntryParts {
  readonly version?: "1";
  readonly acceptanceReason?: string;
  readonly regressions?: readonly LintRatchetRegression[];
  readonly orphansRemoved?: readonly LintRatchetOrphanRemoval[];
}

const ENTRY_KEYS: ReadonlySet<string> = new Set([
  "version",
  "acceptanceReason",
  "regressions",
  "orphansRemoved",
]);

function parseVersion(value: unknown, failures: string[]): "1" | undefined {
  if (value === "1") return "1";
  failures.push('debt-log entry version must be "1"');
  return undefined;
}

function parseAcceptanceReason(value: unknown, failures: string[]): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  failures.push("debt-log entry acceptanceReason must be a non-empty string");
  return undefined;
}

function validateAcceptedDebt(parts: DebtLogEntryParts, failures: string[]): void {
  if (parts.regressions?.length === 0 && parts.orphansRemoved?.length === 0) {
    failures.push("debt-log entry must contain accepted debt");
  }
}

function completeEntry(
  parts: DebtLogEntryParts,
  failures: string[],
): LintRatchetDebtLogEntry | undefined {
  if (
    failures.length > 0 ||
    parts.version === undefined ||
    parts.acceptanceReason === undefined ||
    parts.regressions === undefined ||
    parts.orphansRemoved === undefined
  ) {
    return undefined;
  }
  return {
    version: parts.version,
    acceptanceReason: parts.acceptanceReason,
    regressions: parts.regressions,
    orphansRemoved: parts.orphansRemoved,
  };
}

export function parseLintRatchetDebtLogEntry(value: unknown): ParsedLintRatchetDebtLogEntry {
  const failures: string[] = [];
  if (!isRecord(value)) {
    failures.push("debt-log entry must be an object");
    return { failures };
  }
  rejectUnknownKeys(value, ENTRY_KEYS, "debt-log entry", failures);
  const parts: DebtLogEntryParts = {
    version: parseVersion(value.version, failures),
    acceptanceReason: parseAcceptanceReason(value.acceptanceReason, failures),
    regressions: parseArrayOf(value.regressions, "regressions", failures, parseDebtLogRegression),
    orphansRemoved: parseArrayOf(
      value.orphansRemoved,
      "orphansRemoved",
      failures,
      parseDebtLogOrphanRemoval,
    ),
  };
  validateAcceptedDebt(parts, failures);
  const entry = completeEntry(parts, failures);
  return entry === undefined ? { failures } : { entry, failures };
}
