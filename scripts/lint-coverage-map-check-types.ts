import type { EslintReachChecker } from "./lint-coverage-map-check-eslint-reach.js";

export interface TableRow {
  readonly line: number;
  readonly pathGroup: string;
  readonly ratchets: string;
  readonly status: string;
}

export interface PathPattern {
  readonly line: number;
  readonly source: string;
  readonly pattern: string;
  readonly matcher: (file: string) => boolean;
}

export interface CheckFinding {
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
