import { isObjectLike } from "../lib/records.js";
import {
  checkAgentOverlayControlParity,
  checkDoctorParity,
  checkRatchetParity,
  checkRuleParity,
  extractBunRunScript,
  isNonEmptyString,
  type ManifestCheckContext,
  pushFailure,
  type RawControl,
  validateControlShape,
  validateLintRuleEntry,
  validateNonLintEntry,
  validateRatchetEntry,
  validateSourceField,
} from "./harness-check-validation.js";
import {
  checkScriptParity,
  type HarnessParityConfig,
  parseHarnessParityConfig,
} from "./harness-gate-parity.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";
import type { LocalRuleConfig } from "./local-rule-config.js";

const CONTROL_PREFIX_PATTERN =
  /^(sensor|verify|codemod|drift|logs|doctor|module|docs|db|worktree|harness|lint):/u;

export interface ManifestRegistrationInputs {
  readonly repoRoot: string;
  readonly rawManifest: unknown;
  readonly scripts: ReadonlyMap<string, string>;
  readonly localRuleConfig: LocalRuleConfig;
  readonly ratchetIds: ReadonlySet<string>;
  readonly overlayRuleIds: ReadonlySet<string>;
  readonly doctorSource: string;
}

export interface ManifestRegistrationState {
  readonly controls: readonly RawControl[];
  readonly declaredScripts: ReadonlySet<string>;
  readonly declaredControlIds: ReadonlySet<string>;
  readonly controlInvocations: ReadonlyMap<string, string>;
  readonly parityConfig: HarnessParityConfig;
}

interface DeclaredControlSets {
  readonly scripts: Set<string>;
  readonly rules: Set<string>;
  readonly ratchets: Set<string>;
}

function manifestControls(
  rawManifest: unknown,
  failures: ManifestCheckContext["failures"],
): RawControl[] {
  if (!isObjectLike(rawManifest) || !Array.isArray(rawManifest.controls)) return [];
  const controls: RawControl[] = [];
  for (const [index, entry] of rawManifest.controls.entries()) {
    if (isObjectLike(entry)) controls.push(entry);
    else {
      pushFailure(
        failures,
        "(manifest schema)",
        `harness.controls.json: control entry at index ${String(index)} is not an object; repair harness.controls.json`,
      );
    }
  }
  return controls;
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
      `invocation references unknown package.json script: ${scriptName}; repair package.json or harness.controls.json`,
    );
    return;
  }
  declaredScripts.add(scriptName);
}

interface LintRuleInvocationCheck {
  readonly raw: RawControl;
  readonly id: string;
  readonly ruleName: string;
  readonly enabledRuleNames: ReadonlySet<string>;
}

function validateLintRuleInvocation(
  options: LintRuleInvocationCheck,
  context: ManifestCheckContext,
): void {
  if (!isNonEmptyString(options.raw.invocation)) return;
  const scriptName = extractBunRunScript(options.raw.invocation);
  if (scriptName !== "lint" && scriptName !== "lint:changed") return;
  if (options.enabledRuleNames.has(options.ruleName)) return;
  pushFailure(
    context.failures,
    options.id,
    `invocation ${options.raw.invocation} claims normal ESLint coverage, but ${options.ruleName} is not enabled in eslint.config.js; use bun run lint:ratchet or enable the rule in flat config`,
  );
}

function validateManifestControl(
  raw: RawControl,
  inputs: ManifestRegistrationInputs,
  declared: DeclaredControlSets,
  context: ManifestCheckContext,
): void {
  const shape = validateControlShape(raw, context.failures);
  if (shape === undefined) return;
  const { id, kind } = shape;
  validateSourceField(context.repoRoot, id, raw.source, context.failures);
  if (kind === "lint-rule") {
    const lintEntry = validateLintRuleEntry(
      raw,
      id,
      inputs.localRuleConfig.registeredRuleNames,
      context.failures,
    );
    if (lintEntry !== undefined) {
      declared.rules.add(lintEntry.ruleName);
      validateLintRuleInvocation(
        {
          raw,
          id,
          ruleName: lintEntry.ruleName,
          enabledRuleNames: inputs.localRuleConfig.enabledRuleNames,
        },
        context,
      );
    }
    if (!isNonEmptyString(raw.invocation)) {
      pushFailure(context.failures, id, "invocation must be a non-empty string");
    }
  } else if (kind === "ratchet") {
    validateRatchetEntry(raw, id, inputs.ratchetIds, context);
    if (inputs.ratchetIds.has(id)) declared.ratchets.add(id);
  } else {
    validateNonLintEntry(raw, id, context);
  }
  recordInvocationScript(raw, id, declared.scripts, context);
}

export function collectManifestRegistrationFailures(
  inputs: ManifestRegistrationInputs,
  failures: ManifestCheckContext["failures"],
  aliasScripts: ReadonlySet<string>,
): ManifestRegistrationState {
  const schemaResult = safeParseHarnessManifest(inputs.rawManifest);
  for (const failure of schemaResult.failures ?? []) {
    pushFailure(failures, "(manifest schema)", `${failure}; repair harness.controls.json`);
  }
  const controls = manifestControls(inputs.rawManifest, failures);
  const context: ManifestCheckContext = {
    repoRoot: inputs.repoRoot,
    scripts: inputs.scripts,
    failures,
  };
  const declared: DeclaredControlSets = {
    scripts: new Set(),
    rules: new Set(),
    ratchets: new Set(),
  };
  const declaredControlIds = new Set<string>();
  const controlInvocations = new Map<string, string>();
  for (const raw of controls) {
    if (isNonEmptyString(raw.id)) {
      declaredControlIds.add(raw.id);
      if (isNonEmptyString(raw.invocation)) controlInvocations.set(raw.id, raw.invocation);
    }
    validateManifestControl(raw, inputs, declared, context);
  }
  checkRuleParity(inputs.localRuleConfig.registeredRuleNames, declared.rules, failures);
  checkAgentOverlayControlParity(inputs.overlayRuleIds, declaredControlIds, failures);
  checkRatchetParity(inputs.ratchetIds, declared.ratchets, failures);
  checkDoctorParity(
    inputs.doctorSource,
    new Set([...declaredControlIds].filter((id) => id.startsWith("doctor-check/"))),
    failures,
  );
  const parityConfig = parseHarnessParityConfig(inputs.rawManifest, failures);
  checkScriptParity(
    {
      controlPrefixPattern: CONTROL_PREFIX_PATTERN,
      exemptScripts: parityConfig.scriptParityExemptions,
      declaredScripts: declared.scripts,
      aliasScripts,
    },
    context,
  );
  return {
    controls,
    declaredScripts: declared.scripts,
    declaredControlIds,
    controlInvocations,
    parityConfig,
  };
}
