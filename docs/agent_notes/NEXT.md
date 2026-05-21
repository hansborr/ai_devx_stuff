# Next Up

Promotion pointer for the next human-requested leaf. This file is not a FIFO
queue, and backlog numbering/order is advisory, not permission to keep pulling
work. Parked work stays in `backlog/` unless this file names it or a human
asks for re-triage.

## Ready now

Lint-hardening review follow-up Tier 2 is the active iterative workstream on
`feature/lint-hardening-review-followup`. The current human-promoted leaf is
`backlog/lint-followups/41-ratchet-first-overlooked-lint-coverage.md`; the
organized follow-up queue lives in `backlog/lint-followups/00-index.md`.
Ratchet infrastructure leaves (`01`–`05`) and PRs 1–4, 3b are resolved — see
`LOG.md` and `finished_work/` for landing details. Do not reopen the
resolved leaves without a human ask.

The Leaf 41 coverage map landed at
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` via merge
`b3c0ca0c`; every tracked row resolves to `{linted, ratcheted, proposed,
pending-leaf, excluded, not-code}` with no `unknown` rows. Use the map as the
frozen scope for subsequent ratchet/floor batches.

Latest landing: Leaf 41 ratchet-metric alignment Batch 1 converted all seven
`local/max-lines-*` ratchets to `effective-line-count` and migrated their
baseline items to `{ count, lines }`. The required pre-migration audit was
re-run first; every generated `lines` value is at or below the audited ceiling,
including `scripts/lint-ratchet.ts` (832 <= 846) and
`scripts/lint-ratchet-baseline.ts` (840 <= 857). The new smoke fixture proves
line growth from 4 to 5 fails while diagnostic count stays 1, and a shrink
reports an improvement. Prior latest landing: Leaf 38 codex-review P2 follow-up
widened every `*-top-level-scripts` ratchet to the full four-file Leaf 38 set.
Earlier batches added the codemod, drift-ai, runtime, codemod-test, core-rule,
singleton, and eslint-rules ratchets; per-batch detail lives in the Leaf 41 /
Leaf 38 `finished_work/` notes.

### Next Leaf 41 batches (named, in order)

Operating principle: **broad shallow ceilings before deep drains.** Get a
useful floor on every unprotected surface before any further core-rule
ratcheting (`max-params`, `no-nested-ternary`) or drain work. Each step
below produces an actual ceiling; cleanup/drain stays parked until these
land or are explicitly deferred.

1. **Landed child leaf 41d: Coverage-map generator/check.** Pre-commit-runnable
   script that validates stale map patterns, cited ratchet IDs, status
   vocabulary, and tracked lint-map extensions without full map regeneration.
   Full `Files` count, normal-lint membership, and ratchet membership
   re-derivation stay deferred unless promoted to a named follow-on leaf.
2. **Leaf 41 ratchet-metric alignment Batch 2** from
   `docs/agent_notes/in_progress/leaf-41-ratchet-metric-alignment-plan.md`.
   Convert the three `core-complexity-*` ratchets to `complexity-severity`.
   Batch 1 (`effective-line-count` for all `local/max-lines-*`) has landed;
   do not reopen it unless review finds a targeted follow-up. This is
   ceiling-integrity work, not a drain.
3. **Root/package `*.config.{ts,mts,cts}` block** with its own parser
   project (`eslint.config.js`, `commitlint.config.js`, per-package Vite/
   Vitest/Prisma configs). Currently ignored by normal lint.
4. **Child leaf 41b: ShellCheck floor** over `scripts/**/*.sh`,
   `.husky/*`, `.codex/hooks/*.sh`, `.claude/hooks/*.sh`,
   `.devcontainer/*.sh`.
5. **Child leaf 41c: workflow / config sensors** — actionlint +
   yamllint + taplo + hadolint over workflows, agent/devcontainer config,
   TOML configs, and Dockerfiles.

Tradeoff: this ordering still defers deep drains (e.g., draining the
`local/max-lines` or `core/complexity` baselines to zero) potentially for
weeks. The inserted metric-alignment work is not a drain; it makes the existing
ceilings enforce numeric "no worse than baseline" semantics before the next
round of broad floors continues. A floor that exists everywhere still beats a
zero somewhere with gaps next door.

Opportunistic follow-ons after the named work (no scheduled order):

- **Phase A.3 — eslint-rules deferred rule audit.** Audit the `local/*`,
  `eslint-comments`, and `simple-import-sort` rules that remain intentionally
  absent from the Phase A.2 non-type-aware block. Several `local/*` rules are
  type-aware or package-boundary-specific; decide rule-by-rule whether an
  `eslint-rules/*.js` floor is appropriate, and ratchet tractable findings
  rather than editing rule implementation source.
- **Tighten the coverage-map-check wiring.** Codex review of 41d flagged
  two P2 wiring gaps that do not block the check itself:
  (a) `.husky/pre-commit`'s existing staged-file regex short-circuits
  before `docs:lint-coverage-map:check` when the only staged paths are
  map-scoped files outside that regex (e.g. `.github/workflows/*.yml`,
  root `*.toml`, `.devcontainer/*`) — exactly the file classes the check
  is meant to catch as unaccounted; and
  (b) `scripts/verify.sh` reads the map from the worktree, so a stale
  staged map + fixed unstaged map can pass `verify --changed`. Either
  add the coverage-map path to the source-relevant classifier or read
  the staged copy. Small single-batch follow-up; lift to named when
  next picked up.
- JSDoc lint plugin for `eslint-rules/*.js` — currently not a dependency.
- Additional core ratchets (`max-params`, `no-nested-ternary`) over the
  codemod or drift-ai families using Batch 5's core-source infra.

### Standing rules for all batches

Keep new ratchets in the local/pre-commit gate (external CI is not reliable
enough to be the only enforcement point). Land in small measured batches,
re-measure `bun run lint:ratchet` after each, improve the runner/sensor
rather than skipping a local floor. Each new ratchet's finished-work note
must state an explicit exit path (drain to zero by leaf X, or stays staged
because Y) so floors do not become indefinite parking.

## Promoting a new cycle

When this section is idle, do not pull from a backlog's suggested order
without a human asking for that specific next cycle. When a human does ask,
re-run the audit tools from a fresh checkout and promote exactly one leaf:

```bash
bun run drift:ai --scope current
bun run test:coverage
bun run test:mutation
```
