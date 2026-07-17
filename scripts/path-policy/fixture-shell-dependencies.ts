// Structural tripwire for the fixture class that has repeatedly drifted across
// memory-hardening lanes. This deliberately scopes enforcement to smoke tests
// that copy one of the memory-admission core scripts below. For those fixtures,
// literal `cp` sources must be named by smoke-subject headers and each sandbox
// destination must be closed over literal `# shellcheck source=` edges.
// Dynamic sources and unrelated fixture families remain out of scope because
// statically interpreting arbitrary shell would make this check misleading.
// Heredoc bodies are treated as generated stub/data text and skipped; an
// executable body such as `bash <<EOF` that performs fixture copies is also
// intentionally out of scope and must not be used for monitored setup.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { collectScopedShellLines, type ScopedShellLine } from "./fixture-shell-scope.js";

const monitoredAdmissionRoots = new Set([
  "scripts/lib/tool-memory-admission.sh",
  "scripts/verify/admitted-command.sh",
  "scripts/verify/memory-budget.sh",
]);
const smokeFilePattern = /^test-.+\.sh$/u;
const assignmentPattern = /^\s*([A-Z][A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s#]+)\s*$/gmu;
const shellcheckSourcePattern = /^\s*#\s*shellcheck\s+source=(\S+)\s*$/gmu;
const smokeSubjectPattern = /^#\s*smoke-subjects:(.*)$/gmu;
const shellTokenPattern = /"[^"]*"|'[^']*'|\S+/gu;
const assignmentPathCaptureIndex = 2;

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function capture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error(`expected regex capture ${String(index)}`);
  return value;
}

function repoRelativePath(repoRoot: string, absolutePath: string): string | undefined {
  const relativePath = normalizePath(relative(repoRoot, absolutePath));
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../")) {
    return undefined;
  }
  return relativePath;
}

function resolveFixtureExpression(
  repoRoot: string,
  expression: string,
  assignments: ReadonlyMap<string, string>,
): string | undefined {
  const value = stripQuotes(expression);
  const variableMatch = /^\$\{?([A-Z][A-Z0-9_]*)\}?$/u.exec(value);
  if (variableMatch !== null) return assignments.get(capture(variableMatch, 1));

  const scriptDirPrefixes = ["$SCRIPT_DIR/", "${SCRIPT_DIR}/"];
  for (const prefix of scriptDirPrefixes) {
    if (value.startsWith(prefix)) {
      return repoRelativePath(
        repoRoot,
        resolve(repoRoot, "scripts", "tests", value.slice(prefix.length)),
      );
    }
  }

  const repoRootPrefixes = ["$REPO_ROOT/", "${REPO_ROOT}/"];
  for (const prefix of repoRootPrefixes) {
    if (value.startsWith(prefix)) {
      return repoRelativePath(repoRoot, resolve(repoRoot, value.slice(prefix.length)));
    }
  }

  if (value.startsWith("scripts/")) return normalizePath(value);
  return undefined;
}

function collectAssignments(repoRoot: string, source: string): ReadonlyMap<string, string> {
  const assignments = new Map<string, string>();
  for (const match of source.matchAll(assignmentPattern)) {
    const path = resolveFixtureExpression(
      repoRoot,
      capture(match, assignmentPathCaptureIndex),
      assignments,
    );
    if (path !== undefined) assignments.set(capture(match, 1), path);
  }
  return assignments;
}

function fixtureRootFromDestination(destination: string): string | undefined {
  const value = normalizePath(stripQuotes(destination));
  const scriptsMarker = "/scripts/";
  const markerIndex = value.indexOf(scriptsMarker);
  if (markerIndex > 0) return value.slice(0, markerIndex);
  if (value.endsWith("/scripts")) return value.slice(0, -"/scripts".length);
  return undefined;
}

interface FixtureCopyCommand {
  readonly functionScope: readonly string[];
  readonly fixtureRoot: string;
  readonly sources: readonly string[];
}

interface FixtureCopyGroup {
  readonly functionScope: readonly string[];
  readonly fixtureRoot: string;
  readonly sources: ReadonlySet<string>;
}

function isShellPath(path: string | undefined): path is string {
  return path?.endsWith(".sh") === true;
}

function parseFixtureCopyCommand(
  repoRoot: string,
  scopedLine: ScopedShellLine,
  assignments: ReadonlyMap<string, string>,
): FixtureCopyCommand | undefined {
  const trimmed = scopedLine.line.trim();
  if (!trimmed.startsWith("cp ")) return undefined;
  const tokens = trimmed.match(shellTokenPattern) ?? [];
  const operands = tokens.slice(1).filter((token) => !token.startsWith("-"));
  const destination = operands.at(-1);
  if (destination === undefined) return undefined;
  const fixtureRoot = fixtureRootFromDestination(destination);
  if (fixtureRoot === undefined) return undefined;
  const sources = operands
    .slice(0, -1)
    .map((operand) => resolveFixtureExpression(repoRoot, operand, assignments))
    .filter(isShellPath);
  return { functionScope: scopedLine.functionScope, fixtureRoot, sources };
}

function fixtureGroupKey(functionScope: readonly string[], fixtureRoot: string): string {
  return `${functionScope.join("\u0000")}\u0001${fixtureRoot}`;
}

