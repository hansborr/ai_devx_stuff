# 69. The rendered roll-denial test has no authorized positive control

Status: **Done 2026-07-31** on branch `fix/cq-68-69-fixture-and-control`.
Theme: Character-sheet composition coverage · Area: client tests · Severity: low · Size: XS

Source: `feat/cq-client-followups` round-four gate; split from leaf 63 during
review of `fix/cq-56-63-client-freshness`, 2026-07-30 · Confidence: high

**Evidence is pinned to merge `c5985d1da`; re-resolve symbols before implementation.**

## Outcome

- The core residual was worth closing. An authorized rendered case beside the
  denial now requires both the accessible Strength-check affordance and the
  equipped Longsword's roll button, covering the independently wired ability
  and weapon handlers.
- TDD temporarily forced `rollAllowed` false. The new case failed because
  `Roll Strength check …` was absent, then all 23 composition tests passed after
  the real permission projection was restored. No production code changed.
- Review follow-up TDD withheld only `onRollWeapon`; the ability assertion
  remained satisfied while the new `Roll Longsword` assertion failed. Restoring
  the handler returned the complete composition file to green.
- No hook-call assertions were added: this suite already pins both independent
  hooks for linked, unlinked, and denied-nonmember compositions.
- The optional failed-lookup hook composition case is deliberately declined.
  `sheet-campaign-context.test.ts` already proves that `campaignIdentity`
  returns the raw id for `resolving`, `nonmember`, `error`, and `member`, while
  this suite proves that both hooks consume that projection. Repeating the
  `error` row here would duplicate the authoritative projection matrix without
  strengthening the positive/denial control this leaf owns.

## Problem

`packages/client/src/pages/character-sheet/sheet-layout.test.tsx` asserts that a
true outsider sees no elements labelled `Roll …`, and that denial assertion
does discriminate. Nothing in the suite asserts that those labels appear for an
authorized viewer, however. The denial test therefore goes vacuously green if
the label template in `ability-score-card.tsx` is reworded, or if `SheetBody`
stops forwarding `onRollAbility` or `onRollWeapon`.

The same review noted a smaller composition-seam gap: the suite no longer pins
that both roll hooks receive the raw campaign id when the campaign lookup is in
`error` state. `sheet-campaign-context.test.ts` still pins the identity rule at
the library level, so this is missing composition coverage rather than an
unpinned contract.

## Evidence

- `packages/client/src/pages/character-sheet/sheet-layout.test.tsx` contains the
  outsider denial case but no authorized rendered positive control.
- `packages/client/src/components/sheet/ability-score-card.tsx` owns the
  accessible `Roll …` label used by that assertion.
- `packages/client/src/pages/character-sheet/sheet-state.ts` calls
  `useAbilityRoll` and `useWeaponRoll` independently, so one spy is not a
  positive control for the other seam.

## Proposed direction

1. Add an authorized rendered case beside the denial test that proves roll
   affordances appear.
2. Pin both roll-hook calls if the existing test substrate can do so without
   broad mock churn.
3. Restore the failed-lookup campaign-id composition case only if it stays a
   focused addition; the library-level identity test remains authoritative.

## Scope / caveats

- This is test coverage only; do not change authorization or roll behavior.
- Keep the positive and denial controls at the rendered composition seam.
- Do not fold socket association freshness back into this leaf.
