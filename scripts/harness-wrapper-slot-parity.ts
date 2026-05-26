import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parsePreCommitSlots,
  parseVerifyWrapperSlots,
  type VerifyWrapperMode,
  type WrapperSlot,
} from "./harness-wrapper-slot-parser.js";

interface RawControlWithSlots {
  readonly id?: unknown;
  readonly slots?: unknown;
}

interface ControlFailures {
  readonly id: string;
  readonly failures: string[];
}

interface ManifestSlot {
  readonly name: string;
  readonly script: string;
}

const WRAPPER_SLOT_SPECS: readonly {
  readonly id: string;
  readonly source: string;
  readonly verifyMode?: VerifyWrapperMode;
}[] = [
  { id: "verify-wrapper/verify", source: "scripts/verify.sh", verifyMode: "full" },
  { id: "verify-wrapper/verify-changed", source: "scripts/verify.sh", verifyMode: "changed" },
  { id: "verify-wrapper/verify-parallel", source: "scripts/verify.sh", verifyMode: "parallel" },
  { id: "hook/pre-commit", source: ".husky/pre-commit" },
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pushFailure(failures: Map<string, ControlFailures>, id: string, message: string): void {
  let bucket = failures.get(id);
  if (bucket === undefined) {
    bucket = { id, failures: [] };
    failures.set(id, bucket);
  }
  bucket.failures.push(message);
}

function parseManifestSlot(
  rawSlot: unknown,
  index: number,
  id: string,
  scripts: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): ManifestSlot | undefined {
  if (!isObject(rawSlot)) {
    pushFailure(failures, id, `slots[${String(index)}] must be an object`);
    return undefined;
  }
  const { name, script, condition } = rawSlot;
  if (!isNonEmptyString(name)) {
    pushFailure(failures, id, `slots[${String(index)}].name must be a non-empty string`);
    return undefined;
  }
  if (!isNonEmptyString(script)) {
    pushFailure(failures, id, `slot ${name} script must be a non-empty string`);
    return undefined;
  }
  if (condition !== undefined && !isNonEmptyString(condition)) {
    pushFailure(failures, id, `slot ${name} condition must be a non-empty string`);
  }
  if (!scripts.has(script)) {
    pushFailure(failures, id, `slot ${name} references unknown package.json script: ${script}`);
  }
  return { name, script };
}

function validateManifestSlots(
  rawSlots: unknown,
  id: string,
  scripts: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): Map<string, string> | undefined {
  if (rawSlots === undefined) return new Map<string, string>();
  if (!Array.isArray(rawSlots)) {
    pushFailure(failures, id, "slots must be an array when present");
    return undefined;
  }
  const slots = new Map<string, string>();
  for (const [index, rawSlot] of rawSlots.entries()) {
    const parsed = parseManifestSlot(rawSlot, index, id, scripts, failures);
    if (parsed === undefined) continue;
    const { name, script } = parsed;
    if (slots.has(name)) {
      pushFailure(failures, id, `duplicate slot name: ${name}`);
    } else {
      slots.set(name, script);
    }
  }
  return slots;
}

function wrapperControlMap(
  controls: readonly RawControlWithSlots[],
): Map<string, RawControlWithSlots> {
  const byId = new Map<string, RawControlWithSlots>();
  for (const control of controls) {
    if (isNonEmptyString(control.id)) byId.set(control.id, control);
  }
  return byId;
}

function actualSlotsForSpec(
  repoRoot: string,
  spec: (typeof WRAPPER_SLOT_SPECS)[number],
  failures: Map<string, ControlFailures>,
): readonly WrapperSlot[] {
  let text: string;
  try {
    text = readFileSync(join(repoRoot, spec.source), "utf8");
  } catch {
    pushFailure(failures, spec.id, `could not read wrapper source: ${spec.source}`);
    return [];
  }
  const result =
    spec.verifyMode === undefined
      ? parsePreCommitSlots(text)
      : parseVerifyWrapperSlots(text, spec.verifyMode);
  for (const diagnostic of result.diagnostics) {
    pushFailure(failures, spec.id, diagnostic);
  }
  return result.slots;
}

function compareWrapperSlots(
  id: string,
  declared: ReadonlyMap<string, string>,
  actual: readonly WrapperSlot[],
  failures: Map<string, ControlFailures>,
): void {
  const actualByName = new Map(actual.map((slot) => [slot.name, slot.script]));
  for (const [name, script] of actualByName) {
    const declaredScript = declared.get(name);
    if (declaredScript === undefined) {
      pushFailure(failures, id, `slot ${name} (${script}) is invoked but missing from manifest`);
    } else if (declaredScript !== script) {
      pushFailure(
        failures,
        id,
        `slot ${name} invokes ${script}, but manifest declares ${declaredScript}`,
      );
    }
  }
  for (const name of declared.keys()) {
    if (!actualByName.has(name)) {
      pushFailure(
        failures,
        id,
        `manifest declares slot ${name}, but the wrapper does not invoke it`,
      );
    }
  }
}

export function checkWrapperSlotParity(
  repoRoot: string,
  controls: readonly RawControlWithSlots[],
  scripts: ReadonlyMap<string, string>,
  declaredScripts: Set<string>,
  failures: Map<string, ControlFailures>,
): void {
  const controlsById = wrapperControlMap(controls);
  for (const spec of WRAPPER_SLOT_SPECS) {
    const control = controlsById.get(spec.id);
    if (control === undefined) {
      pushFailure(failures, "(parity)", `${spec.id} is missing from the manifest`);
      continue;
    }
    const declaredSlots = validateManifestSlots(control.slots, spec.id, scripts, failures);
    if (declaredSlots === undefined) continue;
    for (const script of declaredSlots.values()) declaredScripts.add(script);
    compareWrapperSlots(
      spec.id,
      declaredSlots,
      actualSlotsForSpec(repoRoot, spec, failures),
      failures,
    );
  }
}
