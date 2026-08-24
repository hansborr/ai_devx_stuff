import { ConfigError } from "../kernel/metrics-types.js";
import { type LintRatchetDebtLogEntry, parseLintRatchetDebtLogEntry } from "./debt-log-schema.js";

// The one JSONL parse loop for the debt log. Both readers (the CLI report via
// debt-log.ts and the accounting gate via
// baseline-debt-accounting.ts) must reject a malformed line with the same
// line-numbered diagnostic; the label parameterizes the file identity so the
// accounting side can distinguish the base snapshot from the appended slice.

function debtLogLines(text: string): readonly string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/u);
  // Pops exactly ONE trailing empty split (the final "\n"): a "\n\n" tail or an
  // interior blank hard-fails below, the strict opposite of logs-audit's
  // forgive-all-trailing-blanks policy (`auditJsonlText` in
  // scripts/logs-audit/logs-audit-ingestion.ts) —
  // deliberate for a tool-written merge=union log where blanks mean corruption.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parseDebtLogJsonlLine(
  line: string,
  lineNumber: number,
  label: string,
): LintRatchetDebtLogEntry {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown JSON parse error";
    throw new ConfigError(`${label} line ${String(lineNumber)} is not valid JSON: ${message}`);
  }
  const parsed = parseLintRatchetDebtLogEntry(value);
  if (parsed.entry === undefined) {
    throw new ConfigError(
      `${label} line ${String(lineNumber)} is invalid:\n${parsed.failures.join("\n")}`,
    );
  }
  return parsed.entry;
}

export function parseDebtLogJsonl(text: string, label: string): readonly LintRatchetDebtLogEntry[] {
  return debtLogLines(text).map((line, index) => parseDebtLogJsonlLine(line, index + 1, label));
}
