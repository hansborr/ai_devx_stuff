import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareByCodepoint } from "@musi/lint-ratchet/kernel/codepoint-compare.js";

import { runDocGenerator } from "../lib/doc-generator.js";
import {
  loadGeneratedSurfaces,
  renderClassifierFragment,
  renderFixtureManifest,
  renderFreshnessShell,
} from "./generated-surfaces.js";
import { HARNESS_MANIFEST_FILENAME, readHarnessManifest } from "./harness-manifest.js";
import {
  GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH,
  GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH,
  GENERATED_SURFACE_FRESHNESS_PATH,
  GENERATED_VERIFY_STEPS_PATH,
} from "./harness-paths.js";
import { MARKER_BRIDGE_DIVERGENCE_ALLOWLIST } from "./verify-step-bridge-divergences.js";
import {
  isNonEmptyString,
  isObject,
  parseVerifyStepSlots,
  VERIFY_STEP_DYNAMIC_RESOLVER_BINDINGS,
  type VerifyStepSlot,
} from "./verify-step-schema.js";

const VAR_REF_PATTERN = /\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/gu;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// porting-knob: verify-consumers -- retarget manifest consumers and their wrapper variables
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

const PRE_COMMIT_CONSUMER_ID = "hook/pre-commit";
const MARKER_BRIDGE_SUPERSET_CONSUMERS = [
  { id: "verify-wrapper/verify", markerLabel: "verify" },
  { id: "verify-wrapper/verify-changed", markerLabel: "verify:changed" },
] as const;

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
    throw new Error(`${HARNESS_MANIFEST_FILENAME} must declare a controls array`);
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

function findConsumer(consumers: readonly Consumer[], id: string): Consumer {
  const consumer = consumers.find((candidate) => candidate.spec.id === id);
  if (consumer === undefined) {
    throw new Error(`internal verify-step generator error: missing consumer ${id}`);
  }
  return consumer;
}

function markerBridgeAllowedDivergences(supersetId: string): ReadonlySet<string> {
  return new Set(
    MARKER_BRIDGE_DIVERGENCE_ALLOWLIST.filter((entry) => entry.supersetId === supersetId).map(
      (entry) => entry.slot,
    ),
  );
}

// Human-readable rendering for divergence messages: a space-joined command line.
// Never compare on this — distinct token vectors can flatten to the same string
// (`["--foo", "a b"]` vs `["--foo a", "b"]`), which would hide a real drift.
function slotCommandDisplay(slot: VerifyStepSlot): string {
  const tokens = slotCommandTokens(slot).join(" ");
  return slot.dynamic === undefined ? tokens : `${tokens} [dynamic:${slot.dynamic}]`;
}

// Comparison signature: JSON.stringify keeps the token vector unambiguous so a
// space inside a token (env values, quoted args) cannot make two different
// command vectors share a signature and let a bridge divergence pass undetected.
function slotBridgeSignature(slot: VerifyStepSlot): string {
  const tokens = JSON.stringify(slotCommandTokens(slot));
  return slot.dynamic === undefined ? tokens : `${tokens} [dynamic:${slot.dynamic}]`;
}

function assertSlotSuperset(superset: Consumer, subset: Consumer, markerLabel: string): void {
  const supersetByName = new Map(superset.slots.map((slot) => [slot.name, slot] as const));
  const allowed = markerBridgeAllowedDivergences(superset.spec.id);
  const missing: string[] = [];
  const diverged: string[] = [];

  for (const slot of subset.slots) {
    const supersetSlot = supersetByName.get(slot.name);
    if (supersetSlot === undefined) {
      missing.push(slot.name);
      continue;
    }
    if (allowed.has(slot.name)) continue;
    const subsetSignature = slotBridgeSignature(slot);
    const supersetSignature = slotBridgeSignature(supersetSlot);
    if (subsetSignature !== supersetSignature) {
      diverged.push(
        `${slot.name} (${subset.spec.name}: ${slotCommandDisplay(slot)}; ${superset.spec.name}: ${slotCommandDisplay(supersetSlot)})`,
      );
    }
  }

  // Report a missing slot with the historical message first: a name that is
  // absent cannot also be compared for command tokens.
  if (missing.length > 0) {
    throw new Error(
      `${superset.spec.id} slots must include every ${subset.spec.id} slot because pre-commit accepts fresh ${markerLabel} success markers; missing: ${missing.join(", ")}`,
    );
  }
  if (diverged.length > 0) {
    throw new Error(
      `${superset.spec.id} and ${subset.spec.id} must render identical command tokens for every shared slot because pre-commit accepts fresh ${markerLabel} success markers; divergent: ${diverged.join(", ")}. If a divergence is intentional, add {supersetId, slot, reason} to MARKER_BRIDGE_DIVERGENCE_ALLOWLIST in generate-verify-steps.ts.`,
    );
  }
}

