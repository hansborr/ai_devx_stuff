# 29. characterSpellSlotSchema and spellSlotResultSchema are byte-identical 5-field spell-slot rows in separate files

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: product · Severity: quality-low · Size: XS
Source: drift:ai duplicate-schemas (drift-baseline) · Confidence: med

## Problem
Two shared Zod schemas describe the exact same persisted spell-slot row, byte-for-byte, in two different files:

`characterSpellSlotSchema` (`packages/shared/src/schemas/character.ts:175-181`):
```ts
export const characterSpellSlotSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  spellLevel: z.number().int().min(MIN_LEVEL).max(MAX_SPELL_LEVEL),
  total: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
});
```

`spellSlotResultSchema` (`packages/shared/src/schemas/spell-casting-inputs.ts:61-67`):
```ts
export const spellSlotResultSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  spellLevel: z.number().int().min(1).max(MAX_SPELL_LEVEL),
  total: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
});
```

The only textual difference is `spellLevel.min`: `MIN_LEVEL` vs literal `1`. `MIN_LEVEL === 1` (`character.ts:18`), so the two are numerically identical. They must be kept in lockstep by hand; any field change (e.g. tightening `total`/`used` bounds, adding a column) silently applies to only one. This clears the bar as a dedup/maintainability win: one canonical row shape removes a hand-synced copy.

Secondary smell worth fixing while here: `characterSpellSlotSchema` borrows `MIN_LEVEL`, which is the 1-20 *character-level* constant (`MIN_LEVEL = 1`, `MAX_LEVEL = 20` at `character.ts:18-19`), to bound `spellLevel`, a 1-9 value already capped by `MAX_SPELL_LEVEL = 9`. A single canonical definition lets you express this with an intent-honest minimum (literal `1` or a dedicated spell-level constant) instead of an unrelated 1-20 constant that happens to share the value 1.

## Evidence
- `packages/shared/src/schemas/character.ts:175-181` — `characterSpellSlotSchema`; `spellLevel: z.number().int().min(MIN_LEVEL).max(MAX_SPELL_LEVEL)`. Confirmed.
- `packages/shared/src/schemas/spell-casting-inputs.ts:61-67` — `spellSlotResultSchema`; byte-identical except `spellLevel.min` is literal `1`. Confirmed.
- `packages/shared/src/schemas/character.ts:18` — `export const MIN_LEVEL = 1;` (and `MAX_LEVEL = 20` at line 19), i.e. a character-level constant, not a spell-level one.
- `packages/shared/src/constants.ts:12` — `export const MAX_SPELL_LEVEL = 9;` (both schemas import this).
- `packages/shared/src/schemas/character.ts:287` — `spellSlots: z.array(characterSpellSlotSchema)` (the row schema's one shared-schema consumer).
- `packages/shared/src/schemas/spell-casting-inputs.ts:71` — `recoverAllOutputSchema = z.array(spellSlotResultSchema)`; also consumed by `packages/server/src/routers/spell-slot.ts:5,19,24` as procedure `.output(...)`.
- `packages/server/src/services/character-live-state/mapping.ts:44-52` — `mapSpellSlot(row: CharacterSpellSlot): SpellSlotResult` is already a field-by-field copy between the two identical shapes (note: it maps from the *Prisma* row type, so it stays even after dedup; see caveats).

## Proposed fix
1. Pick one file as the canonical home for the spell-slot row shape. `character.ts` is the natural owner (the row is a character sub-entity and already lives beside the other `character*Schema` definitions).
2. In `spell-casting-inputs.ts`, replace the duplicated literal with a re-export so the value is defined once, e.g.:
   ```ts
   import { characterSpellSlotSchema } from "./character.js";
   export const spellSlotResultSchema = characterSpellSlotSchema;
   ```
   Keep both exported names and both `z.infer` type aliases (`CharacterSpellSlot`, `SpellSlotResult`) since external code imports each (server routers/services import `SpellSlotResult`; client components/hooks import `CharacterSpellSlot`). Watch for an import cycle — `character.ts` must not import from `spell-casting-inputs.ts`; the direction chosen above (inputs ← character) is cycle-safe.
3. While the shape is consolidated, correct the `spellLevel.min` intent: use literal `1` (matching `spellSlotResultSchema`'s existing value) or introduce a dedicated `MIN_SPELL_LEVEL`/`CANTRIP_LEVEL`-adjacent constant, rather than the character-level `MIN_LEVEL`. Cantrips (level 0) are intentionally excluded from slot rows, so `1` is correct; just stop sourcing it from the 1-20 constant.
4. TDD: add a shared-package test asserting the two exported schemas accept/reject the same inputs (e.g. parse a valid row through both, and assert `spellLevel: 0` and a negative `used` both fail through both schemas). If step 2 makes them the same object, a `spellSlotResultSchema === characterSpellSlotSchema` identity assertion documents the intent. Run the existing consumers' suites (`spell-slot.test.ts`, the client spell-slot/cast-rail tests) to confirm no inference drift.

## Verification / caveats
- False-positive risk: low. Both schemas are live and exported; this is real duplication, not dead code.
- Scope boundary: this is a pure shared-schema consolidation. Do NOT collapse `mapSpellSlot` (`mapping.ts:44`) — it converts the **Prisma** `CharacterSpellSlot` model (from `generated/prisma/client.js`) into the shared result type, which remains a necessary boundary even after the two Zod schemas merge. Leave that mapper in place.
- Before merging the two schemas, double-check no consumer relies on them being *distinct object identities* (e.g. a schema registry keyed by reference). A quick `code:intel -- refs spellSlotResultSchema` / `refs characterSpellSlotSchema` plus the grep in Evidence covers this; current usages are all `z.array(...)` wrapping and tRPC `.output(...)`, which are identity-agnostic.
- If consolidation surfaces an import cycle that can't be cleanly broken in the inputs ← character direction, the fallback is to define the shape once in a tiny shared module (e.g. a `spell-slot-row` schema file) and have both files re-export from it; this is the "define the shape once" variant and is equally acceptable.
