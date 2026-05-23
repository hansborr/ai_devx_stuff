import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseLintRatchetBaselineStructure,
  validateLintRatchetRegistry,
} from "./lint-ratchet-baseline.js";
import {
  lintRatchetThirdPartyPluginAllowlist,
  lintRatchets,
  type LintRatchetConfig,
  type LintRatchetThirdPartyPluginAllowlistEntry,
} from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { formatRuleDocsFailures, loadLintRuleDocs } from "./lint-rule-docs.js";

const BASELINE_FILENAME = "lint-ratchet.baseline.json";
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Z]:[\\/]/iu;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, BASELINE_FILENAME);

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function braceAlternative(pattern: string, start: number): { readonly source: string; readonly next: number } | undefined {
  const end = pattern.indexOf("}", start + 1);
  if (end === -1) return undefined;
  const parts = pattern
    .slice(start + 1, end)
    .split(",")
    .map((part) => escapeRegExp(part));
  return { source: `(?:${parts.join("|")})`, next: end + 1 };
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index] ?? "";
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:[^/]+/)*";
        index += 3;
      } else {
        source += ".*";
        index += 2;
      }
    } else if (char === "*") {
      source += "[^/]*";
      index += 1;
    } else if (char === "?") {
      source += "[^/]";
      index += 1;
    } else if (char === "{") {
      const alternative = braceAlternative(pattern, index);
      if (alternative === undefined) {
        source += "\\{";
        index += 1;
      } else {
        source += alternative.source;
        index = alternative.next;
      }
    } else {
      source += escapeRegExp(char);
      index += 1;
    }
  }
  return new RegExp(`${source}$`, "u");
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

function matchesRatchet(ratchet: LintRatchetConfig, trackedFile: string): boolean {
  return matchesAny(trackedFile, ratchet.files) && !matchesAny(trackedFile, ratchet.ignores);
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

function trackedFilesFromGit(): readonly string[] {
  try {
    return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter((line) => line.length > 0)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new ConfigError(`git ls-files failed while checking lint ratchet globs: ${message}`);
  }
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
  console.error(
    `lint:ratchet:check-registry FAIL — ${String(result.failures.length)} failure(s).`,
  );
  for (const failure of result.failures) {
    console.error(`${failure.kind}: ${failure.message}`);
  }
  process.exitCode = 1;
}

export async function runLintRatchetCheckRegistry(): Promise<void> {
  const ruleDocsById = await loadRuleDocsById();
  const result = checkLintRatchetRegistry({
    ratchets: lintRatchets,
    localRuleIds: new Set(ruleDocsById.keys()),
    thirdPartyPlugins: lintRatchetThirdPartyPluginAllowlist,
    trackedFiles: trackedFilesFromGit(),
    baselineText: baselineTextIfPresent(),
    baselineLabel: BASELINE_FILENAME,
  });
  writeResult(result, lintRatchets.length);
}
