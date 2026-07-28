import { type GeneratedSurfaceRecord, parseGeneratedSurfaces } from "./generated-surfaces.js";
import { loadTypedHarnessManifest } from "./harness-manifest-loader.js";

/**
 * Whole-manifest shape comes from the typed seam, so this loader only owns the
 * `generatedSurface` facet parse (whose per-record diagnostics stay in
 * generated-surfaces.ts). A manifest that fails the top-level contract throws
 * here rather than silently yielding a short record list.
 */
export function loadGeneratedSurfaces(repoRoot: string): GeneratedSurfaceRecord[] {
  return parseGeneratedSurfaces(loadTypedHarnessManifest(repoRoot).controls);
}
