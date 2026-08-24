# 221. Rename metamagic slot terminology to options-known terminology

Status: Not started
Theme: Metamagic option counts are named as slots in the shared API and caller · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The shared sorcery helper counts metamagic options a character knows, but its
public name calls those choices “slots.” The level-up caller carries the same
misnomer into a local maximum. In a workflow that also handles actual spell
slots, the names obscure which resource is being capped and make otherwise
straightforward validation require inspection of the function body and error
message.

The arithmetic is already correct. The problem is the vocabulary at the API
and caller boundary: it describes one rules-domain concept using the established
term for another.

## Evidence

- `packages/shared/src/rules/sorcery-points.ts:161-170` — the JSDoc describes
  “cumulative metamagic options known,” while the export is named
  `getMetamagicSlotsAtLevel`.
- `packages/server/src/services/level-up/sorcerer.ts:56-62` — the level-up
  validator stores the helper result in `maxSlots`, although the rejection
  message consistently calls the capped values metamagic options.
- `packages/shared/src/rules/sorcery-points.test.ts:211-234` — the focused test
  heading, suite name, and every level-band assertion repeat the slots
  terminology.
- A production-reference search returned only the shared definition and the
  server import/call, measured with
  `rg -n "getMetamagicSlotsAtLevel" packages --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/*.spec.ts' --glob '!**/*.spec.tsx'`:
  `packages/shared/src/rules/sorcery-points.ts:162` and
  `packages/server/src/services/level-up/sorcerer.ts:3,57`.

## Proposed direction

Rename `getMetamagicSlotsAtLevel` to
`getMetamagicOptionsKnownAtLevel` and rename the server caller's `maxSlots`
local to `maxOptions`. Update the import, call, comparison, error interpolation,
focused suite name, and every focused assertion as one atomic monorepo rename.

Keep the helper loop and constants unchanged. The existing level-band tests
must continue to pin 0 options before level 2, 2 at levels 2–9, 4 at levels
10–16, and 6 at levels 17–20. Retain the focused server validation coverage so
the renamed local still caps total known options and preserves the current
error text.

## Scope / caveats

- Do not change metamagic option counts, milestone levels, progression
  arithmetic, validation behavior, or error wording.
- Coordinate the same-file edit with
  [029-one-metamagic-constant-controls-two.md](./029-one-metamagic-constant-controls-two.md).
  That proposal separates the learned-per-milestone and per-cast constants; it
  does not own this helper or caller rename. Avoid concurrent edits to
  `sorcery-points.ts`.
- Do not rename unrelated weapon-mastery or spell-slot variables that correctly
  use slot terminology.
- No prior-pack record covers this terminology mismatch.
