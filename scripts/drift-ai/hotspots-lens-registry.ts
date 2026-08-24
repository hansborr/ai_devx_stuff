// Single-source registry of the concrete hotspot lenses (the `all` fan-out is
// derived where `HotspotLens` lives, in `hotspots-format.ts`). Each definition
// owns the per-lens policy that used to be restated by hand across modules —
// the lens list itself (argument parsing, usage prose, `--lens all` fan-out),
// the `--baseline` row-identity kind, and the suppression content-scan need —
// so a new lens declares everything here once and the derived surfaces cannot
// silently omit it.
//
// DEFINITIONS ONLY: this module imports no lens math and no renderers, so the
// type home (`hotspots-format.ts`) can derive `HotspotLens` from it without
// creating the import cycle its header forbids. Reduction and rendering stay
// dispatched through the union-exhaustive switches in `hotspots.ts` /
// `hotspots-format-sections.ts`, which fail to compile when a lens is added
// here — that is the intended pressure, not a gap.
//
// Modeled on `prototype-subcommand-definitions.ts`: an `as const satisfies`
// array from which the id union and id list are derived.

// How a lens's rows are identified for `--baseline` delta tagging: by file
// `path`, or by the sorted (`a`, `b`) `pair` (coupling's identity).
export type HotspotRowKeyKind = "path" | "pair";

export type HotspotLensDefinition = {
  readonly id: string;
  readonly rowKeyKind: HotspotRowKeyKind;
  // True when reducing this lens needs the `git log -G` suppression content
  // scan collected up front by `hotspots.ts`.
  readonly needsSuppressionScan: boolean;
};

export const HOTSPOT_LENS_DEFINITIONS = [
  { id: "churn", rowKeyKind: "path", needsSuppressionScan: false },
  { id: "coupling", rowKeyKind: "pair", needsSuppressionScan: false },
  { id: "fragmentation", rowKeyKind: "path", needsSuppressionScan: false },
  { id: "suppression-churn", rowKeyKind: "path", needsSuppressionScan: true },
  { id: "thrash", rowKeyKind: "path", needsSuppressionScan: false },
] as const satisfies readonly HotspotLensDefinition[];

export type ConcreteHotspotLens = (typeof HOTSPOT_LENS_DEFINITIONS)[number]["id"];

export const CONCRETE_HOTSPOT_LENSES: readonly ConcreteHotspotLens[] = HOTSPOT_LENS_DEFINITIONS.map(
  (definition) => definition.id,
);

// Row-key kind for a lens name, or null when the registry does not know it.
// Takes `string` (not the union) on purpose: baseline JSON is untrusted on-disk
// input, so a hand-edited or future-version lens name must degrade to "no row
// identity" (its rows read NEW) rather than throw.
export function rowKeyKindFor(lens: string): HotspotRowKeyKind | null {
  const definition = HOTSPOT_LENS_DEFINITIONS.find((candidate) => candidate.id === lens);
  return definition === undefined ? null : definition.rowKeyKind;
}

// Whether any lens in a resolved `--lens` selection declares the suppression
// content scan — the gate for collecting `git log -G` records before reducing.
export function selectionNeedsSuppressionScan(selection: readonly ConcreteHotspotLens[]): boolean {
  return HOTSPOT_LENS_DEFINITIONS.some(
    (definition) => definition.needsSuppressionScan && selection.includes(definition.id),
  );
}
