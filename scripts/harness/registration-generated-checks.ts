import { isAbsolute, relative, resolve } from "node:path";

import { errorMessage } from "../lib/error-message.js";
import { isObjectLike } from "../lib/records.js";
import { collectSkillArtifactCheckFailures } from "./generate-skill-artifacts.js";
import { renderProjectionsFor, type VerifyStepProjectionContext } from "./generate-verify-steps.js";
import { type GeneratedSurfaceRecord, parseGeneratedSurfaces } from "./generated-surfaces.js";
import { type ControlFailures, pushFailure } from "./harness-check-validation.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";

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
  // collectManifestRegistrationFailures, and every collector projection is a
  // projection *of* that manifest's world, so this pass has nothing it can
  // usefully compare until the schema failure is repaired. Bowing out here
  // keeps those granular diagnostics as the only report, rather than adding a
  // "run `bun run verify:steps`" repair that cannot fix a malformed manifest.
  const { manifest } = safeParseHarnessManifest(inputs.rawManifest);
  if (manifest === undefined) return;
  const context: VerifyStepProjectionContext = {
    records,
    knownScripts: new Set(inputs.scripts.keys()),
    manifest,
  };
  // Selection is the generator's: renderProjectionsFor picks this checker's
  // projections and fails loudly if one renders nothing, so a collector
  // projection can never lose its freshness comparison here unnoticed.
  try {
    for (const { outputPath, rendered } of renderProjectionsFor("collector", context)) {
      checkOutputFreshness(inputs, failures, outputPath, rendered);
    }
  } catch (error) {
    pushFailure(
      failures,
      "verify registration",
      `${errorMessage(error)}. ${VERIFY_REGISTRATION_REPAIR}`,
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
      `${errorMessage(error)}. ${SKILL_REGISTRATION_REPAIR}`,
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
      `${errorMessage(error)}; repair harness.controls.json`,
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
