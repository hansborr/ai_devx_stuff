import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  diffSkillArtifactProjection,
  filesystemSkillTargets,
  materializeSkillArtifactProjection,
  projectSkillArtifacts,
  type SkillArtifactProjection,
} from "./skill-artifact-projection.js";

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

function gitignoreSkillOptIns(repoRoot: string): Set<string> {
  return new Set(
    readFileSync(join(repoRoot, ".gitignore"), "utf8")
      .split("\n")
      .filter((line) => /^!\.(?:claude|codex)\/skills\//u.test(line)),
  );
}

export function checkSkillInventory(repoRoot: string, manifest: unknown): string[] {
  const projection = projectSkillArtifacts(repoRoot, manifest);
  return checkSkillArtifactProjection(repoRoot, projection);
}

export function checkSkillArtifactProjection(
  repoRoot: string,
  projection: SkillArtifactProjection,
): string[] {
  return [
    ...diffSkillArtifactProjection(repoRoot, projection),
    ...compareSets(
      "filesystem skill target",
      projection.declaredTargetPaths,
      filesystemSkillTargets(repoRoot),
    ),
    ...compareSets(
      "skill gitignore opt-in",
      projection.gitignoreOptIns,
      gitignoreSkillOptIns(repoRoot),
    ),
  ];
}

export function refreshSkillInventory(repoRoot: string, manifest: unknown): void {
  const projection = projectSkillArtifacts(repoRoot, manifest);
  materializeSkillArtifactProjection(repoRoot, projection);
}
