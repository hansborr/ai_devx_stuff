// Coverage x unused-export correlation core (prototype lane, task 42b). This is
// the library half: it overlays parsed coverage evidence (task 42a) onto the
// symbol-level `unused-exports` reachability rows (knip adapter) WITHOUT running
// tests or a coverage gate. Static reachability and runtime coverage answer
// different questions -- a symbol can be statically unreferenced yet executed via
// dynamic behavior, or referenced yet never run -- so this module keeps the two
// signals SEPARATE per row and never collapses "uncovered" into "dead". Coverage
// sources are never unioned: each artifact contributes its own state for a symbol.
// The advisory rendering lives in coverage-unused-correlation-advisory.ts.

import type {
  CoverageArtifactEvidence,
  CoverageFileEvidence,
  CoverageFormat,
} from "./coverage-types.js";
import type { UnusedExportCategory, UnusedExportSymbol } from "./knip-unused-exports.js";
import { toPosix } from "./path-util.js";

// Standing caveat carried by every correlation run. It enumerates the dead-code
// false-positive trap families the task-40b corpus calibrates against, so a
// statically-unused + runtime-uncovered row can never read as a deletion verdict:
// the symbol may still be invisibly reachable.
export const CORRELATION_STANDING_CAVEAT =
  "static-unused (knip) is not a deletion verdict: a symbol can be invisibly reachable via " +
  "barrel re-export, dynamic import(), reflection / string-keyed access, framework-entrypoint " +
  "registration, or test-only usage. Coverage shows runtime execution for the supplied run(s), " +
  "not reachability -- keep 'uncovered' and 'unused' as two separate signals.";

// How a symbol's range related to a single artifact's coverage. `covered` and
// `uncovered` both mean a coverage record matched (present); they differ only by
// hit count, kept distinct so "uncovered" never silently becomes "unused".
// `unavailable` means coverage did not speak to this symbol (no file/line match
// or no location), which is NOT evidence of deadness.
export type CoverageMatchState = "covered" | "uncovered" | "unavailable";

export type CoverageMatchKind = "function-range" | "line" | "none";

export type PathMatchKind = "exact" | "suffix" | "none";

// One artifact's coverage result for one unused-export symbol. Never merged with
// other artifacts: unit/e2e/prod stay distinguishable.
export type ArtifactCoverageResult = {
  readonly label: string;
  readonly path: string;
  readonly format: CoverageFormat | null;
  readonly state: CoverageMatchState;
  readonly hits: number | null;
  readonly matchedLine: number | null;
  readonly matchedEndLine: number | null;
  readonly matchKind: CoverageMatchKind;
  readonly pathMatch: PathMatchKind;
  readonly note: string | null;
};

// Cross-artifact summary of a symbol's coverage states. A logical summary of the
// per-artifact results, NOT a unioned bitmap: `covered-but-unused` (knip says
// unused yet some run executed it) is the strongest false-positive lead;
// `uncovered-and-unused` is where both signals agree; `coverage-unavailable`
// means no artifact matched the symbol/range.
export type CorrelationAgreement =
  | "covered-but-unused"
  | "uncovered-and-unused"
  | "coverage-unavailable";

export type CoverageUnusedCorrelationRow = {
  readonly rank: number;
  readonly category: UnusedExportCategory;
  readonly file: string;
  readonly symbol: string;
  readonly namespace: string | null;
  readonly line: number | null;
  readonly col: number | null;
  readonly hasLocation: boolean;
  readonly agreement: CorrelationAgreement;
  readonly coverage: readonly ArtifactCoverageResult[];
  readonly caveats: readonly string[];
};

export type CoverageUnusedCorrelationStats = {
  readonly totalSymbols: number;
  readonly missingLocation: number;
  readonly fileNotInAnyArtifact: number;
  readonly suffixMatched: number;
  readonly coveredButUnused: number;
  readonly uncoveredAndUnused: number;
  readonly coverageUnavailable: number;
};

export type CoverageUnusedCorrelationResult = {
  readonly rows: readonly CoverageUnusedCorrelationRow[];
  readonly stats: CoverageUnusedCorrelationStats;
};

// Optional per-symbol caveat labeler. Production passes none (rows carry only the
// standing caveat); the task-40b corpus tests inject a labeler so they can assert
// trap/candidate/known-unused labels survive onto the row without the renderer
// ever calling the symbol dead.
export type CorrelationCaveatLabeler = (symbol: UnusedExportSymbol) => readonly string[];

export type CorrelateOptions = {
  readonly caveatLabeler?: CorrelationCaveatLabeler;
};

