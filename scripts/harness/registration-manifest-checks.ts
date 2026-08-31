import { isObjectLike } from "../lib/records.js";
import {
  collectCommandCatalogCoverageFailures,
  type CommandCatalogCoverageInputs,
  type PackageManifestScripts,
} from "./command-catalog.js";
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
  /**
   * Every TRACKED package.json and its scripts. Script parity above only sees
   * the root manifest and only the control-prefixed keys; the command-catalog
   * coverage rule below sees every script in every manifest, which is what
   * makes "no command lands undocumented" hold for `dev`, `test:*` and the
   * workspace packages too.
   */
  readonly packageManifests: readonly PackageManifestScripts[];
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
  /** Script -> how many controls declare it; the catalog reads the count. */
  readonly scriptControlCounts: Map<string, number>;
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
  declared: DeclaredControlSets,
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
  declared.scripts.add(scriptName);
  declared.scriptControlCounts.set(
    scriptName,
    (declared.scriptControlCounts.get(scriptName) ?? 0) + 1,
  );
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
  recordInvocationScript(raw, id, declared, context);
}

/**
 * Control invocations plus generatedSurface checkScript aliases, counted per
 * script. An alias is a source of its own — it documents the `--check` twin —
 * so it counts alongside any invocation that names the same script.
 */
function controlScriptCounts(
  invocationCounts: ReadonlyMap<string, number>,
  aliasScripts: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const counts = new Map(invocationCounts);
  for (const script of aliasScripts) counts.set(script, (counts.get(script) ?? 0) + 1);
  return counts;
}

/**
 * Exactly one metadata source per script key, across every tracked manifest —
 * and, where several controls declare one script, an authored entry saying what
 * the command itself is for. Reported under its own `(command catalog)` heading rather than `(parity)`:
 * the two rules answer different questions — parity asks whether an
 * enforcement-shaped script is registered as a control, coverage asks whether
 * ANY script says what it is for — and a reader repairing one should not have
 * to sort the other's failures out of the same list.
 */
function checkCommandCatalogCoverage(
  inputs: CommandCatalogCoverageInputs,
  failures: ManifestCheckContext["failures"],
): void {
  for (const failure of collectCommandCatalogCoverageFailures(inputs)) {
    pushFailure(failures, "(command catalog)", failure);
  }
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
    scriptControlCounts: new Map(),
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
  checkCommandCatalogCoverage(
    {
      manifests: inputs.packageManifests,
      controlScripts: controlScriptCounts(declared.scriptControlCounts, aliasScripts),
      catalog: schemaResult.manifest?.commandCatalog ?? [],
    },
    failures,
  );
  return {
    controls,
    declaredScripts: declared.scripts,
    declaredControlIds,
    controlInvocations,
    parityConfig,
  };
}
