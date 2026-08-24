// Descriptive projections shared by the registration explain matchers: the
// control/generated/hook/slot summaries, slot-edge walking, smoke-subject
// selection, and per-control enrichment derived from the parsed registration
// authorities. Consumed by registration-explain-matchers.ts.

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { isRecord } from "../lib/records.js";
import { SHARED_FIXTURE_INFRA_RECORD_ID } from "./generated-surface-dependencies.js";
import { type GeneratedSurfaceRecord, pathListCovers } from "./generated-surfaces.js";
import { extractBunRunScript } from "./harness-check-validation.js";
import type { HarnessManifest } from "./harness-manifest-schema.js";
import { commandShimRelPath } from "./hook-shims.js";
import type {
  ExplainAuthorities,
  ExplainControlSummary,
  ExplainGeneratedSummary,
  ExplainHookSummary,
  ExplainPathPolicy,
  ExplainSlotSummary,
  ExplainSmokeSelection,
} from "./registration-explain-model.js";
import type { VerifyStepSlot } from "./verify-step-schema.js";

type ManifestControl = HarnessManifest["controls"][number];

/** Read one facet-interior string; facet interiors are deliberately open. */
function stringField(record: unknown, key: string): string | undefined {
  if (!isRecord(record)) return undefined;
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Manifest sentinel for a control that deliberately has no paired guide. */
const PAIRED_GUIDE_NONE_SENTINEL = "none";

export function describeControl(control: ManifestControl): ExplainControlSummary {
  const script = extractBunRunScript(control.invocation);
  const declaredGuide = "pairedGuide" in control ? control.pairedGuide : undefined;
  // Mirror control-field-validation.ts: "none" declares absence, so it must
  // not surface as a guide path (or 83 production controls would match
  // `--path none`) nor render as a real paired guide in summaries.
  const pairedGuide = declaredGuide === PAIRED_GUIDE_NONE_SENTINEL ? undefined : declaredGuide;
  return {
    id: control.id,
    kind: control.kind,
    source: control.source,
    invocation: control.invocation,
    ...(script === undefined ? {} : { script }),
    ...(pairedGuide === undefined ? {} : { pairedGuide }),
  };
}

/**
 * The record's effective smoke-fixture copy paths: its own walked import
 * closure plus its declared fixtureExtras residue, with the same filtering
 * deriveFixturePaths applies (generated outputs and fixture-synthesized files
 * satisfy closure edges without being copied). Closure entries whose owner is
 * not a generated-surface record are the validator roots, which belong to the
 * shared infra record — the ownership rule fixture-residue validation already
 * documents (see sharedOwnerSuffix in generated-surface-dependencies.ts).
 */
export function effectiveFixturePaths(
  record: GeneratedSurfaceRecord,
  authorities: ExplainAuthorities,
): readonly string[] {
  const closure = authorities.fixtureClosure;
  const outputs = authorities.generatedSurfaces.flatMap((candidate) => candidate.outputPaths);
  const recordIds = new Set(authorities.generatedSurfaces.map((candidate) => candidate.id));
  const synthesized = new Set(closure.synthesizedPaths);
  const owned = closure.entries
    .filter(
      (entry) =>
        entry.ownerId === record.id ||
        (record.id === SHARED_FIXTURE_INFRA_RECORD_ID && !recordIds.has(entry.ownerId)),
    )
    .flatMap((entry) => entry.files)
    .filter((file) => !pathListCovers(outputs, file) && !synthesized.has(file));
  const extras = (record.fixtureExtras ?? []).map((extra) => extra.path);
  return [...new Set([...owned, ...extras])].sort(compareByCodepoint);
}

export function describeGenerated(
  record: GeneratedSurfaceRecord,
  authorities: ExplainAuthorities,
): ExplainGeneratedSummary {
  return {
    checkScript: record.checkScript,
    refreshScript: record.refreshScript,
    triggerPaths: [...record.triggerPaths].sort(compareByCodepoint),
    outputPaths: [...record.outputPaths].sort(compareByCodepoint),
    fixturePaths: effectiveFixturePaths(record, authorities),
  };
}

function describeHook(control: ManifestControl): ExplainHookSummary | undefined {
  const wiring = "hookWiring" in control ? control.hookWiring : undefined;
  if (wiring === undefined) return undefined;
  const event = stringField(wiring, "event");
  const surface = stringField(wiring, "surface");
  const body = stringField(wiring, "body");
  if (event === undefined && surface === undefined && body === undefined) return undefined;
  return {
    ...(event === undefined ? {} : { event }),
    ...(surface === undefined ? {} : { surface }),
    ...(body === undefined ? {} : { body }),
  };
}

/**
 * Repo-relative harness adapter shim paths declared by a hook control's
 * `hookWiring.harnesses.*.command` entries. The facet interior is open, so
 * unrecognized command shapes contribute nothing instead of failing.
 */
export function hookHarnessShimPaths(control: ManifestControl): readonly string[] {
  const wiring = "hookWiring" in control ? control.hookWiring : undefined;
  const harnesses = isRecord(wiring) ? wiring["harnesses"] : undefined;
  if (!isRecord(harnesses)) return [];
  const paths = new Set<string>();
  for (const entry of Object.values(harnesses)) {
    const command = stringField(entry, "command");
    const shim = command === undefined ? undefined : commandShimRelPath(command);
    if (shim !== undefined) paths.add(shim);
  }
  return [...paths].sort(compareByCodepoint);
}

export interface SlotEdge {
  readonly consumer: string;
  readonly slot: VerifyStepSlot;
}

export function slotEdges(manifest: HarnessManifest): readonly SlotEdge[] {
  const edges: SlotEdge[] = [];
  for (const control of manifest.controls) {
    if (!("slots" in control) || control.slots === undefined) continue;
    for (const slot of control.slots) edges.push({ consumer: control.id, slot });
  }
  return edges;
}

export function describeSlot(edge: SlotEdge): ExplainSlotSummary {
  return {
    consumer: edge.consumer,
    name: edge.slot.name,
    script: edge.slot.script,
    ...(edge.slot.dynamic === undefined ? {} : { dynamic: edge.slot.dynamic }),
    ...(edge.slot.condition === undefined ? {} : { condition: edge.slot.condition }),
  };
}

function compareSlots(a: ExplainSlotSummary, b: ExplainSlotSummary): number {
  return compareByCodepoint(`${a.consumer} ${a.name}`, `${b.consumer} ${b.name}`);
}

function slotsRunningScripts(
  edges: readonly SlotEdge[],
  scripts: ReadonlySet<string>,
): readonly ExplainSlotSummary[] {
  return edges
    .filter((edge) => scripts.has(edge.slot.script))
    .map(describeSlot)
    .sort(compareSlots);
}

export function smokeSelectionsForPath(
  pathPolicy: ExplainPathPolicy,
  path: string,
): readonly ExplainSmokeSelection[] {
  const selections: ExplainSmokeSelection[] = [];
  for (const test of [...pathPolicy.smokeTestNames].sort(compareByCodepoint)) {
    const subjects = [...(pathPolicy.smokeSubjects[test] ?? [])].sort(compareByCodepoint);
    for (const subject of subjects) {
      if (pathListCovers([subject], path)) selections.push({ test, subject });
    }
  }
  if (
    pathPolicy.isSmokeTestPath(path) &&
    pathPolicy.smokeTestNames.includes(pathPolicy.metadataFreshnessTestName)
  ) {
    selections.push({ test: pathPolicy.metadataFreshnessTestName });
  }
  return selections;
}

export interface ControlEnrichment {
  readonly generated?: ExplainGeneratedSummary;
  readonly hook?: ExplainHookSummary;
  readonly verifySlots?: readonly ExplainSlotSummary[];
  readonly smokeSelections?: readonly ExplainSmokeSelection[];
}

function dedupeSlots(slots: readonly ExplainSlotSummary[]): readonly ExplainSlotSummary[] {
  const byKey = new Map(slots.map((slot) => [`${slot.consumer}\u0000${slot.name}`, slot]));
  return [...byKey.values()].sort(compareSlots);
}

/**
 * The full joined chain for one control: its generated surface, hook wiring,
 * every verify-slot relation (both the slots the control itself declares and
 * the slots elsewhere that run its scripts), and the smoke selections its
 * source path triggers. Walking both slot directions matters: a verify
 * wrapper or hook declares slots as their consumer, while a check control is
 * reached from slots running its check or refresh script.
 */
export function enrichControl(
  control: ManifestControl,
  summary: ExplainControlSummary,
  authorities: ExplainAuthorities,
  edges: readonly SlotEdge[],
): ControlEnrichment {
  const record = authorities.generatedSurfaces.find((candidate) => candidate.id === summary.id);
  const hook = describeHook(control);
  const consumedScripts = new Set(
    [summary.script, record?.checkScript].filter((name): name is string => name !== undefined),
  );
  const verifySlots = dedupeSlots([
    ...edges.filter((edge) => edge.consumer === summary.id).map(describeSlot),
    ...slotsRunningScripts(edges, consumedScripts),
  ]);
  const smokeSelections = smokeSelectionsForPath(authorities.pathPolicy, summary.source);
  return {
    ...(record === undefined ? {} : { generated: describeGenerated(record, authorities) }),
    ...(hook === undefined ? {} : { hook }),
    ...(verifySlots.length === 0 ? {} : { verifySlots }),
    ...(smokeSelections.length === 0 ? {} : { smokeSelections }),
  };
}

/** Verify slots that run the record's generated check or refresh script. */
export function slotsConsumingGenerated(
  record: GeneratedSurfaceRecord,
  edges: readonly SlotEdge[],
): readonly ExplainSlotSummary[] {
  return slotsRunningScripts(edges, new Set([record.checkScript, record.refreshScript]));
}

export function coveringEntries(paths: readonly string[], file: string): readonly string[] {
  return paths.filter((entry) => pathListCovers([entry], file));
}

export function commandTokens(command: string): readonly string[] {
  return command.split(/\s+/u).map((token) => token.replace(/^\.\//u, ""));
}

export function controlSummariesById(
  manifest: HarnessManifest,
): ReadonlyMap<string, ExplainControlSummary> {
  return new Map(manifest.controls.map((control) => [control.id, describeControl(control)]));
}
