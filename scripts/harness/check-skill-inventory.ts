import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { isObject, parseSkillWiring, type SkillWiring } from "./skill-inventory-schema.js";
import { compareSkillTrees } from "./skill-tree-comparison.js";

export type { SkillOverlay } from "./skill-inventory-schema.js";
export { compareSkillTrees } from "./skill-tree-comparison.js";

function assertRepoPath(repoRoot: string, path: string, context: string): string {
  const absoluteRepoRoot = resolve(repoRoot);
  const physicalRepoRoot = realpathSync(absoluteRepoRoot);
  const absolute = resolve(absoluteRepoRoot, path);
  const rel = relative(absoluteRepoRoot, absolute);
  if (isAbsolute(rel) || rel.startsWith("..")) throw new Error(`${context} escapes repo root`);
  const rootStat = lstatSync(absolute);
  if (rootStat.isSymbolicLink()) throw new Error(`${context} must not be a symlink: ${path}`);
  if (!rootStat.isDirectory()) throw new Error(`${context} is not a directory: ${path}`);
  const physical = realpathSync(absolute);
  const physicalRel = relative(physicalRepoRoot, physical);
  if (isAbsolute(physicalRel) || physicalRel.startsWith("..")) {
    throw new Error(`${context} resolves outside repo root: ${path}`);
  }
  return physical;
}

function setDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((entry) => !right.has(entry)).sort();
}

function compareSets(
  label: string,
  declared: ReadonlySet<string>,
  actual: ReadonlySet<string>,
): string[] {
  return [
    ...setDifference(actual, declared).map((entry) => `${label} is not inventoried: ${entry}`),
    ...setDifference(declared, actual).map((entry) => `${label} is declared but absent: ${entry}`),
  ];
}

function filesystemSkillTargets(repoRoot: string): Set<string> {
  const targets = new Set<string>();
  for (const root of [".claude/skills", ".codex/skills"]) {
    for (const entry of readdirSync(join(repoRoot, root), { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) targets.add(`${root}/${entry.name}`);
    }
  }
  return targets;
}

function gitignoreSkillOptIns(repoRoot: string): Set<string> {
  return new Set(
    readFileSync(join(repoRoot, ".gitignore"), "utf8")
      .split("\n")
      .filter((line) => /^!\.(?:claude|codex)\/skills\//u.test(line)),
  );
}

function smokeSkillSubjects(repoRoot: string): Set<string> {
  const subjects = new Set<string>();
  for (const file of readdirSync(join(repoRoot, "scripts/tests"))) {
    if (!/^test-.+\.sh$/u.test(file)) continue;
    const source = readFileSync(join(repoRoot, "scripts/tests", file), "utf8");
    for (const line of source.split("\n")) {
      const prefix = "# smoke-subjects:";
      if (!line.startsWith(prefix)) continue;
      for (const subject of line.slice(prefix.length).trim().split(/\s+/u)) {
        if (/^\.(?:claude|codex)\/skills\//u.test(subject)) subjects.add(subject);
      }
    }
  }
  return subjects;
}

export function checkSkillInventory(repoRoot: string, manifest: unknown): string[] {
  if (!isObject(manifest) || !Array.isArray(manifest.controls)) {
    throw new Error("harness.controls.json must declare controls");
  }
  const skills = manifest.controls
    .filter(
      (control): control is Record<string, unknown> =>
        isObject(control) && control.kind === "skill",
    )
    .map(parseSkillWiring);
  if (skills.length === 0) return ["manifest declares no skill controls"];

  const failures: string[] = [];
  const declared: DeclaredSkillSurfaces = {
    targets: new Set<string>(),
    optIns: new Set<string>(),
    smokeSubjects: new Set<string>(),
  };
  for (const skill of skills) {
    failures.push(...checkSkill(repoRoot, skill, declared));
  }

  failures.push(
    ...compareSets("filesystem skill target", declared.targets, filesystemSkillTargets(repoRoot)),
  );
  failures.push(
    ...compareSets("skill gitignore opt-in", declared.optIns, gitignoreSkillOptIns(repoRoot)),
  );
  failures.push(
    ...compareSets("skill smoke subject", declared.smokeSubjects, smokeSkillSubjects(repoRoot)),
  );
  return failures;
}

interface DeclaredSkillSurfaces {
  readonly targets: Set<string>;
  readonly optIns: Set<string>;
  readonly smokeSubjects: Set<string>;
}

function checkSkill(
  repoRoot: string,
  skill: SkillWiring,
  declared: DeclaredSkillSurfaces,
): string[] {
  const failures: string[] = [];
  const canonicalRoot = assertRepoPath(repoRoot, skill.canonical, `${skill.id}.canonical`);
  if (!skill.targets.some((target) => target.path === skill.canonical)) {
    failures.push(`${skill.id} canonical path is not one of its targets: ${skill.canonical}`);
  }
  for (const target of skill.targets) {
    declared.targets.add(target.path);
    const targetRoot = assertRepoPath(repoRoot, target.path, `${skill.id}.${target.harness}`);
    if (target.path === skill.canonical) continue;
    failures.push(
      ...compareSkillTrees(canonicalRoot, targetRoot, target.overlays).map(
        (failure) => `${skill.id} ${target.harness}: ${failure}`,
      ),
    );
  }
  for (const optIn of skill.gitignoreOptIns) declared.optIns.add(optIn);
  for (const subject of skill.smokeSubjects) declared.smokeSubjects.add(subject);
  if (skill.smokeTest !== undefined && !statSync(resolve(repoRoot, skill.smokeTest)).isFile()) {
    failures.push(`${skill.id} smoke test is not a file: ${skill.smokeTest}`);
  }
  return failures;
}
