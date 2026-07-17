import { existsSync, readFileSync } from "node:fs";

import { harnessManifestPath as resolveHarnessManifestPath } from "../harness/harness-manifest.js";
import { formatRuleDocsFailures, loadLintRuleDocs } from "../lib/lint-rule-docs.js";
import {
  collectOrphanRemovals,
  parseLintRatchetBaselineStructure,
  validateLintRatchetRegistry,
} from "./baseline.js";
import { trackedFilesFromGit } from "./git-tracked-files.js";
import {
  type LintRatchetConfig,
  lintRatchets,
  lintRatchetThirdPartyPluginAllowlist,
  type LintRatchetThirdPartyPluginAllowlistEntry,
} from "./lint-ratchet-config.js";
import { ConfigError } from "./metrics.js";
import { BASELINE_FILENAME, baselinePath, repoRoot } from "./paths.js";
import { matchesAny, matchingTrackedFiles } from "./ratchet-globs.js";
import { formatMissingRatchetManifestMessage } from "./ratchet-manifest-message.js";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Z]:[\\/]/iu;
const UPDATE_PREFLIGHT_IGNORED_FAILURE_KINDS: ReadonlySet<RegistryCheckFailureKind> = new Set([
  "orphan-baseline",
]);

export type RegistryCheckFailureKind =
  | "registry-shape"
  | "empty-glob"
  | "dead-glob"
  | "absolute-path"
  | "orphan-baseline"
  | "missing-local-rule"
  | "missing-paired-guide"
  | "missing-third-party"
  | "missing-harness-ratchet";

export interface RegistryCheckFailure {
  readonly kind: RegistryCheckFailureKind;
  readonly message: string;
}

export interface RegistryCheckResult {
  readonly ok: boolean;
  readonly failures: readonly RegistryCheckFailure[];
}

export interface RegistryPreflightOptions {
  readonly ignoredFailureKinds?: ReadonlySet<RegistryCheckFailureKind>;
}

export interface CheckLintRatchetRegistryOptions {
  readonly ratchets: readonly LintRatchetConfig[];
  readonly localRuleIds?: ReadonlySet<string>;
  readonly thirdPartyPlugins?: readonly LintRatchetThirdPartyPluginAllowlistEntry[];
  readonly trackedFiles: readonly string[];
  readonly baselineText?: string;
  readonly baselineLabel?: string;
  readonly harnessManifestRatchetIds?: ReadonlySet<string>;
}

const harnessManifestPath = resolveHarnessManifestPath(repoRoot);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function missingHarnessRatchetFailures(
  ratchets: readonly LintRatchetConfig[],
  manifestRatchetIds: ReadonlySet<string> | undefined,
): readonly RegistryCheckFailure[] {
  if (manifestRatchetIds === undefined) return [];
  return ratchets
    .filter((ratchet) => !manifestRatchetIds.has(ratchet.id))
    .map((ratchet) => ({
      kind: "missing-harness-ratchet" as const,
      message: formatMissingRatchetManifestMessage(ratchet.id),
    }));
}

function emptyGlobFailures(
  ratchets: readonly LintRatchetConfig[],
  trackedFiles: readonly string[],
): readonly RegistryCheckFailure[] {
  const failures: RegistryCheckFailure[] = [];
  for (const ratchet of ratchets) {
    if (ratchet.allowEmpty === true) continue;
    if (matchingTrackedFiles(ratchet, trackedFiles).length > 0) continue;
    failures.push({
      kind: "empty-glob",
      message: `${ratchet.id}: files globs match zero tracked files after ignores`,
    });
  }
  return failures;
}

