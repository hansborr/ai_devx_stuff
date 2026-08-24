// Match builders for the registration explain view. Each selector kind maps
// to one builder that derives every declared relation — controls, generated
// surfaces, package scripts, verify slots, hooks, and smoke selections — from
// the parsed registration authorities. Matches stay distinct: a selector with
// several governing records reports one match per declared relation instead
// of collapsing them into one inferred owner.

import { extractBunRunScript } from "./harness-check-validation.js";
import {
  commandTokens,
  controlSummariesById,
  coveringEntries,
  describeControl,
  describeGenerated,
  describeSlot,
  effectiveFixturePaths,
  enrichControl,
  hookHarnessShimPaths,
  type SlotEdge,
  slotEdges,
  slotsConsumingGenerated,
  smokeSelectionsForPath,
} from "./registration-explain-describe.js";
import type {
  ExplainAuthorities,
  ExplainControlSummary,
  ExplainMatch,
} from "./registration-explain-model.js";

function controlPathMatches(path: string, authorities: ExplainAuthorities): ExplainMatch[] {
  const edges = slotEdges(authorities.manifest);
  const matches: ExplainMatch[] = [];
  for (const control of authorities.manifest.controls) {
    const summary = describeControl(control);
    const enrichment = enrichControl(control, summary, authorities, edges);
    if (summary.source === path) {
      matches.push({ reason: "control-source", matched: path, control: summary, ...enrichment });
    }
    // Control-scoped enrichment (generated surface, hook, verify slots,
    // smoke selections) describes the control's source and identity, not the
    // guide document; carrying it here would let a JSON consumer misread
    // source-scoped joins as guide relations, so the match stays control-only
    // (the hook-body and hook-harness-command branches follow the same rule).
    if (summary.pairedGuide === path) {
      matches.push({ reason: "control-paired-guide", matched: path, control: summary });
    }
    if (enrichment.hook?.body === path) {
      matches.push({ reason: "hook-body", matched: path, control: summary, hook: enrichment.hook });
    }
    if (enrichment.hook !== undefined && hookHarnessShimPaths(control).includes(path)) {
      matches.push({
        reason: "hook-harness-command",
        matched: path,
        control: summary,
        hook: enrichment.hook,
      });
    }
  }
  return matches;
}

/**
 * Generated-surface records are parsed from the same manifest controls the
 * summaries are keyed by, and explain reports are only built over a clean
 * registration state, so every record has an owning control. Failing loudly
 * here beats a defensive ownerless record that silently weakens the join.
 */
function ownerSummary(
  owners: ReadonlyMap<string, ExplainControlSummary>,
  recordId: string,
): ExplainControlSummary {
  const owner = owners.get(recordId);
  if (owner === undefined) {
    throw new Error(`generated-surface record ${recordId} has no owning manifest control`);
  }
  return owner;
}

function generatedPathMatches(path: string, authorities: ExplainAuthorities): ExplainMatch[] {
  const owners = controlSummariesById(authorities.manifest);
  const edges = slotEdges(authorities.manifest);
  const matches: ExplainMatch[] = [];
  for (const record of authorities.generatedSurfaces) {
    const generated = describeGenerated(record, authorities);
    const verifySlots = slotsConsumingGenerated(record, edges);
    const base = {
      control: ownerSummary(owners, record.id),
      generated,
      ...(verifySlots.length === 0 ? {} : { verifySlots }),
    };
    for (const entry of coveringEntries(record.triggerPaths, path)) {
      matches.push({ reason: "generated-trigger", matched: entry, ...base });
    }
    for (const entry of coveringEntries(record.outputPaths, path)) {
      matches.push({ reason: "generated-output", matched: entry, ...base });
    }
    const extras = new Set((record.fixtureExtras ?? []).map((extra) => extra.path));
    for (const entry of effectiveFixturePaths(record, authorities)) {
      if (entry !== path) continue;
      matches.push({
        reason: extras.has(entry) ? "generated-fixture-extra" : "generated-fixture-dependency",
        matched: entry,
        ...base,
      });
    }
  }
  return matches;
}

/**
 * A path appearing in a package-script command explains the script, and the
 * script's own downstream chain — the controls invoked or repaired through
 * it, the generated surfaces that check, refresh, or classify it, and the
 * verify slots that run it — explains the path end to end. Reusing the whole
 * script-name enrichment seam keeps `--path scripts/lint.sh` and
 * `--script lint` in parity instead of stopping the path walk at the script.
 */
function scriptCommandPathMatches(path: string, authorities: ExplainAuthorities): ExplainMatch[] {
  const matches: ExplainMatch[] = [];
  for (const [name, command] of authorities.scripts) {
    if (!commandTokens(command).includes(path)) continue;
    matches.push({
      reason: "package-script-command",
      matched: name,
      packageScript: { name, command },
    });
    matches.push(...scriptNameMatches(name, authorities));
  }
  return matches;
}

