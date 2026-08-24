// harness:check validator for the derived smoke-fixture copy manifest. One
// shared dependency walk supplies both the effective fixture projection and
// trigger coverage validation; authored fixtureExtras are residue only.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../lib/error-message.js";
import { renderProjectionsFor, type VerifyStepProjectionContext } from "./generate-verify-steps.js";
import {
  deriveGeneratedSurfaceDependencies,
  diffFixtureExtraResidue,
  FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV,
  FIXTURE_SYNTHESIZED_PATHS,
} from "./generated-surface-dependencies.js";
import { diffTriggerPathClosure, type GeneratedSurfaceRecord } from "./generated-surfaces.js";
import { type ControlFailures, pushFailure } from "./harness-check-validation.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";

const FIXTURE_CLOSURE_FAILURE_ID = "harness-check fixture copy manifest";
const TRIGGER_CLOSURE_FAILURE_ID = "generatedSurface triggerPaths closure";

/**
 * Explicit permission for a reduced tree with no declarations to consume its
 * checked-in projection, or for a walker-less tree to fall back to a fully
 * hand-declared fixtureExtras list. It never suppresses validation when the
 * walker is available.
 */
export { FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV };

/**
 * Read the reduced-tree/walker-less opt-out. The env read lives at this
 * fail-closed boundary so every consumer of the fixture derivation (validation
 * here, the explain view's authority loading) shares one interpretation.
 */
export function allowWalkerlessFixtureDerivation(): boolean {
  return process.env[FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV] === "1";
}

/**
 * Re-render every projection this checker owns and compare it to the file on
 * disk. Selection is the generator's, not a copy of it: `renderProjectionsFor`
 * picks the fixture-closure projections and fails loudly when one of them
 * renders nothing, so narrowing the context below can no longer drop an
 * output's freshness comparison silently. Adding a fixture-closure projection
 * to the descriptor wires this check up with no edit here.
 */
function checkFixtureClosureProjections(
  repoRoot: string,
  context: VerifyStepProjectionContext,
  failures: Map<string, ControlFailures>,
): void {
  let projections: readonly { readonly outputPath: string; readonly rendered: string }[];
  try {
    projections = renderProjectionsFor("fixtureClosure", context);
  } catch (error) {
    pushFailure(failures, FIXTURE_CLOSURE_FAILURE_ID, errorMessage(error));
    return;
  }
  for (const { outputPath, rendered } of projections) {
    let actual: string | undefined;
    try {
      actual = readFileSync(join(repoRoot, outputPath), "utf8");
    } catch {
      actual = undefined;
    }
    if (actual !== rendered) {
      pushFailure(
        failures,
        outputPath,
        `${outputPath} is out of date. Run \`bun run verify:steps\` and commit the result.`,
      );
    }
  }
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function checkFixtureExtrasAreFiles(
  repoRoot: string,
  records: readonly GeneratedSurfaceRecord[],
  failures: Map<string, ControlFailures>,
): void {
  for (const record of records) {
    for (const extra of record.fixtureExtras ?? []) {
      if (isRegularFile(join(repoRoot, extra.path))) continue;
      pushFailure(
        failures,
        FIXTURE_CLOSURE_FAILURE_ID,
        `${record.id} generatedSurface.fixtureExtras entry does not resolve to a regular file: ${extra.path}`,
      );
    }
  }
}

/**
 * Validate reasoned fixture residue and the checked-in derived projection.
 * `records` comes from the caller's single manifest parse. Zero residue stays
 * fail-closed unless a reduced tree explicitly consumes its precomputed
 * projection. Declared residue is always checked; when the walker cannot load,
 * the explicit permission above makes declarations the whole effective list,
 * with file and projection validation still active. When the walker loads, the
 * permission has no effect: residue, trigger closure, files, and freshness are
 * all validated normally.
 */
export async function checkFixtureCopyClosure(
  repoRoot: string,
  records: readonly GeneratedSurfaceRecord[],
  failures: Map<string, ControlFailures>,
): Promise<void> {
  const allowWalkerlessFixtures = allowWalkerlessFixtureDerivation();
  const hasFixtureExtraDeclarations = records.some((record) => record.fixtureExtras !== undefined);
  if (!hasFixtureExtraDeclarations) {
    if (allowWalkerlessFixtures) return;
    pushFailure(
      failures,
      FIXTURE_CLOSURE_FAILURE_ID,
      "no generatedSurface record declares fixtureExtras, so fixture residue validation " +
        `has nothing to validate; restore fixtureExtras in ${HARNESS_MANIFEST_FILENAME} ` +
        "(a merge can drop them silently). Only a reduced fixture tree consuming a " +
        "precomputed projection, or a walker-less tree with a fully declared list, " +
        `may opt out explicitly via ${FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV}=1.`,
    );
    return;
  }
  checkFixtureExtrasAreFiles(repoRoot, records, failures);

  const dependencies = await deriveGeneratedSurfaceDependencies(repoRoot, records, {
    allowDeclaredFallback: allowWalkerlessFixtures,
  });
  for (const message of dependencies.failures) {
    pushFailure(failures, FIXTURE_CLOSURE_FAILURE_ID, message);
  }
  for (const message of diffFixtureExtraResidue({
    records,
    entryClosures: dependencies.entryClosures,
    synthesizedPaths: FIXTURE_SYNTHESIZED_PATHS,
  })) {
    pushFailure(failures, FIXTURE_CLOSURE_FAILURE_ID, message);
  }

  if (dependencies.failures.length === 0) {
    checkFixtureClosureProjections(
      repoRoot,
      { records, fixturePaths: dependencies.fixturePaths },
      failures,
    );
  }

  for (const message of diffTriggerPathClosure({
    records,
    entryClosures: dependencies.entryClosures,
  })) {
    pushFailure(failures, TRIGGER_CLOSURE_FAILURE_ID, message);
  }
}
