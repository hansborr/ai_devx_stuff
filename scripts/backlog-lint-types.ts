export type BacklogLintFindingKind =
  | "missing-status"
  | "empty-status"
  | "missing-date"
  | "invalid-date"
  | "stale-note";

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
}

export interface BacklogLintResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly checkedCount: number;
  readonly findings: readonly BacklogLintFinding[];
}
