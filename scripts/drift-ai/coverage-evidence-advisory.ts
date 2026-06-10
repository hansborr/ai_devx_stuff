import { plural, positiveInt } from "./advisory-format-helpers.js";
import type {
  CoverageArtifactEvidence,
  CoverageFormat,
  CoverageFunctionEvidence,
  CoverageLineEvidence,
  CoverageParseNote,
} from "./coverage-types.js";
import {
  appendPrototypeSection,
  buildPrototypeAdvisory,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
  type PrototypeAdvisory,
  type PrototypeCap,
  type PrototypeSection,
} from "./prototype-advisory.js";

export const COVERAGE_EVIDENCE_SUBCOMMAND = "coverage-evidence";
export const DEFAULT_COVERAGE_EVIDENCE_TOP = 50;

export type CoverageEvidenceSource = {
  readonly path: string;
  readonly label: string;
  readonly format: CoverageFormat | null;
  readonly timestamp: string | null;
};

export type CoverageEvidenceSummary = {
  readonly files: number;
  readonly functionRows: number;
  readonly lineRows: number;
  readonly functionsFound: number;
  readonly functionsHit: number;
  readonly linesFound: number;
  readonly linesHit: number;
};

export type CoverageEvidenceFunctionRow = {
  readonly rank: number;
  readonly source: CoverageEvidenceSource;
  readonly kind: "function";
  readonly file: string;
  readonly name: string;
  readonly line: number;
  readonly endLine?: number;
  readonly hits: number;
};

export type CoverageEvidenceLineRow = {
  readonly rank: number;
  readonly source: CoverageEvidenceSource;
  readonly kind: "line";
  readonly file: string;
  readonly line: number;
  readonly hits: number;
};

export type CoverageEvidenceRow = CoverageEvidenceFunctionRow | CoverageEvidenceLineRow;

export type CoverageEvidenceSection = PrototypeSection<CoverageEvidenceRow> & {
  readonly artifact: CoverageEvidenceSource | null;
  readonly summary: CoverageEvidenceSummary | null;
  readonly notes: readonly CoverageParseNote[];
};

export type CoverageEvidenceAdvisory = PrototypeAdvisory<CoverageEvidenceSection>;

export type CoverageEvidenceAdvisoryOptions = {
  readonly top?: number;
};

export function buildCoverageEvidenceAdvisory(
  artifacts: readonly CoverageArtifactEvidence[],
  options: CoverageEvidenceAdvisoryOptions = {},
): CoverageEvidenceAdvisory {
  const top = positiveInt(options.top, DEFAULT_COVERAGE_EVIDENCE_TOP);
  if (artifacts.length === 0) return noArtifactsAdvisory(top);
  const sections = artifacts.map((artifact) => sectionForArtifact(artifact, top));
  return buildPrototypeAdvisory({
    subcommand: COVERAGE_EVIDENCE_SUBCOMMAND,
    prerequisites: [
      {
        name: "coverage artifacts",
        satisfied: true,
        detail: `${artifacts.length} configured ${plural("artifact", artifacts.length)}`,
      },
    ],
    caps: [rowCap(top, sections)],
    degradations: artifacts.flatMap(degradationNotes),
    sections,
  });
}