type ArtifactIndex = {
  readonly label: string;
  readonly path: string;
  readonly format: CoverageFormat | null;
  readonly entries: readonly (readonly [string, CoverageFileEvidence])[];
  readonly byFile: ReadonlyMap<string, CoverageFileEvidence>;
};

const AGREEMENT_ORDER: Readonly<Record<CorrelationAgreement, number>> = {
  "covered-but-unused": 0,
  "uncovered-and-unused": 1,
  "coverage-unavailable": 2,
};

export function correlateCoverageUnusedExports(
  symbols: readonly UnusedExportSymbol[],
  artifacts: readonly CoverageArtifactEvidence[],
  options: CorrelateOptions = {},
): CoverageUnusedCorrelationResult {
  const indexes = artifacts.map(buildArtifactIndex);
  const unranked = symbols.map((symbol) => rowForSymbol(symbol, indexes, options));
  const sorted = sortRows(unranked);
  const rows = sorted.map((row, index) => ({ ...row, rank: index + 1 }));
  return { rows, stats: computeStats(rows) };
}

function buildArtifactIndex(artifact: CoverageArtifactEvidence): ArtifactIndex {
  const entries = artifact.files.map((file) => [toPosix(file.file), file] as const);
  return {
    label: artifact.label,
    path: artifact.path,
    format: artifact.format,
    entries,
    byFile: new Map(entries),
  };
}

function rowForSymbol(
  symbol: UnusedExportSymbol,
  indexes: readonly ArtifactIndex[],
  options: CorrelateOptions,
): Omit<CoverageUnusedCorrelationRow, "rank"> {
  const hasLocation = symbol.line !== undefined;
  const coverage = indexes.map((index) => resultForArtifact(symbol, index, hasLocation));
  const extraCaveats = options.caveatLabeler?.(symbol) ?? [];
  return {
    category: symbol.category,
    file: toPosix(symbol.file),
    symbol: symbol.name,
    namespace: symbol.namespace ?? null,
    line: symbol.line ?? null,
    col: symbol.col ?? null,
    hasLocation,
    agreement: agreementFor(coverage),
    coverage,
    caveats: [CORRELATION_STANDING_CAVEAT, ...extraCaveats],
  };
}

function resultForArtifact(
  symbol: UnusedExportSymbol,
  index: ArtifactIndex,
  hasLocation: boolean,
): ArtifactCoverageResult {
  const base = { label: index.label, path: index.path, format: index.format };
  if (!hasLocation || symbol.line === undefined) {
    return {
      ...base,
      state: "unavailable",
      hits: null,
      matchedLine: null,
      matchedEndLine: null,
      matchKind: "none",
      pathMatch: "none",
      note: "symbol has no source location from knip; cannot align it to a coverage range",
    };
  }
  const fileMatch = matchFile(index, toPosix(symbol.file));
  if (fileMatch === null) {
    return {
      ...base,
      state: "unavailable",
      hits: null,
      matchedLine: null,
      matchedEndLine: null,
      matchKind: "none",
      pathMatch: "none",
      note: `file '${toPosix(symbol.file)}' not present in this artifact (path / source-map mismatch)`,
    };
  }
  return resultFromFile(base, fileMatch, symbol.line);
}

function resultFromFile(
  base: Pick<ArtifactCoverageResult, "label" | "path" | "format">,
  fileMatch: { readonly file: CoverageFileEvidence; readonly pathMatch: "exact" | "suffix" },
  line: number,
): ArtifactCoverageResult {
  const suffixNote =
    fileMatch.pathMatch === "suffix" ? "matched by path suffix; verify source-map alignment" : null;
  const within = matchInFile(fileMatch.file, line);
  if (within === null) {
    return {
      ...base,
      state: "unavailable",
      hits: null,
      matchedLine: null,
      matchedEndLine: null,
      matchKind: "none",
      pathMatch: fileMatch.pathMatch,
      note: joinNotes(`no coverage record at ${fileMatch.file.file}:${line}`, suffixNote),
    };
  }
  return {
    ...base,
    state: within.hits > 0 ? "covered" : "uncovered",
    hits: within.hits,
    matchedLine: within.matchedLine,
    matchedEndLine: within.matchedEndLine,
    matchKind: within.kind,
    pathMatch: fileMatch.pathMatch,
    note: suffixNote,
  };
}

function matchFile(
  index: ArtifactIndex,
  symFile: string,
): { readonly file: CoverageFileEvidence; readonly pathMatch: "exact" | "suffix" } | null {
  const exact = index.byFile.get(symFile);
  if (exact !== undefined) return { file: exact, pathMatch: "exact" };
  const suffix = index.entries.filter(([key]) => pathsAlign(key, symFile));
  if (suffix.length === 1 && suffix[0] !== undefined) {
    return { file: suffix[0][1], pathMatch: "suffix" };
  }
  return null;
}

