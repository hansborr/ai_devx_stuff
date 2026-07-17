// Validates harness.controls.json against the live tree:
//  - every control's source path exists and is under repoRoot;
//  - every control's pairedGuide exists or is the "none" sentinel;
//  - every lint-rule entry's ruleName resolves to a real local plugin rule;
//  - every codemod entry's repairCommand is a real package.json script;
//  - parity (rules): every local/* rule has a lint-rule manifest entry;
//  - parity (overlays): every lint-agent guidance overlay has a manifest control;
//  - parity (scripts): every package.json script under the documented
//    control-prefix conventions has a manifest entry (with an explicit
//    EXEMPT_SCRIPTS escape for one-off operational utilities);
//  - parity (doctor): every doctor-check id emitted by doctor.sh is declared
//    in the manifest and every manifest doctor check is still emitted;
//  - parity (porting): every Porting This checklist id has a greppable source
//    marker and every source marker remains documented;
//  - freshness: generated verify step data, AI hook wiring, local lint
//    guidance, the harness-controls doc, the restricted-disable rule list,
//    the config-surface tsconfig (tsconfig.configs.json), generated hook
//    timeout constants, skill mirrors, and smoke-subject metadata are up to date.
//
// Run via `bun run harness:check`. Exits non-zero on any failure with a
// per-control diagnostic list so the harness gates surface drift loudly.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkSkillInventory } from "./harness/check-skill-inventory.js";
import { GENERATED_SURFACE_FRESHNESS } from "./harness/generated-surface-freshness.js";
import type {
  ControlFailures,
  ManifestCheckContext,
  RawControl,
} from "./harness/harness-check-validation.js";
import {
  checkAgentOverlayControlParity,
  checkDoctorParity,
  checkRatchetParity,
  checkRuleParity,
  extractBunRunScript,
  formatFailures,
  isNonEmptyString,
  pushFailure,
  validateControlShape,
  validateLintRuleEntry,
  validateNonLintEntry,
  validateRatchetEntry,
  validateSourceField,
} from "./harness/harness-check-validation.js";
import {
  checkCiGateParity,
  checkScriptParity,
  parseHarnessParityConfig,
} from "./harness/harness-gate-parity.js";
import {
  HARNESS_MANIFEST_FILENAME,
  loadHarnessManifest,
  readHarnessManifest,
} from "./harness/harness-manifest.js";
import {
  CLAUDE_SETTINGS_PATH,
  CODEX_HOOKS_PATH,
  COPILOT_HOOKS_PATH,
} from "./harness/harness-paths.js";
import { loadLocalRuleConfig } from "./harness/local-rule-config.js";
import { checkPortingKnobParity } from "./harness/porting-knob-parity.js";
import { LINT_AGENT_GUIDANCE_OVERLAYS } from "./lint-agent-guidance.js";

const PROCESS_ARG_OFFSET = 2;

const CONTROL_PREFIX_PATTERN =
  /^(sensor|verify|codemod|drift|logs|doctor|module|docs|db|worktree|harness|lint):/u;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(repoRoot, "package.json");
const eslintConfigPath = join(repoRoot, "eslint.config.js");

