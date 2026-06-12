# Lint Review 2026-06 Task Pack

Status: Task index — see "Working This Pack" for how to pick and finish work
Created: 2026-06-11
Source: two independent agent reviews of the lint setup (Claude and Codex,
2026-06-11). Every suggestion was verified against the codebase the same day;
file/line references in the leaves were re-checked, not copied from the
reviews.

## Verification Summary

Confirmed against the working tree on 2026-06-11:

- 35 of 37 ratchets are at zero findings; total remaining baseline debt is
  2 findings (both `local/max-lines` singles). Every ratchet carries
  `zeroBaselineDisposition` metadata and `bun run lint:ratchet:zero-baseline`
  gates on it. The old zero-baseline lifecycle note was stale and is
  superseded by leaf 03 here.
- The scripts coverage inversion is real: `eslint-config/base-configs.js:45`
  ignores `scripts/**/*` and `lintedScriptFiles`
  (`eslint-config/shared-policy.js:33`) re-includes ~30 entries file-by-file,
  with `scriptDebtOverrideConfigs` (`eslint-config/script-configs.js`) as the
  mirrored suppression surface.
- CI orders typecheck before lint with an explicit rationale comment
  (`.github/workflows/ci.yml:68`); local verify consumers run lint first or in
  parallel (`scripts/verify/steps.generated.sh`).
- Only `scripts/lint-agent-changed.sh` preflights `git merge-base`; six other
  changed wrappers use `$BASE...HEAD` without it.
- `eslint-rules/no-shared-schemas-barrel.test.js` already guards the schemas
  barrel ban via `calculateConfigForFile` — the Codex claim that flat-config
  rule replacement is untested was partially stale; leaf 07 narrows it to the
  unguarded entries.
- No import-cycle detection exists anywhere (`rg cycle` over lint configs and
  scripts: no hits). `eslint-plugin-import-x` 4.16.2 is already a dependency.
- `docs/guides/lint-ratchet.md:499` still says "1390-line baseline JSON"; the
  committed baseline is 796 lines.

Cleanup addendum (all 2026-06-11, in order):

- The old lint backlog folders were consolidated into this folder and
  removed. Leaf 09 carries the only remaining lint-message item.
- Leaf 03 was split into agent-sized sub-leaves (03a-03l), one per
  drain/adoption family, so each can be completed in a single session. The
  former Leaf 11 family map was folded into those sub-leaves and deleted.
- The pack was restructured so every Ordering entry is a uniform single-run
  leaf: sub-leaf 03d split into 03d1 (metrics file split) and 03d2 (runtime
  helper adoption); the former multi-item Leaves 10 and 12 moved to
  `watchlist.md` (evidence-gated, outside the Ordering); the former Leaf 13
  bundle split into single-item leaves 13a and 13b; the umbrella 03 file
  became pure shared reference with no checklist of its own.

## Decision Table

| Suggestion | Verdict | Where |
| --- | --- | --- |
| Claude 1 + Codex 4: drain promotion backlog, flip scripts coverage model | Accept (flagship; "delete two-thirds of the registry" is overstated — see leaf) | Sub-leaves 03a-03l (umbrella 03 is shared context) |
| Claude 2: e2e selector allowlist is an off-switch, plus `no-nth-methods` off | Accept | Leaf 04 |
| Claude 3: no import-cycle detection | Accept, evaluate-first | Leaf 05 |
| Claude 4: main lint uses `--cache` with type-aware rules | Accept as measured decision | Leaf 06 |
| Claude 5: registry glob redundancy | Completed during 03d2 runtime adoption | Leaf 03d2 / Leaf 08 note |
| Claude 6: single-source `assertFunctionNames` | Accept, small | Leaf 08 |
| Claude 7: unpin "1390-line baseline" doc reference | Accept, small | Leaf 08 |
| Codex 1: local typecheck-before-lint ordering | Accept | Leaf 02 |
| Codex 2: merge-base fallback in changed wrappers | Accept, broadened to all six wrappers | Leaf 01 |
| Codex 3: generate suppressions from ratchet metadata | Accept as platform carry-forward | Watchlist |
| Codex 5: config tests for flat-config replacement hazards | Accept narrowed (barrel guard already exists) | Leaf 07 |
| Codex 6: lint tool provisioning/doctor parity | Accept as platform carry-forward | Watchlist |
| Older backlog audit: ratchet local-rule message parity | Accept as carry-forward | Leaf 09 |
| Claude's "explicitly not change" list (warn + `--max-warnings=0`, improvement gate, debt log, merge driver) | Agree — no action | — |

## Working This Pack

1. Work exactly one leaf per run: resume the leaf marked `In Progress` if
   one exists, otherwise take the first leaf in Ordering whose `Status:` is
   not `Done`. The Ordering is a valid execution order — every dependency
   points at an earlier entry, so no dependency checking is needed beyond
   going top to bottom.
2. Each leaf records its own state in its `Status:` line. Vocabulary:
   `Parked` (not started), `In Progress` (optionally with a WIP note),
   `Blocked — <reason>`, `Done (<date>, <landing commit>)`. Nothing else
   tracks leaf state — there is no separate checklist.
