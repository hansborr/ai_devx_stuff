import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runDocGenerator } from "../lib/doc-generator.js";
import {
  isNonEmptyString,
  isObject,
  parseVerifyStepSlots,
  type VerifyStepSlot,
} from "./verify-step-schema.js";

const VAR_REF_PATTERN = /\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/gu;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(repoRoot, "harness.controls.json");
const outputPath = join(repoRoot, "scripts/verify/steps.generated.sh");

const CONSUMERS = [
  {
    id: "verify-wrapper/verify",
    name: "verify",
    stepsArray: "MUSI_VERIFY_STEPS",
    variablePrefix: "MUSI_VERIFY",
  },
  {
    id: "verify-wrapper/verify-changed",
    name: "verify_changed",
    stepsArray: "MUSI_VERIFY_CHANGED_STEPS",
    variablePrefix: "MUSI_VERIFY_CHANGED",
  },
  {
    id: "verify-wrapper/verify-parallel",
    name: "verify_parallel",
    stepsArray: "MUSI_VERIFY_PARALLEL_STEPS",
    variablePrefix: "MUSI_VERIFY_PARALLEL",
  },
  {
    id: "hook/pre-commit",
    name: "pre_commit",
    stepsArray: "MUSI_PRE_COMMIT_STEPS",
    variablePrefix: "MUSI_PRE_COMMIT",
  },
] as const;

type ConsumerSpec = (typeof CONSUMERS)[number];

interface Consumer {
  readonly spec: ConsumerSpec;
  readonly slots: readonly VerifyStepSlot[];
}

function parseConsumerSlots(
  control: Record<string, unknown>,
  spec: ConsumerSpec,
): readonly VerifyStepSlot[] {
  if (!Array.isArray(control.slots)) {
    throw new Error(`${spec.id} must declare a slots array`);
  }
  const failures: string[] = [];
  const slots = parseVerifyStepSlots(control.slots, failures, `${spec.id} `);
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return slots ?? [];
}

