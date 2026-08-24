// Validates harness.controls.json against the live tree:
//  - every control's source path exists and is under repoRoot;
//  - every control's pairedGuide exists or is the "none" sentinel;
//  - every lint-rule entry's ruleName resolves to a real local plugin rule;
//  - every codemod entry's repairCommand is a real package.json script;
//  - parity (rules): every local/* rule has a lint-rule manifest entry;
//  - parity (overlays): every lint-agent guidance overlay has a manifest control;
//  - parity (scripts): every package.json script under the documented
//    control-prefix conventions has a manifest entry, is a generatedSurface
//    checkScript alias of one, or sits in the scriptParityExemptions escape
//    for one-off operational utilities (redundant alias-covered exemptions
//    fail so the list cannot silently re-grow);
//  - parity (doctor): every doctor-check id emitted by doctor.sh is declared
//    in the manifest and every manifest doctor check is still emitted;
//  - parity (porting): every Porting This checklist id has a greppable source
//    marker and every source marker remains documented;
//  - freshness: every generatedSurface entry in harness.controls.json is current.
//
// Run via `bun run harness:check`. Exits non-zero on any failure with a
// per-control diagnostic list so the harness gates surface drift loudly.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkFixtureCopyClosure } from "./harness/fixture-closure-check.js";
import { VERIFY_STEP_PROJECTIONS } from "./harness/generate-verify-steps.js";
import { type ControlFailures, pushFailure } from "./harness/harness-check-validation.js";
import { checkCiGateParity } from "./harness/harness-gate-parity.js";
import {
  CLAUDE_SETTINGS_PATH,
  CODEX_HOOKS_PATH,
  COPILOT_HOOKS_PATH,
} from "./harness/harness-paths.js";
import { checkManifestReadTripwire } from "./harness/manifest-contract-check.js";
import { checkPortingKnobParity } from "./harness/porting-knob-parity.js";
import {
  formatRegistrationFailures,
  loadRegistrationCheckInputs,
  runRegistrationChecks,
} from "./harness/registration-check.js";
import { checkRegistrationPreflightWiring } from "./harness/registration-preflight-wiring.js";

const PROCESS_ARG_OFFSET = 2;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Failure-bucket label for the hook-wiring generator, which writes all three
// harness hook configs; built from their shared path constants so it stays in
// lockstep with the generator and path-policy.
const HOOK_WIRING_OUTPUTS_LABEL = [CLAUDE_SETTINGS_PATH, CODEX_HOOKS_PATH, COPILOT_HOOKS_PATH].join(
  " + ",
);

// Shared spawn-and-collect step for freshness/structure checks that shell out:
// a spawn error, a nonzero exit, and silent failure all surface as pushed
// failures under the caller's output id.
type SpawnedSurfaceCheck = {
  readonly outputId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly displayCommand: string;
};

function checkSpawnedSurface(
  failures: Map<string, ControlFailures>,
  { outputId, command, args, displayCommand }: SpawnedSurfaceCheck,
): void {
  const result = spawnSync(command, [...args], { cwd: repoRoot, encoding: "utf8" });
  if (result.error !== undefined) {
    pushFailure(failures, outputId, `failed to run ${displayCommand}: ${result.error.message}`);
    return;
  }
  if (result.status === 0) return;

  const output = [result.stdout.trim(), result.stderr.trim()].filter((text) => text.length > 0);
  pushFailure(
    failures,
    outputId,
    output.length > 0
      ? output.join("\n")
      : `${displayCommand} exited with status ${String(result.status)}`,
  );
}

function checkGeneratedFreshnessOutputs(
  records: readonly { readonly outputPaths: readonly string[]; readonly checkScript: string }[],
  failures: Map<string, ControlFailures>,
): void {
  for (const record of records) {
    checkSpawnedSurface(failures, {
      outputId: record.outputPaths.join(" + "),
      command: "bun",
      args: ["run", record.checkScript],
      displayCommand: `bun run ${record.checkScript}`,
    });
  }
}

function checkGeneratedHookWiringStructure(failures: Map<string, ControlFailures>): void {
  const scriptPath = "scripts/ai-hooks/check-wiring.sh";
  checkSpawnedSurface(failures, {
    outputId: HOOK_WIRING_OUTPUTS_LABEL,
    command: "bash",
    args: [scriptPath],
    displayCommand: scriptPath,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(PROCESS_ARG_OFFSET).filter((arg) => arg !== "--");
  if (args.length > 0) {
    console.error(`harness:check: unknown argument(s): ${args.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const inputs = await loadRegistrationCheckInputs(repoRoot);
  const { failures, state, generatedSurfaces } = runRegistrationChecks(inputs);
  for (const failure of checkManifestReadTripwire(repoRoot)) {
    pushFailure(failures, "harness.controls.json read tripwire", failure);
  }
  for (const failure of checkRegistrationPreflightWiring({
    hookSource: readFileSync(join(repoRoot, ".husky/pre-commit"), "utf8"),
    engineSource: readFileSync(join(repoRoot, "scripts/lib/verify-engine.sh"), "utf8"),
    collectorSource: readFileSync(
      join(repoRoot, "scripts/harness/registration-generated-checks.ts"),
      "utf8",
    ),
    fixtureClosureSource: readFileSync(
      join(repoRoot, "scripts/harness/fixture-closure-check.ts"),
      "utf8",
    ),
    packageScripts: inputs.scripts,
    manifest: inputs.rawManifest,
    generatedSurfaces,
    verifyStepProjections: VERIFY_STEP_PROJECTIONS,
  })) {
    pushFailure(failures, "registration preflight wiring", failure);
  }
  checkGeneratedFreshnessOutputs(generatedSurfaces, failures);
  await checkFixtureCopyClosure(repoRoot, generatedSurfaces, failures);
  checkGeneratedHookWiringStructure(failures);
  for (const failure of checkPortingKnobParity(repoRoot)) {
    pushFailure(failures, "porting-knob checklist", failure);
  }
  const expectedCiGates = new Map<string, string>();
  for (const controlId of state.parityConfig.ciGateControlIds) {
    const invocation = state.controlInvocations.get(controlId);
    if (invocation === undefined) {
      pushFailure(
        failures,
        "(CI parity)",
        `ciGateControlIds references ${controlId}, which has no manifest control invocation`,
      );
    } else {
      expectedCiGates.set(controlId, invocation);
    }
  }
  checkCiGateParity(
    readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
    expectedCiGates,
    failures,
  );

  if (failures.size > 0) {
    console.error(formatRegistrationFailures("harness:check", failures));
    process.exitCode = 1;
    return;
  }
  console.log(
    `harness:check OK — ${String(state.controls.length)} control(s) validated; ${String(inputs.localRuleConfig.registeredRuleNames.size)} lint rule(s); ${String(inputs.ratchetIds.size)} ratchet(s); ${String(state.declaredScripts.size)} package.json script(s) declared.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`harness:check: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
