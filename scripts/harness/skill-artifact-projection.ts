import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { writeFileAtomicallySync } from "../lib/atomic-write.js";
import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { isRecord } from "../lib/records.js";
import { parseSkillWiring, type SkillWiring } from "./skill-inventory-schema.js";
import {
  assertInsideRepo,
  assertRepoRelativePath,
  type FileArtifact,
  projectTargetFiles,
  readFileTree,
} from "./skill-projection-files.js";
import {
  renderSkillSmokeSubjectBlock,
  SKILL_SMOKE_SUBJECTS_BEGIN,
  SKILL_SMOKE_SUBJECTS_END,
} from "./skill-smoke-subject-block.js";

export { SKILL_SMOKE_SUBJECTS_BEGIN, SKILL_SMOKE_SUBJECTS_END };

const FILE_PERMISSION_MASK = 0o777;
const EXECUTABLE_PERMISSION_MASK = 0o111;
const GIT_EXECUTABLE_BIT = 0o100;
const MODE_DISPLAY_WIDTH = 3;
const OCTAL_RADIX = 8;
const SUPPORTS_EXECUTABLE_MODE = process.platform !== "win32";

function permissionMode(mode: number): number {
  return mode & FILE_PERMISSION_MASK;
}

function formatPermissionMode(mode: number): string {
  return permissionMode(mode).toString(OCTAL_RADIX).padStart(MODE_DISPLAY_WIDTH, "0");
}

function isGitExecutable(mode: number): boolean {
  return (permissionMode(mode) & GIT_EXECUTABLE_BIT) !== 0;
}

function withGitExecutableMode(mode: number, executable: boolean): number {
  const permissions = permissionMode(mode);
  return executable
    ? permissions | EXECUTABLE_PERMISSION_MASK
    : permissions & ~EXECUTABLE_PERMISSION_MASK;
}

interface ProjectedSkillTarget {
  readonly id: string;
  readonly harness: string;
  readonly path: string;
  readonly files: ReadonlyMap<string, FileArtifact>;
}

interface ProjectedSkillSmokeTest {
  readonly path: string;
  readonly rendered: string;
}

export interface SkillArtifactProjection {
  readonly declaredTargetPaths: ReadonlySet<string>;
  readonly gitignoreOptIns: ReadonlySet<string>;
  readonly targets: readonly ProjectedSkillTarget[];
  readonly smokeTests: readonly ProjectedSkillSmokeTest[];
}

interface ProjectionState {
  readonly declaredTargetPaths: Set<string>;
  readonly gitignoreOptIns: Set<string>;
  readonly smokeSubjects: Map<string, Set<string>>;
  readonly targets: ProjectedSkillTarget[];
}

