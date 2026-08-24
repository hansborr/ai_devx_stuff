import { PATH_POLICY, type PathPolicySelector } from "./path-policy.js";
import { SCRIPT_SMOKE_TEST_NAMES } from "./path-policy-smoke-subjects.js";
import { matchStarOnlySegmentPattern } from "./segment-pattern.js";
import {
  isScriptSmokeTestPath,
  normalizePath,
  SMOKE_METADATA_FRESHNESS_TEST_NAME,
} from "./smoke-test-files.js";

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
type QueryHandler = (paths: readonly string[]) => string[];

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

const matchesSourceRelevant = (path: string): boolean =>
  matchesAnySelector(path, PATH_POLICY.sourceRelevant.selectors);

const matchesPrecommitStagedSourceRelevant = (path: string): boolean =>
  matchesSourceRelevant(path) &&
  !matchesAnySelector(path, PATH_POLICY.sourceRelevant.precommitStagedExcludedSelectors);

const matchesPrecommitTrackedSourceRelevant = (path: string): boolean =>
  matchesSourceRelevant(path) ||
  hasExcludedPrefix(path, PATH_POLICY.sourceRelevant.precommitTrackedExtraPrefixes);

const matchesConfigSurface =
  (selectors: readonly PathPolicySelector[]): PathPredicate =>
  (path) =>
    !hasExcludedDirectoryName(path, PATH_POLICY.configSurfaces.excludedDirectoryNames) &&
    matchesAnySelector(path, selectors);

const matchesAnyConfigSurface = (path: string): boolean =>
  matchesConfigSurface([
    ...PATH_POLICY.configSurfaces.workflowYaml,
    ...PATH_POLICY.configSurfaces.yaml,
    ...PATH_POLICY.configSurfaces.toml,
    ...PATH_POLICY.configSurfaces.dockerfile,
  ])(path);

const matchesShellSurface = (path: string): boolean =>
  !hasExcludedDirectoryName(path, PATH_POLICY.shellSurfaces.excludedDirectoryNames) &&
  !hasExcludedPrefix(path, PATH_POLICY.shellSurfaces.excludedPrefixes) &&
  matchesAnySelector(path, PATH_POLICY.shellSurfaces.maintained);

const matchesFormatCheckCandidate = (): boolean => {
  const parserSurface: string = PATH_POLICY.formatCheckCandidates.parserSurface;
  return parserSurface === "prettier";
};

const pathFilter =
  (predicate: PathPredicate): QueryHandler =>
  (paths) =>
    paths.filter((path) => path.length > 0 && predicate(path));

const matchesSmokeSubject = (path: string, subject: string): boolean => {
  const comparablePath = normalizePath(path);
  if (comparablePath === subject) return true;
  return subject.endsWith("/") && comparablePath.startsWith(subject);
};

const scriptSmokeSubjects: Readonly<Record<string, readonly string[]>> =
  PATH_POLICY.scriptSmoke.subjects;

const smokeTestsForPaths = (paths: readonly string[]): string[] => {
  const selectedTests = new Set<string>();
  for (const name of SCRIPT_SMOKE_TEST_NAMES) {
    const subjects = scriptSmokeSubjects[name];
    if (subjects === undefined) continue;
    if (paths.some((path) => subjects.some((subject) => matchesSmokeSubject(path, subject)))) {
      selectedTests.add(name);
    }
  }

  if (
    paths.some(isScriptSmokeTestPath) &&
    SCRIPT_SMOKE_TEST_NAMES.includes(SMOKE_METADATA_FRESHNESS_TEST_NAME)
  ) {
    selectedTests.add(SMOKE_METADATA_FRESHNESS_TEST_NAME);
  }

  return SCRIPT_SMOKE_TEST_NAMES.filter((name) => selectedTests.has(name));
};

const matchesScriptSmokeSensitiveDeletion = (path: string): boolean =>
  matchesAnySelector(path, PATH_POLICY.deletionClasses.scriptSmokeSensitive);

const queryHandlers: Record<PathPolicyQueryName, QueryHandler> = {
  lintable: pathFilter(matchesLintableExtension(PATH_POLICY.lintableExtensions.eslintChanged)),
  "lintable:eslint-changed": pathFilter(
    matchesLintableExtension(PATH_POLICY.lintableExtensions.eslintChanged),
  ),
  "lintable:agent-changed": pathFilter(
    matchesLintableExtension(PATH_POLICY.lintableExtensions.agentChanged),
  ),
  "source-relevant": pathFilter(matchesSourceRelevant),
  "source-relevant:precommit-staged": pathFilter(matchesPrecommitStagedSourceRelevant),
  "source-relevant:precommit-tracked": pathFilter(matchesPrecommitTrackedSourceRelevant),
  "format-check-candidate": pathFilter(matchesFormatCheckCandidate),
  "config-surface": pathFilter(matchesAnyConfigSurface),
  "config-surface:workflow-yaml": pathFilter(
    matchesConfigSurface(PATH_POLICY.configSurfaces.workflowYaml),
  ),
  "config-surface:yaml": pathFilter(matchesConfigSurface(PATH_POLICY.configSurfaces.yaml)),
  "config-surface:toml": pathFilter(matchesConfigSurface(PATH_POLICY.configSurfaces.toml)),
  "config-surface:dockerfile": pathFilter(
    matchesConfigSurface(PATH_POLICY.configSurfaces.dockerfile),
  ),
  "config-surface:reference-dockerfile": pathFilter(
    matchesConfigSurface(PATH_POLICY.configSurfaces.referenceDockerfile),
  ),
  "shell-surface": pathFilter(matchesShellSurface),
  "full-scan-trigger:eslint-changed": pathFilter((path) =>
    matchesAnySelector(path, PATH_POLICY.fullScanTriggers.eslintChanged),
  ),
  "full-scan-trigger:agent-lint-changed": pathFilter((path) =>
    matchesAnySelector(path, PATH_POLICY.fullScanTriggers.agentLintChanged),
  ),
  "full-scan-trigger:config-sensors-changed": pathFilter((path) =>
    matchesAnySelector(path, PATH_POLICY.fullScanTriggers.configSensorsChanged),
  ),
  "full-scan-trigger:eslint-disable-register-changed": pathFilter((path) =>
    matchesAnySelector(path, PATH_POLICY.fullScanTriggers.eslintDisableRegisterChanged),
  ),
  "full-scan-trigger:suppression-register-changed": pathFilter((path) =>
    matchesAnySelector(path, PATH_POLICY.fullScanTriggers.suppressionRegisterChanged),
  ),
  "script-smoke-test-names": () => [...SCRIPT_SMOKE_TEST_NAMES],
  "script-smoke-tests": smokeTestsForPaths,
  "deletion-class:script-smoke-sensitive": pathFilter(matchesScriptSmokeSensitiveDeletion),
};

export const isPathPolicyQueryName = (value: string): value is PathPolicyQueryName =>
  pathPolicyQueryNameSet.has(value);

export const queryPathPolicy = (query: PathPolicyQueryName, paths: readonly string[]): string[] =>
  queryHandlers[query](paths);

export const parsePathPolicyInput = (input: string): string[] => {
  if (input.length === 0) return [];
  const parts = input.includes("\0") ? input.split("\0") : input.split(/\r?\n/u);
  return parts.filter((part) => part.length > 0);
};

export const formatPathPolicyOutput = (records: readonly string[]): string =>
  records.length === 0 ? "" : `${records.join("\0")}\0`;
