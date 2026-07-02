export interface ParsedArgs {
  readonly mode:
    | "default"
    | "update"
    | "check-baseline"
    | "check-debt-accounting"
    | "check-registry"
    | "summary"
    | "trend"
    | "zero-baseline"
    | "report"
    | "debt-log"
    | "propose"
    | "edit-check-targets"
    | "edit-check"
    | "edit-ratchet-coverage";
  readonly allowWorse: boolean;
  readonly reason?: string;
  readonly retireRatchetId?: string;
  readonly summaryByDirectoryDepth?: number;
  readonly trendSince?: string;
  readonly trendMax?: number;
  readonly proposeRuleId?: string;
  readonly proposeFiles?: readonly string[];
  readonly proposeIgnores?: readonly string[];
  readonly proposeMetric?: string;
  readonly proposeRuleOptionsJson?: string;
  readonly editCheckTargets?: readonly string[];
  readonly targetsFile?: string;
  readonly editRatchetCoveragePaths?: readonly string[];
}

export interface ParsedArgsState {
  mode: ParsedArgs["mode"];
  allowWorse: boolean;
  reason?: string;
  retireRatchetId?: string;
  summaryByDirectoryDepth?: number;
  trendSince?: string;
  trendMax?: number;
  proposeRuleId?: string;
  proposeFiles?: readonly string[];
  proposeIgnores?: readonly string[];
  proposeMetric?: string;
  proposeRuleOptionsJson?: string;
  editCheckTargets?: readonly string[];
  targetsFile?: string;
  editRatchetCoveragePaths?: readonly string[];
}
