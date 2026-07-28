// The sanctioned read seam for harness.controls.json: the ONE module that
// joins the two halves of the manifest contract.
//
//   harness-manifest.ts        path + IO, no shape opinion (dependency-free leaf)
//   harness-manifest-schema.ts shape, no IO (pure Zod contract)
//   this module                read + parse, so consumers get a HarnessManifest
//
// Splitting IO from shape keeps each half independently testable and keeps the
// leaf free of non-builtin imports; joining them in exactly one place is what
// lets `MANIFEST_DIRECT_READERS` (manifest-contract-check.ts) stay a short,
// shrink-only allowlist instead of growing a new partial, cast-backed picture
// of the manifest per consumer. New manifest consumers import from HERE and do
// not appear in that allowlist at all.
//
// Consumer-owned validation still layers on top: facet parsing
// (generated-surfaces.ts, hook-wiring-schema.ts, skill-inventory-schema.ts,
// verify-step-schema.ts) and every live-tree comparison in harness-check keep
// their own aggregated, test-pinned diagnostics.

import { existsSync } from "node:fs";

import { harnessManifestPath, readHarnessManifest } from "./harness-manifest.js";
import { type HarnessManifest, parseHarnessManifest } from "./harness-manifest-schema.js";

export type { HarnessManifest };

/**
 * Read and strictly parse the manifest under `repoRoot`.
 *
 * Throws on a missing or unreadable file (the underlying `fs`/JSON error) and
 * on any schema failure, in which case the message lists EVERY failure so one
 * run surfaces a whole registration mistake.
 */
export function loadTypedHarnessManifest(repoRoot: string): HarnessManifest {
  return parseHarnessManifest(readHarnessManifest(repoRoot));
}

/**
 * {@link loadTypedHarnessManifest} for trees that may legitimately carry no
 * manifest at all (the lint-ratchet registry check runs against such trees):
 * absence yields `undefined`, while a manifest that exists but does not parse
 * still throws. The existence probe lives here so no consumer needs the
 * manifest path — a path plus `readFileSync` is exactly the bypass shape
 * `MANIFEST_DIRECT_READERS` exists to keep rare.
 */
export function loadTypedHarnessManifestIfPresent(repoRoot: string): HarnessManifest | undefined {
  if (!existsSync(harnessManifestPath(repoRoot))) return undefined;
  return loadTypedHarnessManifest(repoRoot);
}
