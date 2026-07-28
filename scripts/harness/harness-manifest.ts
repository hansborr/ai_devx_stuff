// Single source of truth for locating and reading harness.controls.json.
//
// NEAR-LEAF module: imports node builtins plus the dependency-free record
// guards in scripts/lib/records.ts, and must stay that narrow — FIXTURE COPY
// CLOSURE is the live reason. This file is copied verbatim into two reduced
// trees: the lint-ratchet smoke fixture's portable runtime set
// (PORTABLE_RUNTIME_FILES in scripts/tests/test-lint-ratchet.sh) and the
// harness-check fixture copy manifest (scripts/tests/harness-check-fixture-manifest.generated.txt,
// validated against the real import graph by fixture-closure-check.ts). Every
// import added here lands in both closures — which is why every fixture that
// copies this file must also copy scripts/lib/records.ts to close the sandbox,
// and why the Zod contract lives one layer up in harness-manifest-schema.ts,
// with the two joined in harness-manifest-loader.ts that only trees needing
// shape validation copy.
//
// Split from harness-paths.ts for the same reason: harness-paths.ts keeps this
// repo's hook-wiring and generated-output path vocabulary, which those reduced
// trees have no use for.
//
// Most consumers should NOT import this module directly — see
// docs/guides/harness-manifest-parser.md and the MANIFEST_DIRECT_READERS
// allowlist in manifest-contract-check.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isObjectLike } from "../lib/records.js";

/** The harness control manifest at the repo root. */
export const HARNESS_MANIFEST_FILENAME = "harness.controls.json";

/** Absolute path to the harness control manifest under `repoRoot`. */
export function harnessManifestPath(repoRoot: string): string {
  return join(repoRoot, HARNESS_MANIFEST_FILENAME);
}

/** Parse the harness manifest at `repoRoot` without shape validation. */
export function readHarnessManifest(repoRoot: string): unknown {
  return JSON.parse(readFileSync(harnessManifestPath(repoRoot), "utf8"));
}

/**
 * Read the manifest and return its `controls` array, throwing the shared
 * "must declare a controls array" error when the root is not an object or the
 * `controls` field is not an array. Callers layer their own per-entry
 * validation on top of the returned `unknown[]`.
 */
export function loadHarnessManifest(repoRoot: string): unknown[] {
  const parsed = readHarnessManifest(repoRoot);
  if (!isObjectLike(parsed) || !Array.isArray(parsed.controls)) {
    throw new Error(`${HARNESS_MANIFEST_FILENAME} must declare a controls array`);
  }
  return parsed.controls;
}
