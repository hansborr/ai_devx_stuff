// Portable changed-file path-policy query engine.
//
// This module is the reusable half of the path-policy query surface: the
// selector language, the 22 query names, the handlers built over them, and the
// NUL-safe parse/format helpers. It holds no policy data and reads no
// repository state. Everything repository-specific arrives through
// `createPathPolicyQueryHandlers`, so importing this module never pulls in a
// concrete policy, a generated smoke registry, or filesystem discovery.
//
// Copy contract for another harness: take this file plus `segment-pattern.ts`
// and `smoke-test-files.ts` (the neutral segment-pattern dialect and smoke-file
// vocabulary this engine evaluates against), then supply a `PathPolicy` value
// and the three smoke dependencies. There are no other local imports and no
// Musi-specific literals here — `path-policy-query-core.ts` is the adapter that
// binds this engine to Musi's policy, registry, and discovery.

import { matchStarOnlySegmentPattern } from "./segment-pattern.js";
import {
  isScriptSmokeTestPath,
  matchesSmokeSubject,
  normalizePath,
  type ScriptSmokeSubjects,
} from "./smoke-test-files.js";

export type PathPolicySelector =
  | {
      readonly kind: "exact";
      readonly path: string;
    }
  | {
      readonly kind: "prefix";
      readonly prefix: string;
    }
  | {
      readonly kind: "single-segment-glob";
      /** `*` is the only pattern character; it matches within one path segment. */
      readonly pattern: string;
    }
  | {
      readonly kind: "extension";
      readonly extension: `.${string}`;
    }
  | {
      readonly kind: "prefix-extension";
      readonly prefix: string;
      readonly extension: `.${string}`;
    };

/**
 * The query-facing policy shape: exactly the groups the 22 handlers read. A
 * repository's own policy value may carry more (Musi's carries
 * `directoryPrefixSubjects`); this type is the contract the engine evaluates.
 */
export type PathPolicy = {
  readonly lintableExtensions: {
    readonly eslintChanged: readonly `.${string}`[];
    readonly agentChanged: readonly `.${string}`[];
  };
  readonly sourceRelevant: {
    readonly selectors: readonly PathPolicySelector[];
    readonly precommitStagedExcludedSelectors: readonly PathPolicySelector[];
    readonly precommitTrackedExtraPrefixes: readonly string[];
  };
  readonly fullScanTriggers: {
    readonly eslintChanged: readonly PathPolicySelector[];
    readonly agentLintChanged: readonly PathPolicySelector[];
    readonly configSensorsChanged: readonly PathPolicySelector[];
    readonly eslintDisableRegisterChanged: readonly PathPolicySelector[];
    readonly suppressionRegisterChanged: readonly PathPolicySelector[];
  };
  readonly shellSurfaces: {
    readonly maintained: readonly PathPolicySelector[];
    readonly excludedDirectoryNames: readonly string[];
    readonly excludedPrefixes: readonly string[];
  };
  readonly configSurfaces: {
    readonly workflowYaml: readonly PathPolicySelector[];
    readonly yaml: readonly PathPolicySelector[];
    readonly toml: readonly PathPolicySelector[];
    readonly dockerfile: readonly PathPolicySelector[];
    readonly referenceDockerfile: readonly PathPolicySelector[];
    readonly excludedDirectoryNames: readonly string[];
  };
  readonly deletionClasses: {
    readonly scriptSmokeSensitive: readonly PathPolicySelector[];
  };
};

export const PATH_POLICY_QUERY_NAMES = [
  "lintable",
  "lintable:eslint-changed",
  "lintable:agent-changed",
  "source-relevant",
  "source-relevant:precommit-staged",
  "source-relevant:precommit-tracked",
  "format-check-candidate",
  "config-surface",
  "config-surface:workflow-yaml",
  "config-surface:yaml",
  "config-surface:toml",
  "config-surface:dockerfile",
  "config-surface:reference-dockerfile",
  "shell-surface",
  "full-scan-trigger:eslint-changed",
  "full-scan-trigger:agent-lint-changed",
  "full-scan-trigger:config-sensors-changed",
  "full-scan-trigger:eslint-disable-register-changed",
  "full-scan-trigger:suppression-register-changed",
  "script-smoke-test-names",
  "script-smoke-tests",
  "deletion-class:script-smoke-sensitive",
] as const;

export type PathPolicyQueryName = (typeof PATH_POLICY_QUERY_NAMES)[number];

const pathPolicyQueryNameSet: ReadonlySet<string> = new Set(PATH_POLICY_QUERY_NAMES);

