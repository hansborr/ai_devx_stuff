# Dialog Reset On Open Convention

Status: Parked
Date: 2026-07-03
Source: Deferred repo-audit finding from the docs/process staleness cleanup.

## Context

Roughly ten of the twenty-two frozen `react-hooks/set-state-in-effect` client
ratchet-debt files are dialogs that reset local state when opened. Examples
include `packages/client/src/components/sheet/rest-dialog.tsx:284-286` and
`packages/client/src/components/campaign/tokens/add-token-dialog.tsx:221-225`.

`packages/client/src/components/sheet/weapon-mastery-dialog.tsx:104-111` does
the same reset behind a `prevOpen` ref, which escapes the lint rule entirely.
The current guide already recommends a `key` remount for reset-on-open cases,
but the codebase does not yet have a house pattern that makes the preferred
shape obvious.

## Scope

- Pick the convention: keyed remount at the dialog boundary, or a tiny
  `useResetOnOpen` helper if key remounts are too awkward for the common cases.
- Drain the open-reset dialog subset from the frozen ratchet debt.
- Close the `prevOpen` loophole with either the same convention or a focused
  lint/reporting follow-up.
- Update `docs/guides/client-effects.md` only if the chosen convention needs
  examples beyond the existing key-remount recommendation.

## Verification

- Focused client tests for changed dialogs.
- Ratchet baseline update only after the drained files are confirmed.
- `bun run test -- <focused dialog test files>`
