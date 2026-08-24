# 239. Extract the duplicated homebrew confirm-by-name dialog shell

Status: Not started
Theme: Extract the duplicated homebrew confirm-by-name deletion dialog · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Collection and entry deletion maintain parallel confirm-by-name dialogs. Each
copy owns typed-name state, trimming and matching, submit gating, pending
controls, error presentation, and the full dialog structure alongside its
mutation-specific cache and toast effects.

The duplicated interaction policy can drift independently: an accessibility,
matching, pending-state, or reset fix must be repeated in both paths. At the
same time, folding typed-name confirmation into the ordinary deletion dialog
would mix two materially different confirmation workflows.

## Evidence

- `packages/client/src/components/homebrew/collections/delete-collection-dialog.tsx:26-105`
  — collection deletion combines typed-name state and matching, the mutation
  and invalidation effects, guarded form submission, input markup, alert
  rendering, and pending-disabled footer controls in one component.
- `packages/client/src/components/homebrew/entries/delete-entry-dialog.tsx:26-105`
  — entry deletion repeats the same state, exact trimmed-name match, submit
  guard, input, error alert, pending policy, and footer structure around its
  entity-specific mutation.
- `packages/client/src/components/common/delete-confirm-dialog.tsx:13-54` —
  the existing common deletion dialog supports ordinary button confirmation
  but has no typed-name state, input, matching, or form-submit gate.

## Proposed direction

After the common confirmation work in
[215-converge-destructive-client-actions-on-one.md](./215-converge-destructive-client-actions-on-one.md)
lands, extract a dedicated confirm-by-name shell under
`components/homebrew/shared/`. The shell should own the typed name, the
case-sensitive exact match after trimming, form submission and its defensive
match guard, input/label association, submit gating, pending-disabled controls,
and alert presentation.

Give the shell explicit props for open state, target name, entity-specific
title and description, confirm and pending labels, error state/copy, pending
state, and the confirmed callback. Preserve state reset when a dialog is
reopened or retargeted. The collection and entry wrappers should retain their
mutation hooks and pass only the resulting pending/error state and confirmed
callback into the shell.

Replace both dialog stacks with thin wrappers. Collection-specific cascade
warning copy, entry-specific copy, mutation payloads, cache invalidation,
success toasts, and close-on-success behavior remain in their respective
modules. Add the new shared primitive to `homebrew/shared/MODULE.md`.

Cover the shell directly: a mismatch cannot submit, surrounding whitespace is
trimmed while case still matters, a match enables and invokes confirmation,
pending state disables both cancellation and submission, errors render as
alerts, and reopening or changing the target clears stale confirmation text.
Keep focused wrapper coverage proving that each confirmed callback still sends
the correct ID and retains its own invalidation and toast behavior.

## Scope / caveats

- Land after, or rebase onto,
  [215-converge-destructive-client-actions-on-one.md](./215-converge-destructive-client-actions-on-one.md),
  because that proposal changes the ordinary common confirmation component.
- Do not add a typed-name boolean mode to the ordinary dialog if doing so
  creates one option-driven component for two distinct workflows. A dedicated
  confirm-by-name shell is the settled boundary.
- Mutation construction, cache invalidation, toasts, and mutation-error
  ownership stay in the collection and entry wrappers. The shell only renders
  the passed error state and entity-specific message.
- Preserve the existing collection cascade warning, entry wording,
  case-sensitive matching, pending cancellation policy, and close-on-success
  behavior.
- Do not merge collection and entry deletion into one mutation wrapper or
  generalize this into a destructive-action service.