type PathPredicate = (path: string) => boolean;
export type PathPolicyQueryHandler = (paths: readonly string[]) => string[];

/**
 * What the engine needs from its host harness.
 *
 * The two smoke dependencies are lazy providers so that building the handler
 * table neither discovers smoke tests nor forces a generated registry to be
 * evaluated; the freshness test name is injected for the same reason its
 * subjects are — it names one concrete smoke in the host repository.
 */
export interface PathPolicyQueryDependencies {
  readonly policy: PathPolicy;
  /** Smoke-test names in run order; called per query, memoized by the host. */
  readonly smokeTestNames: () => readonly string[];
  /** The smoke-subject registry; called per query, owned by the host. */
  readonly smokeSubjects: () => ScriptSmokeSubjects;
  /** The smoke that owns smoke-metadata freshness in the host repository. */
  readonly smokeMetadataFreshnessTestName: string;
}

const matchesPathPolicySelector = (path: string, selector: PathPolicySelector): boolean => {
  const comparablePath = normalizePath(path);

  switch (selector.kind) {
    case "exact":
      return comparablePath === selector.path;
    case "prefix":
      return comparablePath.startsWith(selector.prefix);
    case "single-segment-glob":
      return matchStarOnlySegmentPattern(comparablePath, selector.pattern);
    case "extension":
      return comparablePath.endsWith(selector.extension);
    case "prefix-extension":
      return (
        comparablePath.startsWith(selector.prefix) && comparablePath.endsWith(selector.extension)
      );
  }
};

const matchesAnySelector = (path: string, selectors: readonly PathPolicySelector[]): boolean =>
  selectors.some((selector) => matchesPathPolicySelector(path, selector));

const hasExcludedDirectoryName = (path: string, directoryNames: readonly string[]): boolean => {
  const comparablePath = normalizePath(path);
  return comparablePath.split("/").some((segment) => directoryNames.includes(segment));
};

const hasExcludedPrefix = (path: string, prefixes: readonly string[]): boolean => {
  const comparablePath = normalizePath(path);
  return prefixes.some((prefix) => comparablePath.startsWith(prefix));
};

const matchesLintableExtension =
  (extensions: readonly `.${string}`[]): PathPredicate =>
  (path) => {
    const comparablePath = normalizePath(path);
    return extensions.some((extension) => comparablePath.endsWith(extension));
  };

const pathFilter =
  (predicate: PathPredicate): PathPolicyQueryHandler =>
  (paths) =>
    paths.filter((path) => path.length > 0 && predicate(path));

/**
 * Build the handler table for one policy and smoke binding.
 *
 * Handlers close over the injected dependencies, never over module state, so a
 * host may build more than one table (a test fixture policy alongside the live
 * one) in a single process.
 */
