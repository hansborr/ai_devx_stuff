import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LINT_AGENT_GUIDANCE_OVERLAYS } from "../lint-agent-guidance.js";
import type { PackageManifestScripts } from "./command-catalog.js";
import type { GeneratedSurfaceRecord } from "./generated-surfaces.js";
import { type ControlFailures, formatFailures } from "./harness-check-validation.js";
import { readHarnessManifest } from "./harness-manifest.js";
import { loadLocalRuleConfig, type LocalRuleConfig } from "./local-rule-config.js";
import { loadPackageManifestSurface } from "./package-manifest-scripts.js";
import {
  collectGeneratedRegistrationFailures,
  type GeneratedRegistrationInputs,
} from "./registration-generated-checks.js";
import {
  collectManifestRegistrationFailures,
  type ManifestRegistrationState,
} from "./registration-manifest-checks.js";

export interface RegistrationCheckInputs extends GeneratedRegistrationInputs {
  readonly localRuleConfig: LocalRuleConfig;
  readonly ratchetIds: ReadonlySet<string>;
  readonly overlayRuleIds: ReadonlySet<string>;
  readonly doctorSource: string;
  readonly packageManifests: readonly PackageManifestScripts[];
}

export interface RegistrationCheckResult {
  readonly failures: Map<string, ControlFailures>;
  readonly state: ManifestRegistrationState;
  readonly generatedSurfaces: readonly GeneratedSurfaceRecord[];
}

/**
 * The root manifest's scripts, taken from the same tracked-manifest surface the
 * command catalog reads rather than re-parsing package.json here: two readers of
 * one file are two views that can disagree.
 */
function rootScripts(manifests: readonly PackageManifestScripts[]): ReadonlyMap<string, string> {
  const root = manifests.find((manifest) => manifest.path === "package.json");
  if (root === undefined) throw new Error("package.json is not a tracked manifest");
  return root.scripts;
}

export async function loadRegistrationCheckInputs(
  repoRoot: string,
): Promise<RegistrationCheckInputs> {
  const { lintRatchets } = await import("../lint-ratchet/lint-ratchet-config.js");
  const packageManifests = loadPackageManifestSurface(repoRoot).manifests;
  return {
    repoRoot,
    rawManifest: readHarnessManifest(repoRoot),
    scripts: rootScripts(packageManifests),
    packageManifests,
    localRuleConfig: await loadLocalRuleConfig(join(repoRoot, "eslint.config.js")),
    ratchetIds: new Set(lintRatchets.map((ratchet) => ratchet.id)),
    overlayRuleIds: new Set(LINT_AGENT_GUIDANCE_OVERLAYS.keys()),
    doctorSource: readFileSync(join(repoRoot, "scripts/doctor.sh"), "utf8"),
    readOutput: (path) => {
      try {
        return readFileSync(join(repoRoot, path), "utf8");
      } catch {
        return "";
      }
    },
  };
}

export function runRegistrationChecks(inputs: RegistrationCheckInputs): RegistrationCheckResult {
  const failures = new Map<string, ControlFailures>();
  const generatedSurfaces = collectGeneratedRegistrationFailures(inputs, failures);
  const state = collectManifestRegistrationFailures(
    inputs,
    failures,
    new Set(generatedSurfaces.map((record) => record.checkScript)),
  );
  return { failures, state, generatedSurfaces };
}

export function collectRegistrationFailures(
  inputs: RegistrationCheckInputs,
): Map<string, ControlFailures> {
  return runRegistrationChecks(inputs).failures;
}

export function formatRegistrationFailures(
  command: "harness:check" | "harness:registration:check",
  failures: ReadonlyMap<string, ControlFailures>,
): string {
  return formatFailures(failures).replace(/^harness:check/u, command);
}