// Failure-bucket label for the hook-wiring generator, which writes all three
// harness hook configs; built from their shared path constants so it stays in
// lockstep with the generator and path-policy.
const HOOK_WIRING_OUTPUTS_LABEL = [CLAUDE_SETTINGS_PATH, CODEX_HOOKS_PATH, COPILOT_HOOKS_PATH].join(
  " + ",
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadPackageScripts(): Map<string, string> {
  const text = readFileSync(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || !isObject(parsed.scripts)) {
    throw new Error("package.json must declare a scripts object");
  }
  const scripts = new Map<string, string>();
  for (const [name, command] of Object.entries(parsed.scripts)) {
    if (typeof command === "string") scripts.set(name, command);
  }
  return scripts;
}

function loadManifest(): RawControl[] {
  const controls: RawControl[] = [];
  for (const [index, entry] of loadHarnessManifest(repoRoot).entries()) {
    if (!isObject(entry)) {
      throw new Error(
        `${HARNESS_MANIFEST_FILENAME}: control entry at index ${String(index)} is not an object`,
      );
    }
    controls.push(entry);
  }
  return controls;
}

function checkGeneratedFreshness(
  failures: Map<string, ControlFailures>,
  outputId: string,
  checkScript: string,
): void {
  const result = spawnSync("bun", ["run", checkScript], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    pushFailure(
      failures,
      outputId,
      `failed to run bun run ${checkScript}: ${result.error.message}`,
    );
    return;
  }
  if (result.status === 0) return;

  const output = [result.stdout.trim(), result.stderr.trim()].filter((text) => text.length > 0);
  pushFailure(
    failures,
    outputId,
    output.length > 0
      ? output.join("\n")
      : `bun run ${checkScript} exited with status ${String(result.status)}`,
  );
}

function checkGeneratedFreshnessOutputs(failures: Map<string, ControlFailures>): void {
  for (const entry of GENERATED_SURFACE_FRESHNESS) {
    checkGeneratedFreshness(failures, entry.outputPaths.join(" + "), entry.checkScript);
  }
}

function checkGeneratedHookWiringStructure(failures: Map<string, ControlFailures>): void {
  const scriptPath = "scripts/ai-hooks/check-wiring.sh";
  const result = spawnSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    pushFailure(
      failures,
      HOOK_WIRING_OUTPUTS_LABEL,
      `failed to run ${scriptPath}: ${result.error.message}`,
    );
    return;
  }
  if (result.status === 0) return;

  const output = [result.stdout.trim(), result.stderr.trim()].filter((text) => text.length > 0);
  pushFailure(
    failures,
    HOOK_WIRING_OUTPUTS_LABEL,
    output.length > 0
      ? output.join("\n")
      : `${scriptPath} exited with status ${String(result.status)}`,
  );
}

function checkManifestSkillInventory(
  controls: readonly RawControl[],
  failures: Map<string, ControlFailures>,
): void {
  for (const failure of checkSkillInventory(repoRoot, { controls })) {
    pushFailure(failures, "skill mirrors and filesystem inventory", failure);
  }
}

interface DeclaredControlSets {
  readonly scripts: Set<string>;
  readonly rules: Set<string>;
  readonly ratchets: Set<string>;
}

interface ManifestValidationState {
  readonly context: ManifestCheckContext;
  readonly ruleNames: ReadonlySet<string>;
  readonly enabledLintRuleNames: ReadonlySet<string>;
  readonly ratchetIds: ReadonlySet<string>;
  readonly declared: DeclaredControlSets;
}

interface LintRuleInvocationValidation {
  readonly raw: RawControl;
  readonly id: string;
  readonly ruleName: string;
  readonly enabledLintRuleNames: ReadonlySet<string>;
  readonly context: ManifestCheckContext;
}

function recordInvocationScript(
  raw: RawControl,
  id: string,
  declaredScripts: Set<string>,
  context: ManifestCheckContext,
): void {
  if (!isNonEmptyString(raw.invocation)) return;
  const scriptName = extractBunRunScript(raw.invocation);
  if (scriptName === undefined) return;
  if (!context.scripts.has(scriptName)) {
    pushFailure(
      context.failures,
      id,
      `invocation references unknown package.json script: ${scriptName}`,
    );
    return;
  }
  declaredScripts.add(scriptName);
}

function validateLintRuleInvocation(options: LintRuleInvocationValidation): void {
  const { raw, id, ruleName, enabledLintRuleNames, context } = options;
  if (!isNonEmptyString(raw.invocation)) return;
  const scriptName = extractBunRunScript(raw.invocation);
  if (scriptName !== "lint" && scriptName !== "lint:changed") return;
  if (enabledLintRuleNames.has(ruleName)) return;
  pushFailure(
    context.failures,
    id,
    `invocation ${raw.invocation} claims normal ESLint coverage, but ${ruleName} is not enabled in eslint.config.js; use bun run lint:ratchet or enable the rule in flat config`,
  );
}

