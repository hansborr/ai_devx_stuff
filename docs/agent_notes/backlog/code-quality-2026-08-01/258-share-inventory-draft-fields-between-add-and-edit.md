# 258. Share inventory draft fields between add and edit dialogs

Status: Not started
Theme: Share the inventory-item draft fields between add and edit dialogs · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The add and edit inventory dialogs independently own the same five-field draft:
name, item type, quantity, weight, and description. They also duplicate the
same labels, item-type options, numeric constraints, and string-to-number
normalization.

A field or accessibility change must consequently be made twice, while nothing
requires the two copies to retain equivalent bounds and conversion semantics.
The dialogs do have intentionally different submission, reset, change-detection,
footer, and lifetime behavior, so sharing the entire dialog would erase useful
ownership boundaries; the duplication is confined to the controlled field
body and its numeric normalizers.

## Evidence

- `packages/client/src/components/sheet/add-item-dialog.tsx:75-103` — the add
  dialog owns five state cells and a reset contract that restores all five
  draft defaults.
- `packages/client/src/components/sheet/add-item-dialog.tsx:126-145` — add trims
  the name and independently normalizes quantity to at least one and weight to
  at least zero while constructing its create payload.
- `packages/client/src/components/sheet/add-item-dialog.tsx:149-201` — the add
  form renders the name, type, quantity, weight, and description controls,
  including required-name behavior and numeric input constraints.
- `packages/client/src/components/sheet/edit-item-dialog.tsx:21-43` — edit
  declares the same five-field draft shape and repeats the quantity and weight
  normalization while deriving an update payload.
- `packages/client/src/components/sheet/edit-item-dialog.tsx:53-60` — edit owns
  five separate state cells initialized from the selected inventory item and
  computes change detection from them.
- `packages/client/src/components/sheet/edit-item-dialog.tsx:77-149` — edit
  repeats all five controls, the `ITEM_TYPES` selector, required name, and the
  same quantity and weight constraints.
- `packages/client/src/components/sheet/add-item-dialog.tsx:222-270` — add also
  owns a latched custom/homebrew body and preserves the custom draft across tab
  changes, behavior outside the duplicated field body.
- `packages/client/src/components/sheet/edit-item-dialog.tsx:150-171` — edit
  owns its distinct footer and keys the content by open state and item identity
  to reset the draft lifetime.

## Proposed direction

Extract a controlled inventory-item field body that receives the five draft
values and typed change callbacks. Move the shared labels, inputs,
`ITEM_TYPES` selector, required-name attribute, numeric bounds, weight step,
and description presentation into that component. Give each caller an
explicit ID prefix or complete ID map so add and edit retain unique
label/control associations when both dialogs exist in the same document.

Extract typed quantity and weight normalizers alongside the field body:
quantity retains the current integer fallback and minimum of one, while weight
retains the current numeric fallback and minimum of zero. Use those helpers in
both add payload construction and edit change detection so the conversion
semantics have one owner.

Keep state and orchestration in the two dialogs. Add continues to own its
defaults, post-submit reset, custom/homebrew tabs, membership latch, create
payload, and buttons. Edit continues to initialize from the selected item,
derive a sparse update through `buildChanges`, key its content lifetime, and
own its footer and submission rules.

Extend the focused add and edit dialog tests around the extraction. Pin unique
IDs and accessible labels, all five controlled values, type selection, numeric
fallbacks and bounds, add reset and homebrew draft preservation, edit sparse
change detection and item-change reset, and each dialog's existing pending and
footer behavior.

## Scope / caveats

- Preserve required-name behavior, trimmed-name semantics, quantity minimum
  `1`, weight minimum `0`, weight step `0.1`, and the existing fallback values.
- Preserve unique add/edit label and control IDs; the shared component must not
  hard-code one dialog's current IDs.
- Do not merge state hooks, dialog shells, lifecycles, submission callbacks,
  payload construction, change detection, reset behavior, or add/edit-specific
  buttons.
- `homebrew-item-tab.tsx` remains a separate adapter and is not part of the
  shared five-field body. The add dialog continues to own its custom/homebrew
  tab behavior.
- No prior-pack record or existing authored leaf covers this field-body
  duplication.
