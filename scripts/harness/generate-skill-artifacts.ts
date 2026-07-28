import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseCheckModeArgs } from "../lib/doc-generator.js";
import {
  diffSmokeSubjectOutputs,
  projectSmokeSubjectOutputs,
  writeSmokeSubjectOutputs,
} from "../path-policy/smoke-subject-headers.js";
import { checkSkillArtifactProjection } from "./check-skill-inventory.js";
import { readHarnessManifest } from "./harness-manifest.js";
import {
  materializeSkillArtifactProjection,
  projectSkillArtifacts,
  type SkillArtifactProjection,
} from "./skill-artifact-projection.js";

export const SKILL_ARTIFACT_REPAIR_COMMAND = "bun run harness:skills:refresh";
const PROCESS_ARG_OFFSET = 2;

export class SkillArtifactValidationError extends Error {
  readonly validationCause: unknown;

  constructor(cause: unknown) {
    super(String(cause));
    this.name = "SkillArtifactValidationError";
    this.validationCause = cause;
  }
}

export function formatSkillArtifactValidationFailure(cause: unknown): string {
  return `${String(cause)}\nSkill artifact validation failed before mutation; fix the manifest or authored skill inputs (refresh cannot repair this failure).`;
}

export function formatSkillArtifactFailure(cause: unknown): string {
  if (cause instanceof SkillArtifactValidationError) {
    return formatSkillArtifactValidationFailure(cause.validationCause);
  }
  return `${String(cause)}\nSkill artifact generation failed after validation; run \`${SKILL_ARTIFACT_REPAIR_COMMAND}\` to repair generated outputs.`;
}

function smokeSourceOverrides(projection: SkillArtifactProjection): ReadonlyMap<string, string> {
  return new Map(projection.smokeTests.map((smokeTest) => [smokeTest.path, smokeTest.rendered]));
}

export function collectSkillArtifactCheckFailures(
  repoRoot: string,
  manifest: unknown,
): readonly string[] {
  const projection = projectSkillArtifacts(repoRoot, manifest);
  const smokeOutputs = projectSmokeSubjectOutputs(repoRoot, smokeSourceOverrides(projection));
  return [
    ...checkSkillArtifactProjection(repoRoot, projection),
    ...diffSmokeSubjectOutputs(smokeOutputs).map(
      (path) => `${path}: generated smoke-subject output is stale`,
    ),
  ];
}

export function runSkillArtifactGenerator(
  repoRoot: string,
  manifest: unknown,
  checkMode: boolean,
): number {
  let projection: SkillArtifactProjection;
  let smokeOutputs: ReturnType<typeof projectSmokeSubjectOutputs>;
  try {
    projection = projectSkillArtifacts(repoRoot, manifest);
    smokeOutputs = projectSmokeSubjectOutputs(repoRoot, smokeSourceOverrides(projection));
  } catch (cause) {
    throw new SkillArtifactValidationError(cause);
  }
  if (!checkMode) {
    materializeSkillArtifactProjection(repoRoot, projection);
    writeSmokeSubjectOutputs(smokeOutputs);
    console.log("Refreshed skill mirrors and smoke subjects.");
    return 0;
  }

  const failures = [
    ...checkSkillArtifactProjection(repoRoot, projection),
    ...diffSmokeSubjectOutputs(smokeOutputs).map(
      (path) => `${path}: generated smoke-subject output is stale`,
    ),
  ];
  if (failures.length === 0) {
    console.log("Skill mirrors and smoke subjects are up to date.");
    return 0;
  }
  for (const failure of failures) console.error(failure);
  console.error(`Run \`${SKILL_ARTIFACT_REPAIR_COMMAND}\`.`);
  return 1;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function main(): void {
  try {
    let checkMode: boolean;
    let manifest: unknown;
    try {
      ({ checkMode } = parseCheckModeArgs(process.argv.slice(PROCESS_ARG_OFFSET)));
      manifest = readHarnessManifest(repoRoot);
    } catch (cause) {
      throw new SkillArtifactValidationError(cause);
    }
    process.exitCode = runSkillArtifactGenerator(repoRoot, manifest, checkMode);
  } catch (cause) {
    console.error(formatSkillArtifactFailure(cause));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
