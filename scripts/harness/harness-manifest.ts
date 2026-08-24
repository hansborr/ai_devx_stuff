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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isObjectLike } from "../lib/records.js";

/** The harness control manifest at the repo root. */
export const HARNESS_MANIFEST_FILENAME = "harness.controls.json";

/**
 * Generated include owning every `kind: "lint-rule"` control. Lint-rule
 * identity, source and activation mode are all derivable — from the rule files
 * on disk, flat-config enablement, and the ratchet registry — so they are
 * generated (scripts/harness/generate-lint-rule-controls.ts) rather than
 * hand-authored. An include keeps that generator from having to rewrite,
 * reformat, or risk clobbering the 2,800-line hand-authored manifest: the main
 * file owns every other control kind, this one owns lint rules, and
 * `readHarnessManifest` is the single seam that joins them.
 */
export const HARNESS_LINT_RULE_CONTROLS_FILENAME = "harness.controls.lint-rules.generated.json";

/** Absolute path to the harness control manifest under `repoRoot`. */
export function harnessManifestPath(repoRoot: string): string {
  return join(repoRoot, HARNESS_MANIFEST_FILENAME);
}

/**
 * The include's controls, or none when the file is absent.
 *
 * Absence is tolerated because reduced trees legitimately carry a root manifest
 * and no include: the doc-generator smoke (scripts/tests/test-generate-harness-controls.sh)
 * builds most of its failure fixtures that way, and each must fail on the defect
 * it is testing rather than on a missing include. Note this is NOT about a tree
 * with no manifest at all — `readHarnessManifest` throws on the root read long
 * before reaching here; the lint-ratchet smoke fixture, which synthesizes no
 * manifest, never calls this module's readers at all (its only consumer,
 * scripts/lint-ratchet/check-registry.ts, imports `harnessManifestPath` and does
 * its own existsSync). The harness-check fixture does carry an include, so the
 * merge runs end to end there rather than only in unit tests.
 * In the real tree a missing or truncated include cannot pass silently:
 * `harness:check` rule parity fails for every registered `local/*` rule that
 * has no control, and the generator's own `--check` freshness gate fails on the
 * missing output. A malformed include is a hard error here — silently dropping
 * controls from a file that exists is the failure mode worth refusing.
 */
function lintRuleControls(repoRoot: string): unknown[] {
  const includePath = join(repoRoot, HARNESS_LINT_RULE_CONTROLS_FILENAME);
  if (!existsSync(includePath)) return [];
  const parsed: unknown = JSON.parse(readFileSync(includePath, "utf8"));
  if (!isObjectLike(parsed) || !Array.isArray(parsed.controls)) {
    throw new Error(`${HARNESS_LINT_RULE_CONTROLS_FILENAME} must declare a controls array`);
  }
  return parsed.controls;
}

/**
 * Parse the harness manifest at `repoRoot` without shape validation, with the
 * generated lint-rule control include merged in. A root that is not an object
 * with a `controls` array is returned untouched so the callers that report that
 * defect keep their own wording.
 */
export function readHarnessManifest(repoRoot: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(harnessManifestPath(repoRoot), "utf8"));
  if (!isObjectLike(parsed) || !Array.isArray(parsed.controls)) return parsed;
  const included = lintRuleControls(repoRoot);
  if (included.length === 0) return parsed;
  const authored: unknown[] = parsed.controls;
  return { ...parsed, controls: [...authored, ...included] };
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
