# 260. Rename create-only map-layer actions as enable operations

Status: Not started
Theme: Rename create-only map-layer actions as enable operations · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The fog and drawing callback chains use “toggle” names even though both
operations only create a layer. Their current toolbar guards expose them only
when the corresponding layer is absent, so the UI behaves as an enable action,
but the callback contract advertises reversible semantics it does not provide.

That mismatch propagates from action hooks through toolbar props and their
owners. A later caller can reasonably infer that invoking a toggle against an
existing layer disables it, when neither implementation contains such
behavior.

## Evidence

- `packages/client/src/components/campaign/maps/map-fog-actions.ts:28-41` —
  `FogActions` exposes `handleToggleFog`, whose implementation unconditionally
  invokes the fog-layer create mutation.
- `packages/client/src/hooks/use-drawing-actions.ts:37-55` —
  `DrawingActions.handleToggleDrawing` likewise only creates an empty drawing
  layer.
- `packages/client/src/components/campaign/maps/map-toolbar-fog-tools.tsx:7-34`
  — `FogTools` calls the create-only callback `onToggleFog`, but renders it
  only when no fog layer exists and labels the action “Enable fog of war.”
- `packages/client/src/components/campaign/maps/map-toolbar-drawing-tools.tsx:22-60`
  — the drawing toolbar repeats that mismatch: `onToggleDrawing` is available
  only without a drawing layer and is labeled “Enable drawing layer.”
- `packages/client/src/components/campaign/maps/map-toolbar.tsx:19-33` — the
  toggle terminology is also part of the intermediate fog and drawing control
  prop contracts.
- `packages/client/src/components/campaign/maps/map-toolbar-dm-tools.tsx:11-24,54-72`
  — `DmToolSection` forwards both toggle-named callbacks to the enable-only
  toolbar branches.

## Proposed direction

Rename the complete fog chain from `handleToggleFog`/`onToggleFog` to
`handleEnableFog`/`onEnableFog`, and the drawing chain from
`handleToggleDrawing`/`onToggleDrawing` to
`handleEnableDrawing`/`onEnableDrawing`.

Carry those names consistently through `FogActions`, `DrawingActions`,
`MapToolbar` control props, `DmToolSection`, `FogTools`, `DrawingTools`, the map
detail and combat-map headers, and their test fixtures. Retain the
`hasFogLayer` and `hasDrawingLayer` branches that expose the buttons only when
their layers are absent.

Update focused toolbar assertions and test descriptions to use enable
terminology while preserving the existing user-visible labels. Keep the hook
implementations create-only and retain coverage that activating each button
for an absent layer invokes its create callback.

## Scope / caveats

- This is a contract rename only. Do not add disable, delete, reset, clear, or
  other reversible behavior.
- Preserve the existing layer payloads, z-index values, mutation hooks,
  authorization context, toolbar labels, and no-layer rendering guards.
- Coordinate with
  [215-converge-destructive-client-actions-on-one.md](./215-converge-destructive-client-actions-on-one.md),
  which also edits the fog and drawing toolbar files to replace reset and clear
  confirmations. Avoid concurrent edits, and preserve that leaf's destructive
  action callbacks separately from these enable-only names.
