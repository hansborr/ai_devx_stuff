import { ESLint } from "eslint";

import type { CoverageRow } from "./lint-coverage-map-check-types.js";

const ESLINT_REACH_EXTENSION_PATTERN = /\.(?:ts|tsx|js|mjs|cjs|json)$/u;

export type EslintReachChecker = (file: string) => boolean | Promise<boolean>;

export interface EslintReachFinding {
  readonly kind: "eslint-reach-missing" | "eslint-reach-unexpected";
  readonly entry: string;
  readonly value: string;
}

interface CollectEslintReachFindingsOptions {
  readonly checkEslintReach?: boolean;
  readonly cwd: string;
  readonly reachChecker?: EslintReachChecker;
  readonly rows: readonly CoverageRow[];
  readonly trackedFileIsInScope: (file: string) => boolean;
  readonly trackedFiles: readonly string[];
}

// `calculateConfigForFile` is untyped, so narrow its result structurally rather
// than asserting a shape onto it.
function resolvesAnyRule(config: unknown): boolean {
  if (typeof config !== "object" || config === null || !("rules" in config)) return false;
  const { rules } = config;
  return typeof rules === "object" && rules !== null && Object.keys(rules).length > 0;
}

// "Normal lint reaches this file" means the flat config resolves at least one
// rule for it, not merely that a config object comes back. `calculateConfigForFile`
// answers for any file with a known extension — including ones every `ignores`
// entry excludes — so the weaker test would call an intentionally unlinted file
// reachable and make the non-linted direction below vacuous.
export function createEslintReachChecker(cwd: string): EslintReachChecker {
  const eslint = new ESLint({ cwd });
  const cache = new Map<string, Promise<boolean>>();
  return async (file) => {
    const cached = cache.get(file);
    if (cached !== undefined) return await cached;
    const reachable = eslint
      .calculateConfigForFile(file)
      .then((config: unknown) => resolvesAnyRule(config));
    cache.set(file, reachable);
    return await reachable;
  };
}

function trackedFileUsesEslint(file: string): boolean {
  return ESLINT_REACH_EXTENSION_PATTERN.test(file);
}

export async function collectEslintReachFindings({
  checkEslintReach,
  cwd,
  reachChecker,
  rows,
  trackedFileIsInScope,
  trackedFiles,
}: CollectEslintReachFindingsOptions): Promise<EslintReachFinding[]> {
  if (checkEslintReach !== true) return [];
  const checkReach = reachChecker ?? createEslintReachChecker(cwd);
  const findings: EslintReachFinding[] = [];
  for (const row of rows) {
    const rowFiles = trackedFiles.filter(
      (file) =>
        trackedFileIsInScope(file) &&
        trackedFileUsesEslint(file) &&
        row.patterns.some((pattern) => pattern.matcher(file)),
    );
    const claimsLinted = row.statusParts.includes("linted");
    const disagreeing: string[] = [];
    for (const file of rowFiles) {
      if ((await checkReach(file)) !== claimsLinted) disagreeing.push(file);
    }
    const sample = disagreeing[0];
    if (sample === undefined) continue;
    // Both directions are the same defect seen from either side: the row's
    // `linted` claim and what the ESLint config actually does have parted ways.
    findings.push(
      claimsLinted
        ? {
            kind: "eslint-reach-missing",
            entry: row.id,
            value: `${String(disagreeing.length)} of ${String(rowFiles.length)} ESLint-managed file(s) resolve no ESLint rules (e.g. \`${sample}\`)`,
          }
        : {
            kind: "eslint-reach-unexpected",
            entry: row.id,
            value: `${String(disagreeing.length)} of ${String(rowFiles.length)} ESLint-managed file(s) do resolve ESLint rules (e.g. \`${sample}\`), but this row's status is \`${row.statusParts.join(" + ")}\``,
          },
    );
  }
  return findings;
}
