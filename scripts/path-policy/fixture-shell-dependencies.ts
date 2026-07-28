// Structural tripwire for the fixture class that has repeatedly drifted across
// dispatched lanes: a smoke test copies a script into a sandbox but omits one
// of its leaf modules, and the gap only surfaces at the next-deeper gate.
// Every literal fixture copy set is enforced on three axes: `cp` sources of
// shell files must be named by smoke-subject headers; each sandbox destination
// must be closed over the literal `# shellcheck source=` edges of every shell
// file it copies; and each sandbox must be closed over the static import graph
// of every `scripts/**` TS/JS entry it copies (fixture-import-closure.ts).
// (Originally scoped to the memory-admission family; generalized to all
// hand-written copy sets by ready-row B5.) Dynamic sources remain out of scope
// because statically interpreting arbitrary shell would make this check
// misleading. Heredoc bodies are treated as generated stub/data text and
// skipped; an executable body such as `bash <<EOF` that performs fixture
// copies is also intentionally out of scope and must not be used for
// monitored setup.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  capture,
  collectAssignments,
  commandOperands,
  repoRelativePath,
  resolveFixtureExpression,
  scriptsFixtureRootFromDestination,
} from "./fixture-copy-expressions.js";
import {
  fixtureGroupKey,
  type FixtureHelperCall,
  mergeHelperCallSources,
  type MutableFixtureCopyGroup,
  parseFixtureHelperCall,
} from "./fixture-helper-calls.js";
import { collectFixtureImportClosureFailures } from "./fixture-import-closure.js";
import { collectFixtureSandboxes, type FixtureSandbox } from "./fixture-sandbox-model.js";
import { collectScopedShellLines, type ScopedShellLine } from "./fixture-shell-scope.js";

const smokeFilePattern = /^test-.+\.sh$/u;
const shellcheckSourcePattern = /^\s*#\s*shellcheck\s+source=(\S+)\s*$/gmu;
const smokeSubjectPattern = /^#\s*smoke-subjects:(.*)$/gmu;

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
  const operands = commandOperands(trimmed);
  const destination = operands.at(-1);
  if (destination === undefined) return undefined;
  const fixtureRoot = scriptsFixtureRootFromDestination(destination);
  if (fixtureRoot === undefined) return undefined;
  const sources = operands
    .slice(0, -1)
    .map((operand) => resolveFixtureExpression(repoRoot, operand, assignments))
    .filter(isShellPath);
  return { functionScope: scopedLine.functionScope, fixtureRoot, sources };
}

function collectCopiedShellSourcesByFixture(
  repoRoot: string,
  scopedLines: readonly ScopedShellLine[],
  assignments: ReadonlyMap<string, string>,
): readonly FixtureCopyGroup[] {
  const copiedByFixture = new Map<string, MutableFixtureCopyGroup>();
  const helperCalls: FixtureHelperCall[] = [];

  for (const scopedLine of scopedLines) {
    const command = parseFixtureCopyCommand(repoRoot, scopedLine, assignments);
    if (command === undefined) {
      const helperCall = parseFixtureHelperCall(scopedLine);
      if (helperCall !== undefined) helperCalls.push(helperCall);
      continue;
    }
    const key = fixtureGroupKey(command.functionScope, command.fixtureRoot);
    const group = copiedByFixture.get(key) ?? {
      functionScope: command.functionScope,
      fixtureRoot: command.fixtureRoot,
      sources: new Set<string>(),
    };
    for (const path of command.sources) group.sources.add(path);
    if (group.sources.size > 0) copiedByFixture.set(key, group);
  }
  mergeHelperCallSources(copiedByFixture, helperCalls);
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

/**
 * Subject coverage, read exactly the way the changed-mode selector reads it
 * (`matchesSmokeSubject` in path-policy-query-core.ts): an exact path, or a
 * trailing-slash subject covering everything beneath it.
 */
function isCoveredBySubject(subjects: ReadonlySet<string>, path: string): boolean {
  if (subjects.has(path)) return true;
  for (const subject of subjects) {
    if (subject.endsWith("/") && path.startsWith(subject)) return true;
  }
  return false;
}

/**
 * Every path a sandbox seeds by copy must be named by the smoke's subject
 * headers — code and data alike, not only the `.sh` files the sourced-shell
 * closure walks. A copied file is a smoke input by construction: the sandbox
 * runs against it, so a change to it must select the smoke in changed mode.
 * Restricting this to shell paths preserved the exact false PASS the closure
 * guard exists to prevent — a changed TS module would never select the smoke,
 * so the guard would never run on the files that matter.
 */
function collectSmokeMetadataFailures(
  fixturePath: string,
  subjects: ReadonlySet<string>,
  sandboxes: readonly FixtureSandbox[],
): readonly string[] {
  const allCopied = new Set(
    sandboxes.flatMap((sandbox) => [
      ...sandbox.copiedFiles,
      ...[...sandbox.copiedDirectories].map((directory) => `${directory}/`),
    ]),
  );
  return [...allCopied]
    .filter((copiedPath) => !isCoveredBySubject(subjects, copiedPath))
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
  const closureRoots = [...group.sources].sort();
  const functionLabel =
    group.functionScope.length === 0 ? "" : ` function ${group.functionScope.join(" > ")}`;
  for (const closureRoot of closureRoots) {
    const dependencies = [...collectSourcedDependencyClosure(repoRoot, closureRoot)].sort();
    for (const dependency of dependencies) {
      if (!group.sources.has(dependency)) {
        failures.push(
          `${fixturePath}${functionLabel} fixture ${group.fixtureRoot} copies ${closureRoot} but omits sourced dependency ${dependency}`,
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
  const assignments = collectAssignments(repoRoot, source);
  const scopedLines = collectScopedShellLines(source);
  const groups = collectCopiedShellSourcesByFixture(repoRoot, scopedLines, assignments);

  const seeding = collectFixtureSandboxes(repoRoot, fixturePath, scopedLines, assignments);
  const sandboxes = seeding.sandboxes;

  const failures = [
    ...seeding.failures,
    ...collectSmokeMetadataFailures(fixturePath, collectSmokeSubjects(source), sandboxes),
  ];
  for (const group of groups) {
    failures.push(...collectFixtureClosureFailures(repoRoot, fixturePath, group));
  }
  for (const sandbox of sandboxes) {
    failures.push(...collectFixtureImportClosureFailures(repoRoot, fixturePath, sandbox));
  }
  return failures;
}

export function validateFixtureShellDependencies(repoRoot: string): void {
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
    throw new Error(`fixture copy-set drift:\n${failures.join("\n")}`);
  }
}