function collectCopiedShellSourcesByFixture(
  repoRoot: string,
  source: string,
): readonly FixtureCopyGroup[] {
  const assignments = collectAssignments(repoRoot, source);
  const copiedByFixture = new Map<
    string,
    { functionScope: readonly string[]; fixtureRoot: string; sources: Set<string> }
  >();

  for (const scopedLine of collectScopedShellLines(source)) {
    const command = parseFixtureCopyCommand(repoRoot, scopedLine, assignments);
    if (command === undefined) continue;
    const key = fixtureGroupKey(command.functionScope, command.fixtureRoot);
    const group = copiedByFixture.get(key) ?? {
      functionScope: command.functionScope,
      fixtureRoot: command.fixtureRoot,
      sources: new Set<string>(),
    };
    for (const path of command.sources) group.sources.add(path);
    if (group.sources.size > 0) copiedByFixture.set(key, group);
  }
  return [...copiedByFixture.values()];
}

function collectSmokeSubjects(source: string): ReadonlySet<string> {
  const subjects = new Set<string>();
  for (const match of source.matchAll(smokeSubjectPattern)) {
    for (const subject of capture(match, 1).trim().split(/\s+/u)) subjects.add(subject);
  }
  return subjects;
}

function resolveAnnotatedDependency(
  repoRoot: string,
  ownerPath: string,
  annotation: string,
): string | undefined {
  if (annotation === "/dev/null") return undefined;
  const absolutePath = annotation.startsWith("scripts/")
    ? resolve(repoRoot, annotation)
    : resolve(repoRoot, dirname(ownerPath), annotation);
  return repoRelativePath(repoRoot, absolutePath);
}

function collectSourcedDependencyClosure(repoRoot: string, root: string): ReadonlySet<string> {
  const dependencies = new Set<string>();
  const pending = [root];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const owner = pending.pop();
    if (owner === undefined || visited.has(owner)) continue;
    visited.add(owner);
    const ownerAbsolutePath = resolve(repoRoot, owner);
    if (!existsSync(ownerAbsolutePath)) {
      throw new Error(`${owner} referenced by fixture dependency closure does not exist`);
    }
    const source = readFileSync(ownerAbsolutePath, "utf8");
    for (const match of source.matchAll(shellcheckSourcePattern)) {
      const dependency = resolveAnnotatedDependency(repoRoot, owner, capture(match, 1));
      if (dependency === undefined || dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      pending.push(dependency);
    }
  }
  dependencies.delete(root);
  return dependencies;
}

function monitoredFixtureGroups(groups: readonly FixtureCopyGroup[]): readonly FixtureCopyGroup[] {
  return groups.filter((group) =>
    [...group.sources].some((path) => monitoredAdmissionRoots.has(path)),
  );
}

function collectSmokeMetadataFailures(
  fixturePath: string,
  subjects: ReadonlySet<string>,
  groups: readonly FixtureCopyGroup[],
): readonly string[] {
  const allCopied = new Set(groups.flatMap((group) => [...group.sources]));
  return [...allCopied]
    .filter((copiedPath) => !subjects.has(copiedPath))
    .sort()
    .map(
      (copiedPath) =>
        `${fixturePath} copies ${copiedPath} but its smoke-subject headers omit that path`,
    );
}

function collectFixtureClosureFailures(
  repoRoot: string,
  fixturePath: string,
  group: FixtureCopyGroup,
): readonly string[] {
  const failures: string[] = [];
  const admissionRoots = [...group.sources]
    .filter((path) => monitoredAdmissionRoots.has(path))
    .sort();
  const functionLabel =
    group.functionScope.length === 0 ? "" : ` function ${group.functionScope.join(" > ")}`;
  for (const admissionRoot of admissionRoots) {
    const dependencies = [...collectSourcedDependencyClosure(repoRoot, admissionRoot)].sort();
    for (const dependency of dependencies) {
      if (!group.sources.has(dependency)) {
        failures.push(
          `${fixturePath}${functionLabel} fixture ${group.fixtureRoot} copies ${admissionRoot} but omits sourced dependency ${dependency}`,
        );
      }
    }
  }
  return failures;
}

function collectSmokeFixtureFailures(
  repoRoot: string,
  testsDir: string,
  smokeFile: string,
): readonly string[] {
  const fixturePath = `scripts/tests/${smokeFile}`;
  const source = readFileSync(resolve(testsDir, smokeFile), "utf8");
  const groups = collectCopiedShellSourcesByFixture(repoRoot, source);
  const monitoredGroups = monitoredFixtureGroups(groups);
  if (monitoredGroups.length === 0) return [];

  const failures = [
    ...collectSmokeMetadataFailures(fixturePath, collectSmokeSubjects(source), groups),
  ];
  for (const group of monitoredGroups) {
    failures.push(...collectFixtureClosureFailures(repoRoot, fixturePath, group));
  }
  return failures;
}

export function validateMonitoredFixtureShellDependencies(repoRoot: string): void {
  const testsDir = resolve(repoRoot, "scripts", "tests");
  if (!existsSync(testsDir)) return;
  const failures: string[] = [];
  const smokeFiles = readdirSync(testsDir)
    .filter((name) => smokeFilePattern.test(name))
    .sort();

  for (const smokeFile of smokeFiles) {
    failures.push(...collectSmokeFixtureFailures(repoRoot, testsDir, smokeFile));
  }

  if (failures.length > 0) {
    throw new Error(`memory-admission fixture dependency drift:\n${failures.join("\n")}`);
  }
}
