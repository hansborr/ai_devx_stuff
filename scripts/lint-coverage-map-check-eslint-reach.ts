import { ESLint } from "eslint";

const ESLINT_REACH_EXTENSION_PATTERN = /\.(?:ts|tsx|js|mjs|cjs|json)$/u;

export type EslintReachChecker = (file: string) => boolean | Promise<boolean>;

interface EslintReachRow {
  readonly line: number;
  readonly status: string;
}

interface EslintReachPathPattern {
  readonly matcher: (file: string) => boolean;
}

export interface EslintReachFinding {
  readonly kind: "eslint-reach-missing";
  readonly line: number;
  readonly value: string;
}

interface CollectEslintReachFindingsOptions<Row extends EslintReachRow> {
  readonly checkEslintReach?: boolean;
  readonly cwd: string;
  readonly extractPathPatterns: (row: Row) => readonly EslintReachPathPattern[];
  readonly reachChecker?: EslintReachChecker;
  readonly rows: readonly Row[];
  readonly staged?: boolean;
  readonly trackedFileIsInScope: (file: string) => boolean;
  readonly trackedFiles: readonly string[];
}

export function createEslintReachChecker(cwd: string): EslintReachChecker {
  const eslint = new ESLint({ cwd });
  const cache = new Map<string, Promise<boolean>>();
  return async (file) => {
    const cached = cache.get(file);
    if (cached !== undefined) return await cached;
    const reachable = eslint.calculateConfigForFile(file).then((config) => config !== undefined);
    cache.set(file, reachable);
    return await reachable;
  };
}

function statusIncludesPart(status: string, part: string): boolean {
  return status
    .split("+")
    .map((value) => value.trim())
    .includes(part);
}

function trackedFileUsesEslint(file: string): boolean {
  return ESLINT_REACH_EXTENSION_PATTERN.test(file);
}

export async function collectEslintReachFindings<Row extends EslintReachRow>({
  checkEslintReach,
  cwd,
  extractPathPatterns,
  reachChecker,
  rows,
  staged,
  trackedFileIsInScope,
  trackedFiles,
}: CollectEslintReachFindingsOptions<Row>): Promise<EslintReachFinding[]> {
  if (checkEslintReach !== true || staged === true) return [];
  const checkReach = reachChecker ?? createEslintReachChecker(cwd);
  const findings: EslintReachFinding[] = [];
  for (const row of rows) {
    if (!statusIncludesPart(row.status, "linted")) continue;
    const rowPatterns = extractPathPatterns(row);
    const rowFiles = trackedFiles.filter(
      (file) =>
        trackedFileIsInScope(file) &&
        trackedFileUsesEslint(file) &&
        rowPatterns.some((pattern) => pattern.matcher(file)),
    );
    const missing: string[] = [];
    for (const file of rowFiles) {
      if (!(await checkReach(file))) missing.push(file);
    }
    const sample = missing[0];
    if (sample !== undefined) {
      findings.push({
        kind: "eslint-reach-missing",
        line: row.line,
        value: `${String(missing.length)} of ${String(rowFiles.length)} ESLint-managed file(s) have no ESLint config (e.g. \`${sample}\`)`,
      });
    }
  }
  return findings;
}
