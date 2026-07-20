import { execFileSync } from "node:child_process";

import { parseLintRatchetBaselineStructure } from "../kernel/baseline.js";
import { type LintRatchetEngineContext, relativeToRepoRoot } from "../kernel/engine-context.js";
import { summarizeLintRatchetBaseline } from "./summary.js";

const SHORT_SHA_LENGTH = 12;
const DATE_ONLY_LENGTH = 10;
const TREND_CAPTION = "per-commit totals from committed baselines (working tree not included)";
const ALL_HISTORY_COMMAND = "bun run lint:ratchet:trend -- --all";

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
  readonly context: LintRatchetEngineContext;
  readonly ratchets: readonly { readonly id: string }[];
  readonly since?: string | undefined;
  readonly max?: number | undefined;
  readonly deps?: LintRatchetTrendDeps;
  readonly includeRetired?: boolean;
}

export interface LintRatchetTrendResult {
  readonly report: string;
  readonly warnings: readonly string[];
}

interface BaselineCommit {
  readonly sha: string;
  readonly committedAt: string;
  // The baseline's path in this commit's tree. With --follow the file may have
  // been renamed over history, so the blob is read from sha:<historical path>,
  // not the current filename.
  readonly path: string;
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
  readonly status: string;
  readonly rule: string;
  readonly metric: string;
  readonly first: string;
  readonly last: string;
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

function gitOutput(repoRoot: string, args: readonly string[], deps: LintRatchetTrendDeps): string {
  return deps.execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function logArgs(options: RunLintRatchetTrendOptions, baselineRelPath: string): readonly string[] {
  // --follow + --name-status: walk across renames of the baseline file and learn
  // its path at each listed commit, so historicalBaselineText can read the blob
  // from the historical path rather than truncating the series at a rename.
  // "commit" prefixes the format line so it can't be mistaken for a path line.
  return [
    "log",
    "--follow",
    "--name-status",
    "--format=commit %H %cI",
    ...(options.max === undefined ? [] : [`--max-count=${String(options.max)}`]),
    ...(options.since === undefined ? [] : [`--since=${options.since}`]),
    "--",
    baselineRelPath,
  ];
}

function pathFromNameStatusLine(line: string): string | undefined {
  const fields = line.split("\t");
  const status = fields[0] ?? "";
  // Renames/copies list `R<score>\told\tnew` / `C<score>\told\tnew`; the path in
  // this commit's tree is the new one. Adds/modifies list `<status>\tpath`.
  if (/^[RC]\d*$/u.test(status)) return fields[2];
  if (/^[AM]$/u.test(status)) return fields[1];
  return undefined;
}

function parseBaselineLog(output: string): readonly BaselineCommit[] {
  const commits: BaselineCommit[] = [];
  let pending: { sha: string; committedAt: string } | undefined;
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const header = /^commit (?<sha>\S+) (?<committedAt>\S+)$/u.exec(line);
    if (header?.groups !== undefined) {
      const { sha, committedAt } = header.groups;
      pending = sha === undefined || committedAt === undefined ? undefined : { sha, committedAt };
      continue;
    }
    if (pending === undefined) continue;
    const path = pathFromNameStatusLine(line);
    if (path === undefined) continue;
    commits.push({ ...pending, path });
    pending = undefined;
  }
  return commits;
}

function baselineHistory(
  options: RunLintRatchetTrendOptions,
  baselineRelPath: string,
): readonly BaselineCommit[] {
  return parseBaselineLog(
    gitOutput(
      options.context.repoRoot,
      logArgs(options, baselineRelPath),
      options.deps ?? defaultTrendDeps,
    ),
  );
}

function historicalBaselineText(
  repoRoot: string,
  commit: BaselineCommit,
  deps: LintRatchetTrendDeps,
): string | undefined {
  try {
    return gitOutput(repoRoot, ["show", `${commit.sha}:${commit.path}`], deps);
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
  repoRoot: string,
  commits: readonly BaselineCommit[],
  deps: LintRatchetTrendDeps,
): { readonly series: readonly TrendSeries[]; readonly warnings: readonly string[] } {
  const seriesById = new Map<string, TrendSeries>();
  const warnings: string[] = [];
  for (const commit of [...commits].reverse()) {
    const text = historicalBaselineText(repoRoot, commit, deps);
    if (text === undefined) {
      warnings.push(`${commit.sha}: ${commit.path} could not be read`);
      continue;
    }
    const parsed = parseLintRatchetBaselineStructure(text);
    if (parsed.baseline === undefined) {
      warnings.push(`${commit.sha}: ${parsed.failures.join("; ")}`);
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

function trendCells(series: TrendSeries, activeRatchetIds: ReadonlySet<string>): TrendCells {
  const first = series.points[0]?.totalFindings ?? 0;
  const last = series.points[series.points.length - 1]?.totalFindings ?? 0;
  const totals = series.points.map((point) => point.totalFindings);
  const latest = series.points[series.points.length - 1];
  return {
    // Plain-text terminal table, no markdown render boundary — pass cells raw
    // (see rowCells in summary.ts).
    ratchet: series.id,
    status: activeRatchetIds.has(series.id) ? "active" : "retired",
    rule: series.ruleId,
    metric: series.metric,
    first: String(first),
    last: String(last),
    delta: signedDelta(last - first),
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
    status: maxLength(["status", ...rows.map((row) => row.status)]),
    rule: maxLength(["rule", ...rows.map((row) => row.rule)]),
    metric: maxLength(["metric", ...rows.map((row) => row.metric)]),
    first: maxLength(["first", ...rows.map((row) => row.first)]),
    last: maxLength(["last", ...rows.map((row) => row.last)]),
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
    row.status.padEnd(widths.status),
    row.rule.padEnd(widths.rule),
    row.metric.padEnd(widths.metric),
    row.first.padStart(widths.first),
    row.last.padStart(widths.last),
    row.delta.padStart(widths.delta),
    row.min.padStart(widths.min),
    row.max.padStart(widths.max),
    row.points.padStart(widths.points),
    row.latest.padEnd(widths.latest),
  ].join("  ");
}

export function formatLintRatchetTrend(
  series: readonly TrendSeries[],
  activeRatchetIds: ReadonlySet<string>,
): string {
  const rows = series.map((entry) => trendCells(entry, activeRatchetIds));
  const widths = trendWidths(rows);
  const header = formatTrendRow(
    {
      ratchet: "ratchet",
      status: "status",
      rule: "rule",
      metric: "metric",
      first: "first",
      last: "last",
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
  return `${[TREND_CAPTION, header, ...body].join("\n")}\n`;
}

export function runLintRatchetTrend(options: RunLintRatchetTrendOptions): LintRatchetTrendResult {
  const deps = options.deps ?? defaultTrendDeps;
  const repoRoot = options.context.repoRoot;
  const baselineRelPath = relativeToRepoRoot(repoRoot, options.context.baselinePath);
  const collected = collectSeries(
    repoRoot,
    baselineHistory({ ...options, deps }, baselineRelPath),
    deps,
  );
  const activeRatchetIds = new Set(options.ratchets.map((ratchet) => ratchet.id));
  const retiredSeries = collected.series.filter((series) => !activeRatchetIds.has(series.id));
  const visibleSeries = options.includeRetired
    ? collected.series
    : collected.series.filter((series) => activeRatchetIds.has(series.id));
  const omissionNote =
    options.includeRetired === true || retiredSeries.length === 0
      ? ""
      : `Omitted ${String(retiredSeries.length)} retired series; run \`${ALL_HISTORY_COMMAND}\` for complete history.\n`;
  return {
    report: `${formatLintRatchetTrend(visibleSeries, activeRatchetIds)}${omissionNote}`,
    warnings: collected.warnings,
  };
}

export function runLintRatchetTrendCli(options: RunLintRatchetTrendOptions): void {
  const result = runLintRatchetTrend(options);
  for (const warning of result.warnings) console.error(`lint:ratchet:trend WARN - ${warning}`);
  process.stdout.write(result.report);
}