function error(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function skillControls(manifest: unknown): SkillWiring[] {
  if (!isRecord(manifest) || !Array.isArray(manifest.controls)) {
    throw new Error("harness.controls.json must declare controls");
  }
  const skills = manifest.controls
    .filter(
      (control): control is Record<string, unknown> =>
        isRecord(control) && control.kind === "skill",
    )
    .map(parseSkillWiring);
  if (skills.length === 0) throw new Error("manifest declares no skill controls");
  return skills;
}

function registerSkillDeclarations(skill: SkillWiring, state: ProjectionState): void {
  for (const optIn of skill.gitignoreOptIns) {
    if (state.gitignoreOptIns.has(optIn)) error(skill.id, `duplicate gitignore opt-in: ${optIn}`);
    state.gitignoreOptIns.add(optIn);
  }
  for (const target of skill.targets) {
    if (state.declaredTargetPaths.has(target.path)) {
      error(skill.id, `duplicate skill target path: ${target.path}`);
    }
    state.declaredTargetPaths.add(target.path);
  }
}

function addSmokeSubjects(
  skill: SkillWiring,
  contributedSubjects: ReadonlySet<string>,
  state: ProjectionState,
): void {
  if (skill.smokeTest === undefined) return;
  assertRepoRelativePath(skill.smokeTest, `${skill.id}.smokeTest`);
  const existing = state.smokeSubjects.get(skill.smokeTest) ?? new Set<string>();
  for (const subject of contributedSubjects) existing.add(subject);
  state.smokeSubjects.set(skill.smokeTest, existing);
}

function projectSkill(repoRoot: string, skill: SkillWiring, state: ProjectionState): void {
  const canonicalTargets = skill.targets.filter((target) => target.path === skill.canonical);
  const canonicalTarget = canonicalTargets[0];
  if (canonicalTargets.length !== 1 || canonicalTarget === undefined) {
    error(skill.id, `canonical path must match exactly one target: ${skill.canonical}`);
  }
  if (canonicalTarget.overlays.length > 0)
    error(skill.id, "canonical target must not declare overlays");
  const canonicalRoot = assertInsideRepo(repoRoot, skill.canonical, `${skill.id}.canonical`);
  const canonical = readFileTree(canonicalRoot, `${skill.id}.canonical`, false);
  registerSkillDeclarations(skill, state);

  const subjects = new Set<string>(
    [...canonical.files.keys()].map((path) => `${skill.canonical}/${path}`),
  );
  for (const target of skill.targets) {
    if (target.path === skill.canonical) continue;
    const targetRoot = assertInsideRepo(repoRoot, target.path, `${skill.id}.${target.harness}`);
    const current = readFileTree(targetRoot, `${skill.id}.${target.harness}`, true);
    const files = projectTargetFiles(skill, target, canonicalTarget.harness, {
      canonical,
      current,
    });
    state.targets.push({ id: skill.id, harness: target.harness, path: target.path, files });
    for (const path of files.keys()) subjects.add(`${target.path}/${path}`);
  }
  addSmokeSubjects(skill, subjects, state);
}

function projectSmokeTests(
  repoRoot: string,
  smokeSubjects: ReadonlyMap<string, ReadonlySet<string>>,
): ProjectedSkillSmokeTest[] {
  return [...smokeSubjects.entries()]
    .sort(([left], [right]) => compareByCodepoint(left, right))
    .map(([path, subjects]) => {
      const absolute = assertInsideRepo(repoRoot, path, `${path} smoke test`);
      if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
        error(path, "smoke test is not a regular file");
      }
      return {
        path,
        rendered: renderSkillSmokeSubjectBlock(
          readFileSync(absolute, "utf8"),
          path,
          [...subjects].sort(compareByCodepoint),
        ),
      };
    });
}

export function projectSkillArtifacts(
  repoRoot: string,
  manifest: unknown,
): SkillArtifactProjection {
  const state: ProjectionState = {
    declaredTargetPaths: new Set(),
    gitignoreOptIns: new Set(),
    smokeSubjects: new Map(),
    targets: [],
  };
  for (const skill of skillControls(manifest)) projectSkill(repoRoot, skill, state);
  return {
    declaredTargetPaths: state.declaredTargetPaths,
    gitignoreOptIns: state.gitignoreOptIns,
    targets: state.targets.sort((left, right) => compareByCodepoint(left.path, right.path)),
    smokeTests: projectSmokeTests(repoRoot, state.smokeSubjects),
  };
}

function diffTarget(repoRoot: string, target: ProjectedSkillTarget): string[] {
  const absolute = join(repoRoot, target.path);
  if (!existsSync(absolute)) return [`${target.id} ${target.harness}: target root is missing`];
  const current = readFileTree(absolute, `${target.id}.${target.harness}`, false).files;
  const failures: string[] = [];
  for (const path of [...target.files.keys()].sort(compareByCodepoint)) {
    const expected = target.files.get(path);
    const actual = current.get(path);
    if (expected === undefined) continue;
    if (actual === undefined)
      failures.push(`${target.id} ${target.harness}: missing target file ${path}`);
    else if (!actual.content.equals(expected.content)) {
      failures.push(`${target.id} ${target.harness}: stale target file ${path}`);
    } else if (
      SUPPORTS_EXECUTABLE_MODE &&
      isGitExecutable(actual.mode) !== isGitExecutable(expected.mode)
    ) {
      failures.push(
        `${target.id} ${target.harness}: target file mode drift ${path}: expected ${formatPermissionMode(expected.mode)}, got ${formatPermissionMode(actual.mode)}`,
      );
    }
  }
  for (const path of [...current.keys()].sort(compareByCodepoint)) {
    if (!target.files.has(path))
      failures.push(`${target.id} ${target.harness}: stale target file ${path}`);
  }
  return failures;
}

