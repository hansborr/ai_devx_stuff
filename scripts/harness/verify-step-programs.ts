// Resolves the authored two-axis verify program into the materialized slot
// arrays consumed everywhere else. The catalog owns positional order and the
// full/changed command forms; profiles select one mode and may replace a slot
// only with an explicit reason. Runtime ordering/dependency behavior remains
// outside this module in scripts/verify/steps-lib.sh.

import {
  VERIFY_STEP_ARTIFACT_SLOT_KEYS,
  type VerifyStepSlotArtifacts,
} from "./verify-step-artifacts.js";
import { parseVerifyStepSlots, type VerifyStepSlot } from "./verify-step-schema.js";

interface VerifyStepReason {
  readonly slot: string;
  readonly reason: string;
}

export interface VerifyStepBridgeReason extends VerifyStepReason {
  readonly supersetId: string;
}

export interface ResolvedVerifyStepCatalog {
  readonly full: readonly VerifyStepSlot[];
  readonly changed: readonly VerifyStepSlot[];
  readonly changedReasons: readonly VerifyStepReason[];
}

export interface ResolvedVerifyStepProfile {
  readonly slots: readonly VerifyStepSlot[];
  readonly overrideReasons: readonly VerifyStepReason[];
}

interface ResolvedCatalogEntry {
  readonly full?: VerifyStepSlot;
  readonly changed?: VerifyStepSlot;
  readonly changedReason?: VerifyStepReason;
}

interface ChangedDispositionContext {
  readonly name: string;
  readonly artifacts: VerifyStepSlotBodyInput;
  readonly fullSlot?: VerifyStepSlot;
  readonly failures: string[];
  readonly path: string;
}

interface VerifyStepSlotBodyInput {
  readonly [key: string]: unknown;
}

type ChangedVerifyStepDispositionInput =
  | { readonly kind: "inherit" }
  | { readonly kind: "omit"; readonly reason: string }
  | {
      readonly kind: "replace";
      readonly reason: string;
      readonly slot: VerifyStepSlotBodyInput;
    };

export interface VerifyStepCatalogEntryInput {
  readonly name: string;
  readonly full: VerifyStepSlotBodyInput;
  readonly changed: ChangedVerifyStepDispositionInput;
  readonly produces?: string;
  readonly requiresArtifact?: string;
}

/**
 * Artifact edges describe the slot, not one of its command forms: lint needs
 * the dist outputs whether it runs whole-tree or changed-only. Declaring them
 * on the catalog entry means every resolved form — full, changed replacement,
 * and gate override alike — carries the same edge, so a replacement body can
 * never silently drop the slot out of the scheduler's deferral set.
 */
function entryArtifactFields(
  source:
    | VerifyStepSlotArtifacts
    | { readonly produces?: string; readonly requiresArtifact?: string },
): VerifyStepSlotBodyInput {
  return {
    ...(source.produces === undefined ? {} : { produces: source.produces }),
    ...(source.requiresArtifact === undefined ? {} : { requiresArtifact: source.requiresArtifact }),
  };
}

interface ProfileOverrideContext {
  readonly base: readonly VerifyStepSlot[];
  readonly failures: string[];
  readonly controlId: string;
  readonly mode: "full" | "changed";
}

interface VerifyStepProfileOverride {
  readonly name: string;
  readonly reason: string;
  readonly slot: VerifyStepSlotBodyInput;
}

interface VerifyStepProfileInput {
  readonly mode: "full" | "changed";
  readonly overrides?: readonly VerifyStepProfileOverride[];
}

interface NamedSlotComposition {
  readonly name: string;
  readonly artifacts: VerifyStepSlotBodyInput;
  readonly context: string;
}

function parseNamedSlot(
  composition: NamedSlotComposition,
  rawBody: VerifyStepSlotBodyInput,
  failures: string[],
): VerifyStepSlot | undefined {
  const { name, artifacts, context } = composition;
  const restated = ["name", ...VERIFY_STEP_ARTIFACT_SLOT_KEYS].filter((key) => key in rawBody);
  if (restated.length > 0) {
    failures.push(
      `${context} slot must not restate ${restated.join(", ")}; the catalog entry owns ${restated.length === 1 ? "it" : "them"}`,
    );
    return undefined;
  }
  const slots = parseVerifyStepSlots([{ ...rawBody, ...artifacts, name }], failures, `${context} `);
  return slots?.[0];
}

