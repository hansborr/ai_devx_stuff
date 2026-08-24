# 59. Fog overlay component tests assert only that Konva stand-ins exist, never the geometry or opacity their names promise

Status: Not started
Theme: meaningful test oracles · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The fog-of-war component suite names real rendering contracts — coordinate
reversal, cell scaling, fog modes, DM-versus-player presentation — but never
observes any of them. All seven component-level cases (five `FogOverlay`, two
`FogDrawPreview`) assert only that a stand-in element exists, that the root is
truthy, or that a rect count matches. The component's actual job is the
cell-to-pixel arithmetic and the viewer-dependent fill/opacity choice: players
must see fog at opacity 1 while the DM sees 0.45, regions must scale by
`cellSizePx`, and a drag preview whose end cell precedes its start cell must
normalize to positive bounds. Every one of those calculations can regress —
swapped DM/player opacity, dropped `+ 1` in the preview width, unscaled region
coordinates — while all seven cases stay green. Fog visibility is a DM/player
information boundary, so a silently regressing overlay is not cosmetic. The
irony is that the shared Konva mock already retains exactly the props these
tests would need, so the missing oracles cost no infrastructure at all.

## Evidence

- `packages/client/src/components/campaign/maps/fog-overlay.test.tsx:18-64` —
  the five `FogOverlay` cases. Their only assertions are
  `expect(container.firstChild).toBeTruthy()` (`:22`, `:40`),
  `toBeInTheDocument()` on a testid lookup (`:29`, `:63`), and
  `expect(rects.length).toBe(2)` (`:55`). None reads `x`, `y`, `width`,
  `height`, `fill`, or `opacity`.
- `packages/client/src/components/campaign/maps/fog-overlay.test.tsx:258-268` —
  "handles reversed coordinates (end before start)" renders start `(5,5)` /
  end `(2,2)` and asserts only `toBeInTheDocument()` (`:267`); the named
  min/abs normalization at `fog-overlay.tsx:55-58` is never checked. The other
  `FogDrawPreview` case (`:246-256`) is the same shape.
- Measured: the 7 component-level cases contain exactly 7 assertions, all
  existence/truthiness/count, 0 over geometry, fill, or opacity.
- `packages/client/src/components/campaign/maps/fog-overlay.tsx:10-17,165-166` —
  the untested contracts: `FOG_OPACITY_PLAYER = 1` vs `FOG_OPACITY_DM = 0.45`
  selected by `isDm`; region scaling by `cellSizePx` at `:168-177`; preview
  bounds and `isReveal` fill/opacity at `:55-67`.
- `packages/client/src/test/mock-react-konva.tsx:84-92,120-125` —
  `dropKonvaProps` forwards every prop not in `KONVA_ONLY` (`:6-60`) onto the
  stand-in `<div>`; `x`, `y`, `width`, `height`, `fill`, and `opacity` are not
  in the set, so they land as DOM attributes ready for `toHaveAttribute`.
  Wired globally at `packages/client/src/test/setup.ts:57`.
- Contrast in the same file: the four `paintHideAllFog` cases
  (`fog-overlay.test.tsx:148-243`) assert exact painted rects, alpha, and
  composite ops — the suite already knows how to write real oracles for the
  hideAll painter; only the component layer is assertion-free.

## Proposed direction

Rewrite the seven existence-only `FogOverlay`/`FogDrawPreview` cases as a
compact mode/props table asserting the retained Konva attributes (`x`/`y`/
`width`/`height`, `fill`, `opacity`) for region scaling, DM-vs-player
presentation, and reversed preview bounds, using the existing
attribute-preserving mock unchanged and leaving the `paintHideAllFog` cases
alone.

Mechanics: the mock renders retained props as DOM attributes (numbers
stringified), so assertions read
`expect(rect).toHaveAttribute("x", "80")` on `getAllByTestId("konva-rect")` /
`getByTestId("konva-shape")` results. The table rows fall straight out of the
component:

- revealAll regions scale by `cellSizePx` — a region `{ x: 5, y: 5, w: 2, h: 2 }`
  at `cellSizePx=40` must render `x=200 y=200 width=80 height=80`
  (`fog-overlay.tsx:168-177`).
- DM vs player on revealAll rects — `fill "#0d0d1a"` both ways, `opacity`
  `0.45` when `isDm` and `1` otherwise (`fog-overlay.tsx:10-13,165-166`).
- hideAll Shape sizing — `width`/`height` are `mapWidth*cellSizePx` /
  `mapHeight*cellSizePx` (`fog-overlay.tsx:139,163-164`).
- reversed preview bounds — start `(5,5)` / end `(2,2)` at `cellSizePx=40`
  must render `x=80 y=80 width=160 height=160`, plus the `isReveal` fill/
  opacity pair (`fog-overlay.tsx:55-67`).

Keep it TDD-cheap: mutate one expected value first to confirm the new oracle
actually fails, then run the file focused with
`bun run test -- packages/client/src/components/campaign/maps/fog-overlay.test.tsx`.

## Scope / caveats

- The four `paintHideAllFog` cases (`fog-overlay.test.tsx:148-243`) already
  have meaningful oracles and are explicitly out of scope — do not touch them.
- Use the shared mock unchanged. In particular, do not add `sceneFunc` to the
  retained props: `KONVA_ONLY` drops it (`mock-react-konva.tsx:34`), so the
  hideAll path's `isDm → fogOpacity` wiring into the painter is not observable
  at the component level with this mock. That wiring gap stays; the painter's
  own behavior given its options is already pinned by the `paintHideAllFog`
  cases, and extending the mock is a different, larger decision.
- Component-level only — no changes to `fog-overlay.tsx` itself; if a new
  assertion fails, that is a found bug, not a license to adjust the component
  in this leaf.
- Constant values (`#0d0d1a`, `0.45`, `#22c55e`, `#ef4444`, `0.3`) are asserted
  from `fog-overlay.tsx:10-17`; if a design pass retunes them, the table is the
  one place to update.
- No sequencing edges: no other leaf in this pack touches
  `fog-overlay.test.tsx` or the shared Konva mock.
