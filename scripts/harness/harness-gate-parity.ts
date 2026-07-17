import {
  type ControlFailures,
  isNonEmptyString,
  type ManifestCheckContext,
  pushFailure,
} from "./harness-check-validation.js";

export function checkScriptParity(
  controlPrefixPattern: RegExp,
  exemptScripts: ReadonlySet<string>,
  declaredScripts: ReadonlySet<string>,
  context: ManifestCheckContext,
): void {
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
    }
  }
  for (const name of context.scripts.keys()) {
    if (!controlPrefixPattern.test(name)) continue;
    if (exemptScripts.has(name) || declaredScripts.has(name)) continue;
    pushFailure(
      context.failures,
      "(parity)",
      `package.json script "${name}" matches the control-prefix convention but is ` +
        `not declared in harness.controls.json and not exempt. Fix one of:\n` +
        `      1. Add a control entry (with "invocation": "bun run ${name}") to ` +
        `harness.controls.json, then run \`bun run docs:harness-controls\`.\n` +
        `      2. If it is an operational utility (not an enforcement gate), add "${name}" ` +
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

interface CiGateBinding {
  readonly controlId: string;
  readonly invocation?: string;
}

function findMarkedStepInvocation(
  lines: readonly string[],
  markerIndex: number,
): string | undefined {
  let sawStep = false;
  for (let cursor = markerIndex + 1; cursor < lines.length; cursor += 1) {
    const candidate = (lines[cursor] ?? "").trimStart();
    if (candidate.startsWith("# harness-ci-gate:")) return undefined;
    if (/^- (?:name|uses):/u.test(candidate)) {
      if (sawStep) return undefined;
      sawStep = true;
    } else if (candidate.startsWith("run:")) {
      return candidate.slice("run:".length).trim();
    }
  }
  return undefined;
}

function extractCiGateBindings(workflowSource: string): readonly CiGateBinding[] {
  const lines = workflowSource.split("\n");
  const bindings: CiGateBinding[] = [];
  for (const [index, line] of lines.entries()) {
    const controlId = /^\s*# harness-ci-gate:\s*(\S+)\s*$/u.exec(line)?.[1];
    if (controlId === undefined) continue;
    const invocation = findMarkedStepInvocation(lines, index);
    bindings.push({ controlId, ...(invocation === undefined ? {} : { invocation }) });
  }
  return bindings;
}

export function checkCiGateParity(
  workflowSource: string,
  expectedGates: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): void {
  const actualIds = new Set<string>();
  for (const binding of extractCiGateBindings(workflowSource)) {
    if (actualIds.has(binding.controlId)) {
      pushFailure(failures, "(CI parity)", `CI duplicates harness-ci-gate ${binding.controlId}`);
      continue;
    }
    actualIds.add(binding.controlId);
    const expectedInvocation = expectedGates.get(binding.controlId);
    if (expectedInvocation === undefined) {
      pushFailure(
        failures,
        "(CI parity)",
        `CI marks ${binding.controlId} as a gate, but ciGateControlIds does not declare it`,
      );
    } else if (binding.invocation !== expectedInvocation) {
      pushFailure(
        failures,
        "(CI parity)",
        `${binding.controlId} runs ${JSON.stringify(binding.invocation ?? "(missing run)")} in CI, expected manifest invocation ${JSON.stringify(expectedInvocation)}`,
      );
    }
  }
  for (const controlId of expectedGates.keys()) {
    if (actualIds.has(controlId)) continue;
    pushFailure(
      failures,
      "(CI parity)",
      `ciGateControlIds declares ${controlId}, but CI has no harness-ci-gate marker for it`,
    );
  }
}
