import { execFileSync } from "node:child_process";

import { parseLintRatchetBaselineStructure } from "./lint-ratchet-baseline.js";
import { summarizeLintRatchetBaseline } from "./lint-ratchet-summary.js";
import { escapeMarkdownTableCell } from "./markdown-escape.js";
import { BASELINE_FILENAME, repoRoot } from "./paths.js";

const SHORT_SHA_LENGTH = 12;
const DATE_ONLY_LENGTH = 10;

interface GitExecOptions {
  readonly cwd: string;
  readonly encoding: "utf8";
  readonly stdio: readonly ["ignore", "pipe", "ignore"];
}

export interface LintRatchetTrendDeps {
  readonly execFileSync: (
    command: "git",
    args: readonly string[],
    options: GitExecOptions,
  ) => string;
}

export interface RunLintRatchetTrendOptions {
  readonly since?: string | undefined;
  readonly max?: number | undefined;
  readonly deps?: LintRatchetTrendDeps;
}

export interface LintRatchetTrendResult {
  readonly report: string;
  readonly warnings: readonly string[];
}

interface BaselineCommit {
  readonly sha: string;
  readonly committedAt: string;
}

interface TrendPoint extends BaselineCommit {
  readonly totalFindings: number;
}

interface TrendSeries {
  readonly id: string;
  readonly ruleId: string;
  readonly metric: string;
  readonly points: readonly TrendPoint[];
}

interface TrendCells {
  readonly ratchet: string;
  readonly rule: string;
  readonly metric: string;
  readonly first: string;
  readonly current: string;
  readonly delta: string;
  readonly min: string;
  readonly max: string;
  readonly points: string;
  readonly latest: string;
}

type TrendWidths = Readonly<Record<keyof TrendCells, number>>;

interface AddPointOptions {
  readonly seriesById: Map<string, TrendSeries>;
  readonly id: string;
  readonly ruleId: string;
  readonly metric: string;
  readonly point: TrendPoint;
}

const defaultTrendDeps: LintRatchetTrendDeps = {
  execFileSync: (command, args, options) =>
    execFileSync(command, [...args], {
      cwd: options.cwd,
      encoding: options.encoding,
      stdio: [...options.stdio],
    }),
};

