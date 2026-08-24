import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { runDocGenerator } from "../lib/doc-generator.js";
import { isRecord } from "../lib/records.js";
import {
  deriveGeneratedSurfaceDependencies,
  FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV,
  renderFixtureManifest,
} from "./generated-surface-dependencies.js";
import {
  type GeneratedSurfaceRecord,
  renderClassifierFragment,
  renderFreshnessShell,
} from "./generated-surfaces.js";
import { loadGeneratedSurfaces } from "./generated-surfaces-loader.js";
import { loadTypedHarnessManifest } from "./harness-manifest-loader.js";
import type { HarnessManifest } from "./harness-manifest-schema.js";
import {
  GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH,
  GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH,
  GENERATED_SURFACE_FRESHNESS_PATH,
  GENERATED_VERIFY_STEPS_PATH,
} from "./harness-paths.js";
import {
  collectVerifyArtifactFailures,
  renderVerifyArtifactBindings,
  type VerifyArtifactProgram,
} from "./verify-step-artifacts.js";
import {
  VERIFY_STEP_DYNAMIC_RESOLVER_BINDINGS,
  verifyStepBridgeSignature,
  verifyStepCommandTokens,
  type VerifyStepSlot,
} from "./verify-step-schema.js";

type HarnessControl = HarnessManifest["controls"][number];

const VAR_REF_PATTERN = /\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/gu;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// porting-knob: verify-consumers -- retarget manifest consumers and their wrapper variables;
// keep the profile/marker ids used to derive bridge reasons in
// harness-manifest-schema.ts aligned with these ids
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
  control: HarnessControl,
  spec: ConsumerSpec,
): readonly VerifyStepSlot[] {
  // Only the slot-carrying kinds may declare `slots` at all, so a consumer
  // control of any other kind is a registration mistake, not a shape bug.
  const slots = "slots" in control ? control.slots : undefined;
  if (slots === undefined) {
    throw new Error(`${spec.id} must declare a slots array`);
  }
  return slots;
}

