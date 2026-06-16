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
  /**
   * When set, append ready-to-paste coverage-map rows for every unaccounted file
   * to stderr (scaffold for A1/A6). Does not change exit codes.
   */
  readonly suggest?: boolean;
  /**
   * Predicate: does this map-relative path exist in the worktree (regardless of
   * tracking)? Used to turn the opaque "matched 0 tracked files" finding into an
   * actionable "did you forget to `git add` it?" hint. Injectable for tests;
   * defaults to a real `fs.existsSync` rooted at `cwd`.
   */
  readonly worktreeExists?: (relativePath: string) => boolean;
}
