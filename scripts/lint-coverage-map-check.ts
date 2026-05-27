import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectEslintReachFindings,
  type EslintReachChecker,
} from "./lint-coverage-map-check-eslint-reach.js";
import { lintRatchets } from "./lint-ratchet-config.js";

const PATH_COLUMN = 0;
const RATCHET_COLUMN = 3;
const STATUS_COLUMN = 6;
const CODE_SPAN_PATTERN = /`([^`]+)`/gu;
const GLOB_META_PATTERN = /[*?{]/u;
const RATCHET_ID_PATTERN = /ratchet\/[a-z0-9-]+/gu;
const DUPLICATE_EXTENSION_PATTERN = /\.([A-Za-z0-9]+)\.\1$/u;
const GENERATED_DIR_PATTERN =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|\.bun|\.turbo|\.cache|tmp|temp)(?:\/|$)/u;
const TRACKED_EXTENSION_PATTERN = /\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|toml|sh|md|prisma|sql)$/u;
const VALID_STATUS_PARTS = new Set([
  "linted",
  "ratcheted",
  "proposed",
  "pending-leaf",
  "excluded",
  "not-code",
]);
const ROOT_PATH_PREFIXES = new Set(["packages", "scripts", "docs", "e2e", "eslint-rules"]);
const GLOBSTAR_WIDTH = 2;
const GLOBSTAR_WITH_SLASH_WIDTH = 3;
const PROCESS_ARGV_USER_ARGS_START = 2;

interface TableRow {
  readonly line: number;
  readonly pathGroup: string;
  readonly ratchets: string;
  readonly status: string;
}

interface PathPattern {
  readonly line: number;
  readonly source: string;
  readonly pattern: string;
  readonly matcher: (file: string) => boolean;
}

interface CheckFinding {
  readonly kind:
    | "stale-path"
    | "unknown-ratchet"
    | "invalid-status"
    | "unaccounted-file"
    | "eslint-reach-missing";
  readonly line?: number;
  readonly value: string;
}

export interface LintCoverageMapCheckResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly findings: readonly CheckFinding[];
}

export interface LintCoverageMapCheckOptions {
  readonly cwd?: string;
  readonly mapPath?: string;
  readonly mapText?: string;
  readonly staged?: boolean;
  readonly trackedFiles?: readonly string[];
  readonly ratchetIds?: ReadonlySet<string>;
  readonly checkEslintReach?: boolean;
  readonly eslintReachChecker?: EslintReachChecker;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultMapPath = resolve(
  repoRoot,
  "docs/agent_notes/backlog/lint-followups/lint-coverage-map.md",
);

function parseRows(mapText: string): TableRow[] {
  const rows: TableRow[] = [];
  const lines = mapText.split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/u, "")
      .replace(/\|$/u, "")
      .split("|")
      .map((cell) => cell.trim());
    const pathGroup = cells[PATH_COLUMN];
    const ratchets = cells[RATCHET_COLUMN];
    const status = cells[STATUS_COLUMN];
    if (pathGroup === undefined || ratchets === undefined || status === undefined) continue;
    if (pathGroup === "Path / group") continue;
    if (cells.every((cell) => /^:?-{3,}:?$/u.test(cell))) continue;
    rows.push({ line: index + 1, pathGroup, ratchets, status });
  }
  return rows;
}

function stableBaseForPattern(pattern: string): string {
  const slashIndex = pattern.lastIndexOf("/");
  if (slashIndex < 0) return "";
  const beforeLast = pattern.slice(0, slashIndex);
  const globIndex = beforeLast.search(GLOB_META_PATTERN);
  const stable = globIndex < 0 ? beforeLast : beforeLast.slice(0, globIndex);
  return stable.replace(/\/$/u, "");
}

function shouldUpdateBase(pattern: string, base: string): boolean {
  if (base === "") return false;
  if (!pattern.includes("**")) return true;
  return base.split("/").length > 1;
}

function sourceIsRooted(source: string): boolean {
  if (source.startsWith(".") || !source.includes("/")) return true;
  return ROOT_PATH_PREFIXES.has(source.split("/", 1)[0] ?? "");
}

function resolvePatternSource(source: string, base: string): string {
  if (
    base !== "" &&
    !source.startsWith(".") &&
    source !== "bunfig.toml" &&
    (!source.includes("/") || !sourceIsRooted(source))
  )
    return `${base}/${GLOB_META_PATTERN.test(source) ? "**/" : ""}${source}`;
  return !source.includes("/") && GLOB_META_PATTERN.test(source) ? `**/${source}` : source;
}

function extractPathPatterns(row: TableRow): PathPattern[] {
  const patterns: PathPattern[] = [];
  let base = "";
  for (const match of row.pathGroup.matchAll(CODE_SPAN_PATTERN)) {
    const rawSource = match[1];
    if (rawSource === undefined) continue;
    const source = rawSource.trim();
    if (source === "") continue;
    const pattern = resolvePatternSource(source, base);
    patterns.push({ line: row.line, source, pattern, matcher: createMatcher(pattern) });
    const nextBase = stableBaseForPattern(pattern);
    if ((!source.includes("/") || sourceIsRooted(source)) && shouldUpdateBase(pattern, nextBase))
      base = nextBase;
  }
  return patterns;
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  const close = pattern.indexOf("}", open + 1);
  if (close < 0) return [pattern];
  const before = pattern.slice(0, open);
  const after = pattern.slice(close + 1);
  const variants: string[] = [];
  for (const part of pattern.slice(open + 1, close).split(",")) {
    variants.push(...expandBraces(`${before}${part}${after}`));
  }
  return variants;
}

function normalizePatternVariants(pattern: string): string[] {
  const variants = new Set<string>();
  for (const expanded of expandBraces(pattern)) {
    variants.add(expanded);
    variants.add(expanded.replace(DUPLICATE_EXTENSION_PATTERN, ".$1"));
  }
  return [...variants];
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/u.test(char) ? `\\${char}` : char;
}

function globVariantToRegExp(pattern: string): RegExp {
  let regex = "";
  for (let index = 0; index < pattern.length; ) {
    const char = pattern.charAt(index);
    const next = pattern.charAt(index + 1);
    const afterNext = pattern.charAt(index + GLOBSTAR_WIDTH);
    if (char === "*" && next === "*" && afterNext === "/") {
      regex += "(?:.*/)?";
      index += GLOBSTAR_WITH_SLASH_WIDTH;
    } else if (char === "*" && next === "*") {
      regex += ".*";
      index += GLOBSTAR_WIDTH;
    } else if (char === "*") {
      regex += "[^/]*";
      index += 1;
    } else if (char === "?") {
      regex += "[^/]";
      index += 1;
    } else {
      regex += escapeRegexChar(char);
      index += 1;
    }
  }
  return new RegExp(`^${regex}$`, "u");
}

function createMatcher(pattern: string): (file: string) => boolean {
  const regexes = normalizePatternVariants(pattern).map(globVariantToRegExp);
  return (file) => regexes.some((regex) => regex.test(file));
}

function isValidStatus(status: string): boolean {
  const parts = status.split("+").map((part) => part.trim());
  return parts.length > 0 && parts.every((part) => VALID_STATUS_PARTS.has(part));
}

function trackedFileIsInScope(file: string): boolean {
  if (GENERATED_DIR_PATTERN.test(file)) return false;
  if (file === "Dockerfile" || file.endsWith("/Dockerfile")) return true;
  return TRACKED_EXTENSION_PATTERN.test(file);
}

function loadTrackedFiles(cwd: string): string[] {
  const output = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" });
  return output
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .sort();
}

function loadStagedMapText(cwd: string, mapPath: string): string {
  const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const gitPath = relative(topLevel, mapPath).replaceAll("\\", "/");
  return execFileSync("git", ["show", `:${gitPath}`], { cwd: topLevel, encoding: "utf8" });
}

function loadMapText(options: LintCoverageMapCheckOptions, cwd: string): string {
  if (options.mapText !== undefined) return options.mapText;
  const mapPath = options.mapPath ?? defaultMapPath;
  if (options.staged === true) return loadStagedMapText(cwd, mapPath);
  return readFileSync(mapPath, "utf8");
}

function groupByDirectory(files: readonly string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const slash = file.lastIndexOf("/");
    const directory = slash < 0 ? "." : file.slice(0, slash);
    const bucket = groups.get(directory) ?? [];
    bucket.push(file);
    groups.set(directory, bucket);
  }
  const lines: string[] = [];
  for (const [directory, groupFiles] of [...groups.entries()].sort()) {
    lines.push(`- ${directory}:`);
    for (const file of groupFiles) lines.push(`    ${file}`);
  }
  return lines;
}

function formatFindings(findings: readonly CheckFinding[]): string {
  const lines = ["lint-coverage-map-check found drift:"];
  const stale = findings.filter((finding) => finding.kind === "stale-path");
  const unknown = findings.filter((finding) => finding.kind === "unknown-ratchet");
  const invalid = findings.filter((finding) => finding.kind === "invalid-status");
  const unaccounted = findings.filter((finding) => finding.kind === "unaccounted-file");
  const eslintReachMissing = findings.filter((finding) => finding.kind === "eslint-reach-missing");
  if (stale.length > 0) {
    lines.push("", "Stale path/group patterns:");
    for (const finding of stale) lines.push(`- line ${String(finding.line)}: ${finding.value}`);
  }
  if (unknown.length > 0) {
    lines.push("", "Unknown ratchet IDs:");
    for (const finding of unknown) lines.push(`- line ${String(finding.line)}: ${finding.value}`);
  }
  if (invalid.length > 0) {
    lines.push("", "Invalid status values:");
    for (const finding of invalid) lines.push(`- line ${String(finding.line)}: ${finding.value}`);
  }
  if (unaccounted.length > 0) {
    lines.push("", "Unaccounted tracked files:");
    lines.push(...groupByDirectory(unaccounted.map((finding) => finding.value)));
  }
  if (eslintReachMissing.length > 0) {
    lines.push("", "ESLint reach gaps:");
    for (const finding of eslintReachMissing)
      lines.push(`- line ${String(finding.line)}: ${finding.value}`);
  }
  return `${lines.join("\n")}\n`;
}

function collectStalePathFindings(
  pathPatterns: PathPattern[],
  trackedFiles: string[],
): CheckFinding[] {
  return pathPatterns
    .filter((p) => !trackedFiles.some(p.matcher))
    .map(
      (p): CheckFinding => ({
        kind: "stale-path",
        line: p.line,
        value: `\`${p.source}\` (${p.pattern}) matched 0 tracked files`,
      }),
    );
}

