import { isObjectLike } from "../lib/records.js";
import type { GeneratedSurfaceRecord } from "./generated-surfaces.js";

export const REGISTRATION_PREFLIGHT_WIRING_REPAIR =
  " Restore the direct registration admission wiring, then run `bun run harness:check`.";

export interface RegistrationPreflightWiringInputs {
  readonly hookSource: string;
  readonly engineSource: string;
  readonly collectorSource: string;
  readonly packageScripts: ReadonlyMap<string, string>;
  readonly manifest: unknown;
  readonly generatedSurfaces: readonly GeneratedSurfaceRecord[];
}

const REGISTRATION_CONTROL_ID = "check/harness-registration-preflight";
const REGISTRATION_SCRIPT = "harness:registration:check";
const REGISTRATION_SCRIPT_COMMAND = "bun run scripts/harness-registration-check.ts";
const VERIFY_GENERATOR_ID = "check/verify-steps-generator";
const IMPORT_AND_USE_OCCURRENCES = 2;
const REQUIRED_REGISTRATION_FRAGMENTS = [
  ["GENERATED_VERIFY_STEPS_PATH", "scripts/verify/steps.generated.sh"],
  ["GENERATED_SURFACE_FRESHNESS_PATH", "scripts/harness/generated-surface-freshness.generated.sh"],
  ["GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH", "scripts/ai-hooks/classified-bun-scripts.generated.sh"],
  [
    "GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH",
    "scripts/tests/harness-check-fixture-manifest.generated.txt",
  ],
] as const;

function failure(message: string): string {
  return `${message}.${REGISTRATION_PREFLIGHT_WIRING_REPAIR}`;
}

function manifestControl(manifest: unknown, id: string): Record<string, unknown> | undefined {
  if (!isObjectLike(manifest) || !Array.isArray(manifest.controls)) return undefined;
  for (const entry of manifest.controls) {
    if (isObjectLike(entry) && entry.id === id) return entry;
  }
  return undefined;
}

function checkFastMarkerSelection(source: string): string | undefined {
  const admissionAssignment = "REGISTRATION_ADMISSION_HOOK='musi_precommit_registration_admission'";
  const snapshotStart = source.indexOf("musi_precommit_snapshot_fast_mode() {\n");
  const snapshotEnd = snapshotStart < 0 ? -1 : source.indexOf("\n}\n", snapshotStart);
  const snapshotFunction =
    snapshotStart < 0 || snapshotEnd < 0
      ? ""
      : source.slice(snapshotStart, snapshotEnd + "\n}\n".length);
  const snapshotFragments = [
    'if [ -f "$(musi_precommit_fast_marker)" ]; then',
    "MUSI_FAST_COMMIT_ENABLED_SNAPSHOT=1",
    "FAST_COMMIT_RECORD_PENDING=1",
    "snapshot_rc=0",
    "MUSI_FAST_COMMIT_ENABLED_SNAPSHOT=0",
    "FAST_COMMIT_RECORD_PENDING=0",
    "snapshot_rc=1",
    "musi_warn_generated_surfaces_stale || true",
    'return "$snapshot_rc"',
  ] as const;
  if (
    snapshotFragments.some((fragment) => !snapshotFunction.includes(fragment)) ||
    !source.includes('[ "${MUSI_FAST_COMMIT_ENABLED_SNAPSHOT:-0}" -eq 1 ]') ||
    occurrenceCount(source, admissionAssignment) !== 1 ||
    !source.includes("[pre_cache_admission_condition]='musi_precommit_snapshot_fast_mode'")
  ) {
    return failure(
      "pre-commit does not bind registration admission and provenance to one under-lock fast-mode snapshot",
    );
  }
  return undefined;
}

function checkHookWiring(source: string): string | undefined {
  const policyBinding = '[pre_cache_admission_hook]="$REGISTRATION_ADMISSION_HOOK"';
  if (!source.includes(policyBinding)) {
    return failure("pre-commit does not bind the registration admission into the gate policy");
  }
  if (
    !/timeout --foreground --signal=TERM --kill-after=1s 5s\s+(?:\\\s*)?bun run harness:registration:check/u.test(
      source,
    )
  ) {
    return failure("pre-commit does not run the direct registration command with its 5s timeout");
  }
  const unstaged = source.indexOf("musi_changed_gate_fail_if_unstaged");
  const sourceRelevant = source.indexOf("musi_staged_has_source_relevant_change");
  const binding = source.indexOf(policyBinding);
  const gate = source.lastIndexOf("musi_verify_run_gate PRECOMMIT_GATE_POLICY");
  if (
    unstaged < 0 ||
    sourceRelevant < 0 ||
    binding < 0 ||
    gate < 0 ||
    !(unstaged < sourceRelevant && sourceRelevant < binding && binding < gate)
  ) {
    return failure(
      "pre-commit registration admission is not ordered after rejection/source selection and before gate dispatch",
    );
  }
  return undefined;
}

function checkEngineWiring(source: string): string | undefined {
  const admission = source.indexOf('musi_verify_gate_run_pre_cache_admission "$policy_name"');
  const marker = source.indexOf('if [ -f "${policy_ref[marker_path]}" ]');
  const bridge = source.indexOf('if [ -n "${policy_ref[bridge_predicate]:-}" ]');
  if (admission < 0 || marker < 0 || bridge < 0 || !(admission < marker && marker < bridge)) {
    return failure(
      "verify engine admission is not called before native-marker and bridge evaluation",
    );
  }
  return undefined;
}

function checkManifestWiring(inputs: RegistrationPreflightWiringInputs): string | undefined {
  if (inputs.packageScripts.get(REGISTRATION_SCRIPT) !== REGISTRATION_SCRIPT_COMMAND) {
    return failure(
      `package.json ${REGISTRATION_SCRIPT} does not run ${REGISTRATION_SCRIPT_COMMAND}`,
    );
  }
  const control = manifestControl(inputs.manifest, REGISTRATION_CONTROL_ID);
  if (
    control?.source !== "scripts/harness-registration-check.ts" ||
    control.invocation !== `bun run ${REGISTRATION_SCRIPT}`
  ) {
    return failure(`harness.controls.json does not declare ${REGISTRATION_CONTROL_ID} exactly`);
  }
  return undefined;
}

function occurrenceCount(source: string, token: string): number {
  return source.split(token).length - 1;
}

function checkFragmentCoverage(inputs: RegistrationPreflightWiringInputs): string | undefined {
  const verifyGenerator = inputs.generatedSurfaces.find(
    (record) => record.id === VERIFY_GENERATOR_ID,
  );
  for (const [constant, outputPath] of REQUIRED_REGISTRATION_FRAGMENTS) {
    if (
      occurrenceCount(inputs.collectorSource, constant) < IMPORT_AND_USE_OCCURRENCES ||
      verifyGenerator === undefined ||
      !verifyGenerator.outputPaths.includes(outputPath)
    ) {
      return failure(`registration fragment coverage is missing ${outputPath}`);
    }
  }
  return undefined;
}

export function checkRegistrationPreflightWiring(
  inputs: RegistrationPreflightWiringInputs,
): readonly string[] {
  for (const check of [
    checkFastMarkerSelection(inputs.hookSource),
    checkHookWiring(inputs.hookSource),
    checkEngineWiring(inputs.engineSource),
    checkManifestWiring(inputs),
    checkFragmentCoverage(inputs),
  ]) {
    if (check !== undefined) return [check];
  }
  return [];
}
