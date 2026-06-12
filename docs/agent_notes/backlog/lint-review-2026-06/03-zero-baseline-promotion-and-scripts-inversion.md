# Zero-Baseline Promotion And Scripts Coverage Inversion

Status: Reference — shared context for sub-leaves 03a-03l; this file is
never workable itself and never gets a Done status. Sub-leaf statuses live
in the sub-leaf files; nothing is tracked here.
Order: 03 (umbrella)
Source: Claude review item 1 + Codex review item 4. Supersedes the deleted
legacy zero-baseline lifecycle note. Split into sub-leaves 03a-03l on
2026-06-11 so each batch is one agent-sized task; the former Leaf 11 family
map was folded into the sub-leaves. 03d was further split into 03d1/03d2
the same day.

## Context

As of 2026-06-11, 35 of 37 ratchets are at zero findings; total baseline debt
is 2 findings, both `local/max-lines` singles
(`scripts/lint-coverage-map-check.ts` at 352 effective lines, sub-leaf 03c;
`scripts/lint-ratchet/lint-ratchet-metrics.ts` at 357 effective lines,
sub-leaf 03d1). Max-lines counts in this pack are the ratchet's
`effective-line-count` metric — blank and comment lines are skipped, so
`wc -l` reads higher; that gap is not a stale reference. Every ratchet
carries `zeroBaselineDisposition` metadata and the zero-baseline gate
passes. Promotion is cheap; what remains is executing it family by family.

Most zero ratchets exist because of the scripts coverage inversion:
`eslint-config/base-configs.js:45` globally ignores `scripts/**/*`, and
`lintedScriptFiles` (`eslint-config/shared-policy.js:33`) re-includes ~30
entries file-by-file, with `scriptDebtOverrideConfigs`
(`eslint-config/script-configs.js`) as the mirrored suppression surface.
Beyond the re-included files, ~90 non-fixture script files are not linted at
all today (33 lint-ratchet helpers, ~37 codemods files, 7 harness helpers,
5 logs-audit modules, plus `code-intel.ts`, `harness-audit.ts`,
`lint-agent-fix-text.ts`). `tsconfig.scripts.json` already includes almost
all of them, so adoption is mostly an ESLint re-include change, not a
tsconfig change.

## Warning: Unbacked Suppressions

The `scriptDebtOverrideConfigs` comment "the ratchet system enforces these
rules independently" is only true for some entries. Verified 2026-06-11,
these suppressions have NO backing ratchet (they are invisible live debt or
stale offs):

- `complexity: "off"` for `generate-harness-controls.ts`, `harness-check.ts`,
  `lint-agent.ts`, `logs-audit.ts` (only `drift-ai.ts` and
  `sensor-blob-size.ts` in that block are ratchet-backed).
- The entire `regexp/no-unused-capturing-group` block (`drift-ai.ts`,
  `drift-ai/comments.ts`, `harness-check.ts`, `lint-ratchet-metrics.ts`,
  `lint-ratchet.ts`).
- The entire `@typescript-eslint/no-unnecessary-condition` block.
- `no-unsafe-argument` for `lint-ratchet-baseline-parse.ts` and
  `lint-ratchet-baseline.ts` (the `harness-emit-envelope.ts` entry is backed).
- The `drift-ai.ts` and `lint-ratchet.ts` per-file blocks.
- Most of the `lint-ratchet-baseline.test.ts` block (only
  `explicit-function-return-type` and `regexp/no-super-linear-backtracking`
  are backed).

Each sub-leaf must therefore treat the suppression surface, not the registry,
as the debt inventory: removing an off can surface findings no baseline
tracks. Probe first; fix, ratchet, or take a narrow reasoned override.

## Sub-Leaves

Work exactly one at a time, in the index Ordering (lettered order). Status
and landing commit are recorded in each sub-leaf file, not here.

- 03a — drain top-level entrypoint singletons (db-status,
  harness-emit-envelope, sensor-blob-size)
- 03b — drain script-test singletons (code-intel.test,
  lint-ratchet-baseline.test)
- 03c — split `lint-coverage-map-check.ts` and drain its floors (1 of 2
  remaining baseline findings)
- 03d1 — split `lint-ratchet-metrics.ts` (the other baseline finding)
- 03d2 — adopt lint-ratchet runtime helpers
- 03e — drain drift-ai family suppressions
- 03f — adopt `code-intel.ts` (typeof import() rewrite)
- 03g — adopt harness tooling family (harness-audit, harness helpers,
  lint-agent reconciliation)
- 03h — adopt logs-audit modules
- 03i — adopt codemod sources and lib
- 03j — adopt codemod tests
- 03k — eslint-rules floor parity (independent of the other batches, but
  worked in order under the one-leaf-per-run rule)
- 03l — invert the `scripts/**` coverage model (last; requires all others)

## Cross-Family Ratchets

Some ratchets span sub-leaves. The earlier batch removes its drained files
from the ratchet's `files` list and refreshes the baseline; the batch that
drains the last file deletes the ratchet:

- `ratchet/core-complexity-top-level-scripts` and
  `ratchet/core-no-magic-numbers-top-level-scripts`: 03a + 03c.
- `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`:
  03a + 03b.
- `ratchet/typescript-eslint-require-await-script-singletons`: 03b + 03c.
- `ratchet/local-max-lines-runtime`: 03d1 (drains the metrics finding) +
  03d2 (narrows after adopting the lint-ratchet helpers) + 03g (deletes,
  once `harness-check-validation.ts` and the harness CLI caps are settled).

## Keep, Don't Delete

"Promote and delete two-thirds of the registry" (Claude) is overstated. These
need explicit keep-or-narrow verdicts (recorded in `evaluation-verdicts.md`
by 03l), not deletion:

- `intentional-ratchet-only` floors: `ratchet/strict-boolean-expressions-shared`
  and the broad `ratchet/local-type-assertion-boundary` floor. The
  codemod-test floors stop being intentional once 03j lands.
- different-options floors: the vitest `expect-expect` / `valid-expect`
  families where the ratchet pins stricter options than the resolved plugin
  defaults (script-tests pin an `assertFunctionNames` allowlist; the drift-ai
  floor pins `["expect"]` only and stays independent per Leaf 08).

## Coupling

- 03d1/03d2 touch the same runtime files as Leaf 09 (message parity) and
  Leaf 08 item 1 (registry glob redundancy); land or rebase accordingly.
- Landing batches shrinks the watchlist's ratchet-suppression metadata
  entry; 03l re-audits it.
- The watchlist's max-lines single-source policy and ratchet-registry
  builder entries both move after 03l.

## Verification

Every sub-leaf runs at minimum:

- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet` / `lint:ratchet:zero-baseline` /
  `lint:ratchet:check-registry` / `lint:ratchet:check-baseline`
  (`lint:ratchet:update` when registry or baseline identity changes)
- `bun run docs:lint-coverage-map:check`
- `bun run verify:changed`
