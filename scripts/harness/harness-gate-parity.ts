import { errorMessage } from "../lib/error-message.js";
import { isRecord } from "../lib/records.js";
import { isNonEmptyString } from "./control-field-validation.js";
import {
  type ControlFailures,
  type ManifestCheckContext,
  pushFailure,
} from "./harness-check-validation.js";

export interface ScriptParityInputs {
  readonly controlPrefixPattern: RegExp;
  readonly exemptScripts: ReadonlySet<string>;
  readonly declaredScripts: ReadonlySet<string>;
  /**
   * Derived from the generatedSurface facets (each record's `checkScript`): a
   * package.json script equal to a facet checkScript is accounted for by that
   * control, with no scriptParityExemptions entry needed. Exemption entries
   * that are also alias-covered fail so the list cannot silently re-grow past
   * what the facet already declares.
   */
  readonly aliasScripts: ReadonlySet<string>;
}

export function checkScriptParity(inputs: ScriptParityInputs, context: ManifestCheckContext): void {
  const { controlPrefixPattern, exemptScripts, declaredScripts, aliasScripts } = inputs;
  for (const name of exemptScripts) {
    if (!context.scripts.has(name)) {
      pushFailure(
        context.failures,
        "(parity)",
        `scriptParityExemptions names unknown package.json script "${name}"`,
      );
    } else if (!controlPrefixPattern.test(name)) {
      pushFailure(
        context.failures,
        "(parity)",
        `scriptParityExemptions includes "${name}", which does not match the control-prefix convention`,
      );
    } else if (aliasScripts.has(name)) {
      pushFailure(
        context.failures,
        "(parity)",
        `scriptParityExemptions includes "${name}", which is already covered as a ` +
          `generatedSurface checkScript alias; remove the redundant exemption`,
      );
    }
  }
  for (const name of context.scripts.keys()) {
    if (!controlPrefixPattern.test(name)) continue;
    if (exemptScripts.has(name) || declaredScripts.has(name) || aliasScripts.has(name)) continue;
    pushFailure(
      context.failures,
      "(parity)",
      `package.json script "${name}" matches the control-prefix convention but is ` +
        `not declared in harness.controls.json and not exempt. Fix one of:\n` +
        `      1. Add a control entry (with "invocation": "bun run ${name}") to ` +
        `harness.controls.json, then run \`bun run docs:harness-controls\`.\n` +
        `      2. If it is the --check twin of a generated surface, declare it as ` +
        `"generatedSurface": { "checkScript": "${name}", ... } on that control record.\n` +
        `      3. If it is an operational utility (not an enforcement gate), add "${name}" ` +
        `to scriptParityExemptions in harness.controls.json.`,
    );
  }
}

export interface HarnessParityConfig {
  readonly scriptParityExemptions: ReadonlySet<string>;
  readonly ciGateControlIds: ReadonlySet<string>;
}

function objectField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, field)?.value;
}

function parseManifestStringSet(
  manifest: unknown,
  field: "scriptParityExemptions" | "ciGateControlIds",
  failures: Map<string, ControlFailures>,
): ReadonlySet<string> {
  const values = objectField(manifest, field);
  if (!Array.isArray(values)) {
    pushFailure(failures, "(manifest parity metadata)", `${field} must be an array`);
    return new Set();
  }
  const parsed = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (!isNonEmptyString(value)) {
      pushFailure(
        failures,
        "(manifest parity metadata)",
        `${field}[${String(index)}] must be a non-empty string`,
      );
      continue;
    }
    if (parsed.has(value)) {
      pushFailure(failures, "(manifest parity metadata)", `${field} duplicates ${value}`);
    }
    parsed.add(value);
  }
  return parsed;
}

export function parseHarnessParityConfig(
  manifest: unknown,
  failures: Map<string, ControlFailures>,
): HarnessParityConfig {
  return {
    scriptParityExemptions: parseManifestStringSet(manifest, "scriptParityExemptions", failures),
    ciGateControlIds: parseManifestStringSet(manifest, "ciGateControlIds", failures),
  };
}

// CI gate parity: contract as data, not as a comment this module re-parses.
//
// A workflow step declares which harness control it runs by carrying
// `env: { HARNESS_CI_GATE: <control id> }` — structured workflow data read with
// the runtime's real YAML parser. The previous reader anchored on a
// `# harness-ci-gate:` comment and reconstructed the following step with
// per-line regexes over `- name:`/`- uses:`/`run:`, so any formatting those
// regexes did not anticipate silently changed what this check believed.
//
// Deliberately NOT generated: `ciGateControlIds` holds one entry today, so
// generating `ci.yml`, a marker-bounded region inside it, or a composite action
// would add a generator, a freshness surface, and a GitHub-owned artifact to
// remove one binding's worth of duplication. Revisit whole-file or
// composite-action generation only if `ciGateControlIds` grows to roughly 3+
// entries.

/** Step-level workflow env key binding a CI step to its harness control id. */
export const CI_GATE_ENV_KEY = "HARNESS_CI_GATE";

const CI_PARITY_FAILURE_ID = "(CI parity)";
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

