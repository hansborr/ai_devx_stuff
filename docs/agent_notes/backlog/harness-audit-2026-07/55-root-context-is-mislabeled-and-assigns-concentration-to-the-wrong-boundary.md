# 55 — Root `CONTEXT.md` is mislabeled and assigns concentration to the wrong boundary

Status: Done
Track: DOC (docs) · Priority: P2 · Size: S

> **Amended — 2026-07-13 adversarial triage.** B5’s ownership drift stands and E2’s presentation finding was narrowed. The older broad-glossary R18 shape was demoted by two critics; use a scoped rename or purpose header, not an expanding root glossary.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `CONTEXT.md:1-15` — the root-named file contains only Character Live-State guidance and gives no purpose or scope cue.
- `CONTEXT.md:5` and `CONTEXT.md:11` — concentration is grouped under live-state commands that are said to own transactions, broadcasts, and logs.
- `packages/server/src/services/spell-casting/spell-casting.ts:112` and `packages/server/src/services/spell-casting/spell-casting.ts:122-134` — concentration ownership and `dropConcentration` live in spell casting.
- `packages/server/src/routers/cast-spell.ts:100-139` — the router owns authorization and broadcast around casting.
- `packages/server/src/services/character-live-state/` contains no concentration implementation.
- `docs/generated/lint-coverage-map.md:427` — a rename must also update the root-guidance inventory.

Failure: First-contact readers expect root-wide context and are directed toward the wrong service boundary and command-envelope ownership for concentration work.

## Do

Prefer renaming the file to a scoped character-live-state document, or add a strict purpose header that makes its narrow scope unmistakable. Correct the ownership list to point concentration at spell casting and router-owned broadcast. Do not revive R18’s broad glossary expansion; update the coverage-map reference if renaming.

## Verify

If the implementation renames `CONTEXT.md`, update its coverage-map entry;
then check the map:

```
bun run docs:lint-coverage-map:check
```

## Acceptance

- The file name or header accurately signals Character Live-State scope.
- Concentration guidance points to spell-casting ownership and router broadcast without claiming live-state owns it.
