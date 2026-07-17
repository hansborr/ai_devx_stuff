// Advisory rendering for class-construction evidence (task 48). This turns the
// task-48a inventory into prototype-lane candidate rows while preserving the
// difference between "no direct construction signal" and any deletion verdict.

import { plural, positiveInt } from "./advisory-format-helpers.js";
import type {
  ClassConstructionEvidence,
  ClassConstructionInventory,
  ClassConstructionRecord,
} from "./class-construction.js";
import type { UnusedExportCategory, UnusedExportSymbol } from "./knip-unused-exports.js";
import {
  fileLocationLabel,
  type KnipUnusedExportsReportStatus,
  unusedExportsReportPrerequisite,
} from "./knip-unused-exports-correlation.js";
import { toPosix } from "./path-util.js";
import {
  appendPrototypeSection,
  buildPrototypeAdvisory,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
  type PrototypeAdvisory,
  type PrototypeCap,
  type PrototypeSection,
} from "./prototype-advisory.js";

export const CLASS_CONSTRUCTION_SUBCOMMAND = "class-construction";
export const DEFAULT_CLASS_CONSTRUCTION_TOP = 50;

const CANDIDATE_KIND = "classes with no direct or only ambiguous construction signal";
const PARSER_LIMITATION =
  "parser-only class/name reference inventory; no full type-checker reachability, " +
  "framework host API modeling, or runtime registration proof";
const AMBIGUOUS_NAME_CAVEAT = "risky-context: ambiguous-name-shared-evidence";

type ClassUnusedExportsReportStatus = KnipUnusedExportsReportStatus;

export type ClassConstructionAdvisoryInput = {
  readonly inventory: ClassConstructionInventory;
  readonly sourceFileCount: number;
  readonly unreadableSourceFiles?: readonly string[];
  readonly unusedExportsReport?: ClassUnusedExportsReportStatus;
  readonly unusedExportSymbols?: readonly UnusedExportSymbol[];
  readonly top?: number;
};

type ClassConstructionUnusedExportCorrelation = {
  readonly kind: "unused-export";
  readonly source: "knip report";
  readonly category: UnusedExportCategory;
  readonly symbol: string;
  readonly file: string;
  readonly line: number | null;
  readonly col: number | null;
  readonly namespace: string | null;
};

type ClassConstructionAdvisoryRow = {
  readonly rank: number;
  readonly id: string;
  readonly filePath: string;
  readonly displayName: string;
  readonly name: string | null;
  readonly declarationKind: ClassConstructionRecord["kind"];
  readonly exportStatus: ClassConstructionRecord["exportStatus"];
  readonly startLine: number;
  readonly endLine: number;
  readonly staticFactoryMethods: readonly string[];
  readonly evidence: ClassConstructionEvidence;
  readonly caveats: readonly string[];
  readonly correlations: readonly ClassConstructionUnusedExportCorrelation[];
};

type ClassConstructionAdvisorySection = PrototypeSection<ClassConstructionAdvisoryRow>;
export type ClassConstructionAdvisory = PrototypeAdvisory<ClassConstructionAdvisorySection>;

export function buildClassConstructionAdvisory(
  input: ClassConstructionAdvisoryInput,
): ClassConstructionAdvisory {
  const top = positiveInt(input.top, DEFAULT_CLASS_CONSTRUCTION_TOP);
  const unreadableFiles = input.unreadableSourceFiles ?? [];
  const report = input.unusedExportsReport ?? { kind: "absent" };
  const rows = buildRows(input.inventory.classes, input.unusedExportSymbols ?? []);
  return buildPrototypeAdvisory({
    subcommand: CLASS_CONSTRUCTION_SUBCOMMAND,
    prerequisites: [inventoryPrerequisite(input), unusedExportsReportPrerequisite(report)],
    caps: [rowCap(top, rows.length)],
    degradations: [...sourceDegradations(unreadableFiles), PARSER_LIMITATION],
    sections: [
      {
        candidateKind: CANDIDATE_KIND,
        totalCandidates: rows.length,
        emptyReason: emptyReason(input.sourceFileCount, rows.length),
        entries: rows.slice(0, top),
      },
    ],
  });
}

export function formatClassConstructionAdvisoryJson(advisory: ClassConstructionAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatClassConstructionAdvisoryText(advisory: ClassConstructionAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  for (const section of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, section, renderRow);
  }
  return lines.join("\n");
}

type UnrankedClassConstructionRow = Omit<ClassConstructionAdvisoryRow, "rank">;

function buildRows(
  records: readonly ClassConstructionRecord[],
  unusedExportSymbols: readonly UnusedExportSymbol[],
): ClassConstructionAdvisoryRow[] {
  const unranked = records
    .filter(isZeroDirectConstructionCandidate)
    .map((record) => rowForRecord(record, unusedExportSymbols));
  return sortRows(unranked).map((row, index) => ({ ...row, rank: index + 1 }));
}

function isZeroDirectConstructionCandidate(record: ClassConstructionRecord): boolean {
  if (record.caveats.includes(AMBIGUOUS_NAME_CAVEAT)) return true;
  return (
    record.evidence.newExpressions === 0 &&
    record.evidence.subclassings === 0 &&
    record.evidence.jsxReferences === 0 &&
    record.evidence.customElementRegistrations === 0
  );
}

