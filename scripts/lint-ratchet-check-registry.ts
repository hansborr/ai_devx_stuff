import { existsSync, readFileSync } from "node:fs";

import { trackedFilesFromGit } from "./lint-ratchet/git-tracked-files.js";
import { BASELINE_FILENAME, baselinePath, repoRoot } from "./lint-ratchet/paths.js";
import { matchesRatchet } from "./lint-ratchet/ratchet-globs.js";
import {
  parseLintRatchetBaselineStructure,
  validateLintRatchetRegistry,
} from "./lint-ratchet-baseline.js";
import {
  type LintRatchetConfig,
  lintRatchets,
  lintRatchetThirdPartyPluginAllowlist,
  type LintRatchetThirdPartyPluginAllowlistEntry,
} from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { formatRuleDocsFailures, loadLintRuleDocs } from "./lint-rule-docs.js";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Z]:[\\/]/iu;

export type RegistryCheckFailureKind =
  | "registry-shape"
  | "empty-glob"
  | "absolute-path"
  | "orphan-baseline"
  | "missing-local-rule"
  | "missing-paired-guide"
  | "missing-third-party";

export interface RegistryCheckFailure {
  readonly kind: RegistryCheckFailureKind;
  readonly message: string;
}

export interface RegistryCheckResult {
  readonly ok: boolean;
  readonly failures: readonly RegistryCheckFailure[];
}

export interface CheckLintRatchetRegistryOptions {
  readonly ratchets: readonly LintRatchetConfig[];
  readonly localRuleIds?: ReadonlySet<string>;
  readonly thirdPartyPlugins?: readonly LintRatchetThirdPartyPluginAllowlistEntry[];
  readonly trackedFiles: readonly string[];
  readonly baselineText?: string;
  readonly baselineLabel?: string;
}

function registryShapeFailures(
  options: CheckLintRatchetRegistryOptions,
): readonly RegistryCheckFailure[] {
  return validateLintRatchetRegistry(options.ratchets, {
    localRuleIds: options.localRuleIds,
    thirdPartyPlugins: options.thirdPartyPlugins,
  }).map((message) => ({ kind: "registry-shape", message }));
}

function isAbsolutePathPattern(pathPattern: string): boolean {
  return pathPattern.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(pathPattern);
}

function absolutePathFailures(
  ratchets: readonly LintRatchetConfig[],
): readonly RegistryCheckFailure[] {
  const failures: RegistryCheckFailure[] = [];
  for (const ratchet of ratchets) {
    for (const [field, values] of [
      ["files", ratchet.files],
      ["ignores", ratchet.ignores],
    ] as const) {
      for (const value of values) {
        if (isAbsolutePathPattern(value)) {
          failures.push({
            kind: "absolute-path",
            message: `${ratchet.id}: ${field} must use portable relative paths, not absolute local paths: ${value}`,
          });
        }
      }
    }
  }
  return failures;
}

function emptyGlobFailures(
  ratchets: readonly LintRatchetConfig[],
  trackedFiles: readonly string[],
): readonly RegistryCheckFailure[] {
  const failures: RegistryCheckFailure[] = [];
  for (const ratchet of ratchets) {
    if (ratchet.allowEmpty === true) continue;
    if (trackedFiles.some((trackedFile) => matchesRatchet(ratchet, trackedFile))) continue;
    failures.push({
      kind: "empty-glob",
      message: `${ratchet.id}: files globs match zero tracked files after ignores`,
    });
  }
  return failures;
}

function orphanBaselineFailures(
  options: CheckLintRatchetRegistryOptions,
): readonly RegistryCheckFailure[] {
  if (options.baselineText === undefined) return [];
  const parsed = parseLintRatchetBaselineStructure(options.baselineText);
  const label = options.baselineLabel ?? BASELINE_FILENAME;
  if (parsed.baseline === undefined) {
    return parsed.failures.map((message) => ({
      kind: "orphan-baseline",
      message: `${label}: ${message}`,
    }));
  }
  const registryIds = new Set(options.ratchets.map((ratchet) => ratchet.id));
  return Object.keys(parsed.baseline.tests)
    .filter((id) => !registryIds.has(id))
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({
      kind: "orphan-baseline",
      message: `${id}: baseline has no matching registry id; this looks like a rename or removal`,
    }));
}

function sortFailures(failures: readonly RegistryCheckFailure[]): readonly RegistryCheckFailure[] {
  return [...failures].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.message.localeCompare(right.message),
  );
}

export function checkLintRatchetRegistry(
  options: CheckLintRatchetRegistryOptions,
): RegistryCheckResult {
  const failures = sortFailures([
    ...registryShapeFailures(options),
    ...absolutePathFailures(options.ratchets),
    ...emptyGlobFailures(options.ratchets, options.trackedFiles),
    ...orphanBaselineFailures(options),
  ]);
  return { ok: failures.length === 0, failures };
}

async function loadRuleDocsById(): Promise<ReadonlyMap<string, string>> {
  const { entries, failures } = await loadLintRuleDocs(repoRoot);
  if (failures.length > 0) throw new ConfigError(formatRuleDocsFailures(failures));
  return new Map(entries.map((entry) => [entry.id, entry.id]));
}

function baselineTextIfPresent(): string | undefined {
  return existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : undefined;
}

function writeResult(result: RegistryCheckResult, ratchetCount: number): void {
  if (result.ok) {
    console.error(`lint:ratchet:check-registry OK — ${String(ratchetCount)} ratchets validated.`);
    return;
  }
  console.error(formatRegistryCheckFailures("lint:ratchet:check-registry", result.failures));
  process.exitCode = 1;
}

function formatRegistryCheckFailures(
  label: string,
  failures: readonly RegistryCheckFailure[],
): string {
  return [
    `${label} FAIL — ${String(failures.length)} failure(s).`,
    ...failures.map((failure) => `${failure.kind}: ${failure.message}`),
  ].join("\n");
}

async function checkCurrentLintRatchetRegistry(): Promise<RegistryCheckResult> {
  const ruleDocsById = await loadRuleDocsById();
  return checkLintRatchetRegistry({
    ratchets: lintRatchets,
    localRuleIds: new Set(ruleDocsById.keys()),
    thirdPartyPlugins: lintRatchetThirdPartyPluginAllowlist,
    trackedFiles: trackedFilesFromGit("checking lint ratchet globs"),
    baselineText: baselineTextIfPresent(),
    baselineLabel: BASELINE_FILENAME,
  });
}

export async function assertLintRatchetRegistryClean(): Promise<void> {
  const result = await checkCurrentLintRatchetRegistry();
  if (result.ok) return;
  throw new ConfigError(
    formatRegistryCheckFailures("lint:ratchet registry preflight", result.failures),
  );
}

export async function runLintRatchetCheckRegistry(): Promise<void> {
  const result = await checkCurrentLintRatchetRegistry();
  writeResult(result, lintRatchets.length);
}