function collectRowFindings(rows: TableRow[], ratchetIds: ReadonlySet<string>): CheckFinding[] {
  return rows.flatMap((row): CheckFinding[] => [
    ...[...row.ratchets.matchAll(RATCHET_ID_PATTERN)]
      .filter((m) => !ratchetIds.has(m[0]))
      .map((m): CheckFinding => ({ kind: "unknown-ratchet", line: row.line, value: m[0] })),
    ...(isValidStatus(row.status)
      ? []
      : [{ kind: "invalid-status" as const, line: row.line, value: row.status }]),
  ]);
}

function collectUnaccountedFileFindings(
  trackedFiles: string[],
  pathPatterns: PathPattern[],
): CheckFinding[] {
  return trackedFiles
    .filter(trackedFileIsInScope)
    .filter((file) => !pathPatterns.some((p) => p.matcher(file)))
    .map((file): CheckFinding => ({ kind: "unaccounted-file", value: file }));
}

export async function runLintCoverageMapCheck(
  options: LintCoverageMapCheckOptions = {},
): Promise<LintCoverageMapCheckResult> {
  const cwd = options.cwd ?? repoRoot;
  const mapText = loadMapText(options, cwd);
  const trackedFiles = [...(options.trackedFiles ?? loadTrackedFiles(cwd))].sort();
  const ratchetIds = options.ratchetIds ?? new Set(lintRatchets.map((ratchet) => ratchet.id));
  const rows = parseRows(mapText);
  const pathPatterns = rows.flatMap(extractPathPatterns);
  const findings: CheckFinding[] = [
    ...collectStalePathFindings(pathPatterns, trackedFiles),
    ...collectRowFindings(rows, ratchetIds),
    ...collectUnaccountedFileFindings(trackedFiles, pathPatterns),
    ...(await collectEslintReachFindings({
      checkEslintReach: options.checkEslintReach,
      cwd,
      extractPathPatterns,
      reachChecker: options.eslintReachChecker,
      rows,
      staged: options.staged,
      trackedFileIsInScope,
      trackedFiles,
    })),
  ];

  if (findings.length > 0) {
    return { exitCode: 1, stdout: "", stderr: formatFindings(findings), findings };
  }
  return {
    exitCode: 0,
    stdout: `lint-coverage-map-check OK — ${String(rows.length)} row(s), ${String(pathPatterns.length)} path pattern(s), ${String(trackedFiles.length)} tracked file(s) checked.\n`,
    stderr: "",
    findings,
  };
}

function parseCliArgs(args: readonly string[]): LintCoverageMapCheckOptions | undefined {
  const flags = args.filter((arg) => arg !== "--");
  if (flags.every((arg) => arg === "--staged" || arg === "--check-eslint-reach")) {
    const staged = flags.includes("--staged");
    return { staged, checkEslintReach: flags.includes("--check-eslint-reach") && !staged };
  }
  process.stderr.write("usage: lint-coverage-map-check.ts [--check-eslint-reach] [--staged]\n");
  return undefined;
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (fileURLToPath(import.meta.url) === invokedPath) {
  const options = parseCliArgs(process.argv.slice(PROCESS_ARGV_USER_ARGS_START));
  if (options === undefined) {
    process.exitCode = 2;
  } else {
    const result = await runLintCoverageMapCheck(options);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }
}