function assertMarkerBridgeSupersets(consumers: readonly Consumer[]): void {
  const preCommit = findConsumer(consumers, PRE_COMMIT_CONSUMER_ID);
  for (const { id, markerLabel } of MARKER_BRIDGE_SUPERSET_CONSUMERS) {
    assertSlotSuperset(findConsumer(consumers, id), preCommit, markerLabel);
  }
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
  // porting-knob: bun-command-runner -- generated verification invokes package scripts via Bun
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
  // codepoint order, not localeCompare — load-bearing for committed/freshness-compared bytes:
  // these variable names are rendered into the committed steps.generated.sh and freshness-gated.
  // The names contain `_` (U+005F), which localeCompare reorders under many ICU collations.
  return Array.from(variables).sort(compareByCodepoint);
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

// The fast-commit skip set is a pre-commit-only concept: manual verify /
// verify:changed always run every slot so their success markers stay
// trustworthy. Reject the field elsewhere instead of silently ignoring it,
// and emit the pre-commit set as one generated array so steps-lib.sh never
// hand-codes slot names.
function renderFastCommitSkipSlots(consumers: readonly Consumer[]): string[] {
  const skipSlots: string[] = [];
  for (const consumer of consumers) {
    for (const slot of consumer.slots) {
      if (slot.fastCommitSkip !== true) continue;
      if (consumer.spec.id !== PRE_COMMIT_CONSUMER_ID) {
        throw new Error(
          `${consumer.spec.id} slot ${slot.name} declares fastCommitSkip, but only ${PRE_COMMIT_CONSUMER_ID} slots may be fast-commit skippable`,
        );
      }
      skipSlots.push(slot.name);
    }
  }
  return [`declare -ga MUSI_FAST_COMMIT_SKIP_SLOTS=${shellArray(skipSlots)}`, ""];
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
    "declare -gA MUSI_VERIFY_DYNAMIC_RESOLVER_FUNC=()",
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

function renderDynamicResolverDispatch(): string[] {
  const lines: string[] = [];
  for (const binding of VERIFY_STEP_DYNAMIC_RESOLVER_BINDINGS) {
    if (!/^[A-Za-z_]\w*$/u.test(binding.functionName)) {
      throw new Error(
        `dynamic resolver ${binding.id} uses invalid shell function ${binding.functionName}`,
      );
    }
    lines.push(
      `MUSI_VERIFY_DYNAMIC_RESOLVER_FUNC[${shellQuote(binding.id)}]=${shellQuote(binding.functionName)}`,
    );
  }
  lines.push("");
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
  assertMarkerBridgeSupersets(consumers);
  if (knownScripts !== undefined) assertKnownScripts(consumers, knownScripts);
  const lines = [
    ...renderHeader(consumers),
    ...renderConsumerMetadata(consumers),
    ...renderFastCommitSkipSlots(consumers),
    ...renderSlots(consumers),
    ...renderDynamicResolverDispatch(),
  ];
  while (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function readPackageScripts(): ReadonlySet<string> {
  const pkg: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  if (!isObject(pkg) || !isObject(pkg.scripts)) {
    throw new Error("package.json must declare a scripts object");
  }
  return new Set(Object.keys(pkg.scripts));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDocGenerator({
    outputPath: join(repoRoot, GENERATED_VERIFY_STEPS_PATH),
    refreshCommand: "verify:steps",
    render: () => ({
      rendered: renderVerifyStepsShellFromManifest(
        readHarnessManifest(repoRoot),
        readPackageScripts(),
      ),
    }),
  });
  runDocGenerator({
    outputPath: join(repoRoot, GENERATED_SURFACE_FRESHNESS_PATH),
    refreshCommand: "verify:steps",
    render: () => ({
      rendered: renderFreshnessShell(loadGeneratedSurfaces(repoRoot)),
    }),
  });
  runDocGenerator({
    outputPath: join(repoRoot, GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH),
    refreshCommand: "verify:steps",
    render: () => ({
      rendered: renderClassifierFragment(loadGeneratedSurfaces(repoRoot)),
    }),
  });
  runDocGenerator({
    outputPath: join(repoRoot, GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH),
    refreshCommand: "verify:steps",
    render: () => ({
      rendered: renderFixtureManifest(loadGeneratedSurfaces(repoRoot)),
    }),
  });
}