function smokePathMatches(path: string, authorities: ExplainAuthorities): ExplainMatch[] {
  return smokeSelectionsForPath(authorities.pathPolicy, path).map((smoke) => ({
    reason: smoke.subject === undefined ? "smoke-metadata-freshness" : "smoke-subject",
    matched: smoke.subject ?? smoke.test,
    smoke,
  }));
}

export function pathMatches(path: string, authorities: ExplainAuthorities): ExplainMatch[] {
  return [
    ...controlPathMatches(path, authorities),
    ...generatedPathMatches(path, authorities),
    ...scriptCommandPathMatches(path, authorities),
    ...smokePathMatches(path, authorities),
  ];
}

export function controlMatches(id: string, authorities: ExplainAuthorities): ExplainMatch[] {
  const control = authorities.manifest.controls.find((candidate) => candidate.id === id);
  if (control === undefined) return [];
  const summary = describeControl(control);
  const enrichment = enrichControl(control, summary, authorities, slotEdges(authorities.manifest));
  const command =
    summary.script === undefined ? undefined : authorities.scripts.get(summary.script);
  return [
    {
      reason: "control-id",
      matched: id,
      control: summary,
      ...enrichment,
      ...(summary.script === undefined || command === undefined
        ? {}
        : { packageScript: { name: summary.script, command } }),
    },
  ];
}

function controlScriptMatches(name: string, authorities: ExplainAuthorities): ExplainMatch[] {
  const edges = slotEdges(authorities.manifest);
  const matches: ExplainMatch[] = [];
  for (const control of authorities.manifest.controls) {
    const summary = describeControl(control);
    if (summary.script === name) {
      matches.push({
        reason: "control-invocation",
        matched: name,
        control: summary,
        ...enrichControl(control, summary, authorities, edges),
      });
    }
    const repairCommand = "repairCommand" in control ? control.repairCommand : undefined;
    const repairScript =
      repairCommand === undefined ? undefined : extractBunRunScript(repairCommand);
    if (repairScript === name) {
      matches.push({ reason: "control-repair-command", matched: name, control: summary });
    }
  }
  return matches;
}

function verifySlotScriptMatches(name: string, edges: readonly SlotEdge[]): ExplainMatch[] {
  return edges
    .filter((edge) => edge.slot.script === name)
    .map((edge) => ({ reason: "verify-slot", matched: edge.slot.name, slot: describeSlot(edge) }));
}

function generatedScriptMatches(name: string, authorities: ExplainAuthorities): ExplainMatch[] {
  const owners = controlSummariesById(authorities.manifest);
  const matches: ExplainMatch[] = [];
  for (const record of authorities.generatedSurfaces) {
    const base = { control: ownerSummary(owners, record.id) };
    const generated = describeGenerated(record, authorities);
    if (record.checkScript === name) {
      matches.push({ reason: "generated-check-script", matched: name, ...base, generated });
    }
    if (record.refreshScript === name) {
      matches.push({ reason: "generated-refresh-script", matched: name, ...base, generated });
    }
    if (record.bunHook.scripts !== undefined && Object.hasOwn(record.bunHook.scripts, name)) {
      matches.push({ reason: "generated-classified-script", matched: name, ...base, generated });
    }
  }
  return matches;
}

/**
 * Every script-name-scoped relation for one package-script name: the controls
 * invoked or repaired through it, the generated surfaces that check, refresh,
 * or classify it, and the verify slots that run it. This is deliberately the
 * single enrichment seam behind both the script selector and the command-path
 * traversal, so a script-scoped join added here reaches path selectors too
 * instead of opening a new parity gap between the two directions.
 */
function scriptNameMatches(name: string, authorities: ExplainAuthorities): ExplainMatch[] {
  return [
    ...controlScriptMatches(name, authorities),
    ...generatedScriptMatches(name, authorities),
    ...verifySlotScriptMatches(name, slotEdges(authorities.manifest)),
  ];
}

export function scriptMatches(name: string, authorities: ExplainAuthorities): ExplainMatch[] {
  const command = authorities.scripts.get(name);
  const packageScriptMatches: ExplainMatch[] =
    command === undefined
      ? []
      : [{ reason: "package-script", matched: name, packageScript: { name, command } }];
  return [...packageScriptMatches, ...scriptNameMatches(name, authorities)];
}

function matchOwner(match: ExplainMatch): string {
  if (match.control !== undefined) return match.control.id;
  if (match.slot !== undefined) return match.slot.consumer;
  if (match.packageScript !== undefined) return match.packageScript.name;
  if (match.smoke !== undefined) return match.smoke.test;
  return "";
}

/** Deterministic ordering key: declared owner, then reason, then entry. */
export function matchSortKey(match: ExplainMatch): string {
  const slotName = match.slot === undefined ? "" : match.slot.name;
  return `${matchOwner(match)} ${match.reason} ${match.matched} ${slotName}`;
}
