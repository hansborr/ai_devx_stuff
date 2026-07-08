// Single source of truth for repo-root-relative harness file paths.
//
// LEAF module: imports only node builtins so it can be shared by both the
// generators that write these paths and the validators (harness:check,
// path-policy) that assert against them, without risking an import cycle.
// Follow this pattern when adding constants shared across the harness surface
// (see scripts/harness/hook-timeout-constants.ts for the sibling precedent).

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The harness control manifest at the repo root. */
export const HARNESS_MANIFEST_FILENAME = "harness.controls.json";

// Generated output paths, owned here so each generator and harness:check's
// freshness validator agree on the target by construction rather than by
// hand-copied string literals.
export const GENERATED_VERIFY_STEPS_PATH = "scripts/verify/steps.generated.sh";
export const GENERATED_CONFIG_SURFACES_PATH = "tsconfig.configs.json";
export const GENERATED_HARNESS_CONTROLS_DOC_PATH = "docs/generated/harness-controls.md";

// Generated hook-config outputs, shared by the hook generators (which write
// them), harness:check freshness, and path-policy source-relevance.
export const CLAUDE_SETTINGS_PATH = ".claude/settings.json";
export const CODEX_HOOKS_PATH = ".codex/hooks.json";
export const COPILOT_HOOKS_PATH = ".github/hooks/copilot.json";
export const GENERATED_HOOK_TIMEOUT_CONSTANTS_PATH = "scripts/ai-hooks/hook-timeouts.generated.sh";

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
