// knip unused-exports adapter: parse knip's symbol-level reachability categories
// (`exports`, `types`, `enumMembers`, `namespaceMembers`) and build provenance-
// stamped, category-tagged findings. This is the symbol-level companion to the
// FILE-level orphan-files adapter — both pass through the target's OWN knip
// verdict verbatim (adapter contract §1), so this module REUSES orphan-files'
// config resolution, services shape, and skip-reason helpers rather than
// duplicating them. The subprocess I/O lives in knip-runner.ts; the CheckPlugin
// wiring in knip-unused-exports-check.ts.

import { isRecord } from "../lib/records.js";
import {
  fullKnipLocation,
  type KnipReportIssueRows,
  type KnipReportParseFailure,
  knipSymbolFromItem,
  parseKnipReportEnvelope,
} from "./knip-report-envelope.js";
import { sortFindingsByFileMessage, toPosix } from "./path-util.js";
import { changedFilesFromScope, type DetectorScope } from "./scope.js";
import type { DriftFinding, FindingProvenance } from "./types.js";

// The four symbol-level knip categories drift:ai surfaces. `files` (orphan files)
// stays with the orphan-files check; `duplicates` is deferred (a duplication
// signal partly covered by the duplicate-* family). Each category renders a
// category-specific message and is tagged via `details.category`.
export const UNUSED_EXPORT_CATEGORIES = [
  "exports",
  "types",
  "enumMembers",
  "namespaceMembers",
] as const;

export type UnusedExportCategory = (typeof UNUSED_EXPORT_CATEGORIES)[number];

// A single symbol knip flagged as unused. `line`/`col` are present only when
// knip emits a positive-integer location pair; malformed locations keep the
// file-level evidence without fabricating a precise coordinate. `namespace` is
// the enclosing enum/namespace name, present only for enumMembers and
// namespaceMembers (knip's `namespace` field on those rows).
export type UnusedExportSymbol = {
  readonly category: UnusedExportCategory;
  readonly file: string;
  readonly name: string;
  readonly line?: number;
  readonly col?: number;
  readonly namespace?: string;
};

export type ParseKnipUnusedExportsResult =
  | { readonly ok: true; readonly symbols: readonly UnusedExportSymbol[] }
  | KnipReportParseFailure;

// Parse the symbol-level categories from `knip --reporter json` (knip 6.26.0
// shape, confirmed at runtime against the pinned version). A row is keyed by
// `file` and carries a per-category array of items:
//   { "file": "<path>",
//     "exports":          [ { "name", "line", "col", "pos" }, ... ],
//     "types":            [ { "name", "line", "col", "pos" }, ... ],
//     "enumMembers":      [ { "namespace", "name", "line", "col", "pos" }, ... ],
//     "namespaceMembers": [ { "namespace", "name", "line", "col", "pos" }, ... ],
//     "files":            [ { "name" } ] }   // file-level; handled by orphan-files
// A category requested via --include but with no issues is an empty array; a
// category NOT requested is absent from the row entirely. Both mean "no symbols"
// here — a missing/empty/non-array category is skipped, never an error. The
// `files` category is ignored: orphan-files owns file-level reachability.
export function parseKnipUnusedExports(jsonText: string): ParseKnipUnusedExportsResult {
  const envelope = parseKnipReportEnvelope(jsonText);
  if (!envelope.ok) return envelope;
  return projectKnipUnusedExports(envelope.issues);
}

export function projectKnipUnusedExports(
  issues: KnipReportIssueRows,
): Extract<ParseKnipUnusedExportsResult, { readonly ok: true }> {
  const symbols: UnusedExportSymbol[] = [];
  for (const row of issues) symbols.push(...symbolsFromRow(row));
  return { ok: true, symbols };
}

function symbolsFromRow(row: unknown): UnusedExportSymbol[] {
  if (!isRecord(row)) return [];
  const file = row["file"];
  if (typeof file !== "string" || file.length === 0) return [];
  const posixFile = toPosix(file);
  const symbols: UnusedExportSymbol[] = [];
  for (const category of UNUSED_EXPORT_CATEGORIES) {
    const items = row[category];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const symbol = symbolFromItem(category, posixFile, item);
      if (symbol !== undefined) symbols.push(symbol);
    }
  }
  return symbols;
}

function symbolFromItem(
  category: UnusedExportCategory,
  file: string,
  item: unknown,
): UnusedExportSymbol | undefined {
  const symbol = knipSymbolFromItem(item);
  if (symbol === undefined) return undefined;
  const namespace = isRecord(item) ? item["namespace"] : undefined;
  const base = { category, file, ...symbol };
  return typeof namespace === "string" && namespace.length > 0 ? { ...base, namespace } : base;
}

// --- findings ---------------------------------------------------------------