export interface CiGateBinding {
  /**
   * The step's raw `HARNESS_CI_GATE` value. Validation belongs to
   * {@link checkCiGateBindings}, not to the projection: a step that carries the
   * reserved key with an unusable value (empty, whitespace, `null`, non-scalar)
   * is a malformed gate declaration to report, not an ordinary CI step to
   * project away — dropping it here would let an added gate escape parity while
   * the gates that are declared keep the check green.
   */
  readonly controlId: unknown;
  readonly invocation?: string;
}

/**
 * `Bun.YAML` is the runtime's own parser; the repo installs no Bun type
 * package, so the global is declared for this module rather than cast at the
 * use site. Every caller of {@link checkCiGateParity} runs under `bun run` —
 * the manifest declares the invocation and package.json holds the script — so
 * there is no availability branch: on any other runtime this throws and
 * {@link checkCiGateParity} turns it into a parity failure, the same
 * fail-closed outcome a tailored message would have produced.
 */
declare const Bun: { readonly YAML: { readonly parse: (source: string) => unknown } };

function parseWorkflowWithBunYaml(source: string): unknown {
  return Bun.YAML.parse(source);
}

function workflowSteps(workflow: unknown): readonly unknown[] {
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) return [];
  const steps: unknown[] = [];
  for (const job of Object.values(workflow.jobs)) {
    if (!isRecord(job)) continue;
    const jobSteps: unknown = job.steps;
    if (Array.isArray(jobSteps)) steps.push(...(jobSteps as readonly unknown[])); // type-assertion-boundary: interop - Array.isArray widens the unknown job.steps to any[]; the elements stay unknown to callers
  }
  return steps;
}

/**
 * Pure projection of a parsed workflow document into {control id, run} pairs.
 * Steps without the env key are ordinary CI steps and are ignored; presence of
 * the reserved key is what makes a step a gate declaration, whatever its value.
 * A gate step whose `run` is absent or not a scalar yields a binding with no
 * invocation, so the comparison below reports it rather than silently passing.
 */
export function collectCiGateBindings(workflow: unknown): readonly CiGateBinding[] {
  const bindings: CiGateBinding[] = [];
  for (const step of workflowSteps(workflow)) {
    if (!isRecord(step) || !isRecord(step.env)) continue;
    if (!Object.hasOwn(step.env, CI_GATE_ENV_KEY)) continue;
    const run = step.run;
    bindings.push({
      controlId: step.env[CI_GATE_ENV_KEY],
      ...(typeof run === "string" ? { invocation: run.trim() } : {}),
    });
  }
  return bindings;
}

/** Pure comparison of parsed gate bindings against the manifest's expectation. */
export function checkCiGateBindings(
  bindings: readonly CiGateBinding[],
  expectedGates: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): void {
  const actualIds = new Set<string>();
  for (const binding of bindings) {
    const controlId = binding.controlId;
    if (!isNonEmptyString(controlId)) {
      pushFailure(
        failures,
        CI_PARITY_FAILURE_ID,
        `a CI step carries ${CI_GATE_ENV_KEY} with an unusable control id: ${JSON.stringify(controlId)}`,
      );
      continue;
    }
    if (actualIds.has(controlId)) {
      pushFailure(
        failures,
        CI_PARITY_FAILURE_ID,
        `CI duplicates the ${CI_GATE_ENV_KEY} binding for ${controlId}`,
      );
      continue;
    }
    actualIds.add(controlId);
    const expectedInvocation = expectedGates.get(controlId);
    if (expectedInvocation === undefined) {
      pushFailure(
        failures,
        CI_PARITY_FAILURE_ID,
        `CI marks ${controlId} as a gate, but ciGateControlIds does not declare it`,
      );
    } else if (binding.invocation !== expectedInvocation) {
      pushFailure(
        failures,
        CI_PARITY_FAILURE_ID,
        `${controlId} runs ${JSON.stringify(binding.invocation ?? "(missing run)")} in CI, expected manifest invocation ${JSON.stringify(expectedInvocation)}`,
      );
    }
  }
  for (const controlId of expectedGates.keys()) {
    if (actualIds.has(controlId)) continue;
    pushFailure(
      failures,
      CI_PARITY_FAILURE_ID,
      `ciGateControlIds declares ${controlId}, but no CI step carries ${CI_GATE_ENV_KEY}: ${controlId}`,
    );
  }
}

/**
 * Parse the workflow, then compare. Both halves are pinned end-to-end against
 * the real parser by scripts/tests/test-harness-check.sh, which drives a
 * well-formed fixture workflow and a truncated one; the unit tests here cover
 * {@link collectCiGateBindings} and {@link checkCiGateBindings} directly.
 */
export function checkCiGateParity(
  workflowSource: string,
  expectedGates: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): void {
  let workflow: unknown;
  try {
    workflow = parseWorkflowWithBunYaml(workflowSource);
  } catch (error) {
    pushFailure(
      failures,
      CI_PARITY_FAILURE_ID,
      `${CI_WORKFLOW_PATH} could not be parsed as YAML: ${errorMessage(error)}`,
    );
    return;
  }
  checkCiGateBindings(collectCiGateBindings(workflow), expectedGates, failures);
}
