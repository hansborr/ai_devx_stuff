# 03a: Drain Top-Level Entrypoint Singletons

Status: Done (2026-06-11, landed in "refactor(lint): drain top-level
entrypoint singletons")

Completion notes (2026-06-11):

- Probe result: removing every suppression entry produced zero findings —
  all listed suppressions for these four files were already stale, including
  the "unbacked" relaxed-CLI entries (`max-params` back at 4, no-magic-numbers
  back at warn, both clean).
- Relaxed-CLI-options decision: went strict. The four files already satisfy
  `restrict-template-expressions` `allowNumber: false`, so normal lint pins
  the ratchet's stricter options in a dedicated `script-configs.js` block
  (commented) instead of keeping a different-options ratchet floor.
- Deleted `core-preserve-caught-error-`, `typescript-eslint-no-unsafe-argument-`,
  and `typescript-eslint-unbound-method-top-level-scripts`; narrowed the three
  cross-family ratchets to their 03b/03c remainders (`lint-coverage-map-check.ts`,
  `code-intel.test.ts`) and refreshed their disposition reasons.
- Ripple surfaces beyond the leaf's list: `harness.controls.json` (three
  entries removed, three principles reworded; regenerated
  `docs/generated/harness-controls.md`) and `docs/agent_notes/lint-coverage-map.md`
  (the four Leaf 38 rows still claimed the files were not normal-linted —
  stale even before this leaf; now linted + ratcheted).
- Violation probe: `preserve-caught-error` fired in normal lint on
  `sensor-blob-size.ts` (note the probe needs a bound catch parameter;
  `requireCatchParameter: false` ignores bare `catch {}`), then reverted.
Order: 03a (first batch of the Leaf 03 umbrella)
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md` — read its
unbacked-suppressions warning and cross-family ratchet rule first.

## Context

Files: `scripts/db-status.ts`, `scripts/harness-emit-envelope.ts`,
`scripts/sensor-blob-size.ts`, `scripts/sensor-blob-size.test.ts`. All are in
`lintedScriptFiles` and `tsconfig.scripts.json` already; the work is
suppression removal and ratchet promotion, no adoption.

Ratchets over these files (all zero, all `narrow-floor`):

- `ratchet/core-preserve-caught-error-top-level-scripts`
- `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`
- `ratchet/typescript-eslint-unbound-method-top-level-scripts`
- `ratchet/core-complexity-top-level-scripts` (also covers
  `lint-coverage-map-check.ts` — narrow, don't delete; 03c finishes it)
- `ratchet/core-no-magic-numbers-top-level-scripts` (same split with 03c)
- `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`
  (also covers `code-intel.test.ts` — narrow; 03b finishes it)

Suppression surface (`eslint-config/script-configs.js`):

- the `harness-emit-envelope.ts` block (`unbound-method`,
  `preserve-caught-error` off) — ratchet-backed, removable once normal lint
  holds the floor;
- the `harness-emit-envelope.ts` entry in the `no-unsafe-argument` block;
- these files' entries in the relaxed CLI block
  (`restrict-template-expressions` `allowNumber: true`, `max-params` 6,
  `no-magic-numbers` off) — a policy decision per family: fix numeric
  interpolations to meet the ratchet's stricter `allowNumber: false` floor,
  or keep the relaxed options deliberately and keep the ratchet as a
  different-options floor;
- the `sensor-blob-size.ts` entry in the `complexity: "off"` block
  (ratchet-backed);
- the `sensor-blob-size.test.ts` entry in the test-file relax block.

## Scope

1. Probe: for each suppression entry above, remove it and run normal lint on
   the four files. Fix findings or take a narrow reasoned override.
2. Make normal lint enforce what each drained ratchet enforced (same rule,
   same or stricter options) for these files.
3. Delete the three wholly-contained ratchets; remove these four files from
   the three cross-family ratchets' `files` lists.
4. `bun run lint:ratchet:update`; confirm via `lint:ratchet:summary` that no
   other ratchet's scope changed.

## Definition Of Done

The four files have no `scriptDebtOverrideConfigs` entries and no
singleton ratchets; every rule the deleted ratchets pinned is enforced at
equal or stricter strength by normal lint. The relaxed-CLI-options decision
is written down (comment in the config block or evaluation verdict).

## Verification

Umbrella gate set (see parent leaf), plus: a deliberate
`preserve-caught-error` violation probe in `sensor-blob-size.ts` fails normal
lint (then revert).
