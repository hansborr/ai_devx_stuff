import { isAbsolute, relative, sep } from "node:path";

import { z } from "zod";

import type { LintRatchetConfig } from "../kernel/config-types.js";
import type {
  LintRatchetEngineBinding,
  LintRatchetWorkflowVocabulary,
} from "../kernel/engine-context.js";

export interface LintRatchetGitRailAdapter {
  readonly baselineFile: string;
  readonly debtLogFile: string;
  readonly executableModuleSpecifier: string;
  readonly checkBaselineCommand: readonly [string, ...string[]];
  readonly worseBaselineExitCode: number;
  readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
  readonly binding: LintRatchetEngineBinding;
  readonly ratchets: readonly LintRatchetConfig[];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const PORTABLE_GIT_ATTRIBUTE_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[\w./-]+$/u;

function isPortableGitAttributePath(value: unknown): value is string {
  return (
    isString(value) &&
    value !== "." &&
    !value.endsWith("/") &&
    PORTABLE_GIT_ATTRIBUTE_PATH.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is readonly [string, ...string[]] {
  return Array.isArray(value) && value.length > 0 && value.every(isString);
}

function isWorkflowVocabulary(value: unknown): value is LintRatchetWorkflowVocabulary {
  return (
    isRecord(value) &&
    isString(value.updateCommand) &&
    isString(value.regressionUpdateCommand) &&
    isString(value.debtAcceptanceCommand) &&
    isString(value.installMergeDriverCommand) &&
    typeof value.restoreBaselineOursCommand === "function" &&
    isString(value.trendAllCommand)
  );
}

function isBinding(value: unknown): value is LintRatchetEngineBinding {
  return (
    isRecord(value) && isString(value.repoRoot) && Array.isArray(value.thirdPartyPluginAllowlist)
  );
}

function isGitRailAdapter(value: unknown): value is LintRatchetGitRailAdapter {
  return (
    isRecord(value) &&
    isPortableGitAttributePath(value.baselineFile) &&
    isPortableGitAttributePath(value.debtLogFile) &&
    isString(value.executableModuleSpecifier) &&
    isNonEmptyStringArray(value.checkBaselineCommand) &&
    typeof value.worseBaselineExitCode === "number" &&
    isWorkflowVocabulary(value.workflowVocabulary) &&
    isBinding(value.binding) &&
    Array.isArray(value.ratchets)
  );
}

export const lintRatchetGitRailAdapterSchema = z.custom<LintRatchetGitRailAdapter>(
  isGitRailAdapter,
  "invalid lint-ratchet git-rail adapter",
);

export function repoRelativeAdapterPath(repoRoot: string, adapterPath: string): string {
  const result = relative(repoRoot, adapterPath);
  if (result === "" || isAbsolute(result) || result === ".." || result.startsWith(`..${sep}`)) {
    throw new Error("git-rail adapter module must be inside the repository");
  }
  return result.split(sep).join("/");
}
