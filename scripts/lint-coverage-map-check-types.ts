import type { EslintReachChecker } from "./lint-coverage-map-check-eslint-reach.js";
import type { CoverageEntry, CoverageStatusPart } from "./lint-coverage-map-manifest-schema.js";

/** One explicit repo-rooted glob of a coverage entry, compiled for matching. */
export interface CoveragePattern {
  readonly entryId: string;
  readonly glob: string;
  readonly matcher: (file: string) => boolean;
}

/**
 * A manifest entry reduced to the fields the drift checks act on. Rows are
 * identified by their stable entry id — never by a Markdown line number — so a
 * finding survives reordering the document.
 */
export interface CoverageRow {
  readonly id: string;
  readonly patterns: readonly CoveragePattern[];
  /** `Existing ratchet/floor` prose; empty for rows whose ratchets are derived. */
  readonly ratchetProse: string;
  /** Asserted `Files` cell; `undefined` for rows whose count is rendered. */
  readonly filesProse: string | undefined;
  /** Set when this row declares why its `Files` count is not derivable. */
  readonly filesCountNote: string | undefined;
  readonly statusParts: readonly CoverageStatusPart[];
}

export interface ConfigSurfaceCoverageEntry {
  readonly path: string;
  readonly coverageStatus: string;
}

export interface CheckFinding {
  readonly kind:
    | "stale-path"
    | "unknown-ratchet"
    | "ratchet-membership-mismatch"
    | "conflicting-coverage"
    | "config-surface-coverage-mismatch"
    | "unaccounted-file"
    | "files-count-stale"
    | "eslint-reach-missing"
    | "eslint-reach-unexpected";
  readonly entry?: string;
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
  /** Coverage entries to check. Defaults to the real manifest. */
  readonly entries?: readonly CoverageEntry[];
  readonly trackedFiles?: readonly string[];
  readonly ratchetIds?: ReadonlySet<string>;
  /**
   * Resolve a ratchet id to a file-membership predicate (its `files` glob minus
   * `ignores`), or `undefined` when the id is unknown. Used to validate that a
   * row claiming `ratchet/<id>` actually shares files with that ratchet rather
   * than only that the id exists. Injectable for tests; defaults to the real
   * `lintRatchets` registry.
   */
  readonly ratchetMembership?: (ratchetId: string) => ((file: string) => boolean) | undefined;
  readonly checkEslintReach?: boolean;
  readonly eslintReachChecker?: EslintReachChecker;
  readonly configSurfaceEntries?: readonly ConfigSurfaceCoverageEntry[];
  /**
   * When set, append ready-to-paste manifest entries for every unaccounted file
   * to stderr. Does not change exit codes.
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