export function diffSkillArtifactProjection(
  repoRoot: string,
  projection: SkillArtifactProjection,
): string[] {
  const failures = projection.targets.flatMap((target) => diffTarget(repoRoot, target));
  for (const smokeTest of projection.smokeTests) {
    if (readFileSync(join(repoRoot, smokeTest.path), "utf8") !== smokeTest.rendered) {
      failures.push(`${smokeTest.path}: generated skill smoke-subject block is stale`);
    }
  }
  return failures;
}

interface StagedTarget {
  readonly target: ProjectedSkillTarget;
  readonly temporaryPath: string;
}

function writeStagedTarget(repoRoot: string, target: ProjectedSkillTarget): StagedTarget {
  const absolute = join(repoRoot, target.path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporaryPath = mkdtempSync(join(dirname(absolute), `.${basename(absolute)}.refresh-`));
  try {
    for (const [path, artifact] of target.files) {
      const output = join(temporaryPath, path);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, artifact.content);
      if (SUPPORTS_EXECUTABLE_MODE) {
        const currentPath = join(absolute, path);
        const baseMode = existsSync(currentPath)
          ? lstatSync(currentPath).mode
          : lstatSync(output).mode;
        chmodSync(output, withGitExecutableMode(baseMode, isGitExecutable(artifact.mode)));
      }
    }
    return { target, temporaryPath };
  } catch (cause) {
    rmSync(temporaryPath, { recursive: true, force: true });
    throw cause;
  }
}

function installStagedTarget(repoRoot: string, staged: StagedTarget): void {
  const absolute = join(repoRoot, staged.target.path);
  if (!existsSync(absolute)) {
    renameSync(staged.temporaryPath, absolute);
    return;
  }
  const backup = `${staged.temporaryPath}.previous`;
  renameSync(absolute, backup);
  try {
    renameSync(staged.temporaryPath, absolute);
  } catch (cause) {
    renameSync(backup, absolute);
    throw cause;
  }
  rmSync(backup, { recursive: true, force: true });
}

export function materializeSkillArtifactProjection(
  repoRoot: string,
  projection: SkillArtifactProjection,
): void {
  const changedTargets = projection.targets.filter(
    (target) => diffTarget(repoRoot, target).length > 0,
  );
  const staged = changedTargets.map((target) => writeStagedTarget(repoRoot, target));
  try {
    for (const target of staged) installStagedTarget(repoRoot, target);
  } finally {
    for (const target of staged) {
      if (existsSync(target.temporaryPath))
        rmSync(target.temporaryPath, { recursive: true, force: true });
    }
  }
  for (const smokeTest of projection.smokeTests) {
    const absolute = join(repoRoot, smokeTest.path);
    if (readFileSync(absolute, "utf8") !== smokeTest.rendered) {
      const mode = permissionMode(lstatSync(absolute).mode);
      writeFileAtomicallySync(absolute, smokeTest.rendered, {
        mode,
      });
      if (SUPPORTS_EXECUTABLE_MODE) chmodSync(absolute, mode);
    }
  }
}

export function filesystemSkillTargets(repoRoot: string): Set<string> {
  const targets = new Set<string>();
  for (const root of [".claude/skills", ".codex/skills"]) {
    for (const entry of readdirSync(join(repoRoot, root), { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) targets.add(`${root}/${entry.name}`);
    }
  }
  return targets;
}
