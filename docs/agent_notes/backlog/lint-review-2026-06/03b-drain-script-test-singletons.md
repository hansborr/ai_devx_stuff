# 03b: Drain Script-Test Singletons

Status: Done (2026-06-12, landed in "refactor(lint): drain script test
singleton ratchets")

Completion notes (2026-06-12):

- Probe result: removing both script-test suppression blocks produced zero
  findings under normal ESLint; the unbacked offs in
  `lint-ratchet-baseline.test.ts` were stale.
- Review follow-up: the broad relaxed-CLI override also matched
  `lint-ratchet-baseline.test.ts` through `lint-ratchet*.ts`; added a narrow
  ignore so the file resolves strict `restrict-template-expressions` and
  `max-params` defaults, then re-probed normal ESLint clean.
- Deleted the four drained zero ratchets
  (`regexp/no-super-linear-backtracking`, explicit-return-type,
  no-unsafe-assignment, and restrict-template-expressions) and narrowed
  `ratchet/typescript-eslint-require-await-script-singletons` to the remaining
  `lint-coverage-map-check.ts` 03c scope.
- Kept the vitest `expect-expect` and `valid-expect` script-test floors as
  different-options ratchets, per the parent leaf.
- Ripple surfaces: removed the four deleted ratchet controls from
  `harness.controls.json`, regenerated `docs/generated/harness-controls.md`,
  and updated the two `docs/agent_notes/lint-coverage-map.md` rows that still
  pointed at the deleted ratchets.
Order: 03b
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

Files: `scripts/code-intel.test.ts`,
`scripts/lint-ratchet/lint-ratchet-baseline.test.ts`. Both are in
`lintedScriptFiles` already.

Ratchets (zero, `narrow-floor`):

- `ratchet/typescript-eslint-explicit-function-return-type-script-tests`
- `ratchet/typescript-eslint-no-unsafe-assignment-script-tests`
  (`code-intel.test.ts` only)
- `ratchet/regexp-no-super-linear-backtracking-script-tests`
  (`lint-ratchet-baseline.test.ts` only)
- `ratchet/typescript-eslint-require-await-script-singletons` — drain only
  the `code-intel.test.ts` entry; 03c finishes `lint-coverage-map-check.ts`.
- `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`
  — drain only the `code-intel.test.ts` entry (03a handled the rest).

Suppression surface (`eslint-config/script-configs.js`):

- the `code-intel.test.ts` block (four rules off) — all four ratchet-backed;
- the `lint-ratchet-baseline.test.ts` block (six rules off) — only
  `explicit-function-return-type` and `regexp/no-super-linear-backtracking`
  are ratchet-backed. `no-dynamic-delete`, `no-unsafe-assignment`,
  `restrict-template-expressions`, and `max-params` for this file are
  unbacked offs: probing may surface live findings nothing currently tracks.

Keep decisions (do not drain here):
`ratchet/vitest-expect-expect-script-tests` and
`ratchet/vitest-valid-expect-script-tests` pin stricter options
(`assertFunctionNames` allowlist, `maxArgs: 2`) than resolved plugin
defaults — different-options floors per the parent leaf. If Leaf 08 item 2
(single-source `assertFunctionNames`) has not landed, this batch is a good
vehicle for it.

## Scope

1. Remove the two suppression blocks; fix surfaced findings (expect the
   unbacked offs in the baseline test block to produce real work) or take
   narrow reasoned overrides.
2. Delete the wholly-contained ratchets; remove `code-intel.test.ts` from
   the two cross-family ratchets' `files` lists.
3. `bun run lint:ratchet:update`; confirm unchanged scope elsewhere via
   `lint:ratchet:summary`.

## Definition Of Done

Neither test file has a `scriptDebtOverrideConfigs` block; the singleton
ratchets are gone; the vitest different-options floors remain with their
keep rationale intact.

## Verification

Umbrella gate set, plus
`bash scripts/vitest.sh run scripts/lint-ratchet/lint-ratchet-baseline.test.ts`
and the code-intel test target after any test-file edits.