// `emptyGlobFailures` only fires when a ratchet's `files` patterns match zero
// tracked files *combined*, so one dead pattern hiding among live ones stays
// invisible — exactly how a mistyped-but-syntactically-valid glob silently
// drops files from coverage. This checks each `files` entry individually.
// `ignores` entries are exempt: an ignore that matches nothing today is a
// legitimate forward-looking guard, not a coverage hole.
function deadGlobFailures(
  ratchets: readonly LintRatchetConfig[],
  trackedFiles: readonly string[],
): readonly RegistryCheckFailure[] {
  const failures: RegistryCheckFailure[] = [];
  for (const ratchet of ratchets) {
    if (ratchet.allowEmpty === true) continue;
    for (const pattern of ratchet.files) {
      if (trackedFiles.some((trackedFile) => matchesAny(trackedFile, [pattern]))) continue;
      failures.push({
        kind: "dead-glob",
        message: `${ratchet.id}: files glob matches zero tracked files: ${pattern}`,
      });
    }
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
  return collectOrphanRemovals(parsed.baseline, options.ratchets).map((removal) => ({
    kind: "orphan-baseline",
    message: `${removal.testId}: baseline has no matching registry id; this looks like a rename or removal`,
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
    ...deadGlobFailures(options.ratchets, options.trackedFiles),
    ...orphanBaselineFailures(options),
    ...missingHarnessRatchetFailures(options.ratchets, options.harnessManifestRatchetIds),
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

export function parseHarnessManifestRatchetIds(text: string, label: string): ReadonlySet<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // A raw SyntaxError escapes the CLI's ConfigError mapper as a stack trace
    // with no filename; name the file and dress it as a ConfigError instead.
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`harness.controls.json is not valid JSON at ${label}: ${message}`);
  }
  if (!isObject(parsed) || !Array.isArray(parsed.controls)) {
    throw new ConfigError("harness.controls.json must declare a controls array");
  }
  const ratchetIds = new Set<string>();
  for (const entry of parsed.controls) {
    if (isObject(entry) && entry.kind === "ratchet" && typeof entry.id === "string") {
      ratchetIds.add(entry.id);
    }
  }
  return ratchetIds;
}

function harnessManifestRatchetIdsIfPresent(): ReadonlySet<string> | undefined {
  if (!existsSync(harnessManifestPath)) return undefined;
  return parseHarnessManifestRatchetIds(
    readFileSync(harnessManifestPath, "utf8"),
    harnessManifestPath,
  );
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

function applyPreflightOptions(
  result: RegistryCheckResult,
  options: RegistryPreflightOptions,
): RegistryCheckResult {
  const ignoredFailureKinds = options.ignoredFailureKinds;
  if (ignoredFailureKinds === undefined || ignoredFailureKinds.size === 0) return result;
  const failures = result.failures.filter((failure) => !ignoredFailureKinds.has(failure.kind));
  return { ok: failures.length === 0, failures };
}

async function checkCurrentLintRatchetRegistry(
  options: RegistryPreflightOptions = {},
): Promise<RegistryCheckResult> {
  const ruleDocsById = await loadRuleDocsById();
  const result = checkLintRatchetRegistry({
    ratchets: lintRatchets,
    localRuleIds: new Set(ruleDocsById.keys()),
    thirdPartyPlugins: lintRatchetThirdPartyPluginAllowlist,
    trackedFiles: trackedFilesFromGit("checking lint ratchet globs"),
    baselineText: baselineTextIfPresent(),
    baselineLabel: BASELINE_FILENAME,
    harnessManifestRatchetIds: harnessManifestRatchetIdsIfPresent(),
  });
  return applyPreflightOptions(result, options);
}

export async function assertLintRatchetRegistryClean(
  options: RegistryPreflightOptions = {},
): Promise<void> {
  const result = await checkCurrentLintRatchetRegistry(options);
  if (result.ok) return;
  throw new ConfigError(
    formatRegistryCheckFailures("lint:ratchet registry preflight", result.failures),
  );
}

export async function assertLintRatchetUpdateRegistryClean(): Promise<void> {
  await assertLintRatchetRegistryClean({
    ignoredFailureKinds: UPDATE_PREFLIGHT_IGNORED_FAILURE_KINDS,
  });
}

export async function runLintRatchetCheckRegistry(): Promise<void> {
  const result = await checkCurrentLintRatchetRegistry();
  writeResult(result, lintRatchets.length);
}
