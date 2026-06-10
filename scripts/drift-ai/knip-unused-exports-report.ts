import { readFileSync } from "node:fs";
import path from "node:path";

import { parseKnipUnusedExports, type UnusedExportSymbol } from "./knip-unused-exports.js";

export type KnipUnusedExportsReportStatus =
  | { readonly kind: "ok"; readonly path: string; readonly symbolCount: number }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly path: string; readonly error: string }
  | { readonly kind: "parse-failed"; readonly path: string; readonly error: string };

export type LoadedKnipUnusedExportsReport = {
  readonly status: KnipUnusedExportsReportStatus;
  readonly symbols: readonly UnusedExportSymbol[];
};

// Consume-don't-run: prototype overlays read a supplied knip JSON report and
// disclose absent, unreadable, or unparseable reports as advisory prerequisites.
export function loadKnipUnusedExportsReport(
  repoRoot: string,
  reportPath: string | null,
): LoadedKnipUnusedExportsReport {
  if (reportPath === null) return { status: { kind: "absent" }, symbols: [] };
  let content: string;
  try {
    content = readFileSync(path.resolve(repoRoot, reportPath), "utf8");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { status: { kind: "unreadable", path: reportPath, error }, symbols: [] };
  }
  const parsed = parseKnipUnusedExports(content);
  if (!parsed.ok) {
    return { status: { kind: "parse-failed", path: reportPath, error: parsed.error }, symbols: [] };
  }
  return {
    status: { kind: "ok", path: reportPath, symbolCount: parsed.symbols.length },
    symbols: parsed.symbols,
  };
}
