# 99. The concurrency rulebook sends readers to a facade router for the participant writer and misnames its lock ordering

Status: Not started
Theme: concurrency guide accuracy · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`docs/CONCURRENCY.md` is the mandated pre-read for race-sensitive mutation work
(AGENTS.md sends every contributor there before expanding race-sensitive helper
surfaces), and on the participant path it is wrong in three places. It locates
the `updateParticipant` DM-override writer in `routers/encounter.ts`, but that
router procedure is a one-line delegation — the service
`services/encounter-combat/participant-action.ts` owns the auth assertion, the
transaction boundary, the version-CAS contract, and the broadcast. It says the
fail-closed `PARTICIPANT_FIELD_KIND` field-classification map lives in
`routers/encounter.ts`; it lives in the same service file. And the guide's
deadlock argument describes the multi-row sort families as "code-point"
ordered, while the comparator those sorts actually run through,
`compareCodeUnits`, explicitly implements UTF-16 code-unit order and its own
doc block distinguishes the two. A maintainer auditing a suspected deadlock or
adding a participant field starts from the central guide, lands in a file that
contains none of the logic, and reads a technically false ordering claim inside
the very argument meant to prove sortedness. The pointers are also mutually
inconsistent: the service's JSDoc points at `docs/CONCURRENCY.md`, and
`CONCURRENCY.md` points back at the router.

## Evidence

- `docs/CONCURRENCY.md:354` — cross-table writer 1 is
  "`routers/encounter.ts:updateParticipant` (DM override)".
- `docs/CONCURRENCY.md:745-746` — "Field classification lives in the
  `PARTICIPANT_FIELD_KIND` map in `routers/encounter.ts`".
- `packages/server/src/routers/encounter.ts:225-228` — the procedure body is
  `.mutation(async ({ input, ctx }) => updateParticipant(ctx, input))`, a
  one-line delegation to the service.
- `packages/server/src/services/encounter-combat/participant-action.ts:58-75` —
  the exhaustive `PARTICIPANT_FIELD_KIND` map (`as const satisfies
  Record<keyof UpdateParticipantInput, "racing" | "non-racing">`) lives here.
- `packages/server/src/services/encounter-combat/participant-action.ts:284-318`
  — the request-facing `updateParticipant` writer; its JSDoc says "the router
  stays a thin pass-through" and cites `docs/CONCURRENCY.md`.
- `docs/CONCURRENCY.md:362`, `:369`, `:418` — the three ordering claims in the
  deadlock argument: "sort it by code point", "code-point participant-ID
  order", "sorts every multi-row family by code point".
- `packages/server/src/utils/string-order.ts:9-11` — the comparator's contract:
  `<`/`>` on raw strings "is UTF-16 code-unit order — not code-point order,
  which differs for supplementary-plane characters. Every id this repository
  sorts is ASCII, where the two agree."
- The sorts the guide describes really do run through that comparator:
  `packages/server/src/services/spell-casting/combat-transaction.ts:33`, `:39`,
  `:130` all sort via `compareCodeUnits`.
- `grep -n 'routers/encounter\.ts' docs/CONCURRENCY.md` returns exactly the two
  stale lines (354 and 746) today.

## Proposed direction

In `docs/CONCURRENCY.md`, repoint the `updateParticipant` writer and
`PARTICIPANT_FIELD_KIND` entries from `routers/encounter.ts` to
`services/encounter-combat/participant-action.ts`, and rename the lock-ordering
description from code-point to UTF-16 code-unit order, noting that current
ASCII identifiers make the two orders equivalent.

Mechanics — treat `participant-action.ts` and `compareCodeUnits` as
authoritative; this is a prose-only edit to one document:

1. `docs/CONCURRENCY.md:354` — change the writer's home to
   `services/encounter-combat/participant-action.ts:updateParticipant`.
2. `docs/CONCURRENCY.md:745-746` — same repoint for the
   `PARTICIPANT_FIELD_KIND` map.
3. `docs/CONCURRENCY.md:362`, `:369`, `:418` — replace "code point" /
   "code-point" with "UTF-16 code-unit"; at the first occurrence add one
   parenthetical naming the comparator (`compareCodeUnits`,
   `packages/server/src/utils/string-order.ts`) and noting that every id
   sorted today is ASCII, where code-unit and code-point order agree.
4. Verify: `grep -n 'routers/encounter\.ts' docs/CONCURRENCY.md` returns
   nothing (the `routers/encounter-map.ts` and
   `routers/encounter-combat-concurrency.test.ts` mentions do not match that
   pattern), and the only remaining "code-point" mention is the deliberate
   contrast note from step 3.

## Scope / caveats

- Prose-only: no source files change. `compareCodeUnits`'s body and its call
  sites are correct and out of scope.
- The behavioral description of the racing/blind whitelist at
  `docs/CONCURRENCY.md:731-755` is accurate against `participant-action.ts` —
  only the location claim is stale. One verified exception a fixer may sweep in
  the same pass: `:741` lists `initiativeModifier` as a blind-path field, but
  `updateParticipantInputSchema`
  (`packages/shared/src/schemas/encounter-inputs.ts:204-230`) has no such
  field, and the exhaustive map has no entry for it.
- [092-concurrency-rulebook-claims-three-exhaustive.md](092-concurrency-rulebook-claims-three-exhaustive.md)
  corrects a different `CONCURRENCY.md` claim (the exhaustive-patterns count).
  The two could land as one doc pass, but they are distinct claims — do not
  edit the file concurrently in two lanes.
- Prior pack: the live 2026-07-25 pack already schedules the same
  code-point→UTF-16-code-unit terminology correction for the spell-casting
  module docs —
  [07-PLAN.md](../code-quality-2026-07-25/07-PLAN.md) slice 07.1 covers
  `packages/server/src/services/spell-casting/MODULE.md:63-64` and pinning the
  ordering contract in the facade test. That slice does not touch
  `docs/CONCURRENCY.md` or the stale writer locations; this leaf covers only
  `CONCURRENCY.md` and leaves `MODULE.md` to that slice.