function gitOutput(args: readonly string[], deps: LintRatchetTrendDeps): string {
  return deps.execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function logArgs(options: RunLintRatchetTrendOptions): readonly string[] {
  return [
    "log",
    "--format=%H %cI",
    ...(options.max === undefined ? [] : [`--max-count=${String(options.max)}`]),
    ...(options.since === undefined ? [] : [`--since=${options.since}`]),
    "--",
    BASELINE_FILENAME,
  ];
}

function parseLogLine(line: string): BaselineCommit | undefined {
  const match = /^(?<sha>\S+)\s+(?<committedAt>\S+)$/u.exec(line);
  const sha = match?.groups?.sha;
  const committedAt = match?.groups?.committedAt;
  return sha === undefined || committedAt === undefined ? undefined : { sha, committedAt };
}

function baselineHistory(options: RunLintRatchetTrendOptions): readonly BaselineCommit[] {
  return gitOutput(logArgs(options), options.deps ?? defaultTrendDeps)
    .split("\n")
    .filter((line) => line.length > 0)
    .map(parseLogLine)
    .filter((commit): commit is BaselineCommit => commit !== undefined);
}

function historicalBaselineText(
  commit: BaselineCommit,
  deps: LintRatchetTrendDeps,
): string | undefined {
  try {
    return gitOutput(["show", `${commit.sha}:${BASELINE_FILENAME}`], deps);
  } catch {
    return undefined;
  }
}

function addPoint(options: AddPointOptions): void {
  const previous = options.seriesById.get(options.id);
  options.seriesById.set(options.id, {
    id: options.id,
    ruleId: options.ruleId,
    metric: options.metric,
    points: [...(previous?.points ?? []), options.point],
  });
}

function collectSeries(
  commits: readonly BaselineCommit[],
  deps: LintRatchetTrendDeps,
): { readonly series: readonly TrendSeries[]; readonly warnings: readonly string[] } {
  const seriesById = new Map<string, TrendSeries>();
  const warnings: string[] = [];
  for (const commit of [...commits].reverse()) {
    const text = historicalBaselineText(commit, deps);
    if (text === undefined) {
      warnings.push(
        escapeMarkdownTableCell(`${commit.sha}: ${BASELINE_FILENAME} could not be read`),
      );
      continue;
    }
    const parsed = parseLintRatchetBaselineStructure(text);
    if (parsed.baseline === undefined) {
      warnings.push(escapeMarkdownTableCell(`${commit.sha}: ${parsed.failures.join("; ")}`));
      continue;
    }
    for (const row of summarizeLintRatchetBaseline(parsed.baseline, [])) {
      addPoint({
        seriesById,
        id: row.id,
        ruleId: row.ruleId,
        metric: row.metric,
        point: {
          ...commit,
          totalFindings: row.totalFindings,
        },
      });
    }
  }
  return {
    series: [...seriesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    warnings,
  };
}

function maxLength(values: readonly string[]): number {
  return Math.max(...values.map((value) => value.length));
}

function signedDelta(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}

function trendCells(series: TrendSeries): TrendCells {
  const first = series.points[0]?.totalFindings ?? 0;
  const current = series.points[series.points.length - 1]?.totalFindings ?? 0;
  const totals = series.points.map((point) => point.totalFindings);
  const latest = series.points[series.points.length - 1];
  return {
    ratchet: escapeMarkdownTableCell(series.id),
    rule: escapeMarkdownTableCell(series.ruleId),
    metric: escapeMarkdownTableCell(series.metric),
    first: String(first),
    current: String(current),
    delta: signedDelta(current - first),
    min: String(Math.min(...totals)),
    max: String(Math.max(...totals)),
    points: String(series.points.length),
    latest:
      latest === undefined
        ? ""
        : `${latest.committedAt.slice(0, DATE_ONLY_LENGTH)} ${latest.sha.slice(0, SHORT_SHA_LENGTH)}`,
  };
}

function trendWidths(rows: readonly TrendCells[]): TrendWidths {
  return {
    ratchet: maxLength(["ratchet", ...rows.map((row) => row.ratchet)]),
    rule: maxLength(["rule", ...rows.map((row) => row.rule)]),
    metric: maxLength(["metric", ...rows.map((row) => row.metric)]),
    first: maxLength(["first", ...rows.map((row) => row.first)]),
    current: maxLength(["current", ...rows.map((row) => row.current)]),
    delta: maxLength(["delta", ...rows.map((row) => row.delta)]),
    min: maxLength(["min", ...rows.map((row) => row.min)]),
    max: maxLength(["max", ...rows.map((row) => row.max)]),
    points: maxLength(["points", ...rows.map((row) => row.points)]),
    latest: maxLength(["latest", ...rows.map((row) => row.latest)]),
  };
}

function formatTrendRow(row: TrendCells, widths: TrendWidths): string {
  return [
    row.ratchet.padEnd(widths.ratchet),
    row.rule.padEnd(widths.rule),
    row.metric.padEnd(widths.metric),
    row.first.padStart(widths.first),
    row.current.padStart(widths.current),
    row.delta.padStart(widths.delta),
    row.min.padStart(widths.min),
    row.max.padStart(widths.max),
    row.points.padStart(widths.points),
    row.latest.padEnd(widths.latest),
  ].join("  ");
}

export function formatLintRatchetTrend(series: readonly TrendSeries[]): string {
  const rows = series.map(trendCells);
  const widths = trendWidths(rows);
  const header = formatTrendRow(
    {
      ratchet: "ratchet",
      rule: "rule",
      metric: "metric",
      first: "first",
      current: "current",
      delta: "delta",
      min: "min",
      max: "max",
      points: "points",
      latest: "latest",
    },
    widths,
  );
  const body =
    rows.length === 0
      ? ["(no ratchet trend points)"]
      : rows.map((row) => formatTrendRow(row, widths));
  return `${[header, ...body].join("\n")}\n`;
}

export function runLintRatchetTrend(
  options: RunLintRatchetTrendOptions = {},
): LintRatchetTrendResult {
  const deps = options.deps ?? defaultTrendDeps;
  const collected = collectSeries(baselineHistory({ ...options, deps }), deps);
  return { report: formatLintRatchetTrend(collected.series), warnings: collected.warnings };
}

export function runLintRatchetTrendCli(since: string | undefined, max: number | undefined): void {
  const result = runLintRatchetTrend({ since, max });
  for (const warning of result.warnings) console.error(`lint:ratchet:trend WARN - ${warning}`);
  process.stdout.write(result.report);
}
