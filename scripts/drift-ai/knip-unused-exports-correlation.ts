import type { KnipUnusedExportsReportStatus } from "./knip-unused-exports-report.js";
import type { PrototypePrerequisite } from "./prototype-advisory.js";

export type { KnipUnusedExportsReportStatus } from "./knip-unused-exports-report.js";

export type FileLocation = {
  readonly file: string;
  readonly line: number | null | undefined;
  readonly col: number | null | undefined;
};

export function unusedExportsReportPrerequisite(
  report: KnipUnusedExportsReportStatus,
): PrototypePrerequisite {
  const base = { name: "unused-exports report" };
  switch (report.kind) {
    case "ok":
      return {
        ...base,
        satisfied: true,
        detail: `${report.symbolCount} symbol(s) from ${report.path}`,
      };
    case "absent":
      return {
        ...base,
        satisfied: false,
        detail: "no report supplied; pass --unused-exports-report <knip --reporter json output>",
      };
    case "unreadable":
      return {
        ...base,
        satisfied: false,
        detail: `could not read ${report.path}: ${report.error}`,
      };
    case "parse-failed":
      return {
        ...base,
        satisfied: false,
        detail: `could not parse ${report.path}: ${report.error}`,
      };
  }
}

export function fileLocationLabel(location: FileLocation): string {
  if (location.line === null || location.line === undefined) return location.file;
  if (location.col === null || location.col === undefined)
    return `${location.file}:${location.line}`;
  return `${location.file}:${location.line}:${location.col}`;
}
