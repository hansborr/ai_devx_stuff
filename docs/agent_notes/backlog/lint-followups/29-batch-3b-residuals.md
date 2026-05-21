# Leaf 29: Batch 3b Drain Residuals

Status: 29.2 resolved 2026-05-19 (commit a6092c2b41094f0d6357645519de483584485d58); 29.1 informational only
Discovered: 2026-05-19 during Leaf 07 drain batch 3b peer review (commit e9dd13a2 on `feature/lint-hardening-review-followup`)

## 29.1: Notes panel update payload silently fixes a latent strict-schema mismatch

Source: `packages/client/src/components/campaign/notes/notes-panel.tsx` mutation save handler.

Before batch 3b, the save handler cast the form data and forwarded it as-is:

```ts
updateMutation.mutate(data as NoteFormData & { id: string });
```

`NoteFormData` includes a `campaignId` field (used on the create branch). On the update branch the cast trusted whatever keys existed on `data`. If `campaignId` happened to be defined on an update path, `updateNoteInputSchema` (`packages/shared/src/schemas/note-inputs.ts:37-51`) would reject the call as having an unexpected field.

Batch 3b's drain replaced the cast with an explicit destructure that builds the create/update payloads field-by-field. The update branch no longer forwards `campaignId`, which means the strict-schema rejection scenario can no longer happen.

This is a behaviour change, not a pure refactor. The drain commit message frames it as a lint fix. Worth a callout in the ledger so reviewers don't treat the change as a no-op.

Suggested follow-up: none required — the new behaviour is what the schema already expected. Capturing this here for traceability when future drain audits cross-reference the commit.

## 29.2: Missing component-level tests for batch-3b changes

Source: peer review of e9dd13a2.

Two of the touched files gained new helper functions during the drain but have no sibling test files:

- `packages/client/src/components/sheet/spell-filter-bar.tsx` — added `toSpellSchoolFilter` (Zod parse + null fallback) and `isPreparedFilter`/`toPreparedFilter` (literal-union guard with `"all"` fallback).
- `packages/client/src/components/homebrew/monster/monster-ability-scores.tsx` — added `abilityScorePatch` (exhaustive 6-key switch returning typed updates).

The helpers are TS-exhaustive so a typo would fail compilation, but the runtime fallback behaviour on invalid dropdown values is not currently exercised. This is a pre-existing test-coverage gap; the drain enlarged the surface that lacks coverage.

Considered fixes:

1. **Add focused unit tests** for the three helpers (`toSpellSchoolFilter`, `toPreparedFilter`, `abilityScorePatch`). Cheap, runs in the existing vitest client suite, no new infrastructure required.
2. **Add component-level tests** that exercise the dropdown → state-change → mutation flow. More valuable, but bigger scope than this leaf warrants.
3. **Document and defer**. The dropdowns are populated from the same literal-union source the helpers validate against, so the fallback paths are unreachable in production today. Drift risk is low.

### Resolution (2026-05-19)

Commit: `a6092c2b41094f0d6357645519de483584485d58`.

Exported helpers for sibling test coverage:

- `toSpellSchoolFilter`
- `isPreparedFilter`
- `toPreparedFilter`
- `abilityScorePatch`

Exported type for the monster helper test:

- `AbilityKey`

New test files:

- `packages/client/src/components/sheet/spell-filter-bar.test.ts`
- `packages/client/src/components/homebrew/monster/monster-ability-scores.test.ts`

## Decision

29.1: no action needed (informational).
29.2: option 1 (unit tests for the three helpers) when next touching either file. Not blocking; drift risk is bounded by the literal-union exhaustiveness check at the call sites.
