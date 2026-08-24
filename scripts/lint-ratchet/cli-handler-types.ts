import type { Mode } from "./cli-catalog.js";

export interface CommandHandlerArgs {
  readonly mode: Mode;
  readonly allowWorse: boolean;
  readonly reason?: string;
  readonly migrationReason?: string;
  readonly retireRatchetId?: string;
  readonly acceptDifferentOptions?: boolean;
  readonly debtAccountingStaged?: boolean;
  readonly debtAccountingBaseRef?: string;
  readonly summaryByDirectoryDepth?: number;
  readonly trendSince?: string;
  readonly trendMax?: number;
  readonly trendAll?: boolean;
  readonly proposeRuleId?: string;
  readonly proposeFiles?: readonly string[];
  readonly proposeIgnores?: readonly string[];
  readonly proposeMetric?: string;
  readonly proposeRuleOptionsJson?: string;
  readonly proposePluginModule?: string;
  readonly proposePluginExport?: string;
  readonly proposeParserProfile?: string;
  readonly editCheckTargets?: readonly string[];
  readonly targetsFile?: string;
  readonly editRatchetCoveragePaths?: readonly string[];
}

export interface LintRatchetRuntimeOptions {
  readonly reportArtifactName?: string;
  readonly editCheckConcurrency?: number;
  readonly collectConcurrency?: number;
}

export type CommandHandler = (
  args: CommandHandlerArgs,
  options: LintRatchetRuntimeOptions,
) => Promise<void> | void;

export type ValidationHook = (state: CommandHandlerArgs) => void;

export type PreflightTier =
  | "none"
  | "registry-preflight"
  | "update-registry-clean"
  | "validate-registry";

export type PreflightHandler = () => Promise<void> | void;
