# 192. Present the level-up history already delivered with every character sheet

Status: Not started
Theme: Level history presentation · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Character detail already carries a durable record of each level-up choice, including class and HP gains, subclasses, feats, ability-score increases, and metamagic selections. The character sheet never presents that history. Players and DMs must reconstruct earlier decisions from the character's current state or keep external notes, while the client receives the unused payload on every character-detail load.

The missing surface also makes the record's limitations unclear. It is useful as read-only history, but it is not a reversible mutation manifest: a contributor should not infer that displaying it makes rollback or downgrade safe.

## Evidence

- `packages/shared/src/schemas/character.ts:190-219` defines the known ASI, feat, metamagic, level-up, and subclass payload shapes; the level-up variant includes HP method, HP gained, and class ID at `:206-213`.
- `packages/shared/src/schemas/character.ts:221-245` deliberately permits a generic record fallback, then stores each choice with `level`, `choiceType`, `choiceData`, and `appliedAt`.
- `packages/shared/src/schemas/character.ts:261-274` includes `levelChoices` in `characterDetailSchema`, so no new endpoint or server read is needed.
- A re-derived search of client TypeScript/TSX finds exactly two `levelChoices` references, both in test support (`packages/client/src/test/fixtures-character.ts:144-150` and `packages/client/src/pages/character-sheet/sheet-helpers.test.ts:131`); the measured production-consumer count is zero.
- `packages/client/src/components/sheet/level-up-dialog.tsx:108-153` presents the next level-up transaction and its current choices, but no previous-level history.
- `packages/client/src/components/sheet/features-panel.tsx:11-25` demonstrates the intended presentational boundary: data and label maps arrive through props, and the panel performs no query or mutation.
- `packages/client/src/components/sheet/desktop-sheet-layout.tsx:90-96` and `packages/client/src/components/sheet/mobile-sheet-tabs.tsx:176-185` are the two responsive placements for the neighboring feature panel.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:211-235` already has the character, class lookup data, and feat-name map at the sheet composition boundary.

## Proposed direction

1. Add a read-only `LevelHistoryPanel` beside the existing sheet panels. Keep it presentational: accept `CharacterLevelChoice[]` and label lookups through props, with no tRPC call, TanStack Query hook, socket subscription, mutation, or `useEffect`.

2. Put transformation in a pure, unit-tested helper such as `level-history-helpers.ts`. It should:

   - sort by numeric level and then `appliedAt`;
   - group rows by level without trying to infer one compound transaction;
   - render every same-level row independently, which is required for multiclass and multi-choice levels;
   - use the `choiceType` plus runtime property checks to narrow `choiceData`;
   - emit a generic “choice recorded” row for unknown, legacy, or malformed record shapes rather than throwing; and
   - perform that narrowing without production type assertions.

3. Resolve display labels from data the sheet already owns:

   - resolve `classId` through `useSrdLookups.className`; because the lookup's generic fallback is `"—"` (`packages/client/src/hooks/use-srd-lookups.ts:47-52`), substitute the raw ID when no class label resolves;
   - resolve `featId` through `featNames`, falling back to the raw ID (`use-srd-lookups.ts:121-131`);
   - resolve metamagic IDs with `getMetamagicOption` (`packages/shared/src/rules/sorcery-points.ts:172-174`), again preserving an unresolved raw ID;
   - display `asiIncreases` from their stored ability abbreviations and amounts; and
   - display the stored `subclassName` directly.

4. Thread the class-label resolver through `SheetSharedProps` and `SheetBody`, then render the panel in both `desktop-sheet-layout.tsx` and `mobile-sheet-tabs.tsx`, alongside or within the existing Features section. Pass `character.levelChoices` directly from the already-loaded detail.

5. Build the helper tests first, covering every known variant, multiple rows at one level, deterministic ordering, unresolved IDs, and the generic-record fallback. Extend the existing character fixtures at `packages/client/src/test/fixtures-character.ts:144-150` and `pages/character-sheet/sheet-helpers.test.ts:131` rather than introducing a competing fixture shape. Add focused panel coverage and update `packages/client/src/components/sheet/MODULE.md`, whose current data-flow contract is at `:17-30`.

## Scope / caveats

- Rollback, undo, downgrade, and any mutation surface are explicitly out of scope. The stored rows do not describe all inverse writes needed to restore a prior character.
- No shared schema, server router, Prisma, socket, or new query work belongs here.
- Preserve defensive rendering. The generic `z.record` fallback at `packages/shared/src/schemas/character.ts:227-234` is intentional, and the previous pack records it as load-bearing in [SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md):715. That work made malformed rows survivable; it did not provide a client history surface.
- Do not correlate same-level rows by assumption. Several legitimate records may share a level, especially for multiclass, subclass, ASI/feat, and metamagic choices.
- `docs/architecture-plan.md:73-77` currently promises both review and rollback. Its separate wording correction can land before or after this work; after this panel lands, the document may accurately say read-only review exists while rollback remains a future product decision.
- Read `docs/guides/client-effects.md` before implementation. Its render-time derivation rule at `:14-20` applies directly: this panel needs no effect.