export function formatCoverageEvidenceAdvisoryJson(advisory: CoverageEvidenceAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatCoverageEvidenceAdvisoryText(advisory: CoverageEvidenceAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  for (const section of advisory.sections) {
    lines.push("");
    appendCoverageSection(lines, section);
  }
  return lines.join("\n");
}

function noArtifactsAdvisory(top: number): CoverageEvidenceAdvisory {
  return buildPrototypeAdvisory<CoverageEvidenceSection>({
    subcommand: COVERAGE_EVIDENCE_SUBCOMMAND,
    prerequisites: [
      {
        name: "coverage artifacts",
        satisfied: false,
        detail: "0 configured artifacts; add coverage.artifacts to drift-ai config",
      },
    ],
    caps: [rowCap(top, [])],
    sections: [
      {
        candidateKind: "coverage artifact evidence",
        artifact: null,
        summary: null,
        notes: [],
        totalCandidates: 0,
        emptyReason: "no coverage artifacts configured.",
        entries: [],
      },
    ],
  });
}

function sectionForArtifact(
  artifact: CoverageArtifactEvidence,
  top: number,
): CoverageEvidenceSection {
  const source = sourceForArtifact(artifact);
  const rows = rowsForArtifact(artifact, source);
  return {
    candidateKind: "coverage artifact evidence",
    artifact: source,
    summary: summaryForArtifact(artifact),
    notes: artifact.notes,
    totalCandidates: rows.length,
    emptyReason:
      rows.length === 0 ? `no coverage rows parsed from artifact '${artifact.label}'.` : null,
    entries: rows.slice(0, top),
  };
}

function sourceForArtifact(artifact: CoverageArtifactEvidence): CoverageEvidenceSource {
  return {
    path: artifact.path,
    label: artifact.label,
    format: artifact.format,
    timestamp: artifact.timestamp,
  };
}

function rowsForArtifact(
  artifact: CoverageArtifactEvidence,
  source: CoverageEvidenceSource,
): CoverageEvidenceRow[] {
  const rows: CoverageEvidenceRow[] = [];
  for (const file of artifact.files) {
    appendFunctionRows(rows, source, file.file, file.functions);
    appendLineRows(rows, source, file.file, file.lines);
  }
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function appendFunctionRows(
  rows: CoverageEvidenceRow[],
  source: CoverageEvidenceSource,
  file: string,
  functions: readonly CoverageFunctionEvidence[],
): void {
  for (const fn of functions) {
    const base = {
      rank: 0,
      source,
      kind: "function" as const,
      file,
      name: fn.name,
      line: fn.line,
      hits: fn.hits,
    };
    rows.push(fn.endLine === undefined ? base : { ...base, endLine: fn.endLine });
  }
}

function appendLineRows(
  rows: CoverageEvidenceRow[],
  source: CoverageEvidenceSource,
  file: string,
  lines: readonly CoverageLineEvidence[],
): void {
  for (const line of lines) {
    rows.push({
      rank: 0,
      source,
      kind: "line",
      file,
      line: line.line,
      hits: line.hits,
    });
  }
}

function summaryForArtifact(artifact: CoverageArtifactEvidence): CoverageEvidenceSummary {
  return artifact.files.reduce(
    (summary, file) => ({
      files: summary.files + 1,
      functionRows: summary.functionRows + file.functions.length,
      lineRows: summary.lineRows + file.lines.length,
      functionsFound: summary.functionsFound + file.functionsFound,
      functionsHit: summary.functionsHit + file.functionsHit,
      linesFound: summary.linesFound + file.linesFound,
      linesHit: summary.linesHit + file.linesHit,
    }),
    {
      files: 0,
      functionRows: 0,
      lineRows: 0,
      functionsFound: 0,
      functionsHit: 0,
      linesFound: 0,
      linesHit: 0,
    },
  );
}

function rowCap(top: number, sections: readonly CoverageEvidenceSection[]): PrototypeCap {
  const hitCount = sections.filter(
    (section) => section.totalCandidates > section.entries.length,
  ).length;
  return {
    label: "rows per artifact",
    limit: top,
    hit: hitCount > 0,
    detail:
      hitCount > 0
        ? `${hitCount} ${plural("artifact", hitCount)} had more than ${top} parsed rows`
        : null,
  };
}

function degradationNotes(artifact: CoverageArtifactEvidence): string[] {
  return artifact.notes.map((note) => `${artifact.label} ${artifact.path}: ${formatNote(note)}`);
}

function appendCoverageSection(lines: string[], section: CoverageEvidenceSection): void {
  appendPrototypeSection(lines, section, renderRow, { preludeLines: coverageSectionPrelude });
}

function coverageSectionPrelude(section: CoverageEvidenceSection): readonly string[] {
  const lines: string[] = [];
  if (section.artifact !== null) {
    lines.push(formatArtifact(section.artifact));
  }
  if (section.summary !== null) {
    lines.push(formatSummary(section.summary));
  }
  for (const note of section.notes) {
    lines.push(`note ${formatSectionNote(note)}`);
  }
  return lines;
}

function renderRow(row: CoverageEvidenceRow): readonly string[] {
  return [
    row.kind === "function" ? formatFunctionRow(row) : formatLineRow(row),
    `source ${row.source.label} (${formatFormat(row.source.format)}) artifact ${row.source.path}; inspect coverage run context before interpreting hits.`,
  ];
}

function formatFunctionRow(row: CoverageEvidenceFunctionRow): string {
  return `#${row.rank} function ${row.file}:${formatRange(row)} ${row.name} hits ${row.hits}`;
}

function formatLineRow(row: CoverageEvidenceLineRow): string {
  return `#${row.rank} line ${row.file}:${row.line} hits ${row.hits}`;
}

function formatRange(row: CoverageEvidenceFunctionRow): string {
  return row.endLine === undefined ? String(row.line) : `${row.line}-${row.endLine}`;
}

function formatArtifact(artifact: CoverageEvidenceSource): string {
  return `artifact ${artifact.label}: ${artifact.path} (${formatFormat(
    artifact.format,
  )}, timestamp ${artifact.timestamp ?? "n/a"})`;
}

function formatSummary(summary: CoverageEvidenceSummary): string {
  return `summary: files ${summary.files}, functions ${summary.functionsHit}/${summary.functionsFound} hit, lines ${summary.linesHit}/${summary.linesFound} hit`;
}

function formatNote(note: CoverageParseNote): string {
  const line = note.line === undefined ? "" : ` line ${note.line}`;
  return `${note.kind}${line} - ${note.detail}`;
}

function formatSectionNote(note: CoverageParseNote): string {
  const line = note.line === undefined ? "" : ` line ${note.line}`;
  return `${note.kind}${line}: ${note.detail}`;
}

function formatFormat(format: CoverageFormat | null): string {
  return format ?? "unparsed";
}
