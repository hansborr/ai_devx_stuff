import { isAbsolute, relative, resolve } from "node:path";

import { isObjectLike } from "../lib/records.js";
import { collectSkillArtifactCheckFailures } from "./generate-skill-artifacts.js";
import { renderVerifyStepsShellFromManifest } from "./generate-verify-steps.js";
import {
  type GeneratedSurfaceRecord,
  parseGeneratedSurfaces,
  renderClassifierFragment,
  renderFixtureManifest,
  renderFreshnessShell,
} from "./generated-surfaces.js";
import { type ControlFailures, pushFailure } from "./harness-check-validation.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";
import {
  GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH,
  GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH,
  GENERATED_SURFACE_FRESHNESS_PATH,
  GENERATED_VERIFY_STEPS_PATH,
} from "./harness-paths.js";

const VERIFY_REGISTRATION_REPAIR = "Run `bun run verify:steps` and commit the result.";
const SKILL_REGISTRATION_REPAIR = "Run `bun run harness:skills:refresh` and commit the result.";

export interface GeneratedRegistrationInputs {
  readonly repoRoot: string;
  readonly rawManifest: unknown;
  readonly scripts: ReadonlyMap<string, string>;
  readonly readOutput: (path: string) => string;
}

function controls(rawManifest: unknown): readonly unknown[] {
  return isObjectLike(rawManifest) && Array.isArray(rawManifest.controls)
    ? rawManifest.controls
    : [];
}

function isUnderRoot(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

interface GeneratedPathCheck {
  readonly repoRoot: string;
  readonly record: GeneratedSurfaceRecord;
  readonly field: "triggerPaths" | "outputPaths";
  readonly path: string;
}

function checkGeneratedPath(
  options: GeneratedPathCheck,
  failures: Map<string, ControlFailures>,
): void {
  const absolute = resolve(options.repoRoot, options.path);
  if (!isUnderRoot(options.repoRoot, absolute)) {
    pushFailure(
      failures,
      options.record.id,
      `generatedSurface.${options.field} entry must resolve under repoRoot: ${options.path}; repair harness.controls.json`,
    );
  }
}

function checkGeneratedScripts(
  record: GeneratedSurfaceRecord,
  scripts: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): void {
  const registered = [
    ["refresh", record.refreshScript],
    ["check", record.checkScript],
    ...Object.keys(record.bunHook.scripts ?? {}).map((script) => ["Bun-hook", script]),
  ] as const;
  for (const [kind, script] of registered) {
    if (scripts.has(script)) continue;
    pushFailure(
      failures,
      record.id,
      `generatedSurface references unknown package.json ${kind} script: ${script}; repair package.json or harness.controls.json`,
    );
  }
}

function checkOutputFreshness(
  inputs: GeneratedRegistrationInputs,
  failures: Map<string, ControlFailures>,
  path: string,
  rendered: string,
): void {
  if (inputs.readOutput(path) === rendered) return;
  pushFailure(failures, path, `${path} is out of date. ${VERIFY_REGISTRATION_REPAIR}`);
}

function checkVerifyRegistrationFragments(
  inputs: GeneratedRegistrationInputs,
  records: readonly GeneratedSurfaceRecord[],
  failures: Map<string, ControlFailures>,
): void {
  // A manifest that fails the typed contract is reported control-by-control by
  // collectManifestRegistrationFailures; skipping the verify-step render here
  // keeps those granular diagnostics reachable instead of aborting the run on
  // a schema throw.
  const { manifest } = safeParseHarnessManifest(inputs.rawManifest);
  try {
    if (manifest !== undefined) {
      checkOutputFreshness(
        inputs,
        failures,
        GENERATED_VERIFY_STEPS_PATH,
        renderVerifyStepsShellFromManifest(manifest, new Set(inputs.scripts.keys())),
      );
    }
    checkOutputFreshness(
      inputs,
      failures,
      GENERATED_SURFACE_FRESHNESS_PATH,
      renderFreshnessShell(records),
    );
    checkOutputFreshness(
      inputs,
      failures,
      GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH,
      renderClassifierFragment(records),
    );
    checkOutputFreshness(
      inputs,
      failures,
      GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH,
      renderFixtureManifest(records),
    );
  } catch (error) {
    pushFailure(
      failures,
      "verify registration",
      `${error instanceof Error ? error.message : String(error)}. ${VERIFY_REGISTRATION_REPAIR}`,
    );
  }
}

function checkSkillRegistration(
  inputs: GeneratedRegistrationInputs,
  failures: Map<string, ControlFailures>,
): void {
  try {
    for (const failure of collectSkillArtifactCheckFailures(inputs.repoRoot, inputs.rawManifest)) {
      pushFailure(
        failures,
        "skill artifact registration",
        `${failure}. ${SKILL_REGISTRATION_REPAIR}`,
      );
    }
  } catch (error) {
    pushFailure(
      failures,
      "skill artifact registration",
      `${error instanceof Error ? error.message : String(error)}. ${SKILL_REGISTRATION_REPAIR}`,
    );
  }
}

export function collectGeneratedRegistrationFailures(
  inputs: GeneratedRegistrationInputs,
  failures: Map<string, ControlFailures>,
): readonly GeneratedSurfaceRecord[] {
  let records: readonly GeneratedSurfaceRecord[] = [];
  try {
    records = parseGeneratedSurfaces(controls(inputs.rawManifest));
  } catch (error) {
    pushFailure(
      failures,
      "generatedSurface schema",
      `${error instanceof Error ? error.message : String(error)}; repair harness.controls.json`,
    );
  }
  for (const record of records) {
    checkGeneratedScripts(record, inputs.scripts, failures);
    for (const path of record.triggerPaths) {
      checkGeneratedPath(
        { repoRoot: inputs.repoRoot, record, field: "triggerPaths", path },
        failures,
      );
    }
    for (const path of record.outputPaths) {
      checkGeneratedPath(
        { repoRoot: inputs.repoRoot, record, field: "outputPaths", path },
        failures,
      );
    }
  }
  checkVerifyRegistrationFragments(inputs, records, failures);
  checkSkillRegistration(inputs, failures);
  return records;
}
