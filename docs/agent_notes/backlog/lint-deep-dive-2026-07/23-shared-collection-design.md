# 23. One gate spawns four independent ESLint collections — design a shared-collection seam (design-gated)

Status: Design noted — 2026-07-04 recommendation is option (c), keep per-slot caching/memoization and do not implement shared collection yet.
Lens: pipeline · Area: lint architecture · Severity: med · Size: L · Confidence: med
Theme: performance · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
A full gate runs: (1) `eslint .` in the lint slot, (2) a per-ratchet ESLint
collection in the ratchet slot, (3) another collection for `zero-baseline`,
(4) another for `debt-accounting` (full/parallel modes), plus (5) the
coverage-map audit's config-resolution pass. Each has its own process
startup, config load, and (for typed profiles) project-service init over
overlapping file sets. The ratchet's isolated-config design is deliberate
(hermetic per-rule collection — see `docs/guides/lint-ratchet.md` "The ratchet
runner writes isolated ESLint configs"), so naive merging is wrong; but the
duplication is now the dominant structural cost of the gate.

## Evidence
- Explore trace 2026-07-04 (verify-gate lint-step trace): slot commands and their independent ESLint spawns; `scripts/verify/steps.generated.sh:20-35`.
- `scripts/lint-ratchet/current-collector.ts:214-228`, `current-collection-scheduler.ts:75-93` — per-ratchet spawn model.

## Measurement

Measurement caveat: this worktree recently OOMed, so these timings were
captured by running the generated lint-family slot commands directly and
strictly one at a time instead of through the parallel changed/pre-commit
wrapper. Ratchet collection was forced to `AI_RATCHET_COLLECT_CONCURRENCY=1`
so no two ESLint child processes overlapped. CPU seconds are `user + sys`
from Bash `time -p`; direct commands sourced `scripts/lib/gate-env.sh` to
match the current gate heap policy.

Before leaves 21/22, measured 2026-07-04 on the current
`fix/lint-gate-suppression-lane` branch:

| Context | Slot command | ESLint role | Wall (s) | CPU (s) |
| --- | --- | --- | ---: | ---: |
| Changed-mode representative (`main...HEAD`; lint config changes force full scan) | `bun run lint:changed` | normal full ESLint scan inside the lint slot | 77.09 | 154.15 |
| Changed-mode representative | `AI_RATCHET_COLLECT_CONCURRENCY=1 bun run lint:ratchet` | isolated ratchet ESLint collection | 15.40 | 29.55 |
| Changed-mode representative | `bun run lint:ratchet:zero-baseline` | normal-config resolution through ESLint API | 2.22 | 3.07 |
| Changed-mode representative | `bun run lint:ratchet:check-debt-accounting` | no ESLint in the current branch implementation; git/JSON accounting only | 1.05 | 1.48 |
| Changed-mode representative | `bun run docs:lint-coverage-map:check -- --staged` | no ESLint reach check in staged mode | 0.18 | 0.21 |
| Full sequential verify equivalent | `bun run lint` | normal full ESLint scan inside the lint slot | 77.50 | 160.62 |
| Full sequential verify equivalent | `AI_RATCHET_COLLECT_CONCURRENCY=1 bun run lint:ratchet` | isolated ratchet ESLint collection | 15.38 | 29.98 |
| Full sequential verify equivalent | `bun run lint:ratchet:zero-baseline` | normal-config resolution through ESLint API | 2.20 | 3.04 |
| Full sequential verify equivalent | `bun run lint:ratchet:check-debt-accounting` | no ESLint in the current branch implementation; git/JSON accounting only | 1.04 | 1.48 |
| Full sequential verify equivalent | `bun run docs:lint-coverage-map:audit` | ESLint reach/config-resolution audit | 2.58 | 3.48 |

After leaves 21/22, measured 2026-07-04 with the same serial caveat:

| Context | Slot command | Before wall/CPU (s) | After wall/CPU (s) | Notes |
| --- | --- | ---: | ---: | --- |
| Changed-mode representative (`main...HEAD`; lint config changes force full scan) | `bun run lint:changed` | 77.09 / 154.15 | 15.77 / 30.38 | Warm salted main ESLint cache. |
| Full sequential verify equivalent | `bun run lint` | 77.50 / 160.62 | 16.30 / 30.63 | Warm salted main ESLint cache; cold cached full lint was 84.77 / 175.57 because the first run writes the cache. |
| Full sequential verify equivalent | `AI_RATCHET_COLLECT_CONCURRENCY=1 bun run lint:ratchet` | 15.38 / 29.98 | 66.18 / 87.77 | Leaf 21/22 did not touch ratchet collection; this late sample looks host/load sensitive, but it is the current after-pass number. |
| Full sequential verify equivalent | `bun run lint:ratchet:zero-baseline` | 2.20 / 3.04 | 2.39 / 3.37 | Immediate post-memo measurement; later samples varied at 6.54-8.59s wall, still small relative to lint/ratchet. |

Second-layer cache-salt hardening, measured 2026-07-04 without starting
ESLint: the review-observed per-file `sha256sum` loop cost was about 4.8s wall
per lint invocation. After switching the salt to a NUL-delimited single-process
hash, `musi_eslint_main_cache_identity_fingerprint "$PWD"` measured 0.10s wall
in three samples (`user+sys` 0.12s, 0.12s, 0.12s), and the full
`musi_eslint_main_cache_args "$PWD"` helper including stale identity-cache
cleanup measured 0.12s, 0.10s, 0.10s wall (`user+sys` 0.13s, 0.11s, 0.12s).

Cold-path caveat: the identity salt intentionally includes source/type-graph
inputs, so every source edit selects an empty main ESLint cache. The normal
commit-gate path after a source edit therefore pays the cold cached full-lint
cost measured above (84.77s wall / 175.57 CPU before the salt-loop hardening)
plus the current ~0.10s salt/cache-args overhead. The 77s -> 16s lint-slot win
applies to byte-identical trees only: gate re-runs, verify-then-commit bridge
runs, and other repeated checks of the same worktree identity.

## Design note

Recommendation: choose **(c) status quo + per-slot caching/memoization** for
now, and do not build a shared-collection architecture in this pack.

The measured win from leaf 21 is large for byte-identical warm re-runs: the
main lint slot dropped from ~77s to ~16s wall in both full-scan changed mode and
full verify equivalent when the cache identity did not change. Leaf 22 is
essentially O(1) insurance at today's scale:
zero-baseline stayed small and noisy, and current-branch debt-accounting is
git/JSON-only rather than an ESLint collection. That means option (a) no longer
kills "2 of 4" meaningful ESLint spawns on this branch; it mostly targets a
small zero-baseline/config-resolution cost while leaving the two expensive
surfaces, normal lint and ratchet collection, intact.

Option (b), normal-lint piggyback, is the only architecture that could remove
the ratchet collection cost, but it is also the option with the highest identity
risk: ratchet collection deliberately uses isolated configs, ratchet-specific
rule options, config hashes, rule-source hashes, no-inline-config semantics, and
per-ratchet cache identity. The current numbers do not justify that complexity
or the byte-for-byte baseline/envelope risk. Revisit only if repeated serial
ratchet measurements show the 66s after-pass is stable, or if the zero-baseline
registry grows enough that config resolution becomes a double-digit cost on its
own; prefer narrower ratchet scheduler/cache work before normal-lint piggyback.

## Proposed direction
Write a short design note (in this leaf) choosing among:
- **(a) Collection reuse within the ratchet family:** one collection feeding
  default-gate compare, zero-baseline, and debt-accounting in a single
  `lint:ratchet --all-checks` invocation — no cross-contamination with normal
  lint, keeps isolated configs, kills 2 of the 4 spawns. Likely the winner:
  mechanical, semantics-preserving.
- **(b) Normal-lint piggyback:** derive ratchet counts for rules that are
  *identical* in normal lint from the normal run's JSON output, keeping
  isolated collection only where options/scope differ. Bigger win, bigger
  identity risk (configHash semantics).
- **(c) Status quo + per-slot caching (leaves 21/22) and declare the spawn
  count acceptable.** Measure first: if (21)+(22) get the gate under target,
  take (c) and close.

## Scope / caveats
- Decide with numbers: instrument one full verify and one pre-commit with
  per-slot ESLint wall/CPU before choosing.
- Whatever lands must preserve envelope and baseline identity semantics
  (configHash, ruleSourceHash) byte-for-byte.
