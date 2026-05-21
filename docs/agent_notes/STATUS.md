# Status

**Last updated**: 2026-05-21 — Leaf 41 ratchet-metric alignment Batch 1 landed
`effective-line-count` for all seven `local/max-lines-*` ratchets:
`ratchet/local-max-lines`, `ratchet/local-max-lines-code-intel`,
`ratchet/local-max-lines-codemods`, `ratchet/local-max-lines-drift-ai`,
`ratchet/local-max-lines-generate-harness-controls`,
`ratchet/local-max-lines-logs-audit`, and `ratchet/local-max-lines-runtime`.
The migrated baseline stores `{ count, lines }` for every current over-limit
file, and the added smoke fixture proves an already-over-limit file can grow
from 4 to 5 effective lines, keep one diagnostic, and still fail the ratchet.
The required pre-migration audit was re-run first; post-migration lines are at
or below every audited ceiling, including the edited runner files
(`scripts/lint-ratchet.ts` 832 <= 846 and
`scripts/lint-ratchet-baseline.ts` 840 <= 857). Batch 2
`complexity-severity` for `core-complexity-*` remains pending.

Prior landings on this branch: Leaf 41 drift-ai test-harness bug-class
ratchets, Leaf 41 eslint-rules floor Phase A/A.2/B, child
leaf 41d coverage-map drift check, Batches 1-3 `local/max-lines` (codemods,
drift-ai, ratchet/harness runtime), Batch 4 codemod test-harness bug-class
ratchets (vitest + tseslint), Batch 5 core-rule runner support, Batch 6
`ratchet/core-complexity-codemods`, Batch 7
`ratchet/core-complexity-drift-ai`, and Batch 8 singleton `local/max-lines`
ratchets. The load-bearing Leaf 41 coverage map remains at
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`; every tracked
file family resolves to one of `{linted, ratcheted, proposed, pending-leaf,
excluded, not-code}` with no `unknown` rows. Continue Leaf 41 with small
measured ratchet/floor batches against this frozen scope.

## Active

Lint-hardening review follow-up Tier 2 is the active iterative workstream on
`feature/lint-hardening-review-followup`. The organized follow-up queue lives
in `backlog/lint-followups/00-index.md`; ratchet infrastructure leaves (01–05)
are resolved or explicitly deferred and should not be reopened without a human
ask. Old lint-hardening notes remain provenance only.

The current promoted leaf is `41-ratchet-first-overlooked-lint-coverage.md`.
With child leaf 41d, Phase A/A.2 eslint-rules implementation coverage, Phase B
rule-test coverage, the Batch 1-8 floors/source work, the drift-ai
test-harness bug-class floor, and Leaf 38 in place, the
operating principle for the
remaining Leaf 41 work is **broad shallow ceilings before deep drains**: get a
useful floor on every unprotected surface before any further core-rule
ratcheting or drain work. The next named work is item 2 in `NEXT.md`: Batch 2
of the ratchet-metric alignment, `complexity-severity` for the three
`core-complexity-*` ratchets, before root/package `*.config.*`, child leaf 41b
ShellCheck, and child leaf 41c workflow/config sensors. Phase A.3 for the
deferred `local/*`,
`eslint-comments`, and `simple-import-sort` eslint-rules audit is demoted back
to opportunistic because it deepens an already-floored surface. Detail and the
accepted tradeoff (drains stay
deferred) live in `NEXT.md`. New floors stay in local/pre-commit, not CI-only.
Bug-class findings (`vitest/expect-expect`, non-`Error` throws, ambiguous
truthiness) get fix-soon drains. Zero-finding ratchet scopes need matched-file
proof, ideally a temporary-violation probe reverted before commit. Core ESLint
rules (`complexity`, `max-params`, `no-nested-ternary`) have runner support and
live `complexity` ratchets over codemods, drift-ai, and eslint-rules;
`max-params` and `no-nested-ternary` are now opportunistic follow-ons, not
next-up.

Leaf 19's autonomous-slice queue remains substantially exhausted (slice 4
`scripts/code-intel.ts` re-probe confirmed the 9 `consistent-type-imports`
findings need manual rewrite; four codemod test files remain deferred). Leaf
38 resolved the former top-level non-tsconfig script deferral. Latest Leaf 19
landing was slice 5 (three drift-ai files).

## Verification

Each merged leaf passed its scoped verification gates (at minimum `lint`,
`typecheck`, plus `test:scripts:changed` / `test:server` / `test:client` as
relevant). Per-leaf verification detail lives in `LOG.md` and the per-leaf
`finished_work/` notes.

## Landed On This Branch

Review the referenced finished_work notes or leaf docs for details:

- PRs 1, 2, 3a, 3b, and 4 (rule contract, harness manifest, machine-readable
  diagnostics, JSON emitters, custom lint ratchet).
- Leaves 01, 02, 05, 06, 08, 10a, 13a, 13b, 14a, 14b, 14c, 15, 15b, 21, 22,
  23, 24, 26, 27, 28, 29.2, and the full `local/type-assertion-boundary`
  package drain (batches 3a–6, ratchet now at 0 current findings).
- Leaf 41 coverage map, Batches 1-3 `local/max-lines` ratchets (codemods,
  drift-ai, ratchet/harness runtime), Batch 4 codemod test-harness bug-class
  ratchets (vitest + tseslint), Batch 5 core-rule source support, Batch 6
  first `complexity` ratchet (codemods), Batch 7 drift-ai mirror `complexity`
  ratchet, Batch 8 singleton `local/max-lines` ratchets, child leaf 41d
  coverage-map drift check, Leaf 41 eslint-rules floor Phases A, A.2, and B,
  Leaf 41 drift-ai test-harness bug-class ratchets, Leaf 38 top-level script
  project lint adoption, and Leaf 41 metric-alignment Batch 1
  `effective-line-count` for `local/max-lines-*`.

## Historical Context

Per-leaf summaries and the evolution of the ratchet-first handoff live in
`LOG.md`. The lint-hardening backlog index is
`backlog/lint-hardening-cross-repo-review.md`, with the verdict register at
`backlog/lint-hardening/evaluation-verdicts.md`. Parked in-progress lint
context docs are retained for provenance and should only be opened when a
human asks for re-triage.
