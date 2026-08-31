// Projects harness control records into the command-catalog's control-derived
// metadata source, and assembles the full catalog input for the generator.
//
// Two ways a control reaches a script:
//   - its `invocation` is `bun run <script>` — the control IS that command;
//   - its generatedSurface facet names a `checkScript` — the `--check` twin of
//     the control's own refresh script, which exists as a package script but
//     never as a control of its own.
// Both are projections. Nothing here is authored, which is the point: the
// catalog cannot drift from the control record it describes.

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import type { ControlCommandSource } from "./command-catalog.js";
import { parseGeneratedSurfaces } from "./generated-surfaces.js";
import { extractBunRunScript } from "./harness-check-validation.js";
import type { HarnessManifest } from "./harness-manifest-schema.js";

type ManifestControl = HarnessManifest["controls"][number];

function push(
  sources: Map<string, ControlCommandSource[]>,
  script: string,
  source: ControlCommandSource,
): void {
  const bucket = sources.get(script);
  if (bucket === undefined) sources.set(script, [source]);
  else bucket.push(source);
}

function invocationSource(
  control: ManifestControl,
  refreshScripts: ReadonlySet<string>,
): ControlCommandSource | undefined {
  const script = extractBunRunScript(control.invocation);
  if (script === undefined) return undefined;
  return {
    id: control.id,
    kind: control.kind,
    script,
    ...(refreshScripts.has(script) ? { refreshesGeneratedSurface: true } : {}),
    ...("principle" in control && typeof control.principle === "string"
      ? { principle: control.principle }
      : {}),
    ...("pairedGuide" in control && typeof control.pairedGuide === "string"
      ? { pairedGuide: control.pairedGuide }
      : {}),
  };
}

/**
 * Root-manifest script name -> the control records that document it. A script
 * with more than one control is normal (`bun run lint` backs both the lint
 * floor and its ratchet wrappers); the catalog renders the count and defers to
 * the harness controls map for the detail.
 */
export function buildControlCommandSources(
  manifest: HarnessManifest,
): Map<string, readonly ControlCommandSource[]> {
  const sources = new Map<string, ControlCommandSource[]>();
  const surfaces = parseGeneratedSurfaces(manifest.controls);
  // Keyed by script, not by control: the claim the catalog needs is "running
  // this command rewrites committed files", which is true of the refresh script
  // however many controls name it and whatever kind they carry.
  const refreshScripts = new Set(surfaces.map((surface) => surface.refreshScript));
  for (const control of manifest.controls) {
    const source = invocationSource(control, refreshScripts);
    if (source !== undefined) push(sources, source.script, source);
  }
  for (const surface of surfaces) {
    push(sources, surface.checkScript, {
      id: surface.id,
      kind: "generated-surface-check",
      script: surface.checkScript,
      checksRefreshScript: surface.refreshScript,
      outputPaths: surface.outputPaths,
    });
  }
  for (const bucket of sources.values()) {
    bucket.sort((a, b) => compareByCodepoint(a.id, b.id));
  }
  return sources;
}
