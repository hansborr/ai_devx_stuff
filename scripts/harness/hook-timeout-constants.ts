import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ControlFailures,
  isNonEmptyString,
  pushFailure,
  type RawControl,
} from "./harness-check-validation.js";
import { type HookHarness, resolveHookWiring } from "./hook-wiring-schema.js";

interface HookTimeoutConstantBinding {
  readonly controlId: string;
  readonly harness: HookHarness;
  readonly scriptPath: string;
  readonly variableName: string;
}

const HOOK_TIMEOUT_CONSTANT_BINDINGS = [
  {
    controlId: "hook/ai-bun-run-quiet",
    harness: "claude",
    scriptPath: "scripts/ai-hooks/bun-run-quiet.sh",
    variableName: "BUN_RUN_QUIET_HOOK_TIMEOUT",
  },
  {
    controlId: "hook/ai-git-commit-quiet",
    harness: "claude",
    scriptPath: "scripts/ai-hooks/git-commit-quiet.sh",
    variableName: "GIT_COMMIT_QUIET_HOOK_TIMEOUT",
  },
] as const satisfies readonly HookTimeoutConstantBinding[];

function escapeRegexLiteral(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

function readShellIntegerConstant(
  repoRoot: string,
  binding: HookTimeoutConstantBinding,
  failures: Map<string, ControlFailures>,
): number | undefined {
  const fullPath = join(repoRoot, binding.scriptPath);
  let text: string;
  try {
    text = readFileSync(fullPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushFailure(failures, binding.scriptPath, `failed to read ${binding.scriptPath}: ${message}`);
    return undefined;
  }

  const variablePattern = new RegExp(
    `^[ \\t]*${escapeRegexLiteral(binding.variableName)}=([0-9]+)[ \\t]*(?:#.*)?$`,
    "mu",
  );
  const valueText = text.match(variablePattern)?.[1];
  if (valueText === undefined) {
    pushFailure(
      failures,
      binding.scriptPath,
      `missing integer shell constant ${binding.variableName}`,
    );
    return undefined;
  }
  return Number.parseInt(valueText, 10);
}

function readManifestHookTimeout(
  controlsById: ReadonlyMap<string, RawControl>,
  binding: HookTimeoutConstantBinding,
  failures: Map<string, ControlFailures>,
): number | undefined {
  const control = controlsById.get(binding.controlId);
  if (control === undefined) {
    pushFailure(
      failures,
      binding.controlId,
      `required hook timeout control ${binding.controlId} is missing from harness.controls.json`,
    );
    return undefined;
  }

  try {
    const wiring = resolveHookWiring(binding.controlId, control.hookWiring);
    const command = wiring.harnesses[binding.harness];
    if (command === undefined) {
      pushFailure(
        failures,
        binding.controlId,
        `hookWiring.harnesses.${binding.harness} is required for ${binding.variableName}`,
      );
      return undefined;
    }
    if (command.timeout === undefined) {
      pushFailure(
        failures,
        binding.controlId,
        `hookWiring.harnesses.${binding.harness}.timeout is required for ${binding.variableName}`,
      );
      return undefined;
    }
    return command.timeout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushFailure(failures, binding.controlId, message);
    return undefined;
  }
}

export function checkHookTimeoutConstants(
  repoRoot: string,
  controls: readonly RawControl[],
  failures: Map<string, ControlFailures>,
): void {
  const controlsById = new Map<string, RawControl>();
  for (const control of controls) {
    if (isNonEmptyString(control.id)) controlsById.set(control.id, control);
  }

  for (const binding of HOOK_TIMEOUT_CONSTANT_BINDINGS) {
    const manifestTimeout = readManifestHookTimeout(controlsById, binding, failures);
    const shellTimeout = readShellIntegerConstant(repoRoot, binding, failures);
    if (manifestTimeout === undefined || shellTimeout === undefined) continue;
    if (manifestTimeout === shellTimeout) continue;
    pushFailure(
      failures,
      binding.scriptPath,
      `${binding.variableName}=${String(shellTimeout)} does not match ${binding.controlId} ${binding.harness} hookWiring timeout ${String(manifestTimeout)} from harness.controls.json`,
    );
  }
}
