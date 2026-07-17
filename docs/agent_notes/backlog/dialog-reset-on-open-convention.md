# Dialog Reset On Open Convention

Status: Completed by lint-adoption-2026-07 Leaf 21 (2026-07-15)
Date: 2026-07-03
Source: Deferred repo-audit finding from the docs/process staleness cleanup.

Decision: keyed remounts at dialog/editor boundaries are the house convention
for reset-on-open state. Leaf 21 completed the migration described here.

## Historical context (before Leaf 21)

The following describes the state before the migration, not the current house
pattern.

Roughly ten of the twenty-two frozen `react-hooks/set-state-in-effect` client
ratchet-debt files are dialogs that reset local state when opened. Examples
include `packages/client/src/components/sheet/rest-dialog.tsx:284-286` and
`packages/client/src/components/campaign/tokens/add-token-dialog.tsx:221-225`.

`packages/client/src/components/sheet/weapon-mastery-dialog.tsx:104-111` does
the same reset behind a `prevOpen` ref, which escapes the lint rule entirely.
The current guide already recommends a `key` remount for reset-on-open cases,
but the codebase does not yet have a house pattern that makes the preferred
shape obvious.

## Completed scope

- Adopted keyed remounts at dialog/editor boundaries.
- Drained the open-reset dialog subset from the frozen ratchet debt.
- Removed the `prevOpen` loophole using the same convention.
- Kept `docs/guides/client-effects.md` as the authoritative guidance.

## Verification performed

- Focused client tests for changed dialogs.
- Ratchet baseline update only after the drained files are confirmed.
- `bun run test -- <focused dialog test files>`

## Outcome

Keyed remounts are the house convention. Public dialog/editor components keep
their existing API and render an internal stateful component keyed by the open
state plus the edited entity identity when applicable. Note and NPC editors
already had an internal keyed form seam, so their keys now include open state
and their state initializes directly from props.

The migration removed the full 15-file dialog/editor cohort from
`ratchet/react-hooks-set-state-in-effect-client`, reducing that floor from 21
findings to 6. A later Leaf 21 movement-tracking bug fix reduced the same floor
to 5; that additional reduction was not part of the dialog migration. The
migration also removed the `prevOpen` ref workaround from
`weapon-mastery-dialog.tsx`. A focused Add Token regression test proves that
an externally controlled close/reopen resets the whole form; the previous
effect only refreshed coordinates and left the label stale.