function resolveChangedDisposition(
  rawChanged: ChangedVerifyStepDispositionInput,
  context: ChangedDispositionContext,
): Pick<ResolvedCatalogEntry, "changed" | "changedReason"> {
  if (rawChanged.kind === "inherit") return { changed: context.fullSlot };
  if (rawChanged.kind === "omit") return {};
  const changed = parseNamedSlot(
    { name: context.name, artifacts: context.artifacts, context: `${context.path}.changed` },
    rawChanged.slot,
    context.failures,
  );
  return changed === undefined
    ? {}
    : { changed, changedReason: { slot: context.name, reason: rawChanged.reason } };
}

function resolveCatalogEntry(
  rawEntry: VerifyStepCatalogEntryInput,
  index: number,
  seen: Set<string>,
  failures: string[],
): ResolvedCatalogEntry {
  const context = `verifySlotCatalog[${String(index)}]`;
  const name = rawEntry.name;
  if (seen.has(name)) {
    failures.push(`duplicate verifySlotCatalog slot name: ${name}`);
    return {};
  }
  seen.add(name);
  const artifacts = entryArtifactFields(rawEntry);
  const full = parseNamedSlot(
    { name, artifacts, context: `${context}.full` },
    rawEntry.full,
    failures,
  );
  return {
    full,
    ...resolveChangedDisposition(rawEntry.changed, {
      name,
      artifacts,
      fullSlot: full,
      failures,
      path: context,
    }),
  };
}

export function resolveVerifyStepCatalog(
  rawCatalog: readonly VerifyStepCatalogEntryInput[] | undefined,
  failures: string[],
): ResolvedVerifyStepCatalog | undefined {
  if (rawCatalog === undefined) return undefined;
  const full: VerifyStepSlot[] = [];
  const changed: VerifyStepSlot[] = [];
  const changedReasons: VerifyStepReason[] = [];
  const seen = new Set<string>();

  for (const [index, rawEntry] of rawCatalog.entries()) {
    const entry = resolveCatalogEntry(rawEntry, index, seen, failures);
    if (entry.full !== undefined) full.push(entry.full);
    if (entry.changed !== undefined) changed.push(entry.changed);
    if (entry.changedReason !== undefined) changedReasons.push(entry.changedReason);
  }

  return { full, changed, changedReasons };
}

function collectProfileOverrides(
  rawOverrides: readonly VerifyStepProfileOverride[] | undefined,
  context: ProfileOverrideContext,
): {
  readonly replacements: ReadonlyMap<string, VerifyStepSlot>;
  readonly reasons: readonly VerifyStepReason[];
} {
  const replacements = new Map<string, VerifyStepSlot>();
  const reasons: VerifyStepReason[] = [];
  const available = new Map(context.base.map((slot) => [slot.name, slot] as const));
  for (const [index, rawOverride] of (rawOverrides ?? []).entries()) {
    const overridePath = `${context.controlId} slotProfile.overrides[${String(index)}]`;
    const name = rawOverride.name;
    const baseSlot = available.get(name);
    if (baseSlot === undefined) {
      context.failures.push(
        `${overridePath} targets slot ${name}, which is absent from ${context.mode} mode`,
      );
      continue;
    }
    if (replacements.has(name)) {
      context.failures.push(
        `${context.controlId} slotProfile has duplicate override for slot ${name}`,
      );
      continue;
    }
    const slot = parseNamedSlot(
      { name, artifacts: entryArtifactFields(baseSlot), context: overridePath },
      rawOverride.slot,
      context.failures,
    );
    if (slot === undefined) continue;
    replacements.set(name, slot);
    reasons.push({ slot: name, reason: rawOverride.reason });
  }
  return { replacements, reasons };
}

export function resolveVerifyStepProfile(
  catalog: ResolvedVerifyStepCatalog,
  rawProfile: VerifyStepProfileInput,
  failures: string[],
  controlId: string,
): ResolvedVerifyStepProfile {
  const base = rawProfile.mode === "full" ? catalog.full : catalog.changed;
  const overrides = collectProfileOverrides(rawProfile.overrides, {
    base,
    failures,
    controlId,
    mode: rawProfile.mode,
  });
  const slots = base.map((slot) => overrides.replacements.get(slot.name) ?? slot);
  if (slots.length === 0) {
    failures.push(`${controlId} slotProfile resolves to an empty slots array`);
  }
  return { slots, overrideReasons: overrides.reasons };
}
