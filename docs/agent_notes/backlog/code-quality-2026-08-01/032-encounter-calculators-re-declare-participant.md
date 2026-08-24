# 32. The encounter difficulty and XP calculators hand-write the participant discriminator instead of typing it from the canonical schema

Status: Not started
Theme: schema-derived vocabulary typing · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared` treats its Zod schemas as the contract every layer derives
from, and the encounter contract does define the participant vocabulary once:
`PARTICIPANT_TYPES`, its `participantTypeSchema`, and the inferred
`ParticipantType`. But the two encounter calculators sitting one directory away
ignore that definition: `DifficultyParticipant` and `XpParticipant` each
hand-write `"character" | "monster" | "npc"` as an inline union with no type
relationship to the contract. The values match today, which is exactly why the
copies are invisible — nothing fails until someone adds or renames a participant
kind, at which point the compiler cannot point at the two calculator inputs
that silently kept the old vocabulary. A contributor has to know the copies
exist and edit all three in coordination, contrary to how the rest of the
package works: the neighbouring rules modules already `import type` their
vocabularies from `schemas/`, so these two unions are stragglers, not a
layering necessity.

## Evidence

- `packages/shared/src/schemas/encounter.ts:32-36` — the canonical definition:
  `PARTICIPANT_TYPES = ["character", "monster", "npc"] as const`,
  `participantTypeSchema = z.enum(PARTICIPANT_TYPES)`, and
  `type ParticipantType = z.infer<typeof participantTypeSchema>`.
- `packages/shared/src/rules/encounter-difficulty.ts:53-57` —
  `DifficultyParticipant` re-declares `type: "character" | "monster" | "npc"`
  by hand (`:54`).
- `packages/shared/src/rules/xp.ts:96-99` — `XpParticipant` repeats the same
  hand-written union (`:97`).
- The shared tuple and the two calculator unions are the three hand-authored TypeScript declarations, but Prisma also declares the persisted vocabulary at `packages/server/prisma/schema.prisma:123-128`; parity with the shared schema is guarded by `packages/server/src/test/enum-sync.test.ts:122-124`. `TOKEN_TYPES` at `packages/shared/src/schemas/map.ts:47` looks similar but is a different vocabulary (`"object"`, not `"npc"`).
- No layering obstacle: `rules/` already type-imports from
  `schemas/encounter.js` in three sibling modules —
  `packages/shared/src/rules/combat.ts:1`,
  `packages/shared/src/rules/conditions.ts:3`,
  `packages/shared/src/rules/initiative.ts:1`.
- The calculators' real inputs are already schema-derived: `packages/client/src/components/campaign/encounters/difficulty-indicator.tsx:12-19` accepts and passes a `readonly EncounterParticipant[]` prop, while `xp-summary-panel.tsx:20-24` and `end-encounter-dialog.tsx:36` pass `encounter.participants` directly. Re-typing the discriminator therefore changes no assignability in practice.

## Proposed direction

Replace the hand-written unions by typing `DifficultyParticipant.type` and
`XpParticipant.type` as `ParticipantType` type-imported from
`../schemas/encounter.js` (rules/ already type-imports from schemas/
elsewhere). Concretely, in both `rules/encounter-difficulty.ts` and
`rules/xp.ts`: add `import type { ParticipantType } from
"../schemas/encounter.js";` and change the `type:` field at
`encounter-difficulty.ts:54` and `xp.ts:97` to `type: ParticipantType`.

Keep the import type-only. Several schemas modules value-import from `xp.ts`
(`schemas/monster-inputs.ts:4`, `schemas/encounter-inputs.ts:11`,
`schemas/monster.ts:13`, `schemas/homebrew.ts:6` all pull `VALID_CR_VALUES` /
`CR_TO_XP`), so an `import type` edge back into `schemas/` adds no runtime
import and matches the existing rules-module convention. This is a pure type
re-pointing with zero runtime change; the existing suites beside the code
(`rules/encounter-difficulty.test.ts`, `rules/xp.test.ts`,
`rules/xp.property.test.ts`) must pass untouched.

## Scope / caveats

- **Do not fold `TOKEN_TYPES` (`schemas/map.ts:47`) into this.** Its member set
  differs on purpose (`"object"` instead of `"npc"`); only the encounter
  participant vocabulary is in scope.
- Out of scope: reshaping or unifying `DifficultyParticipant` and
  `XpParticipant` themselves (they differ deliberately —
  `characterLevel` exists only on the difficulty input), and any Zod-schema
  derivation of the calculator inputs. Only the discriminator's type source
  changes.
- Prior pack: the live 2026-07-25 pack already landed the shared
  single-sourcing work
  ([`21-shared-constants-single-source.md`](../code-quality-2026-07-25/21-shared-constants-single-source.md)),
  and its [`CONSTRAINTS.md`](../code-quality-2026-07-25/CONSTRAINTS.md)
  records a standing ruling: a whole-tree straggler search is an acceptance
  criterion for every single-sourcing change. These two unions are exactly such TypeScript stragglers, and the same ruling binds here — finish by sweeping `packages/` by both identifier and literal member strings. The expected remaining source mirror is Prisma's `ParticipantType`, guarded by `enum-sync.test.ts`; require that no other unguarded hand-authored TypeScript copy remains before calling the shared TypeScript vocabulary single-sourced.
- Read `docs/guides/change-rules-logic.md` before editing files under
  `packages/shared/src/rules/`, even though this change is type-only.
