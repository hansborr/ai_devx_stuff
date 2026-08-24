# 58. VTT drawer spell suites each hand-copy a full `CharacterSpellWithDetails` payload as their private base fixture

Status: Not started
Theme: test fixture duplication · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every casting-related suite in `packages/client/src/components/vtt/drawer/`
opens by declaring its own complete `CharacterSpellWithDetails` payload — all
seven entity fields plus the full 20-field nested `Spell` — and then derives
its other scenarios from that local base with spreads. The base itself is the
copied part: four files carry a byte-identical 29-line Fireball body, differing
only in the `const` name. Across the eight drawer test files there are 24 such
typed fixture blocks, 515 lines of payload. A change to the spell schema is an
eight-file edit, and what a case is actually about (prepared vs unprepared,
ritual, concentration, executable combat data) is buried under invariant
boilerplate like `characterId: "char-1"` and `castingTime: "1 action"`. The
irony is that both halves of the fix already exist elsewhere in the client:
`src/test/fixtures-spell.ts` exports canonical spell payloads that nine
sheet-side and hook suites import, and `src/test/fixtures-encounter.ts` /
`fixtures-srd.ts` establish the `build<X>(overrides)` convention — the drawer
suites just predate both and reach for neither.

## Evidence

- `packages/client/src/components/vtt/drawer/cast-rail.test.tsx:73-101` — the
  29-line `FIREBALL` block. Its body (everything after the `const` line) is
  byte-identical in `cast-rail-meta.test.tsx:7-35` (named `BASE_SPELL`),
  `cast-rail-slot-picker.test.tsx:14-42`, and `confirm-cast-strip.test.tsx:16-44`
  — four copies, 116 lines.
- Measured at the pin: 24 `: CharacterSpellWithDetails = {` fixture blocks
  across the eight drawer test files, 515 lines total — `cast-rail.test.tsx`
  4 blocks/103 lines, `cast-rail-meta.test.tsx` 4/64,
  `cast-rail-concentration.test.tsx` 3/64, `cast-rail-slot-picker.test.tsx`
  2/45, `confirm-cast-strip.test.tsx` 3/65, `tabs/spells-tab.test.tsx` 5/101,
  `tabs/stats-tab.test.tsx` 1/29, `tabs/actions-tab.test.tsx` 2/44.
- Duplication is cross-file, not in-file: `confirm-cast-strip.test.tsx:46-60`
  (`FIRE_BOLT`) and `tabs/spells-tab.test.tsx:81-99` (`PREPARED_WEB`) already
  derive from the local base via `...FIREBALL.spell` / `...CANTRIP.spell` —
  but still restate the invariant identity fields per variant.
- `packages/client/src/test/fixtures-spell.ts:97-119` exports
  `TEST_SPELL_FIREBALL` and `:133-179` `TEST_CHARACTER_SPELLS`; no
  `vtt/drawer` suite imports from it (grep at the pin), while nine files
  elsewhere — including the drawer's own hook suite
  `hooks/vtt-drawer/use-confirm-cast.test.ts` — do.
- `packages/client/src/test/fixtures-encounter.ts:39-44` — the established
  builder idiom: `Partial<T> & Pick<T, …required>` overrides spread over a
  defaults factory (`buildParticipant`); same pattern in `fixtures-srd.ts`.

## Proposed direction

Add a typed `buildCharacterSpell(overrides)` scenario builder with a canonical
Fireball default in a drawer test helper, and route the raw
`CharacterSpellWithDetails` literals in the VTT drawer test files through it,
keeping local semantic names and explicit per-case overrides. Mechanics:

- Put the builder in a drawer-local helper, e.g.
  `packages/client/src/components/vtt/drawer/spell-scenarios.test-helper.ts`
  (client `*.test-helper.ts` naming precedent:
  `hooks/canvas-input/use-canvas-input.test-helper.ts`). Follow the
  `fixtures-encounter.ts:39-44` overrides idiom, plus a nested
  `spell?: Partial<Spell>` merged over the default spell so variants state only
  the fields the case is about.
- The default must stay field-for-field identical to today's copied Fireball
  payload (`cast-rail.test.tsx:73-101` — `description: ""`, `material: null`,
  `higherLevel: null`), so no rendering assertion moves.
- Convert all 24 blocks in the eight files above — the originally counted six
  files hold 18 of them; `cast-rail-meta.test.tsx` (which owns one of the four
  byte-identical Fireball bodies) and `tabs/actions-tab.test.tsx` are the same
  mechanical change. Keep each file's semantic names (`HYPNOTIC_PATTERN`,
  `UNPREPARED_FIREBALL`, `EXECUTABLE_FIREBALL`, …) as `const NAME =
  buildCharacterSpell({ … })`.
- Pure test refactor: assertions unchanged; verify with
  `bun run test -- <the eight drawer test files>` (e.g.
  `bun run test -- packages/client/src/components/vtt/drawer/cast-rail.test.tsx`).
  List explicit files — `scripts/test-all.sh` routes explicit existing test
  files onto its focused lane, while a directory selector falls back to the
  full-suite invocation. TDD here means the suites stay green through each
  file's conversion.

## Scope / caveats

- Out of scope: production drawer components, the shared spell schema, and the
  sheet-side suites already importing `fixtures-spell.ts`.
- Do not swap the default to `fixtures-spell.ts`'s `TEST_SPELL_FIREBALL`: that
  copy carries the full SRD prose (non-empty `description`, `material`,
  `higherLevel`) where the drawer base is deliberately lean, and adopting it
  silently changes rendered text under test. If the builder is hosted in
  `src/test/fixtures-spell.ts` instead of a drawer-local helper, keep the lean
  default as a separate export and update `src/test/MODULE.md`'s fixtures
  listing; the drawer-local helper avoids that doc edit.
- Prior pack: the live 2026-07-25 pack's scheduled slice 40.1
  (`docs/agent_notes/backlog/code-quality-2026-07-25/40-PLAN.md`, corpus id
  CQ25-48) edits six of these same suites — deleting
  `as unknown as CharacterDetail` and `.stats` casts against
  `fixtures-character.ts` — but never touches the spell payloads. No ordering
  dependency; just do not work the two concurrently in
  `packages/client/src/components/vtt/drawer/`.
- Read `packages/client/src/components/vtt/drawer/MODULE.md` first per repo
  convention; this change should not alter anything it documents.
- Leaf 040 rewrites `tabs/actions-tab.test.tsx` and
  `tabs/spells-tab.test.tsx` for shared eligibility and real feature-use
  behavior, while this leaf converts their spell fixtures. Either order works,
  but do not implement the two leaves concurrently; if leaf 040 lands first,
  include any spell fixtures it adds in this builder migration.
