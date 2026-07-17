// Single source of truth for locating and reading harness.controls.json.
//
// LEAF module: imports only node builtins. Split from harness-paths.ts so the
// portable lint-ratchet copy set can ship the manifest reader without dragging
// along this repo's hook-wiring and generated-output path vocabulary
// (harness-paths.ts keeps those non-portable constants).

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The harness control manifest at the repo root. */
export const HARNESS_MANIFEST_FILENAME = "harness.controls.json";

/** Absolute path to the harness control manifest under `repoRoot`. */
export function harnessManifestPath(repoRoot: string): string {
  return join(repoRoot, HARNESS_MANIFEST_FILENAME);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  if (!isObject(parsed) || !Array.isArray(parsed.controls)) {
    throw new Error(`${HARNESS_MANIFEST_FILENAME} must declare a controls array`);
  }
  return parsed.controls;
}
