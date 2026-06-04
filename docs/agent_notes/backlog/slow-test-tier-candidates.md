# Slow-Tier Migration Candidates

Status: Parked (Tier 3 of the 2026-06 test-runtime reduction work)
Date: 2026-06-03
Source: `test-runtime-audit` agent-team run (live timings against the test DB);
sibling work landed on branch `fix/reduce-verify-times`.

Parked list of tests that are **valuable but slow** and could move into the
slow tier (`vitest.slow.config.ts`, run only via `bun run test:slow`) to shrink
the per-commit critical path. Deferred on purpose: unlike the dead-test removals
and the worker/concurrency bumps that already landed, re-tiering is a behavior
change (these tests stop running in pre-commit / `verify:changed`), so we only
do it if we still need to trim more time after the landed wins settle.

Promote one bucket at a time and re-measure; do not move everything at once.

## Baseline that motivated this (measured 2026-06-02)

| Surface | Wall | Note |
|---|---|---|
| server vitest | 134s → **50s** | already cut by `SERVER_TEST_MAX_WORKERS` 4→6 (landed) |
| client vitest | 73s | breadth, not a few giants — not a slow-tier target |
| scripts vitest | 12s | ~20s of it is 2 files |
| shell smokes | 112s | floored by `test-ai-hooks` + `test-lint-ratchet` |

After the landed worker bump, the next bottlenecks are the shell-smoke giants
and the heavy `scripts` meta-tests; the server concurrency files are smaller
individually but sit directly on the (now ~50s) server path.

## ⚠️ Coverage-threshold caveat (read before moving any whole file)

`bun run test:coverage` uses the **default** root config, which **excludes**
`**/*.slow.test.*`. Concurrency tests frequently cover unique race-handling
**branches** that no fast test exercises. Moving such a file wholesale can drop
`packages/server/src/**` below its thresholds (lines 93 / branches 86 in
`vitest.config.ts`) and fail `test:coverage`. Before landing any whole-file
move:

1. Run `bun run test:coverage --project=server` (or the relevant project)
   after the move and confirm thresholds still pass.
2. If they drop, either keep a small fast test that covers the same lines, or
   teach the coverage run to include the slow tier. Do **not** lower thresholds
   to accommodate a move.

`scripts/test-changed.sh` already hints when a changed `*.slow.test.*` file is
detected, so changed-mode ergonomics are handled once files are renamed.

## How to move

- **Whole file:** rename `foo.test.ts` → `foo.slow.test.ts`. No other change;
  the slow config picks it up and the default configs exclude it.
- **Part of a file (preferred for mixed fast/slow files):** extract the slow
  `describe(...)` block into a new sibling `foo-concurrency.slow.test.ts`
  (carry its imports/helpers); leave the cheap cases in the original fast file.
- **Shell smokes:** there is **no** slow tier for shell smokes today — they are
  not vitest `*.slow.test.*` files. Deferring one needs new plumbing: a
  `MUSI_RUN_SLOW_TESTS`-gated "slow smoke" classification in
  `scripts/test-scripts.sh` (drop it from the default `script-smoke-test-names`
  selection and run it only from `test:slow` / a new slow-smoke entry point).

Line numbers below are approximate (from the audit) — **verify the current
ranges before extracting.**

## Server product tests (sit on the ~50s server path)