// True when one repo-relative path is a tail of the other across a `/` boundary,
// the common case when a coverage tool emits absolute or differently-rooted paths
// while knip emits repo-relative ones. Requiring the `/` boundary avoids matching
// `b.ts` against `sub.ts`.
function pathsAlign(left: string, right: string): boolean {
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

type WithinMatch = {
  readonly hits: number;
  readonly kind: CoverageMatchKind;
  readonly matchedLine: number;
  readonly matchedEndLine: number | null;
};

function matchInFile(file: CoverageFileEvidence, line: number): WithinMatch | null {
  const declMatch = file.functions.find((fn) => fn.line === line);
  if (declMatch !== undefined) return functionMatch(declMatch);
  const rangeMatch = file.functions.find(
    (fn) => fn.endLine !== undefined && fn.line <= line && line <= fn.endLine,
  );
  if (rangeMatch !== undefined) return functionMatch(rangeMatch);
  const lineMatch = file.lines.find((entry) => entry.line === line);
  if (lineMatch !== undefined) {
    return {
      hits: lineMatch.hits,
      kind: "line",
      matchedLine: lineMatch.line,
      matchedEndLine: null,
    };
  }
  return null;
}

function functionMatch(fn: CoverageFileEvidence["functions"][number]): WithinMatch {
  return {
    hits: fn.hits,
    kind: "function-range",
    matchedLine: fn.line,
    matchedEndLine: fn.endLine ?? null,
  };
}

function agreementFor(coverage: readonly ArtifactCoverageResult[]): CorrelationAgreement {
  const matched = coverage.filter((result) => result.state !== "unavailable");
  if (matched.length === 0) return "coverage-unavailable";
  if (matched.some((result) => result.state === "covered")) return "covered-but-unused";
  return "uncovered-and-unused";
}

// Deterministic, signal-first ordering: rows whose coverage spoke come before
// coverage-unavailable rows (within the display cap a reader sees the informative
// ones), then by file, line, symbol, and category for stability.
function sortRows(
  rows: readonly Omit<CoverageUnusedCorrelationRow, "rank">[],
): Omit<CoverageUnusedCorrelationRow, "rank">[] {
  return [...rows].sort((left, right) => {
    const byAgreement = AGREEMENT_ORDER[left.agreement] - AGREEMENT_ORDER[right.agreement];
    if (byAgreement !== 0) return byAgreement;
    const byFile = left.file.localeCompare(right.file, "en");
    if (byFile !== 0) return byFile;
    const byLine = (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
    if (byLine !== 0) return byLine;
    const bySymbol = left.symbol.localeCompare(right.symbol, "en");
    if (bySymbol !== 0) return bySymbol;
    return left.category.localeCompare(right.category, "en");
  });
}

function computeStats(
  rows: readonly CoverageUnusedCorrelationRow[],
): CoverageUnusedCorrelationStats {
  return rows.reduce<CoverageUnusedCorrelationStats>(
    (stats, row) => ({
      totalSymbols: stats.totalSymbols + 1,
      missingLocation: stats.missingLocation + (row.hasLocation ? 0 : 1),
      fileNotInAnyArtifact: stats.fileNotInAnyArtifact + (fileMissingEverywhere(row) ? 1 : 0),
      suffixMatched: stats.suffixMatched + (anySuffixMatch(row) ? 1 : 0),
      coveredButUnused: stats.coveredButUnused + (row.agreement === "covered-but-unused" ? 1 : 0),
      uncoveredAndUnused:
        stats.uncoveredAndUnused + (row.agreement === "uncovered-and-unused" ? 1 : 0),
      coverageUnavailable:
        stats.coverageUnavailable + (row.agreement === "coverage-unavailable" ? 1 : 0),
    }),
    emptyStats(),
  );
}

function fileMissingEverywhere(row: CoverageUnusedCorrelationRow): boolean {
  return row.hasLocation && row.coverage.every((result) => result.pathMatch === "none");
}

function anySuffixMatch(row: CoverageUnusedCorrelationRow): boolean {
  return row.coverage.some((result) => result.pathMatch === "suffix");
}

function emptyStats(): CoverageUnusedCorrelationStats {
  return {
    totalSymbols: 0,
    missingLocation: 0,
    fileNotInAnyArtifact: 0,
    suffixMatched: 0,
    coveredButUnused: 0,
    uncoveredAndUnused: 0,
    coverageUnavailable: 0,
  };
}

function joinNotes(primary: string, secondary: string | null): string {
  return secondary === null ? primary : `${primary}; ${secondary}`;
}
