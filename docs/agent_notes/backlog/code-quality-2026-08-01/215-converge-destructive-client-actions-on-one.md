# 215. Converge destructive client actions on one accessible confirmation dialog

Status: Not started
Theme: Map and token destructive actions bypass the dialog confirmation system · Area: client · Severity: low · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Destructive actions follow two unrelated interaction policies. Token removal,
fog reset, and drawing clear use blocking browser prompts, while entity
deletion uses application dialogs with controlled focus, accessible structure,
and pending-state handling. Copy and cancellation behavior therefore live at
each call site, and token removal already duplicates the same prompt twice.

Dashboard character deletion adds a second application-dialog implementation.
It duplicates the common confirmation shell but has diverged on whether
cancellation remains available during a pending deletion and on the pending
label. Accessibility or interaction fixes must consequently be repeated across
browser prompts and two dialog components.

## Evidence

- `packages/client/src/components/campaign/tokens/token-sidebar.tsx:53-64` —
  the sidebar delete button calls `window.confirm` before forwarding the token
  ID to `onDelete`.
- `packages/client/src/components/campaign/tokens/token-context-menu.tsx:213-224`
  — the context menu independently repeats the token-removal prompt and closes
  the menu after the decision.
- `packages/client/src/components/campaign/maps/map-toolbar-fog-tools.tsx:61-72`
  — resetting fog uses a blocking prompt with fog-specific warning copy.
- `packages/client/src/components/campaign/maps/map-toolbar-drawing-tools.tsx:73-84`
  — clearing drawings uses a fourth local prompt and its own wording.
- `packages/client/src/components/delete-character-dialog.tsx:21-55` — the
  Dashboard-specific dialog implements the full confirmation shell, disables
  both buttons while deletion is pending, and renders `Deleting...`.
- `packages/client/src/components/common/delete-confirm-dialog.tsx:22-54` —
  the common dialog implements the same shell but leaves Cancel enabled while
  pending and renders `Deleting…`, demonstrating already-divergent policy.
- `packages/client/src/pages/dashboard-page.tsx:237-243` — Dashboard wires the
  bespoke character dialog with the same open, close, confirm, and pending
  state shape expected by the common component.
- Reproduction: `rg -n 'window\.confirm' packages/client/src/components/campaign/tokens/token-sidebar.tsx packages/client/src/components/campaign/tokens/token-context-menu.tsx packages/client/src/components/campaign/maps/map-toolbar-fog-tools.tsx packages/client/src/components/campaign/maps/map-toolbar-drawing-tools.tsx` returns exactly four call sites, while `rg -l 'export function (DeleteCharacterDialog|DeleteConfirmDialog)' packages/client/src/components/delete-character-dialog.tsx packages/client/src/components/common/delete-confirm-dialog.tsx` returns exactly the two dialog implementations; the four prompt migrations plus Dashboard character deletion are the five targets below.

## Proposed direction

Generalize the existing common destructive-confirmation dialog only enough to
support action-specific title, description, confirm label, pending label, and
pending-cancellation policy. Preserve defaults for its existing entity-delete
consumers rather than forcing every caller to restate standard deletion copy.

Migrate the five targets in focused steps:

1. Repoint Dashboard character deletion first, preserving its exact warning
   semantics, its pending label, and the rule that both Cancel and Delete are
   disabled while deletion is pending. Move its assertions into the common
   dialog and Dashboard coverage, then delete
   `delete-character-dialog.tsx` and its bespoke test.
2. Replace both token prompts with the common dialog. Keep the token label in
   the warning, invoke the existing removal callback only after confirmation,
   and retain the context menu's close behavior. Place confirmation state at
   an owner that remains mounted when the context menu closes.
3. Replace fog reset and drawing clear with the same dialog while retaining
   their distinct titles, descriptions, and existing callbacks.

Extend the common-dialog tests for custom copy and both pending-cancellation
policies. Replace `window.confirm` spies in the token and map-toolbar tests
with user-level dialog confirm/cancel assertions, including the guarantee that
cancellation never invokes the destructive callback.

## Scope / caveats

- Do not introduce a global modal framework, modal registry, or imperative
  confirmation service. This is a bounded generalization of the existing
  common dialog.
- Preserve each action's current authorization checks, mutation hook, cache
  behavior, toast behavior, and callback ownership. The common component owns
  confirmation UI only.
- Preserve Dashboard's bespoke pending behavior when removing its component.
  Do not silently apply that cancellation rule to existing common-dialog
  consumers or invent pending UI for VTT actions that currently hand off and
  close immediately.
- Preserve action-specific wording and context-menu closure semantics; a
  generic destructive-dialog shell does not imply generic destructive copy.
- The prior pack supplied the existing common component. This leaf covers only
  the five remaining migrations and the minimum API generalization they
  require.
