# Leaf 16 Suppression Register Baseline

## Status

Hard-gate landed 2026-05-16 in the Leaf 16 close-out commit. Baseline below
was the snapshot before migration; current state shows zero policy violations.

## Date

2026-05-16.

## Tool

`scripts/suppression-register.sh` (commit
`7aa678189d3e71ab26f53709285586e005dd4554`).

## Total Counts

- `total=36`
- `ts-expect-error=25`
- `ts-ignore=0`
- `ts-nocheck=0`
- `stryker=11`

## Per-Dialect Breakdown

### Missing Reasons

`total=36`. These directives have explanatory text, but not in the new
register's required `-- reason` form.

`ts-expect-error=25`:

- `packages/server/src/socket/broadcast-registry.test.ts:356` — `// @ts-expect-error — exercising runtime validation against a bad payload.`
- `packages/server/src/socket/broadcast-registry.test.ts:447` — `// @ts-expect-error — exercising runtime validation against a bad payload.`
- `packages/server/src/utils/__type-tests__/character-class-restrictions.ts:17` — `// @ts-expect-error — direct update is forbidden; use character-class-mutations helpers`
- `packages/server/src/utils/__type-tests__/character-class-restrictions.ts:20` — `// @ts-expect-error — direct updateMany is forbidden; use character-class-mutations helpers`
- `packages/server/src/utils/__type-tests__/character-class-restrictions.ts:23` — `// @ts-expect-error — direct updateManyAndReturn is forbidden; use character-class-mutations helpers`
- `packages/server/src/utils/__type-tests__/character-spell-slot-restrictions.ts:19` — `// @ts-expect-error — direct update is forbidden; use spell-slot-mutations helpers`
- `packages/server/src/utils/__type-tests__/character-spell-slot-restrictions.ts:22` — `// @ts-expect-error — direct updateMany is forbidden; use spell-slot-mutations helpers`
- `packages/server/src/utils/__type-tests__/character-spell-slot-restrictions.ts:25` — `// @ts-expect-error — direct updateManyAndReturn is forbidden; use spell-slot-mutations helpers`
- `packages/server/src/utils/__type-tests__/character-stats-restrictions.ts:24` — `// @ts-expect-error — direct update is forbidden; use updateCharacterStatsLocked`
- `packages/server/src/utils/__type-tests__/character-stats-restrictions.ts:27` — `// @ts-expect-error — direct updateMany is forbidden; use updateCharacterStatsLocked`
- `packages/server/src/utils/__type-tests__/character-stats-restrictions.ts:30` — `// @ts-expect-error — direct updateManyAndReturn is forbidden; use updateCharacterStatsLocked`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:28` — `// @ts-expect-error — direct update is forbidden; use blindUpdateParticipant or updateParticipantStatsLocked`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:31` — `// @ts-expect-error — direct updateMany is forbidden; use blindUpdateParticipant or updateParticipantStatsLocked`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:34` — `// @ts-expect-error — direct updateManyAndReturn is forbidden; use blindUpdateParticipant or updateParticipantStatsLocked`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:48` — `// @ts-expect-error — currentHp is derived; route through updateParticipantStatsLocked`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:51` — `// @ts-expect-error — tempHp is derived; route through updateParticipantStatsLocked`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:54` — `// @ts-expect-error — version is managed by the locked helper only`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:57` — `// @ts-expect-error — conditions is read-modify-write (combat-actions); route through updateParticipantStatsLocked`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:60` — `// @ts-expect-error — identity field, not mutable via blind helper`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:63` — `// @ts-expect-error — identity field, not mutable via blind helper`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:66` — `// @ts-expect-error — identity field, not mutable via blind helper`
- `packages/server/src/utils/__type-tests__/encounter-participant-restrictions.ts:69` — `// @ts-expect-error — identity field, not mutable via blind helper`
- `packages/server/src/utils/__type-tests__/encounter-restrictions.ts:16` — `// @ts-expect-error — direct update is forbidden; use encounter-state-mutations helpers`
- `packages/server/src/utils/__type-tests__/encounter-restrictions.ts:19` — `// @ts-expect-error — direct updateMany is forbidden; use encounter-state-mutations helpers`
- `packages/server/src/utils/__type-tests__/encounter-restrictions.ts:22` — `// @ts-expect-error — direct updateManyAndReturn is forbidden; use encounter-state-mutations helpers`

`stryker=11`:

- `packages/shared/src/rules/attack-roll.ts:118` — `// Stryker disable next-line Regex: shared schema guarantees dice prefix before labels`
- `packages/shared/src/rules/combat.ts:87` — `// Stryker disable next-line ConditionalExpression,EqualityOperator: temp HP is non-negative by contract`
- `packages/shared/src/rules/encounter-difficulty.ts:100` — `// Stryker disable next-line ConditionalExpression: addParticipant rows give levels only through character relations`
- `packages/shared/src/rules/encounter-difficulty.ts:107` — `// Stryker disable next-line ConditionalExpression: addParticipant rows leave character CR null`
- `packages/shared/src/rules/initiative.ts:33` — `// Stryker disable next-line ConditionalExpression: stable-sort preserves order when tied modifiers fall through`
- `packages/shared/src/rules/initiative.ts:39` — `// Stryker disable next-line ArithmeticOperator: stable-sort preserves order when fallback is damaged`
- `packages/shared/src/rules/multiclass-rules.ts:65` — `// Stryker disable next-line MethodExpression: Fighter's anyOf groups contain a single ability; every/some are equivalent over the current table`
- `packages/shared/src/rules/multiclass-rules.ts:76` — `// Stryker disable next-line StringLiteral: anyOf groups have a single requirement; join separator unobservable on length-1 arrays`
- `packages/shared/src/rules/spellcasting.ts:92` — `// Stryker disable next-line ConditionalExpression: later table fallbacks preserve the same empty result`
- `packages/shared/src/rules/spellcasting.ts:142` — `// Stryker disable next-line ConditionalExpression: guards against all-none multiclass and zero effective level`
- `packages/shared/src/rules/xp.ts:120` — `// Stryker disable next-line ConditionalExpression: addParticipant rows leave character CR null`

### `@ts-ignore` Sites

`total=0`.

### `@ts-nocheck` Outside Allowlist

`total=0`.

### Broad Stryker Disables

`total=0`.

## Allowlist Contents

- `scripts/drift-ai/suppressions.ts`
- `scripts/drift-ai/suppressions.test.ts`

## Notes

- Report-only initially; hard-gate flip is a separate leaf.
- `bun run drift:ai --scope current --check suppressions` skips the
  suppressions check because the drift-ai suppression detector is diff-scoped.
  No site-level discrepancy was observed; this register is current-state, while
  drift-ai remains changed-state.
- The rough planning estimate included string-fixture references and stale
  expected `@ts-nocheck` sites. The committed scanner excludes quoted fixtures
  and found no active `@ts-ignore` or `@ts-nocheck` directive comments.