function collectConsumers(manifest: unknown): readonly Consumer[] {
  if (!isObject(manifest) || !Array.isArray(manifest.controls)) {
    throw new Error("harness.controls.json must declare a controls array");
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const [index, control] of manifest.controls.entries()) {
    if (!isObject(control)) {
      throw new Error(`control entry at index ${String(index)} must be an object`);
    }
    if (!isNonEmptyString(control.id)) {
      throw new Error(`control entry at index ${String(index)} must declare a non-empty id`);
    }
    if (byId.has(control.id)) {
      throw new Error(`duplicate control id: ${control.id}`);
    }
    byId.set(control.id, control);
  }
  return CONSUMERS.map((spec) => {
    const control = byId.get(spec.id);
    if (control === undefined) {
      throw new Error(`missing verify step control: ${spec.id}`);
    }
    return { spec, slots: parseConsumerSlots(control, spec) };
  });
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellDoubleQuote(value: string): string {
  // Double-quoted values expand when the wrappers source the generated file,
  // so only plain $VAR / ${VAR} references may survive into this branch —
  // anything else (notably $(...)) would execute at source time. Backslashes
  // are rejected outright: \$FOO would pass the var-ref check below yet still
  // expand, so backslash next to $ in one value is inherently ambiguous.
  if (value.includes("\\")) {
    throw new Error(`manifest value mixes backslash with $ expansion: ${value}`);
  }
  if (value.replaceAll(VAR_REF_PATTERN, "").includes("$")) {
    throw new Error(`manifest value uses $ outside a plain variable reference: ${value}`);
  }
  return `"${value.replaceAll('"', '\\"').replaceAll("`", "\\`")}"`;
}

function shellQuote(value: string): string {
  return value.includes("$") ? shellDoubleQuote(value) : shellSingleQuote(value);
}

function shellArray(values: readonly string[]): string {
  return `(${values.map(shellQuote).join(" ")})`;
}

function shellVariableSuffix(value: string): string {
  return value
    .replaceAll(/[^A-Za-z0-9]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "")
    .toUpperCase();
}

function slotCommandTokens(slot: VerifyStepSlot): readonly string[] {
  const envTokens = Object.entries(slot.env ?? {}).map(([name, value]) => `${name}=${value}`);
  return [
    ...(envTokens.length > 0 ? ["env", ...envTokens] : []),
    "bun",
    "run",
    slot.script,
    ...(slot.args ?? []),
  ];
}

function runtimeVariables(consumers: readonly Consumer[]): readonly string[] {
  const variables = new Set<string>();
  for (const consumer of consumers) {
    for (const slot of consumer.slots) {
      for (const token of [...Object.values(slot.env ?? {}), ...(slot.args ?? [])]) {
        for (const match of token.matchAll(VAR_REF_PATTERN)) {
          const variable = match[1] ?? match[2];
          if (variable !== undefined) variables.add(variable);
        }
      }
    }
  }
  return Array.from(variables).sort((left, right) => left.localeCompare(right));
}

function renderHeader(consumers: readonly Consumer[]): string[] {
  const lines = [
    "# shellcheck shell=bash",
    "# shellcheck disable=SC2034",
    "# Generated by scripts/harness/generate-verify-steps.ts. Do not edit by hand.",
    "#",
    "# Source this file only after the verify wrapper has initialized runtime",
    "# variables referenced by slot args/env values. The guards below intentionally",
    "# fail loudly when a wrapper sources the generated arrays too early.",
  ];
  for (const variable of runtimeVariables(consumers)) {
    lines.push(`: "\${${variable}:?scripts/verify/steps.generated.sh requires ${variable}}"`);
  }
  lines.push("");
  return lines;
}

function renderConsumerMetadata(consumers: readonly Consumer[]): string[] {
  const lines = [
    `declare -ga MUSI_VERIFY_CONSUMERS=${shellArray(consumers.map((consumer) => consumer.spec.name))}`,
  ];
  for (const { spec, slots } of consumers) {
    lines.push(`declare -ga ${spec.stepsArray}=${shellArray(slots.map((slot) => slot.name))}`);
  }
  lines.push("");
  return lines;
}

function slotVariableName(consumer: Consumer, slot: VerifyStepSlot): string {
  return `${consumer.spec.variablePrefix}_${shellVariableSuffix(slot.name)}_CMD`;
}

function renderSlotMetadata(consumer: Consumer, slot: VerifyStepSlot): string[] {
  const variableName = slotVariableName(consumer, slot);
  const key = `${consumer.spec.name}:${slot.name}`;
  const lines = [
    `${variableName}=${shellArray(slotCommandTokens(slot))}`,
    `MUSI_VERIFY_SLOT_CMD_VAR[${shellQuote(key)}]=${shellQuote(variableName)}`,
  ];
  if (slot.dynamic !== undefined) {
    lines.push(`MUSI_VERIFY_SLOT_DYNAMIC[${shellQuote(key)}]=${shellQuote(slot.dynamic)}`);
  }
  lines.push("");
  return lines;
}

function renderSlots(consumers: readonly Consumer[]): string[] {
  const lines = [
    "declare -gA MUSI_VERIFY_SLOT_CMD_VAR=()",
    "declare -gA MUSI_VERIFY_SLOT_DYNAMIC=()",
    "",
  ];
  // shellVariableSuffix collapses non-alphanumerics, and consumer prefixes can
  // overlap (MUSI_VERIFY + changed-lint vs MUSI_VERIFY_CHANGED + lint), so
  // ownership must be global across every generated command array.
  const variableNameOwners = new Map<string, string>();
  for (const consumer of consumers) {
    for (const slot of consumer.slots) {
      const variableName = slotVariableName(consumer, slot);
      const owner = variableNameOwners.get(variableName);
      const slotOwner = `${consumer.spec.id}:${slot.name}`;
      if (owner !== undefined) {
        throw new Error(
          `slots ${owner} and ${slotOwner} derive the same shell variable: ${variableName}`,
        );
      }
      variableNameOwners.set(variableName, slotOwner);
      lines.push(...renderSlotMetadata(consumer, slot));
    }
  }
  return lines;
}

function assertKnownScripts(
  consumers: readonly Consumer[],
  knownScripts: ReadonlySet<string>,
): void {
  for (const consumer of consumers) {
    for (const slot of consumer.slots) {
      if (!knownScripts.has(slot.script)) {
        throw new Error(
          `${consumer.spec.id} slot ${slot.name} references unknown package.json script: ${slot.script}`,
        );
      }
    }
  }
}

export function renderVerifyStepsShellFromManifest(
  manifest: unknown,
  knownScripts?: ReadonlySet<string>,
): string {
  const consumers = collectConsumers(manifest);
  if (knownScripts !== undefined) assertKnownScripts(consumers, knownScripts);
  const lines = [
    ...renderHeader(consumers),
    ...renderConsumerMetadata(consumers),
    ...renderSlots(consumers),
  ];
  while (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function readManifest(): unknown {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function readPackageScripts(): ReadonlySet<string> {
  const pkg: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  if (!isObject(pkg) || !isObject(pkg.scripts)) {
    throw new Error("package.json must declare a scripts object");
  }
  return new Set(Object.keys(pkg.scripts));
}

function main(): void {
  runDocGenerator({
    outputPath,
    refreshCommand: "verify:steps",
    render: () => ({
      rendered: renderVerifyStepsShellFromManifest(readManifest(), readPackageScripts()),
    }),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
