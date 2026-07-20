// Summary engine for mutation:survivors (scripts/mutation-survivors.ts).
//
// Pure transformation from a parsed Stryker mutation.json report to a ranked,
// bounded triage summary: totals by status, actionable (Survived +
// NoCoverage) counts rolled up by file and by directory area, and a small
// sample of mutants per file. No I/O here — the CLI wrapper owns reading,
// rendering, and exit codes.

import path from "node:path";

import { z } from "zod";

export const DEFAULT_TOP_FILES = 10;
const DEFAULT_SAMPLES_PER_FILE = 3;
const MAX_REPLACEMENT_CHARS = 60;

const ACTIONABLE_STATUSES = new Set(["Survived", "NoCoverage"]);

// Minimal slice of the mutation-testing-report-schema: only the fields the
// summary needs, everything else tolerated and ignored so schema-version
// bumps do not break the summarizer.
const mutantSchema = z.looseObject({
  mutatorName: z.string().optional(),
  status: z.string(),
  replacement: z.string().optional(),
  // Fully partial: a mutant with a location but no start.line must degrade
  // to no-line rendering ("L?"), not fail the whole report.
  location: z
    .looseObject({
      start: z.looseObject({ line: z.number().optional() }).optional(),
    })
    .optional(),
});

export const mutationReportSchema = z.looseObject({
  files: z.record(z.string(), z.looseObject({ mutants: z.array(mutantSchema) })),
});

export type MutationReportInput = z.input<typeof mutationReportSchema>;

type SurvivorSample = {
  readonly line: number | undefined;
  readonly mutatorName: string;
  readonly status: string;
  readonly replacement?: string;
};

type SurvivorFileSummary = {
  readonly path: string;
  readonly survived: number;
  readonly noCoverage: number;
  readonly actionable: number;
  readonly samples: readonly SurvivorSample[];
};

type SurvivorAreaSummary = {
  readonly area: string;
  readonly survived: number;
  readonly noCoverage: number;
  readonly actionable: number;
};

export type SurvivorSummary = {
  readonly totals: {
    readonly mutants: number;
    readonly byStatus: Readonly<Record<string, number>>;
    readonly actionable: number;
  };
  readonly areas: readonly SurvivorAreaSummary[];
  readonly files: readonly SurvivorFileSummary[];
};

export type SurvivorSummaryOptions = {
  readonly top?: number;
  readonly samplesPerFile?: number;
};

function toArea(filePath: string): string {
  const dir = path.posix.dirname(filePath.replaceAll("\\", "/"));
  return dir === "." ? "(root)" : dir;
}

function truncateReplacement(replacement: string): string {
  if (replacement.length <= MAX_REPLACEMENT_CHARS) return replacement;
  return `${replacement.slice(0, MAX_REPLACEMENT_CHARS)}…`;
}

type ParsedMutant = z.output<typeof mutantSchema>;

type FileAccumulation = {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly survived: number;
  readonly noCoverage: number;
  readonly samples: readonly SurvivorSample[];
};

function toSample(mutant: ParsedMutant): SurvivorSample {
  return {
    line: mutant.location?.start?.line,
    mutatorName: mutant.mutatorName ?? "(unknown mutator)",
    status: mutant.status,
    ...(mutant.replacement === undefined
      ? {}
      : { replacement: truncateReplacement(mutant.replacement) }),
  };
}

function accumulateMutants(
  mutants: readonly ParsedMutant[],
  samplesPerFile: number,
): FileAccumulation {
  const byStatus: Record<string, number> = {};
  let survived = 0;
  let noCoverage = 0;
  const samples: SurvivorSample[] = [];
  for (const mutant of mutants) {
    byStatus[mutant.status] = (byStatus[mutant.status] ?? 0) + 1;
    if (!ACTIONABLE_STATUSES.has(mutant.status)) continue;
    if (mutant.status === "Survived") survived += 1;
    else noCoverage += 1;
    if (samples.length < samplesPerFile) samples.push(toSample(mutant));
  }
  return { total: mutants.length, byStatus, survived, noCoverage, samples };
}

function rankAreas(files: readonly SurvivorFileSummary[]): SurvivorAreaSummary[] {
  const areas = new Map<string, { survived: number; noCoverage: number }>();
  for (const file of files) {
    const key = toArea(file.path);
    const area = areas.get(key) ?? { survived: 0, noCoverage: 0 };
    area.survived += file.survived;
    area.noCoverage += file.noCoverage;
    areas.set(key, area);
  }
  return [...areas.entries()]
    .map(([area, counts]) => ({
      area,
      survived: counts.survived,
      noCoverage: counts.noCoverage,
      actionable: counts.survived + counts.noCoverage,
    }))
    .sort((a, b) => b.actionable - a.actionable || a.area.localeCompare(b.area));
}

export function buildSurvivorSummary(
  reportInput: MutationReportInput,
  options: SurvivorSummaryOptions = {},
): SurvivorSummary {
  const report = mutationReportSchema.parse(reportInput);
  const top = options.top ?? DEFAULT_TOP_FILES;
  const samplesPerFile = options.samplesPerFile ?? DEFAULT_SAMPLES_PER_FILE;

  const byStatus: Record<string, number> = {};
  let mutantTotal = 0;
  const files: SurvivorFileSummary[] = [];

  for (const [filePath, file] of Object.entries(report.files)) {
    const accumulated = accumulateMutants(file.mutants, samplesPerFile);
    mutantTotal += accumulated.total;
    for (const [status, count] of Object.entries(accumulated.byStatus)) {
      byStatus[status] = (byStatus[status] ?? 0) + count;
    }
    const actionable = accumulated.survived + accumulated.noCoverage;
    if (actionable === 0) continue;
    files.push({
      path: filePath,
      survived: accumulated.survived,
      noCoverage: accumulated.noCoverage,
      actionable,
      samples: accumulated.samples,
    });
  }

  files.sort((a, b) => b.actionable - a.actionable || a.path.localeCompare(b.path));
  const actionable = files.reduce((sum, file) => sum + file.actionable, 0);
  return {
    totals: { mutants: mutantTotal, byStatus, actionable },
    areas: rankAreas(files).slice(0, top),
    files: files.slice(0, top),
  };
}

export function formatTextSummary(summary: SurvivorSummary): string {
  const statusLine = Object.entries(summary.totals.byStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status} ${String(count)}`)
    .join(", ");
  const lines = [
    `mutation-survivors: ${String(summary.totals.mutants)} mutants — ${statusLine || "none"}`,
    `actionable (Survived + NoCoverage): ${String(summary.totals.actionable)}`,
  ];
  if (summary.totals.actionable === 0) {
    lines.push("no surviving or uncovered mutants — nothing to triage");
    return lines.join("\n");
  }
  lines.push("top areas:");
  for (const area of summary.areas) {
    lines.push(
      `  ${area.area}: ${String(area.survived)} survived, ${String(area.noCoverage)} no-coverage`,
    );
  }
  lines.push("top files:");
  for (const file of summary.files) {
    lines.push(
      `  ${file.path}: ${String(file.survived)} survived, ${String(file.noCoverage)} no-coverage`,
    );
    for (const sample of file.samples) {
      const lineLabel = sample.line === undefined ? "L?" : `L${String(sample.line)}`;
      const replacement = sample.replacement === undefined ? "" : ` -> \`${sample.replacement}\``;
      lines.push(`    ${lineLabel} ${sample.mutatorName}${replacement} [${sample.status}]`);
    }
  }
  return lines.join("\n");
}