3. When finishing a leaf, add short notes in the leaf (decisions, surprises,
   deferred bits) and commit the status edit with the code change.
4. Re-verify the file/line references in the leaf before editing; this pack
   was written on 2026-06-11 and the lint surface moves quickly. Max-lines
   counts are the ratchet's `effective-line-count` metric (blanks and
   comments skipped), so `wc -l` reading higher is not staleness.
5. Rule/plugin/sensor evaluations record their verdict in
   `evaluation-verdicts.md`.
6. Not workable: `00-index.md` (this file),
   `03-zero-baseline-promotion-and-scripts-inversion.md` (shared context for
   the 03 sub-leaves), `evaluation-verdicts.md` (verdict register), and
   `watchlist.md` (evidence-gated candidates that need a human promotion
   decision; to act on one, write a new numbered leaf and add it to the
   Ordering).

## Ordering

Filenames are the durable execution order: correctness and parity first
(01, 02), then the flagship consolidation (the 03 sub-leaves), then the
debt-growth stopper (04), then evaluations, hardening, and carry-forwards
(05-09, 13a/13b). Before any 03 sub-leaf, read the umbrella
`03-zero-baseline-promotion-and-scripts-inversion.md` for the
unbacked-suppressions warning, the cross-family ratchet rule, and the
shared verification gate set.

1. `01-changed-wrapper-merge-base-preflight.md` — shared no-common-ancestor
   preflight for every `...HEAD` changed wrapper.
2. `02-local-typecheck-before-lint-ordering.md` — make local verify match
   CI's typecheck-before-lint requirement or fail with a clear diagnostic.
3. `03a-drain-top-level-entrypoint-singletons.md` — drain the
   db-status/harness-emit-envelope/sensor-blob-size singletons.
4. `03b-drain-script-test-singletons.md` — drain the code-intel.test and
   lint-ratchet-baseline.test singletons.
5. `03c-split-lint-coverage-map-check.md` — split the coverage-map checker;
   drains 1 of the 2 remaining baseline findings.
6. `03d1-split-lint-ratchet-metrics.md` — split the metrics file; drains
   the other baseline finding.
7. `03d2-adopt-lint-ratchet-runtime.md` — adopt the ~33 lint-ratchet helper
   modules into normal lint.
8. `03e-drain-drift-ai-family.md` — drain drift-ai family suppressions.
9. `03f-adopt-code-intel-entrypoint.md` — adopt `code-intel.ts` (typeof
   import() rewrite).
10. `03g-adopt-harness-tooling-family.md` — adopt the harness tooling
    family; finishes `ratchet/local-max-lines-runtime`.
11. `03h-adopt-logs-audit-family.md` — adopt the logs-audit modules.
12. `03i-adopt-codemod-sources.md` — adopt codemod sources and lib.
13. `03j-adopt-codemod-tests.md` — adopt the four codemod test files
    (after 03i).
14. `03k-eslint-rules-floor-parity.md` — raise normal lint to the six
    eslint-rules ratchet floors or record keep verdicts.
15. `03l-invert-scripts-coverage-model.md` — flip `scripts/**` to
    linted-by-default (terminal; requires all earlier 03 sub-leaves).
16. `04-e2e-selector-debt-ratchets.md` — convert the e2e selector allowlist
    and `playwright/no-nth-methods` from off-switches into ratchet floors.
17. `05-import-cycle-detection.md` — evaluate `import-x/no-cycle` vs a
    `code:intel`-based cycle sensor.
18. `06-type-aware-eslint-cache-policy.md` — measure and decide the local
    `--cache` policy for the type-aware lint surface.
19. `07-flat-config-guard-tests.md` — extend the existing
    `calculateConfigForFile` guard pattern to unguarded by-key replacement
    hazards.
20. `08-registry-and-policy-small-cleanups.md` — one run, two remaining
    small items: shared `assertFunctionNames` constant and doc line-count
    unpin. The glob dedup item was completed during 03d2.
21. `09-ratchet-local-rule-message-parity.md` — carry the first local-rule
    ESLint message through message-count ratchets so ratchet envelopes can
    reuse concrete `How to fix:` guidance.
22. `13a-doctor-json-workdir.md` — re-check `doctor --json`
    working-directory handling for `harness:check`.
23. `13b-complexity-message-parser-test.md` — table-driven shape test for
    the complexity-message parser.

Evidence-gated follow-ups (formerly Leaves 10 and 12) live in
`watchlist.md`, outside this Ordering.

## Dependencies And Coupling

- The 03 sub-leaves shrink the watchlist's suppression-metadata entry; most
  `scriptDebtOverrideConfigs` entries disappear when their families join
  normal lint, and 03l re-audits what remains.
- Sub-leaves 03d1/03d2 touch the same runtime files as Leaf 09. Sub-leaf 03j
  coordinates with Leaf 08 item 2 (`assertFunctionNames`).
- The 03 family interacts with the watchlist's max-lines policy and
  ratchet-registry builder entries; both move after 03l.
- Leaf 02 is the local-side companion of the watchlist's CI validate fanout
  and harness-controls execution-model entries.
- Leaf 06 shares a decision space with the watchlist's CI ESLint cache
  entry; settle one cache policy covering both directions.