export const createPathPolicyQueryHandlers = ({
  policy,
  smokeTestNames,
  smokeSubjects,
  smokeMetadataFreshnessTestName,
}: PathPolicyQueryDependencies): Record<PathPolicyQueryName, PathPolicyQueryHandler> => {
  const matchesSourceRelevant = (path: string): boolean =>
    matchesAnySelector(path, policy.sourceRelevant.selectors);

  const matchesPrecommitStagedSourceRelevant = (path: string): boolean =>
    matchesSourceRelevant(path) &&
    !matchesAnySelector(path, policy.sourceRelevant.precommitStagedExcludedSelectors);

  const matchesPrecommitTrackedSourceRelevant = (path: string): boolean =>
    matchesSourceRelevant(path) ||
    hasExcludedPrefix(path, policy.sourceRelevant.precommitTrackedExtraPrefixes);

  const matchesConfigSurface =
    (selectors: readonly PathPolicySelector[]): PathPredicate =>
    (path) =>
      !hasExcludedDirectoryName(path, policy.configSurfaces.excludedDirectoryNames) &&
      matchesAnySelector(path, selectors);

  const matchesAnyConfigSurface = (path: string): boolean =>
    matchesConfigSurface([
      ...policy.configSurfaces.workflowYaml,
      ...policy.configSurfaces.yaml,
      ...policy.configSurfaces.toml,
      ...policy.configSurfaces.dockerfile,
    ])(path);

  const matchesShellSurface = (path: string): boolean =>
    !hasExcludedDirectoryName(path, policy.shellSurfaces.excludedDirectoryNames) &&
    !hasExcludedPrefix(path, policy.shellSurfaces.excludedPrefixes) &&
    matchesAnySelector(path, policy.shellSurfaces.maintained);

  const smokeTestsForPaths = (paths: readonly string[]): string[] => {
    const testNames = smokeTestNames();
    const subjectsByName = smokeSubjects();
    const selectedTests = new Set<string>();
    for (const name of testNames) {
      const subjects = subjectsByName[name];
      if (subjects === undefined) continue;
      if (paths.some((path) => subjects.some((subject) => matchesSmokeSubject(path, subject)))) {
        selectedTests.add(name);
      }
    }

    if (paths.some(isScriptSmokeTestPath)) {
      selectedTests.add(smokeMetadataFreshnessTestName);
    }

    // The filter is what enforces both run order and membership: a selected
    // name the provider never discovered — the injected freshness smoke, in a
    // host that does not have it — is dropped here rather than guarded above.
    return testNames.filter((name) => selectedTests.has(name));
  };

  const matchesScriptSmokeSensitiveDeletion = (path: string): boolean =>
    matchesAnySelector(path, policy.deletionClasses.scriptSmokeSensitive);

  return {
    lintable: pathFilter(matchesLintableExtension(policy.lintableExtensions.eslintChanged)),
    "lintable:eslint-changed": pathFilter(
      matchesLintableExtension(policy.lintableExtensions.eslintChanged),
    ),
    "lintable:agent-changed": pathFilter(
      matchesLintableExtension(policy.lintableExtensions.agentChanged),
    ),
    "source-relevant": pathFilter(matchesSourceRelevant),
    "source-relevant:precommit-staged": pathFilter(matchesPrecommitStagedSourceRelevant),
    "source-relevant:precommit-tracked": pathFilter(matchesPrecommitTrackedSourceRelevant),
    // Pass-through by design: every changed path is a format-check candidate, so
    // this query only echoes its input. scripts/format-changed.sh does the
    // filtering downstream — it drops paths that no longer exist on disk, then
    // hands the rest to `prettier --ignore-unknown`. Prettier's default ignore
    // path (.gitignore and .prettierignore) skips the excluded files; the flag
    // skips the ones Prettier has no parser for.
    "format-check-candidate": pathFilter(() => true),
    "config-surface": pathFilter(matchesAnyConfigSurface),
    "config-surface:workflow-yaml": pathFilter(
      matchesConfigSurface(policy.configSurfaces.workflowYaml),
    ),
    "config-surface:yaml": pathFilter(matchesConfigSurface(policy.configSurfaces.yaml)),
    "config-surface:toml": pathFilter(matchesConfigSurface(policy.configSurfaces.toml)),
    "config-surface:dockerfile": pathFilter(matchesConfigSurface(policy.configSurfaces.dockerfile)),
    "config-surface:reference-dockerfile": pathFilter(
      matchesConfigSurface(policy.configSurfaces.referenceDockerfile),
    ),
    "shell-surface": pathFilter(matchesShellSurface),
    "full-scan-trigger:eslint-changed": pathFilter((path) =>
      matchesAnySelector(path, policy.fullScanTriggers.eslintChanged),
    ),
    "full-scan-trigger:agent-lint-changed": pathFilter((path) =>
      matchesAnySelector(path, policy.fullScanTriggers.agentLintChanged),
    ),
    "full-scan-trigger:config-sensors-changed": pathFilter((path) =>
      matchesAnySelector(path, policy.fullScanTriggers.configSensorsChanged),
    ),
    "full-scan-trigger:eslint-disable-register-changed": pathFilter((path) =>
      matchesAnySelector(path, policy.fullScanTriggers.eslintDisableRegisterChanged),
    ),
    "full-scan-trigger:suppression-register-changed": pathFilter((path) =>
      matchesAnySelector(path, policy.fullScanTriggers.suppressionRegisterChanged),
    ),
    "script-smoke-test-names": () => [...smokeTestNames()],
    "script-smoke-tests": smokeTestsForPaths,
    "deletion-class:script-smoke-sensitive": pathFilter(matchesScriptSmokeSensitiveDeletion),
  };
};

export const isPathPolicyQueryName = (value: string): value is PathPolicyQueryName =>
  pathPolicyQueryNameSet.has(value);

export const parsePathPolicyInput = (input: string): string[] => {
  if (input.length === 0) return [];
  const parts = input.includes("\0") ? input.split("\0") : input.split(/\r?\n/u);
  return parts.filter((part) => part.length > 0);
};

export const formatPathPolicyOutput = (records: readonly string[]): string =>
  records.length === 0 ? "" : `${records.join("\0")}\0`;
