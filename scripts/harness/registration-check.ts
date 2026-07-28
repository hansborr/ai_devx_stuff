import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isObjectLike } from "../lib/records.js";
import { LINT_AGENT_GUIDANCE_OVERLAYS } from "../lint-agent-guidance.js";
import type { GeneratedSurfaceRecord } from "./generated-surfaces.js";
import { type ControlFailures, formatFailures } from "./harness-check-validation.js";
import { readHarnessManifest } from "./harness-manifest.js";
import { loadLocalRuleConfig, type LocalRuleConfig } from "./local-rule-config.js";
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
}

export interface RegistrationCheckResult {
  readonly failures: Map<string, ControlFailures>;
  readonly state: ManifestRegistrationState;
  readonly generatedSurfaces: readonly GeneratedSurfaceRecord[];
}

function loadPackageScripts(repoRoot: string): Map<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  if (!isObjectLike(parsed) || !isObjectLike(parsed.scripts)) {
    throw new Error("package.json must declare a scripts object");
  }
  const scripts = new Map<string, string>();
  for (const [name, command] of Object.entries(parsed.scripts)) {
    if (typeof command === "string") scripts.set(name, command);
  }
  return scripts;
}

export async function loadRegistrationCheckInputs(
  repoRoot: string,
): Promise<RegistrationCheckInputs> {
  const { lintRatchets } = await import("../lint-ratchet/lint-ratchet-config.js");
  return {
    repoRoot,
    rawManifest: readHarnessManifest(repoRoot),
    scripts: loadPackageScripts(repoRoot),
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