export const UNUSED_EXPORTS_REPAIR_HINT =
  "if the symbol is dead, remove it; if it is part of the public API or used in a way knip cannot see (dynamic access, framework magic, string-keyed lookup), add it (or its file/pattern) to the target's knip ignore config so the signal stays clean.";

// Overlay hint for a symbol that knip reports unused AND that is locally annotated
// `@deprecated`: the two signals together make it a strong tombstone-removal
// candidate. Still evidence, not a verdict — the escape hatches mirror the base
// hint (drop the annotation or add a knip ignore if the symbol is reachable
// invisibly).
export const DEPRECATED_UNUSED_EXPORTS_REPAIR_HINT =
  "annotated @deprecated and reported unused by knip — a strong tombstone-removal candidate; if it is still part of the public API or used in a way knip cannot see (dynamic access, framework magic, string-keyed lookup), drop the @deprecated tag or add it (or its file/pattern) to the target's knip ignore config so the signal stays clean.";

// A predicate that says whether a symbol is locally annotated `@deprecated`. Kept
// as a plain predicate so this module stays free of the ts-morph parsing seam; the
// real lookup lives in knip-unused-exports-deprecated.ts and is injected by the
// check plugin, while direct unit tests pass a fake (or omit it entirely).
export type DeprecatedSymbolPredicate = (symbol: UnusedExportSymbol) => boolean;

// Category-specific message. Names the engine's own framing — never asserts the
// symbol IS dead (evidence, not verdicts); the FIX hint points at the resolution.
// When the symbol is also `@deprecated`, the message names that local annotation
// alongside knip's reachability verdict.
function messageFor(symbol: UnusedExportSymbol, deprecated: boolean): string {
  const where = `${symbol.name} (${locationLabel(symbol)})`;
  const dep = deprecated ? "marked @deprecated and " : "";
  switch (symbol.category) {
    case "exports":
      return `exported symbol ${where} is ${dep}never imported (knip reports it as an unused export)`;
    case "types":
      return `exported type ${where} is ${dep}never referenced (knip reports it as an unused type)`;
    case "enumMembers": {
      const member = symbol.namespace === undefined ? where : `${symbol.namespace}.${where}`;
      return `enum member ${member} is ${dep}never used (knip reports it as an unused enum member)`;
    }
    case "namespaceMembers": {
      const member = symbol.namespace === undefined ? where : `${symbol.namespace}.${where}`;
      return `namespace member ${member} is ${dep}never used (knip reports it as an unused namespace member)`;
    }
  }
}

export function buildUnusedExportFindings(
  symbols: readonly UnusedExportSymbol[],
  detectorScope: DetectorScope,
  provenance: FindingProvenance,
  isDeprecated?: DeprecatedSymbolPredicate,
): DriftFinding[] {
  const inScope = filterSymbolsToScope(symbols, detectorScope);
  const findings = inScope.map<DriftFinding>((symbol) => {
    const location = fullKnipLocation(symbol);
    const deprecated = isDeprecated?.(symbol) ?? false;
    return {
      check: "unused-exports",
      file: symbol.file,
      message: messageFor(symbol, deprecated),
      hint: deprecated ? DEPRECATED_UNUSED_EXPORTS_REPAIR_HINT : UNUSED_EXPORTS_REPAIR_HINT,
      details: {
        category: symbol.category,
        symbol: symbol.name,
        ...(location === undefined ? {} : location),
        ...(symbol.namespace === undefined ? {} : { namespace: symbol.namespace }),
        ...(deprecated ? { deprecated: true } : {}),
      },
      provenance,
    };
  });
  return sortFindingsByFileMessage(findings);
}

// knip analyzes the whole project, so the symbol set is global. We scope it to
// the run's canonical relevance set, identically to orphan-files:
//   - changed scope: intersect with the changed set.
//   - current scope: intersect with detector scope files (already filtered
//     through roots, ignore rules, regular-file checks, source-extension policy).
// This only scopes report relevance, never knip's verdict (the target's knip
// config already owns what counts as used) — evidence, not verdicts.
function filterSymbolsToScope(
  symbols: readonly UnusedExportSymbol[],
  detectorScope: DetectorScope,
): UnusedExportSymbol[] {
  const inScope = scopeFileSet(detectorScope);
  return symbols.filter((symbol) => inScope.has(toPosix(symbol.file)));
}

function scopeFileSet(detectorScope: DetectorScope): ReadonlySet<string> {
  if (detectorScope.scopeMode === "current") {
    return new Set(detectorScope.files.map((file) => toPosix(file.path)));
  }
  return new Set(changedFilesFromScope(detectorScope).map((file) => toPosix(file.path)));
}

function locationLabel(symbol: UnusedExportSymbol): string {
  const location = fullKnipLocation(symbol);
  return location === undefined ? symbol.file : `${symbol.file}:${location.line}:${location.col}`;
}
