# 235. Preserve GridType through client map component boundaries

Status: Not started
Theme: Preserve GridType through client map component boundaries · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The shared map schema defines grid type as a closed vocabulary, but three
adjacent client component boundaries widen it to unrestricted `string`.
Callers can therefore pass invalid values without a type error, after which
the components silently omit grid or template UI because their conditionals
recognize only supported literals.

The widening also removes exhaustiveness pressure when the shared vocabulary
changes. Each component can continue compiling without deciding how a new
grid type should render or whether it supports template tools.

## Evidence

- `packages/shared/src/schemas/map.ts:41-45` — `GRID_TYPES` contains
  `"square"`, `"hex"`, and `"none"`; `gridTypeSchema` and the exported
  `GridType` type derive the closed union from that constant.
- `packages/client/src/components/campaign/maps/map-canvas-grid.tsx:81-103` —
  `GridBody` accepts `gridType: string`, renders square and hex branches, and
  otherwise leaves the group empty.
- `packages/client/src/components/campaign/maps/map-toolbar.tsx:40-68` —
  `MapToolbarProps` widens `gridType` to `string` and forwards it to
  `PrimaryToolSection`.
- `packages/client/src/components/campaign/maps/map-toolbar-primary-tools.tsx:10-16,49-59`
  — `PrimaryToolSectionProps` repeats the widening and exposes template tools
  only for a square grid.
- `packages/client/src/components/campaign/maps` — the exact command
  `rg -n 'readonly gridType: string' packages/client/src/components/campaign/maps --glob '*.tsx'`
  returned 3 matches: `map-canvas-grid.tsx:88`, `map-toolbar.tsx:43`, and
  `map-toolbar-primary-tools.tsx:12`.

## Proposed direction

Import the shared `GridType` type from
`@musi/shared/schemas/map.js` in `map-canvas-grid.tsx`, `map-toolbar.tsx`, and
`map-toolbar-primary-tools.tsx`, and replace all three `string` declarations
with `GridType`.

Make the intentional behavior explicit through an exhaustive `GridType`
switch or typed lookup: `GridBody` renders square or hex geometry and renders
nothing for `none`; `PrimaryToolSection` enables template tools only for
`square` and explicitly classifies both `hex` and `none` as unsupported.
`MapToolbar` remains a forwarding boundary.

Add focused type assertions using `ComponentProps` and `expectTypeOf` for all
three exported component props. Extend the toolbar coverage to show templates
for `square` and omit them for both `hex` and `none`, and add presentational
grid coverage that pins the deliberate no-grid result for `none`.

## Scope / caveats

- Do not change square or hex geometry, grid visibility, toolbar layout, or
  template-tool behavior. `none` must continue producing no grid, while both
  `hex` and `none` continue hiding square-only templates.
- Do not introduce a client-local grid union or duplicate the three literals.
  The shared schema-derived `GridType` remains the sole vocabulary.
- Keep the `none` omission explicit and exhaustively typed so a future shared
  vocabulary addition requires a deliberate component decision.
- [053-filterselect-erases-schema-derived-option.md](./053-filterselect-erases-schema-derived-option.md)
  addresses schema-union widening at `FilterSelect` and its filter consumers;
  it does not own these map component props. No implementation ordering is
  required because the files do not overlap.