// Controls-array shape, entry object-ness, id presence, and id uniqueness are
// the typed contract's job (harness-manifest-schema.ts); what remains here is
// the consumer vocabulary: which control ids must exist and what their slot
// arrays must contain.
function collectConsumers(manifest: HarnessManifest): readonly Consumer[] {
  const byId = new Map<string, HarnessControl>(
    manifest.controls.map((control) => [control.id, control]),
  );
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

function markerBridgeAllowedDivergences(
  reasons: HarnessManifest["verifyStepBridgeDivergenceReasons"],
  supersetId: string,
): ReadonlySet<string> {
  return new Set(
    reasons.filter((entry) => entry.supersetId === supersetId).map((entry) => entry.slot),
  );
}

// Human-readable rendering for divergence messages: a space-joined command line.
// Never compare on this — distinct token vectors can flatten to the same string
// (`["--foo", "a b"]` vs `["--foo a", "b"]`), which would hide a real drift.
function slotCommandDisplay(slot: VerifyStepSlot): string {
  const tokens = verifyStepCommandTokens(slot).join(" ");
  return slot.dynamic === undefined ? tokens : `${tokens} [dynamic:${slot.dynamic}]`;
}

function assertSlotSuperset(
  superset: Consumer,
  subset: Consumer,
  markerLabel: string,
  allowed: ReadonlySet<string>,
): void {
  const supersetByName = new Map(superset.slots.map((slot) => [slot.name, slot] as const));
  const missing: string[] = [];
  const diverged: string[] = [];

  for (const slot of subset.slots) {
    const supersetSlot = supersetByName.get(slot.name);
    if (supersetSlot === undefined) {
      missing.push(slot.name);
      continue;
    }
    const subsetSignature = verifyStepBridgeSignature(slot);
    const supersetSignature = verifyStepBridgeSignature(supersetSlot);
    if (subsetSignature !== supersetSignature) {
      if (allowed.has(slot.name)) continue;
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
      `${superset.spec.id} and ${subset.spec.id} must render identical command tokens for every shared slot because pre-commit accepts fresh ${markerLabel} success markers; divergent: ${diverged.join(", ")}. If a divergence is intentional, declare its reason on the catalog changed form or pre-commit profile override in harness.controls.json.`,
    );
  }
}

function assertMarkerBridgeSupersets(
  consumers: readonly Consumer[],
  reasons: HarnessManifest["verifyStepBridgeDivergenceReasons"],
): void {
  // Changed/staged-mode commands may be blessed against full verify's stronger
  // whole-tree/worktree forms because both marker bridges use the worktree
  // fingerprint; every other shared slot must remain signature-identical.
  const preCommit = findConsumer(consumers, PRE_COMMIT_CONSUMER_ID);
  for (const { id, markerLabel } of MARKER_BRIDGE_SUPERSET_CONSUMERS) {
    assertSlotSuperset(
      findConsumer(consumers, id),
      preCommit,
      markerLabel,
      markerBridgeAllowedDivergences(reasons, id),
    );
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
    `${variableName}=${shellArray(verifyStepCommandTokens(slot))}`,
    `MUSI_VERIFY_SLOT_CMD_VAR[${shellQuote(key)}]=${shellQuote(variableName)}`,
  ];
  if (slot.dynamic !== undefined) {
    lines.push(`MUSI_VERIFY_SLOT_DYNAMIC[${shellQuote(key)}]=${shellQuote(slot.dynamic)}`);
  }
  if (slot.produces !== undefined) {
    lines.push(`MUSI_VERIFY_SLOT_PRODUCES[${shellQuote(key)}]=${shellQuote(slot.produces)}`);
  }
  if (slot.requiresArtifact !== undefined) {
    lines.push(
      `MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT[${shellQuote(key)}]=${shellQuote(slot.requiresArtifact)}`,
    );
  }
  lines.push("");
  return lines;
}

function renderSlots(consumers: readonly Consumer[]): string[] {
  // Declared unconditionally, populated only from declarations: a manifest with
  // no artifact edges generates empty maps, and the runner's deferral branch —
  // guarded on an empty lookup — disappears for an adopter without a producing
  // slot.
  const lines = [
    "declare -gA MUSI_VERIFY_SLOT_CMD_VAR=()",
    "declare -gA MUSI_VERIFY_SLOT_DYNAMIC=()",
    "declare -gA MUSI_VERIFY_SLOT_PRODUCES=()",
    "declare -gA MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT=()",
    "declare -gA MUSI_VERIFY_DYNAMIC_RESOLVER_FUNC=()",
    "declare -gA MUSI_VERIFY_ARTIFACT_PROBE_FUNC=()",
    "declare -gA MUSI_VERIFY_ARTIFACT_SUMMARY=()",
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

function artifactPrograms(consumers: readonly Consumer[]): readonly VerifyArtifactProgram[] {
  return consumers.map((consumer) => ({ id: consumer.spec.id, slots: consumer.slots }));
}

function assertArtifactClosure(consumers: readonly Consumer[]): void {
  const failures = collectVerifyArtifactFailures(artifactPrograms(consumers));
  if (failures.length > 0) throw new Error(failures.join("; "));
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
  manifest: HarnessManifest,
  knownScripts?: ReadonlySet<string>,
): string {
  const consumers = collectConsumers(manifest);
  assertMarkerBridgeSupersets(consumers, manifest.verifyStepBridgeDivergenceReasons);
  assertArtifactClosure(consumers);
  if (knownScripts !== undefined) assertKnownScripts(consumers, knownScripts);
  const lines = [
    ...renderHeader(consumers),
    ...renderConsumerMetadata(consumers),
    ...renderFastCommitSkipSlots(consumers),
    ...renderSlots(consumers),
    ...renderDynamicResolverDispatch(),
    ...renderVerifyArtifactBindings(artifactPrograms(consumers), shellQuote),
  ];
  while (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

/** Which `harness:check` surface re-renders a projection to prove it fresh. */
export type VerifyStepProjectionChecker = "collector" | "fixtureClosure";

export interface VerifyStepProjectionContext {
  readonly records: readonly GeneratedSurfaceRecord[];
  /** Absent when the typed manifest failed its schema contract. */
  readonly manifest?: HarnessManifest;
  readonly knownScripts?: ReadonlySet<string>;
  /** Absent when the derived fixture copy closure was not computed. */
  readonly fixturePaths?: readonly string[];
}

/** Context inputs a projection may need that are not always available. */
export type VerifyStepProjectionInput = "manifest" | "fixturePaths";

/**
 * Which optional inputs each checker's context supplies. This makes `checkedBy`
 * more than a label: a projection may only require inputs its own owner
 * provides, so the owner's pass always reaches it. Preflight asserts that,
 * which is what turns path-set parity into a proof that every advertised output
 * has a writer — a mis-tagged `checkedBy` otherwise renders `undefined` in the
 * only pass that offers it and is never selected by the other.
 */
export const VERIFY_STEP_PROJECTION_CHECKER_INPUTS: Readonly<
  Record<VerifyStepProjectionChecker, readonly VerifyStepProjectionInput[]>
> = {
  collector: ["manifest"],
  fixtureClosure: ["fixturePaths"],
};

export interface VerifyStepProjection {
  readonly outputPath: string;
  readonly checkedBy: VerifyStepProjectionChecker;
  /**
   * Optional context inputs {@link render} needs. `render` returns `undefined`
   * exactly when one is absent, and every caller that tolerates that reports
   * the absence itself (a manifest that failed its schema contract; a
   * dependency walk that failed), so the sentinel never means "no writer".
   */
  readonly requires: readonly VerifyStepProjectionInput[];
  /** Renders the output, or `undefined` when a {@link requires} input is absent. */
  readonly render: (context: VerifyStepProjectionContext) => string | undefined;
}

/**
 * The projection set `bun run verify:steps` writes: one typed descriptor read
 * by the producer below, by the collector-side freshness checker
 * (registration-generated-checks.ts), and by the fixture-closure checker
 * (fixture-closure-check.ts), so producer and checkers cannot drift on which
 * renderer feeds which output or on who proves it fresh.
 *
 * `harness.controls.json` stays the registration authority: this list carries
 * no registration of its own, and registration-preflight-wiring.ts asserts it
 * agrees with check/verify-steps-generator's `generatedSurface.outputPaths`
 * exactly, in both directions — plus that each entry's `requires` is something
 * its `checkedBy` owner supplies, so agreement means "has a writer" rather than
 * only "the two lists name the same paths".
 */
export const VERIFY_STEP_PROJECTIONS: readonly VerifyStepProjection[] = [
  {
    outputPath: GENERATED_VERIFY_STEPS_PATH,
    checkedBy: "collector",
    requires: ["manifest"],
    render: ({ manifest, knownScripts }) =>
      manifest === undefined
        ? undefined
        : renderVerifyStepsShellFromManifest(manifest, knownScripts),
  },
  {
    outputPath: GENERATED_SURFACE_FRESHNESS_PATH,
    checkedBy: "collector",
    requires: [],
    render: ({ records }) => renderFreshnessShell(records),
  },
  {
    outputPath: GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH,
    checkedBy: "collector",
    requires: [],
    render: ({ records }) => renderClassifierFragment(records),
  },
  {
    outputPath: GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH,
    checkedBy: "fixtureClosure",
    requires: ["fixturePaths"],
    render: ({ fixturePaths }) =>
      fixturePaths === undefined ? undefined : renderFixtureManifest(fixturePaths),
  },
];

/**
 * Render every projection `owner` writes. A selected projection that renders
 * nothing is a wiring bug, not a skip: the producer supplies exactly the inputs
 * the owner advertises, so `bun run verify:steps` names the output that would
 * otherwise have been dropped instead of quietly writing one file fewer.
 */
export function renderProjectionsFor(
  owner: VerifyStepProjectionChecker,
  context: VerifyStepProjectionContext,
): readonly { readonly outputPath: string; readonly rendered: string }[] {
  const rendered: { readonly outputPath: string; readonly rendered: string }[] = [];
  for (const projection of VERIFY_STEP_PROJECTIONS) {
    if (projection.checkedBy !== owner) continue;
    const output = projection.render(context);
    if (output === undefined) {
      const missing = projection.requires.filter((input) => context[input] === undefined);
      throw new Error(
        `the ${owner} pass rendered nothing for ${projection.outputPath}: missing ` +
          (missing.length > 0 ? missing.join(", ") : "nothing it declared as required"),
      );
    }
    rendered.push({ outputPath: projection.outputPath, rendered: output });
  }
  return rendered;
}

function readPackageScripts(): ReadonlySet<string> {
  const pkg: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  if (!isRecord(pkg) || !isRecord(pkg.scripts)) {
    throw new Error("package.json must declare a scripts object");
  }
  return new Set(Object.keys(pkg.scripts));
}

/** A producer pass's context, or `undefined` when the run has no such pass. */
type PassContext = VerifyStepProjectionContext | undefined;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const generatedSurfaces = loadGeneratedSurfaces(repoRoot);
  // One model per run rather than one per projection: every projection reads
  // the same manifest, surface records, and script names.
  const context: VerifyStepProjectionContext = {
    records: generatedSurfaces,
    manifest: loadTypedHarnessManifest(repoRoot),
    knownScripts: readPackageScripts(),
  };
  // One entry per owner the descriptor can name, keyed exhaustively: an owner
  // added to VerifyStepProjectionChecker without a context here is a type
  // error, and the pass loop below iterates the descriptor rather than a
  // hand-written call list, so no call site decides on its own whether an
  // owner runs. Returning `undefined` is the single documented opt-out (a
  // walker-less tree with no fixture residue to derive anything from).
  const passes: Record<VerifyStepProjectionChecker, () => PassContext | Promise<PassContext>> = {
    collector: () => context,
    fixtureClosure: async () => {
      const allowWalkerless = process.env[FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV] === "1";
      const declared = generatedSurfaces.some((record) => record.fixtureExtras !== undefined);
      if (!declared && allowWalkerless) return undefined;
      const dependencies = await deriveGeneratedSurfaceDependencies(repoRoot, generatedSurfaces, {
        allowDeclaredFallback: allowWalkerless,
      });
      if (dependencies.failures.length > 0) throw new Error(dependencies.failures.join("\n"));
      return { ...context, fixturePaths: dependencies.fixturePaths };
    },
  };

  // Descriptor order is pass order: the directly rendered projections come
  // first, so a bootstrap run adding a new generated surface still lands them
  // before the derived fixture closure, whose dependency walk can fail.
  for (const owner of new Set(VERIFY_STEP_PROJECTIONS.map((entry) => entry.checkedBy))) {
    const ownerContext = await passes[owner]();
    if (ownerContext === undefined) continue;
    for (const { outputPath, rendered } of renderProjectionsFor(owner, ownerContext)) {
      runDocGenerator({
        outputPath: join(repoRoot, outputPath),
        refreshCommand: "verify:steps",
        render: () => ({ rendered }),
      });
    }
  }
}
