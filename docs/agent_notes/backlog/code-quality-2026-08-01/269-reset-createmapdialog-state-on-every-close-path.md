# 269. Reset CreateMapDialog state on every close path

Status: Not started
Theme: CreateMapDialog retains its submitted draft because successful close bypasses reset · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`CreateMapDialog` owns its draft and image-preview lifecycle above the
controlled dialog content. Cancel and ordinary dismissal call a local reset
function, but successful creation closes the dialog directly from
`MapsPanel`. Because the component remains mounted, that success path retains
the submitted name, dimensions, grid type, image mode, URL or selected file,
and preview for the next open.

A selected file also owns a browser object URL. The preview hook revokes that
URL when the file is cleared or its hook owner unmounts, but successful close
does neither. The stale draft is therefore both a visible reopen defect and a
resource-lifecycle gap tied to which close path happened to run.

## Evidence

- `packages/client/src/components/campaign/maps/create-map-dialog.tsx:39-77` —
  the dialog contract is controlled by `open`/`onOpenChange`, while
  `defaultForm` defines the name, dimensions, grid size/type, and URL draft
  that a fresh open should receive.
- `packages/client/src/components/campaign/maps/create-map-dialog.tsx:203-216`
  — the persistently mounted `CreateMapDialog` owns form state, image mode,
  upload state, selected file, and preview URL above `DialogContent`.
- `packages/client/src/components/campaign/maps/create-map-dialog.tsx:218-245`
  — submission calls the parent `onSubmit`, while state reset and
  `setImageFile(null)` occur only in `handleClose`.
- `packages/client/src/components/campaign/maps/create-map-dialog.tsx:247-291`
  — dismiss and Cancel route through `handleClose`, but the controlled
  component itself remains the state owner around `DialogContent`.
- `packages/client/src/components/campaign/maps/maps-panel.tsx:157-172` —
  create success calls `setCreateOpen(false)` from the parent, bypassing the
  dialog's `handleClose`.
- `packages/client/src/components/campaign/maps/use-map-image-preview.ts:27-53`
  — clearing the selected file revokes the current object URL, and the only
  other cleanup is the hook-owner unmount effect.
- `packages/client/src/components/campaign/maps/create-map-dialog.test.tsx:12-140`
  — current component coverage checks defaults, submission, image mode, and
  Cancel, but has no successful-create/close/reopen lifecycle regression.

## Proposed direction

Move the form, image-mode, upload, selected-file, and preview hooks into a
stateful dialog-content component keyed by the controlled open state, leaving
the outer `CreateMapDialog` as the controlled shell. A transition to
`open={false}` must replace or unmount that state owner regardless of whether
the transition came from Cancel, overlay/ESC dismissal, or the parent's
create-success callback. Reopening then mounts a fresh owner initialized by
`defaultForm`.

With lifecycle reset owned by that boundary, route Cancel and dialog dismissal
through `onOpenChange(false)` without separately reconstructing the draft.
Keep the parent's successful `setCreateOpen(false)` path: it now crosses the
same remount boundary. Because `useMapImagePreview` belongs to the remounted
content, every close also runs its existing unmount cleanup and revokes any
selected-file object URL.

Add a controlled create-success-close-reopen regression. Populate non-default
name, dimensions, image mode, URL/file, and preview state; submit; simulate the
successful parent close; reopen; and assert all defaults are restored. For the
file path, mock `URL.createObjectURL`/`URL.revokeObjectURL` and assert the
created URL is revoked on success close. Retain the existing submission,
upload, pending-label, and Cancel behavior tests.

## Scope / caveats

- Preserve successful map creation, upload-before-submit ordering, URL mode,
  validation, pending labels, and the parent's mutation invalidation/toast
  behavior. This leaf changes only draft/preview lifetime.
- Do not introduce a general dialog framework, an imperative reset ref, or a
  new effect that mirrors `open` into local state. Keep the lifecycle local to
  `CreateMapDialog`.
- `CQ25-216` in
  [`code-quality-2026-07-25/66-sheet-owner-capability-gate.md`](../code-quality-2026-07-25/66-sheet-owner-capability-gate.md)
  declined dialog remount/reset work only within the sheet-owner capability
  branch; its companion
  [`code-quality-2026-07-25/72-sheet-capability-callback-source.md`](../code-quality-2026-07-25/72-sheet-capability-callback-source.md)
  keeps that boundary. Neither record inspected `CreateMapDialog`.
- [055-token-placement-mirrors-store-state-dialog.md](./055-token-placement-mirrors-store-state-dialog.md)
  concerns derived visibility for the add-token dialog and has no file or
  lifecycle overlap. There is no implementation dependency between the two
  leaves.
- Do not broaden this into sheet-owner capability work, token-placement state,
  other dialogs, or a campaign-wide reset policy.
