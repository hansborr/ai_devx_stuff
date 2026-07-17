export type BacklogLintFindingKind =
  | "missing-status"
  | "empty-status"
  | "missing-date"
  | "invalid-date"
  | "stale-note"
  | "missing-index"
  | "nonstandard-index-name"
  | "index-leaf-drift"
  | "dangling-index-link"
  | "unlisted-leaf"
  | "unknown-status";

export interface BacklogLintFinding {
  readonly kind: BacklogLintFindingKind;
  readonly path: string;
  readonly line?: number;
  readonly message: string;
}

export interface BacklogLintFile {
  readonly path: string;
  readonly text: string;
}

export interface BacklogLintOptions {
  readonly files: readonly BacklogLintFile[];
  readonly now?: Date;
  readonly staleMonths?: number;
  readonly checkStaleness?: boolean;
  readonly requireFrontMatter?: boolean;
  /** Backlog root, used to group files into packs. Defaults to the SoT dir. */
  readonly backlogDir?: string;
  /**
   * Full set of files used to build pack structure. Defaults to `files`; in
   * `--file` mode it also carries the edited file's pack siblings so the
   * pack-level checks have the whole pack in view.
   */
  readonly packCorpus?: readonly BacklogLintFile[];
  /**
   * When set (file mode), pack-level findings are scoped to edits touching
   * these paths so editing one leaf does not surface the whole pack's drift.
   */
  readonly focusPaths?: readonly string[];
}

export interface BacklogLintResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly checkedCount: number;
  readonly findings: readonly BacklogLintFinding[];
}
