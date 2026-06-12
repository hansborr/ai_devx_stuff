# 03e: Drain Drift-AI Family Suppressions

Status: Done (2026-06-12, landed in "refactor(lint): drain drift-ai family
suppressions")

Completion notes (2026-06-12):

- Probe result: removing every drift-ai suppression produced 675 findings —
  the relaxed CLI and test-relax blocks were heavily live (445
  restrict-template-expressions, 152 no-magic-numbers, 33 max-params, 21
  explicit-function-return-type, 19 no-unsafe-assignment, 4
  no-dynamic-delete). The unbacked offs hid exactly one live finding
  (`regexp/no-unused-capturing-group` in `drift-ai/comments.ts:122`, fixed
  with a non-capturing group); the no-unnecessary-condition and per-file
  super-linear-backtracking / switch-exhaustiveness offs were stale.
- Fix-or-keep decision: KEEP the relaxed CLI options (allowNumber,
  max-params 6, no-magic-numbers off) for the whole family including tests,
  as a commented policy block (verdict in `evaluation-verdicts.md`). FIX the
  test-relax block instead of keeping it: 21 return-type annotations, a
  typed `stringContaining` seam (`scripts/drift-ai/matcher.test-helper.ts`)
  for the 18 flagged vitest asymmetric-matcher sites (21 call sites converted
  so each file uses one idiom), `vi.stubEnv`/`vi.unstubAllEnvs`
  for the 4 no-dynamic-delete env save/restore sites, one JSON.parse
  boundary assertion, and two String() wrappers for non-number unions.
- All six drift-ai `maxLinesPolicy.exceptions` were stale (files split since;
  all under 300 raw lines) and were deleted, so normal lint now holds the
  error-300 cap the ratchet floored.
- Ripples: `harness.controls.json` (two ratchet entries removed; regenerated
  `docs/generated/harness-controls.md`) and the coverage map's whole drift-ai
  section, whose rows still claimed the family was not normal-linted — stale
  since before this leaf; rewrote the intro and updated 52 rows.
- The same `delete process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV]` pattern
  remains in `scripts/harness/harness-diagnostics-output.test.ts` and
  `scripts/logs-audit/logs-audit.test.ts`; 03g/03h can reuse the vi.stubEnv
  conversion (and the matcher seam if needed).
Order: 03e
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

`scripts/drift-ai.ts`, `scripts/drift-ai/**`, `scripts/drift-ai.test.ts` are
already fully in `lintedScriptFiles`; this batch is suppression
reconciliation plus possible file splits, no adoption.

Ratchets (zero):

- `ratchet/core-complexity-drift-ai` (`narrow-floor`)
- `ratchet/local-max-lines-drift-ai` (`narrow-floor`)
- Keep decisions, not drains: `ratchet/vitest-expect-expect-drift-ai-tests`
  pins `assertFunctionNames: ["expect"]` — deliberately narrower than both
  plugin defaults and the script-tests allowlist (Leaf 08 notes it stays
  independent); `ratchet/vitest-valid-expect-drift-ai-tests` pins
  `maxArgs: 2`.

Suppression surface (`eslint-config/script-configs.js`):

- `drift-ai.ts` / `drift-ai/**/*.ts` in the relaxed CLI block
  (fix-or-keep policy decision, as in 03a);
- `drift-ai.test.ts` / `drift-ai/**/*.test.ts` in the test-file relax block;
- `drift-ai.ts` in the `complexity: "off"` block — ratchet-backed;
- `drift-ai.ts`, `drift-ai/comments.ts` in the
  `regexp/no-unused-capturing-group` block — unbacked;
- `drift-ai/duplicates.ts`, `drift-ai/ghost-files.ts` in the
  `no-unnecessary-condition` block — unbacked;
- the `drift-ai.ts` per-file block (`regexp/no-super-linear-backtracking`,
  `switch-exhaustiveness-check`) — unbacked.

`scripts/drift-ai/fixtures/**` stays ignored (tsconfig and ratchets already
exclude it).

## Scope

1. Remove the suppression entries above one block at a time; probe and fix.
   The unbacked regexp / unnecessary-condition / switch-exhaustiveness offs
   may hide live findings — fix or take narrow line-scoped overrides, not
   file-level offs.
2. If any drift-ai module is over the normal max-lines cap, split it
   (policy doc applies) rather than keeping the ratchet floor.
3. Drain `core-complexity-drift-ai` and `local-max-lines-drift-ai` once
   normal lint holds equal-or-stricter floors.
4. Record the keep verdict for the two vitest drift-ai floors in
   `evaluation-verdicts.md` (they are the pack's canonical different-options
   examples).
5. `bun run lint:ratchet:update`; scope-diff via `lint:ratchet:summary`.

## Definition Of Done

No drift-ai entry remains in `scriptDebtOverrideConfigs`; the complexity and
max-lines drift-ai ratchets are gone; the two vitest floors remain with a
recorded verdict.

## Verification

Umbrella gate set, plus the drift-ai vitest targets
(`bash scripts/vitest.sh run scripts/drift-ai.test.ts` and the
`scripts/drift-ai/**` tests) after any splits.