| File | Measured | Move | Confidence |
|---|---|---|---|
| `packages/server/src/routers/auth-rate-limit.test.ts` | 4.0s (slowest server file) | Whole file → `.slow`. Logic counterpart `trpc/rate-limit.test.ts` covers the limiter with fake timers; this file only proves HTTP wiring via `app.inject`. | high |
| `packages/server/src/routers/encounter-combat-concurrency.test.ts` | 3.2s | Whole file → `.slow` (all-concurrency: `Promise.all` injects, 20-iter race ~`:527-602`). | high |
| `packages/server/src/routers/sorcery-point.test.ts` | ~2.0s of 2.74s | Extract concurrency `describe` (~`:257-381`, 100-iter ~`:321-380`) → `sorcery-point-concurrency.slow.test.ts`; keep sequential cases (~`:104-242`). | high |
| `packages/server/src/routers/rest-long.test.ts` | ~1.8s of 3.17s | Extract concurrency `describe` (~`:376-496`, ITER=30) → `rest-long-concurrency.slow.test.ts`; keep HP/hit-dice/auth cases. | high |
| `packages/server/src/routers/character-stats-concurrency.test.ts` | ~1.8s of 2.68s | Extract the race loops (~`:97-132`, `:481-534`); **keep** the cheap `describe("correctness")` math (~`:358-470`) fast. | medium |
| `packages/server/src/services/level-up/level-up-concurrency.test.ts` | ~1.5s | Whole file → `.slow` (real `LOCK TABLE`, ~`:136-196`). | medium |
| `packages/server/src/routers/character-level-up.test.ts` | ~1.2s of 2.12s | Extract concurrent `describe` (~`:296+`, `LOCK TABLE` ~`:311-349`); keep sequential level-up asserts. | medium |
| `packages/server/src/routers/invite-concurrency.test.ts`, `cast-spell-concentration.test.ts` | <1.5s, not top-40 | **Investigate** — move only for policy consistency, not runtime. | low |

## Scripts (meta/tooling) vitest tests

| File | Measured | Move | Confidence |
|---|---|---|---|
| `scripts/lint-ratchet-output.test.ts` | 11.4s (slowest file overall; ~10 `bun` spawns/test) | Whole file → `.slow`. The sidecar writer is already unit-tested in-process by `harness-diagnostics-output.test.ts`. | high |
| `scripts/lint-ratchet-check-registry.test.ts` | 3.97s in one case `"accepts the Musi registry fixture"` (~`:116-125`); siblings 0–2ms | Split **only that case** into a `.slow` file (it re-validates live config overlapping CI `lint:ratchet`); keep the fast matcher tests. | high |
| `scripts/codemods/expand-barrel.test.ts` | 4.6s | Subprocess-heavy; whole-file `.slow` candidate. | medium |
| `scripts/code-intel.test.ts` | 8.4–11.5s file | **Investigate exact split first.** Keep in-process query tests fast; move the daemon-lifecycle (~`:1121-1265`) and real-`bun`-spawn cases to `.slow`. | medium |

## Shell smokes (need new slow-smoke plumbing first)

| File | Measured | Move | Confidence |
|---|---|---|---|
| `scripts/test-lint-ratchet.sh` | 64.8s — the smoke-suite floor (~61 real ESLint runs) | Genuinely slow + valuable (only end-to-end coverage of this path). Defer via the `MUSI_RUN_SLOW_TESTS`-gated slow-smoke list described above. Biggest single lever on the 112s smoke wall. | medium |

`scripts/test-ai-hooks.sh` (~84s) is the other smoke giant. Its cost is largely
`grep -qE`-per-check in `ai-hooks/policy.sh` rather than a movable block — see
the separate matcher-optimization decision on `fix/reduce-verify-times` (making
`ai_policy_has_command` use bash `[[ =~ ]]` would speed every policy assertion
and the live hook while preserving the full enumeration). Prefer that over
moving/trimming the policy smoke.

## Do NOT move (checked, keep fast)

- `packages/client/src/components/campaign/notes/note-editor.test.tsx` (3.8s) —
  slowest client *file* but 13 distinct high-signal render tests; moving render
  tests to slow would hide UI regressions from pre-commit.
- `packages/server/src/trpc/rate-limit.test.ts` — the fast logic counterpart
  that makes the `auth-rate-limit` move safe.

## After any move

1. `bun run test:slow` — confirm the moved tests still pass in the slow tier.
2. `bun run test` (or `test:changed`) — confirm they no longer run by default.
3. The coverage check in the caveat above.