function rowForRecord(
  record: ClassConstructionRecord,
  unusedExportSymbols: readonly UnusedExportSymbol[],
): UnrankedClassConstructionRow {
  return {
    id: record.id,
    filePath: record.filePath,
    displayName: record.displayName,
    name: record.name ?? null,
    declarationKind: record.kind,
    exportStatus: record.exportStatus,
    startLine: record.startLine,
    endLine: record.endLine,
    staticFactoryMethods: record.staticFactoryMethods,
    evidence: record.evidence,
    caveats: record.caveats,
    correlations: unusedExportSymbols
      .filter((symbol) => matchesRecord(symbol, record))
      .map(
        (symbol): ClassConstructionUnusedExportCorrelation => ({
          kind: "unused-export",
          source: "knip report",
          category: symbol.category,
          symbol: symbol.name,
          file: toPosix(symbol.file),
          line: symbol.line ?? null,
          col: symbol.col ?? null,
          namespace: symbol.namespace ?? null,
        }),
      ),
  };
}

function matchesRecord(symbol: UnusedExportSymbol, record: ClassConstructionRecord): boolean {
  if (toPosix(symbol.file) !== record.filePath) return false;
  if (record.name !== undefined && symbol.name === record.name) return true;
  return record.exportStatus === "default" && symbol.name === "default";
}

function sortRows(rows: readonly UnrankedClassConstructionRow[]): UnrankedClassConstructionRow[] {
  return [...rows].sort(
    (left, right) =>
      Number(right.correlations.length > 0) - Number(left.correlations.length > 0) ||
      left.filePath.localeCompare(right.filePath, "en") ||
      left.startLine - right.startLine ||
      left.displayName.localeCompare(right.displayName, "en"),
  );
}

function inventoryPrerequisite(
  input: Pick<ClassConstructionAdvisoryInput, "inventory" | "sourceFileCount">,
): ClassConstructionAdvisory["prerequisites"][number] {
  const classCount = input.inventory.classes.length;
  return {
    name: "class inventory",
    satisfied: input.sourceFileCount > 0,
    detail:
      input.sourceFileCount > 0
        ? `${classCount} class ${plural("record", classCount)} from ${input.sourceFileCount} source ${plural(
            "file",
            input.sourceFileCount,
          )}`
        : "0 source files matched current roots/config; no class inventory computed",
  };
}

function rowCap(top: number, total: number): PrototypeCap {
  const hit = total > top;
  return {
    label: "candidate rows",
    limit: top,
    hit,
    detail: hit ? `stopped after showing ${top} of ${total} class candidates` : null,
  };
}

function sourceDegradations(unreadableFiles: readonly string[]): string[] {
  if (unreadableFiles.length === 0) return [];
  const shown = unreadableFiles.slice(0, 5).join(", ");
  const suffix = unreadableFiles.length > 5 ? `, ... ${unreadableFiles.length - 5} more` : "";
  return [
    `${unreadableFiles.length} source ${plural(
      "file",
      unreadableFiles.length,
    )} could not be read and were skipped: ${shown}${suffix}`,
  ];
}

function emptyReason(sourceFileCount: number, total: number): string | null {
  if (total > 0) return null;
  if (sourceFileCount === 0) return "no source files were available for class inventory.";
  return "no classes lacked direct or ambiguous construction signals under the current parser inventory.";
}

function renderRow(row: ClassConstructionAdvisoryRow): readonly string[] {
  const lines = [
    `#${row.rank} ${row.filePath}:${row.startLine}-${row.endLine} ${row.displayName} [${row.exportStatus} ${row.declarationKind}]`,
    `direct construction counts: new ${row.evidence.newExpressions}, subclass ${row.evidence.subclassings}, jsx ${row.evidence.jsxReferences}, custom-element ${row.evidence.customElementRegistrations}`,
    `reference counts: value ${row.evidence.valueReferences}, decorator ${row.evidence.decoratorReferences}, type-only ${row.evidence.typeOnlyReferences}, string-keyed ${row.evidence.stringKeyedReferences}`,
  ];
  if (row.staticFactoryMethods.length > 0) {
    lines.push(`static factories: ${row.staticFactoryMethods.join(", ")}`);
  }
  if (row.correlations.length === 0) lines.push("correlation: none supplied");
  else lines.push(...row.correlations.map(formatCorrelation));
  for (const caveat of row.caveats) lines.push(`caveat: ${caveat}`);
  lines.push("inspect: confirm runtime construction paths before changing the class.");
  return lines;
}

function formatCorrelation(correlation: ClassConstructionUnusedExportCorrelation): string {
  const namespace =
    correlation.namespace === null
      ? correlation.symbol
      : `${correlation.namespace}.${correlation.symbol}`;
  return `correlation: ${correlation.kind} (${correlation.source}) ${correlation.category} ${namespace} at ${locationLabel(
    correlation,
  )}`;
}

function locationLabel(correlation: ClassConstructionUnusedExportCorrelation): string {
  return fileLocationLabel(correlation);
}
