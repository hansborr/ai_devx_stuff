// Parsers for Semgrep CLI output (semgrep plan, slice 2): `--version` for
// engine provenance and the `--json` scan document. Prototype-lane plumbing
// only — no check id, no report rows. Fixtures derive from the real logged-out
// 1.165.0 capture at `fixtures/semgrep/scan-output.logged-out.json`; the parser
// never reads the redacted `extra.lines` / `extra.fingerprint` fields (see
// `semgrep-types.ts`).

import { isRecord, type UnknownRecord } from "./config-readers.js";
import { toPosix } from "./path-util.js";
import type {
  SemgrepFinding,
  SemgrepFindingMetadata,
  SemgrepScanError,
  SemgrepScanParse,
} from "./semgrep-types.js";
import { parseToolVersionOutput } from "./tool-version.js";

export function parseSemgrepVersionOutput(output: string): string | undefined {
  return parseToolVersionOutput(output, "semgrep");
}

export function parseSemgrepScanOutput(jsonText: string): SemgrepScanParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `semgrep output was not valid JSON: ${detail}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: "semgrep output must be a JSON object" };
  const results = parsed["results"];
  if (!Array.isArray(results)) {
    return { ok: false, error: "semgrep output is missing a 'results' array" };
  }
  const findings: SemgrepFinding[] = [];
  let malformedResultCount = 0;
  for (const raw of results) {
    const finding = readFinding(raw);
    if (finding === null) malformedResultCount += 1;
    else findings.push(finding);
  }
  return {
    ok: true,
    scan: {
      engineVersion: readString(parsed["version"]),
      findings,
      malformedResultCount,
      errors: readScanErrors(parsed["errors"]),
      skippedRules: readSkippedRules(parsed["skipped_rules"]),
      scannedCount: readScannedCount(parsed["paths"]),
    },
  };
}

function readFinding(raw: unknown): SemgrepFinding | null {
  if (!isRecord(raw)) return null;
  const checkId = readString(raw["check_id"]);
  const filePath = readString(raw["path"]);
  const startLine = readPositionField(raw["start"], "line");
  const endLine = readPositionField(raw["end"], "line");
  if (checkId === null || filePath === null || startLine === null || endLine === null) return null;
  const extra = isRecord(raw["extra"]) ? raw["extra"] : {};
  return {
    checkId,
    path: toPosix(filePath),
    startLine,
    startCol: readPositionField(raw["start"], "col"),
    endLine,
    endCol: readPositionField(raw["end"], "col"),
    message: readString(extra["message"]) ?? "",
    severity: readString(extra["severity"]),
    metadata: readFindingMetadata(isRecord(extra["metadata"]) ? extra["metadata"] : {}),
  };
}

function readFindingMetadata(raw: UnknownRecord): SemgrepFindingMetadata {
  return {
    confidence: readString(raw["confidence"]),
    likelihood: readString(raw["likelihood"]),
    impact: readString(raw["impact"]),
    category: readString(raw["category"]),
    subcategory: readStringList(raw["subcategory"]),
    cwe: readStringList(raw["cwe"]),
    owasp: readStringList(raw["owasp"]),
    references: readStringList(raw["references"]),
  };
}

function readScanErrors(value: unknown): readonly SemgrepScanError[] {
  if (!Array.isArray(value)) return [];
  return value.map(readScanError);
}

function readScanError(raw: unknown): SemgrepScanError {
  if (!isRecord(raw)) {
    return { message: "unparsed semgrep scan error", level: null, type: null, path: null };
  }
  return {
    message: readString(raw["message"]) ?? "unparsed semgrep scan error",
    level: readString(raw["level"]),
    type: readString(raw["type"]),
    path: readString(raw["path"]),
  };
}

function readSkippedRules(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map(
    (raw) => (isRecord(raw) ? readString(raw["rule_id"]) : null) ?? "unparsed skipped rule",
  );
}

function readScannedCount(paths: unknown): number | null {
  if (!isRecord(paths)) return null;
  const scanned = paths["scanned"];
  return Array.isArray(scanned) ? scanned.length : null;
}

// Semgrep positions are one-based: a 0 line marks the result row malformed
// (counted, never a line-0 candidate row), and a 0 col degrades to null.
function readPositionField(value: unknown, key: "line" | "col"): number | null {
  if (!isRecord(value)) return null;
  const position = value[key];
  return typeof position === "number" && Number.isInteger(position) && position >= 1
    ? position
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// Semgrep rule metadata declares cwe/owasp/subcategory as a scalar or a list;
// normalize both shapes (and drop non-string entries) so consumers see lists.
function readStringList(value: unknown): readonly string[] {
  if (typeof value === "string") return value.trim().length > 0 ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
