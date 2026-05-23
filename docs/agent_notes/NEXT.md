# Next Up

Promotion pointer for the next human-requested leaf. This file is not a
FIFO queue, and backlog numbering/order is advisory, not permission to
keep pulling work. Parked work stays in `backlog/` unless this file
names it or a human asks for re-triage.

## Ready now

The `feature/lint-ratchet-sharing-backlog` branch is complete (all seven
leaves landed, including MIT license and sync to `ai_devx_stuff`). No
lint-ratchet sharing work remains.

The broader hardening snapshot is:

Latest landing: `feature/lint-hardening-baseline-drain-audit` drained 39
ratchet baseline items across four commits (`lint:ratchet` current
findings `128 -> 89`): magic-numbers in top-level scripts (`15 -> 0`),
`require-await` in `scripts/code-intel.test.ts` (`11 -> 0`),
`only-throw-error` + `expect-expect` in codemod tests (`12 -> 0`), and
`drift-ai.ts:249` `parseArgs` complexity (`49 -> 6`). Codex-reviewed
clean and merged as `9d0d1f9b`. Audit: `/tmp/codex-drain-audit-report.md`.
Details: `finished_work/baseline-drain-batch.md`.

Recent context (see `finished_work/` for full notes):

- `feature/jsdoc-plugin-eslint-rules` (merged): scoped
  `eslint-plugin-jsdoc@62.9.0` starter floor to `eslint-rules/*.js`.
- `feature/lint-hardening-pre-commit-perf-exploration` (merged):
  5 leaves trimmed pre-commit time (typecheck/lint parallelism,
  bounded-parallel script smokes, Vitest JSON opt-in, run-meta
  history archive).
- Leaves 42a/42b/42c drained
  `ratchet/core-complexity-lint-ratchet-runtime` to empty.
- Leaves 41b–41j brought broad-shallow lint coverage (ShellCheck,
  config sensors, root/package TS configs, coverage-map reach
  verification, JSON changed/pre-commit path) to "complete enough."

## Pivot point

Broad-shallow Leaf 41 coverage is **complete enough** after Leaf 41j.
Cleanup/drain work is no longer blocked by missing floors. Pull only
named drain/deeper-rule leaves next — do not opportunistically re-open
broad-shallow audits.

Suggested next targets (drain audit `/tmp/codex-drain-audit-report.md`,
2026-05-21):

- `ratchet/core-complexity-codemods` (24 items / 343 complexity weight,
  L effort; recommended as a separate branch, split by file).
- Remaining `ratchet/core-complexity-drift-ai` items
  (9 items after parseArgs drain — `comments.ts:87`, `runDriftAi`,
  `parseSuppressionDiff`, `buildReport`, plus small).
- `local/max-lines-*` ratchets — only with dedicated module-split time.

## Standing rules

- Keep new ratchets in the local/pre-commit gate (external CI is not
  reliable enough to be the only enforcement point).
- Land in small measured batches; re-measure `bun run lint:ratchet`
  after each; improve runner/sensor rather than skip a local floor.
- Each new ratchet's finished-work note must state an explicit exit
  path (drain to zero by leaf X, or stays staged because Y).

## Promoting a new cycle

When this section is idle, do not pull from a backlog's suggested order
without a human asking for that specific cycle. When a human does ask,
re-run the audit tools from a fresh checkout and promote exactly one
leaf:

```bash
bun run drift:ai --scope current
bun run test:coverage
bun run test:mutation
```
