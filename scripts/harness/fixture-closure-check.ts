// harness:check validator for the smoke-fixture copy manifest (slice S4 of the
// generated-surfaces plan): the declared `generatedSurface.fixturePaths` union
// must cover — and not exceed — the computed static import closure of
// scripts/harness-check.ts plus every record's generator source, because the
// scripts/tests/test-harness-check.sh fixture copies exactly that union and
// then runs all of those entry points. The same per-record closure walk feeds
// a second consumer: every generator import must be covered by the record's
// `generatedSurface.triggerPaths` (imports ⊆ triggers), so a new leaf module
// cannot silently escape the pre-commit staleness warner.

import { statSync } from "node:fs";
import { join } from "node:path";

import {
  diffFixtureClosure,
  diffTriggerPathClosure,
  FIXTURE_SYNTHESIZED_PATHS,
  type FixtureClosureEntry,
  type GeneratedSurfaceRecord,
  WALKABLE_SOURCE_PATTERN,
} from "./generated-surfaces.js";
import { type ControlFailures, pushFailure } from "./harness-check-validation.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";

// Failure bucket for every fixture copy-closure diagnostic.
const FIXTURE_CLOSURE_FAILURE_ID = "harness-check fixture copy manifest";
// Failure bucket for trigger-list-vs-import-closure diagnostics: a generator
// import that no triggerPaths entry covers would never stale-warn its outputs.
const TRIGGER_CLOSURE_FAILURE_ID = "generatedSurface triggerPaths closure";
// The fixture resolves these via node_modules symlinks, so the closure walk
// must not pull the packages' own sources into the copy manifest.
const FIXTURE_CLOSURE_EXTERNAL_PACKAGES = ["@musi/lint-ratchet", "zod"] as const;
// The validator's own entry point; also the ownerId marking closure files that
// are shared harness-check infrastructure rather than one generator's inputs.
const FIXTURE_CLOSURE_ROOT_ENTRY = "scripts/harness-check.ts";

/**
 * Explicit opt-out (value must be exactly "1") for trees whose manifest
 * legitimately declares no generatedSurface.fixturePaths — today only the
 * scripts/tests/test-harness-check.sh fixture, whose synthesized manifest
 * declares none and whose tree cannot resolve the `typescript` walker. In the
 * real tree the validator fails closed instead: zero declarations means the
 * copy manifest silently emptied (for example a bad merge), not a clean pass.
 */
export const FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV =
  "MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS";

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function checkFixturePathsAreFiles(
  repoRoot: string,
  records: readonly GeneratedSurfaceRecord[],
  failures: Map<string, ControlFailures>,
): void {
  for (const record of records) {
    for (const path of record.fixturePaths ?? []) {
      // Regular files only: the fixture copy loop runs plain `cp`, so a
      // directory entry (with or without a trailing slash) would abort it.
      if (isRegularFile(join(repoRoot, path))) continue;
      pushFailure(
        failures,
        FIXTURE_CLOSURE_FAILURE_ID,
        `${record.id} generatedSurface.fixturePaths entry does not resolve to a regular file: ${path}`,
      );
    }
  }
}

interface ClosureWalkEntry {
  readonly ownerId: string;
  readonly entry: string;
}

function closureWalkEntries(
  records: readonly GeneratedSurfaceRecord[],
): readonly ClosureWalkEntry[] {
  return [
    { ownerId: FIXTURE_CLOSURE_ROOT_ENTRY, entry: FIXTURE_CLOSURE_ROOT_ENTRY },
    ...records.map((record) => ({ ownerId: record.id, entry: record.source })),
  ].filter(({ entry }) => WALKABLE_SOURCE_PATTERN.test(entry));
}

/**
 * Validate declared fixturePaths against the computed static import closure.
 * `records` comes from the caller's single manifest parse rather than a second
 * read here, so a manifest that fails the typed contract still reaches
 * harness-check's granular per-control diagnostics instead of aborting the run.
 * Zero declarations fail closed: an emptied copy manifest (for example a merge
 * that stripped every fixturePaths facet) must not read as a clean pass. The
 * only sanctioned skip is the explicit
 * `MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS=1` opt-out set by the smoke
 * fixture, whose synthesized manifest declares none and whose tree cannot
 * resolve the `typescript` walker; hence the dynamic walker import below.
 */
export async function checkFixtureCopyClosure(
  repoRoot: string,
  records: readonly GeneratedSurfaceRecord[],
  failures: Map<string, ControlFailures>,
): Promise<void> {
  if (!records.some((record) => record.fixturePaths !== undefined)) {
    if (process.env[FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV] === "1") return;
    pushFailure(
      failures,
      FIXTURE_CLOSURE_FAILURE_ID,
      "no generatedSurface record declares fixturePaths, so the smoke-fixture copy manifest " +
        "is empty and the import-closure walk has nothing to validate; restore the " +
        `fixturePaths declarations in ${HARNESS_MANIFEST_FILENAME} (a merge can drop them ` +
        "silently). Only a fixture tree that cannot run the walker may opt out explicitly " +
        `via ${FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV}=1.`,
    );
    return;
  }
  checkFixturePathsAreFiles(repoRoot, records, failures);

  const { validateSeedImportClosure } = await import("../worktree-seed-import-closure.js");
  const entryClosures: FixtureClosureEntry[] = [];
  for (const { ownerId, entry } of closureWalkEntries(records)) {
    try {
      const { files } = validateSeedImportClosure({
        root: repoRoot,
        entry,
        allowedRoots: ["."],
        allowedFiles: [],
        externalPackages: FIXTURE_CLOSURE_EXTERNAL_PACKAGES,
        nonStaticSpecifiers: "skip",
      });
      entryClosures.push({ ownerId, files });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushFailure(
        failures,
        FIXTURE_CLOSURE_FAILURE_ID,
        `failed to walk the import closure of ${entry} (${ownerId}): ${message}`,
      );
    }
  }
  const diffFailures = diffFixtureClosure({
    records,
    entryClosures,
    synthesizedPaths: FIXTURE_SYNTHESIZED_PATHS,
  });
  for (const message of diffFailures) {
    pushFailure(failures, FIXTURE_CLOSURE_FAILURE_ID, message);
  }
  // Same walk, second consumer: every generator import must be covered by the
  // record's triggerPaths so edits to it stale-warn the generated outputs.
  for (const message of diffTriggerPathClosure({ records, entryClosures })) {
    pushFailure(failures, TRIGGER_CLOSURE_FAILURE_ID, message);
  }
}
