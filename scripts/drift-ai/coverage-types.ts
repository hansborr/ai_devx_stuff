// Structured, labeled coverage evidence for the coverage prototype lane (tasks
// 42a-42c). This module is intentionally library-only: it owns the evidence
// shape, not any user-facing output. Coverage answers "was this range executed
// in this run?", not "is this code dead?", so the shape keeps raw per-artifact
// execution counts and degradation notes rather than verdicts. Task 42c renders
// it; task 42b correlates it with unused-exports.

// Artifact formats the parser understands. lcov (`.info`) is the first and only
// supported format; `coverage-final.json` (Istanbul) is intentionally deferred.
export type CoverageFormat = "lcov";

// One function's execution evidence within a covered file. `line` is the
// declaration line; `endLine` is only present when the artifact reports a
// function range (newer lcov `FN:<start>,<end>,<name>`). `hits` is the raw
// execution count for the run that produced the artifact.
export type CoverageFunctionEvidence = {
  readonly name: string;
  readonly line: number;
  readonly endLine?: number;
  readonly hits: number;
};

// One source line's execution evidence: 1-based line number and raw hit count.
export type CoverageLineEvidence = {
  readonly line: number;
  readonly hits: number;
};

// Per-source-file evidence parsed from a single artifact. `linesFound`/`linesHit`
// /`functionsFound`/`functionsHit` use the artifact's own summary records
// (lcov LF/LH/FNF/FNH) when present, falling back to values derived from the
// parsed per-line/per-function records when the artifact omits the summary.
export type CoverageFileEvidence = {
  readonly file: string;
  readonly functions: readonly CoverageFunctionEvidence[];
  readonly lines: readonly CoverageLineEvidence[];
  readonly linesFound: number;
  readonly linesHit: number;
  readonly functionsFound: number;
  readonly functionsHit: number;
};

// A non-fatal degradation recorded while reading or parsing an artifact. These
// keep partial evidence honest: a later renderer can disclose that a run was
// only partially parsed instead of mistaking it for clean coverage.
export type CoverageParseNoteKind =
  | "malformed-record"
  | "missing-end-of-record"
  | "unsupported-format"
  | "empty-artifact"
  | "read-failure";

export type CoverageParseNote = {
  readonly kind: CoverageParseNoteKind;
  readonly detail: string;
  // 1-based line within the artifact, when the note is tied to a specific record.
  readonly line?: number;
};

// One artifact's evidence, kept separate from every other artifact (coverage
// sources are never merged silently). `format` is null when the artifact could
// not be parsed (unsupported format or read failure). `timestamp` is the
// artifact file's modification time (ISO 8601) when available, sourced at the IO
// boundary; the parser itself is content-only.
export type CoverageArtifactEvidence = {
  readonly path: string;
  readonly label: string;
  readonly format: CoverageFormat | null;
  readonly timestamp: string | null;
  readonly files: readonly CoverageFileEvidence[];
  readonly notes: readonly CoverageParseNote[];
};

export type ParsedLcov = {
  readonly files: readonly CoverageFileEvidence[];
  readonly notes: readonly CoverageParseNote[];
};
