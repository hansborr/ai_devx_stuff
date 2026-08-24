import { isObjectLike } from "../lib/records.js";
import { isNonEmptyString } from "./control-field-validation.js";
import {
  checkAgentOverlayControlParity,
  checkDoctorParity,
  checkRatchetParity,
  checkRuleParity,
  extractBunRunScript,
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
import {
  HARNESS_LINT_RULE_CONTROLS_FILENAME,
  HARNESS_MANIFEST_FILENAME,
} from "./harness-manifest.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";
import type { LocalRuleConfig } from "./local-rule-config.js";

const CONTROL_PREFIX_PATTERN =
  /^(sensor|verify|codemod|drift|logs|doctor|module|docs|db|worktree|harness|lint):/u;

/**
 * Where to repair a control the schema rejected.
 *
 * These diagnostics run against the ASSEMBLED manifest, so the entry they name
 * can sit in either owner file: harness.controls.json owns every kind except
 * lint-rule, and the generated include owns those. Naming only the root file
 * sends a reader chasing a malformed lint-rule control into a file that no
 * longer contains one — the same misdirection checkRuleParity and doctor.sh
 * were corrected for, so the sibling messages here read the same way.
 */
const MANIFEST_REPAIR_HINT =
  `repair ${HARNESS_MANIFEST_FILENAME}, or run bun run harness:lint-rule-controls if the ` +
  `entry is a lint-rule control in ${HARNESS_LINT_RULE_CONTROLS_FILENAME}`;

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
        `control entry at index ${String(index)} of the assembled manifest is not an object; ${MANIFEST_REPAIR_HINT}`,
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

/**
 * Activation-mode policy, checked in BOTH directions.
 *
 * The normal-lint direction catches a control promising coverage no gate
 * delivers. The ratchet direction catches the mirror defect the one-directional
 * form let through for as long as it existed: a rule promoted into normal lint
 * whose control still advertises `bun run lint:ratchet`, so the manifest — and
 * the agent-facing control doc generated from it — names a command that is not
 * how the rule is actually enforced. Generation now derives the invocation, so
 * this is the guard on a hand edit to the generated include.
 */
function validateLintRuleInvocation(
  options: LintRuleInvocationCheck,
  context: ManifestCheckContext,
): void {
  if (!isNonEmptyString(options.raw.invocation)) return;
  const scriptName = extractBunRunScript(options.raw.invocation);
  const claimsNormalLint = scriptName === "lint" || scriptName === "lint:changed";
  const enabled = options.enabledRuleNames.has(options.ruleName);
  if (claimsNormalLint === enabled) return;
  pushFailure(
    context.failures,
    options.id,
    claimsNormalLint
      ? `invocation ${options.raw.invocation} claims normal ESLint coverage, but ${options.ruleName} is not enabled in eslint.config.js; use bun run lint:ratchet or enable the rule in flat config`
      : `invocation ${options.raw.invocation} claims ${options.ruleName} is not under normal ESLint coverage, but it is enabled in eslint.config.js; use bun run lint, or run \`bun run harness:lint-rule-controls\` to regenerate the lint-rule controls`,
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
    pushFailure(failures, "(manifest schema)", `${failure}; ${MANIFEST_REPAIR_HINT}`);
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
