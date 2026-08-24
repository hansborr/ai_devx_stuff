// Read-only joined provenance view over the harness registration state.
//
// `harness:registration:check --explain` answers, for one explicitly typed
// selector (a repository path, a control ID, or a package-script name), which
// controls govern it, why a smoke test would be selected for it, which verify
// slot or hook consumes it, and which generated trigger/fixture/output paths
// must stay fresh. Every relation is derived from the same authorities the
// registration check already reads — the parsed manifest, package scripts,
// generatedSurface records, and the path-policy smoke-subject data — never
// from a second manifest or a hand-maintained join table.
//
// This module is the public entry: it resolves the authority surface from the
// registration-check inputs/outputs and builds the deterministic report. The
// report vocabulary lives in registration-explain-model.ts, the per-selector
// match builders in registration-explain-matchers.ts, the renderers in
// registration-explain-render.ts, and the CLI argument grammar in
// registration-explain-cli.ts.

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { SCRIPT_SMOKE_TEST_NAMES } from "../path-policy/path-policy-smoke-subjects.js";
import { SCRIPT_SMOKE_SUBJECTS } from "../path-policy/path-policy-smoke-subjects-data.js";
import {
  isScriptSmokeTestPath,
  normalizePath,
  SMOKE_METADATA_FRESHNESS_TEST_NAME,
} from "../path-policy/smoke-test-files.js";
import {
  allowWalkerlessFixtureDerivation,
  FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV,
} from "./fixture-closure-check.js";
import {
  deriveGeneratedSurfaceDependencies,
  FIXTURE_SYNTHESIZED_PATHS,
} from "./generated-surface-dependencies.js";
import type { GeneratedSurfaceRecord } from "./generated-surfaces.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";
import type { RegistrationCheckInputs, RegistrationCheckResult } from "./registration-check.js";
import {
  controlMatches,
  matchSortKey,
  pathMatches,
  scriptMatches,
} from "./registration-explain-matchers.js";
import {
  EXPLAIN_FORMAT_VERSION,
  type ExplainAuthorities,
  type ExplainFixtureClosure,
  type ExplainMatch,
  type ExplainPathPolicy,
  type ExplainReport,
  type ExplainSelector,
  type ExplainSelectorKind,
} from "./registration-explain-model.js";

export function liveExplainPathPolicy(): ExplainPathPolicy {
  return {
    smokeSubjects: SCRIPT_SMOKE_SUBJECTS,
    smokeTestNames: SCRIPT_SMOKE_TEST_NAMES,
    metadataFreshnessTestName: SMOKE_METADATA_FRESHNESS_TEST_NAME,
    isSmokeTestPath: isScriptSmokeTestPath,
  };
}

export type ResolveExplainAuthoritiesResult =
  | { readonly authorities: ExplainAuthorities; readonly failures?: undefined }
  | { readonly authorities?: undefined; readonly failures: readonly string[] };

export interface ExplainFixtureClosureResolution {
  readonly closure: ExplainFixtureClosure;
  readonly failures: readonly string[];
}

/**
 * Derive the live smoke-fixture copy closure for the explain view, mirroring
 * checkFixtureCopyClosure's boundary rules: a walker-less tree may fall back
 * to declarations alone, but a reduced tree with no declared fixture residue
 * consumes its checked-in projection — which this view does not read — so no
 * fixture closure is derivable there and the mode is reported as a failure.
 * Every failure is returned so resolution can refuse rather than report
 * authoritative-looking fixture omissions.
 */
export async function loadLiveExplainFixtureClosure(
  repoRoot: string,
  records: readonly GeneratedSurfaceRecord[],
): Promise<ExplainFixtureClosureResolution> {
  const allowWalkerless = allowWalkerlessFixtureDerivation();
  const synthesizedPaths = FIXTURE_SYNTHESIZED_PATHS;
  if (allowWalkerless && !records.some((record) => record.fixtureExtras !== undefined)) {
    return {
      closure: { entries: [], synthesizedPaths },
      failures: [
        `fixture provenance is not derivable in this tree: ${FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV}=1 ` +
          "with no declared fixtureExtras means the checked-in fixture projection, not a live " +
          "closure walk, is the fixture authority here, so an explain report cannot make an " +
          "authoritative fixture claim; run --explain from a tree that derives its fixture closure",
      ],
    };
  }
  const dependencies = await deriveGeneratedSurfaceDependencies(repoRoot, records, {
    allowDeclaredFallback: allowWalkerless,
  });
  return {
    closure: { entries: dependencies.entryClosures, synthesizedPaths },
    failures: dependencies.failures,
  };
}

/** The registration-check surfaces the explain model actually reads. */
export type ExplainRegistrationInputs = Pick<RegistrationCheckInputs, "rawManifest" | "scripts">;
export type ExplainRegistrationState = Pick<
  RegistrationCheckResult,
  "failures" | "generatedSurfaces"
>;

/**
 * Join the registration-check inputs/outputs with the path-policy authorities
 * into the explain model's read surface. Fail-closed: an explain report claims
 * its relations (and its empty result) are authoritative over the live
 * registration state, and neither a manifest the schema rejects nor a state
 * carrying registration failures can back that claim — a malformed authority
 * may have contributed nothing to the joined view (for example a rejected
 * generatedSurface facet leaves `generatedSurfaces` empty). Every failure is
 * returned so the caller can refuse loudly instead of reporting
 * authoritative-looking omissions.
 */
export function resolveExplainAuthorities(
  inputs: ExplainRegistrationInputs,
  result: ExplainRegistrationState,
  pathPolicy: ExplainPathPolicy,
  fixtureClosure: ExplainFixtureClosureResolution,
): ResolveExplainAuthoritiesResult {
  const failures: string[] = [];
  const parsed = safeParseHarnessManifest(inputs.rawManifest);
  if (parsed.failures !== undefined) failures.push(...parsed.failures);
  for (const entry of result.failures.values()) {
    for (const message of entry.failures) failures.push(`${entry.id}: ${message}`);
  }
  failures.push(...fixtureClosure.failures);
  if (parsed.manifest === undefined || failures.length > 0) return { failures };
  return {
    authorities: {
      manifest: parsed.manifest,
      scripts: inputs.scripts,
      generatedSurfaces: result.generatedSurfaces,
      pathPolicy,
      fixtureClosure: fixtureClosure.closure,
    },
  };
}

/**
 * Convert backslashes via the shared path-policy normalizer and strip a
 * leading `./`; comparisons elsewhere are exact and heuristic-free.
 */
function normalizeSelectorValue(selector: ExplainSelector): string {
  return selector.kind === "path"
    ? normalizePath(selector.value).replace(/^\.\//u, "")
    : selector.value;
}

export function buildExplainReport(
  selector: ExplainSelector,
  authorities: ExplainAuthorities,
): ExplainReport {
  const value = normalizeSelectorValue(selector);
  const builders: Record<ExplainSelectorKind, () => ExplainMatch[]> = {
    path: () => pathMatches(value, authorities),
    control: () => controlMatches(value, authorities),
    script: () => scriptMatches(value, authorities),
  };
  const matches = builders[selector.kind]().sort((a, b) =>
    compareByCodepoint(matchSortKey(a), matchSortKey(b)),
  );
  return {
    explainVersion: EXPLAIN_FORMAT_VERSION,
    selector: { kind: selector.kind, value },
    matches,
  };
}