function validateManifestControl(raw: RawControl, state: ManifestValidationState): void {
  const { context, ruleNames, enabledLintRuleNames, ratchetIds, declared } = state;
  const shape = validateControlShape(raw, context.failures);
  if (shape === undefined) return;
  const { id, kind } = shape;
  validateSourceField(context.repoRoot, id, raw.source, context.failures);

  if (kind === "lint-rule") {
    const lintEntry = validateLintRuleEntry(raw, id, ruleNames, context.failures);
    if (lintEntry !== undefined) {
      declared.rules.add(lintEntry.ruleName);
      validateLintRuleInvocation({
        raw,
        id,
        ruleName: lintEntry.ruleName,
        enabledLintRuleNames,
        context,
      });
    }
    if (!isNonEmptyString(raw.invocation)) {
      pushFailure(context.failures, id, "invocation must be a non-empty string");
    }
  } else if (kind === "ratchet") {
    validateRatchetEntry(raw, id, ratchetIds, context);
    if (ratchetIds.has(id)) declared.ratchets.add(id);
  } else {
    validateNonLintEntry(raw, id, context);
  }

  recordInvocationScript(raw, id, declared.scripts, context);
}

async function main(): Promise<void> {
  const args = process.argv.slice(PROCESS_ARG_OFFSET).filter((arg) => arg !== "--");
  if (args.length > 0) {
    console.error(`harness:check: unknown argument(s): ${args.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const { lintRatchets } = await import("./lint-ratchet/lint-ratchet-config.js");
  const rawManifest = readHarnessManifest(repoRoot);
  const controls = loadManifest();
  const localRuleConfig = await loadLocalRuleConfig(eslintConfigPath);
  const failures = new Map<string, ControlFailures>();
  const parityConfig = parseHarnessParityConfig(rawManifest, failures);
  const context: ManifestCheckContext = { repoRoot, scripts: loadPackageScripts(), failures };
  const declared: DeclaredControlSets = {
    scripts: new Set<string>(),
    rules: new Set<string>(),
    ratchets: new Set<string>(),
  };
  const ratchetIds = new Set<string>(lintRatchets.map((ratchet) => ratchet.id));
  const declaredControlIds = new Set<string>();
  const controlInvocations = new Map<string, string>();

  for (const raw of controls) {
    if (isNonEmptyString(raw.id)) {
      declaredControlIds.add(raw.id);
      if (isNonEmptyString(raw.invocation)) controlInvocations.set(raw.id, raw.invocation);
    }
    validateManifestControl(raw, {
      context,
      ruleNames: localRuleConfig.registeredRuleNames,
      enabledLintRuleNames: localRuleConfig.enabledRuleNames,
      ratchetIds,
      declared,
    });
  }

  checkRuleParity(localRuleConfig.registeredRuleNames, declared.rules, failures);
  checkAgentOverlayControlParity(
    new Set(LINT_AGENT_GUIDANCE_OVERLAYS.keys()),
    declaredControlIds,
    failures,
  );
  checkRatchetParity(ratchetIds, declared.ratchets, failures);
  checkDoctorParity(
    readFileSync(join(repoRoot, "scripts/doctor.sh"), "utf8"),
    new Set([...declaredControlIds].filter((id) => id.startsWith("doctor-check/"))),
    failures,
  );
  checkGeneratedFreshnessOutputs(failures);
  checkGeneratedHookWiringStructure(failures);
  checkManifestSkillInventory(controls, failures);
  for (const failure of checkPortingKnobParity(repoRoot)) {
    pushFailure(failures, "porting-knob checklist", failure);
  }
  checkScriptParity(
    CONTROL_PREFIX_PATTERN,
    parityConfig.scriptParityExemptions,
    declared.scripts,
    context,
  );
  const expectedCiGates = new Map<string, string>();
  for (const controlId of parityConfig.ciGateControlIds) {
    const invocation = controlInvocations.get(controlId);
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
    console.error(formatFailures(failures));
    process.exitCode = 1;
    return;
  }
  console.log(
    `harness:check OK — ${String(controls.length)} control(s) validated; ${String(declared.rules.size)} lint rule(s); ${String(declared.ratchets.size)} ratchet(s); ${String(declared.scripts.size)} package.json script(s) declared.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`harness:check: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
