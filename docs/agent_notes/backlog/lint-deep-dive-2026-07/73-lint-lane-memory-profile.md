# 73. Memory profile of the full-scan lint lane + gate slot stacking (measurement spike)

Status: Findings recorded 2026-07-12 on `auto/38-lint-memory-profile` (measurement spike for harness-sweep leaf 38; no gate wiring in this commit).
Lens: pipeline · Area: lint/test performance + OOM · Severity: high (recorded container OOM) · Size: M (measurement)
Theme: performance / memory · Source: harness-sweep-2026-07 leaf 38, widened by the repo owner with a memory-reduction mandate ("OOM is something we've run into even with single lanes … the lint memory spike appears very significant").

Machine: 16 GB RAM + 8 GB swap, 16 CPUs. Full-scan lint escalation runs under a
shared 6144 MB Node heap (`scripts/lib/gate-env.sh`, leaf 20). This note
profiles peak memory, decomposes what dominates it, and evaluates ESLint native
`--concurrency` on memory grounds.

## Method

Peak RSS was sampled by sID-summed `ps` at ~0.2 s intervals around a `setsid`
process group (`/tmp/musi-tree-rss.sh`), reporting summed RSS across the whole
tree and the peak instant. Heavy runs after the fatal `--concurrency=auto` run
were bounded by a 9 GB kill-cutoff (`MUSI_MEASURE_RSS_CUTOFF_KB=9000000`),
verified to TERM the whole process group before the host is endangered. Error
bars: polled RSS undersamples sub-200 ms spikes, so peaks are lower bounds
(±~5%); `ps` RSS double-counts shared pages across processes, so multi-process
sums (test/scripts/typecheck) slightly overstate true unique memory. Cold =
fresh eslint cache in this worktree; warm = second run against a populated
`node_modules/.cache/eslint-main` cache.

## Numbers

| Measurement | Wall | Peak RSS | Procs/threads | Cache | Notes |
|---|---:|---:|---:|---|---|
| ESLint main lane, **serial** (pre-partition baseline) | 78.7 s | **4.27 GB** | 1 proc / 1 thread | cold | the originally profiled lane: `eslint --max-warnings=0 <cache-args> .` |
| ESLint main lane, serial | 3.1 s | 0.46 GB | 1 | warm | full cache hit; no type program built |
| Final-tree monolithic parity reference (leaf 76) | 79.147 s | 4,293,960 KiB (4.095 GiB) | 1 | cold | same tree/config as the adopted runner; 8.5M-KiB cutoff |
| **Adopted four-way sequential main lane** (leaf 76) | **78.254 s** | **3,545,060 KiB (3.381 GiB)** | 2 (runner + one ESLint) | cold | shared `src`, server `src`, client `src`, remainder; never concurrent |
| Adopted four-way sequential main lane | 6.194 s | 461,580 KiB (0.440 GiB) | 2 | warm | four content-cache hits; cache sizes unchanged from the spike |
| ESLint `--concurrency=2` | 53.8 s | 8.14 GB | 1 proc / 2 threads | cold | worker_threads share one process |
| ESLint `--concurrency=2` | 5.4 s | 1.22 GB | 1 | warm | |
| ESLint `--concurrency=auto` | — | **~9.95 GB then host death** | 1 proc / N threads | cold | **FATAL: OOM-killed the 16 GB container.** Summed RSS plateaued ~9.95 GB t=116–200 s; process at death 18.5 GB VSZ / 9.9 GB RSS. Run without the cutoff; do not repeat. |
| ESLint AST/parse floor (tseslint parser, **zero rules → no type program**) | 8.4 s | **0.86 GB** | 1 | cold(no cache) | parses all 2477 source files, holds no persistent type program |
| `typecheck` (tsc, project references) | 14.2 s | 1.83 GB | 8 procs | cold | same type work, partitioned per package |
| **test** slot (`bun test`, pre-commit form) | 213.6 s | **5.58 GB** | 21 procs | — | `MUSI_VERIFY_TEST_CMD` |
| **scripts** slot (`bun run test:scripts`) | 191.4 s | 2.47 GB | 48 procs | — | `MUSI_VERIFY_SCRIPTS_CMD` |
| **ratchet** slot (`bun run lint:ratchet`) | 19.0 s | 2.21 GB | 5 procs | cold | type-aware ESLint children; co-deferred with lint behind typecheck |

(The pre-partition serial and ESLint concurrency rows are the codex-collected
points from the prior lane and were re-confirmed consistent here. The
final-tree monolithic and adopted rows come from leaf 76. The AST-floor,
typecheck, test, scripts, and ratchet rows were collected on this branch.)

Leaf 76 subsequently adopted the four-way sequential design in `d714f4ce`.
Its final-tree comparison reduced cold peak by 748,900 KiB (17.4%) with cold
wall improving by 0.893 s. Against the measured prototype, the implementation
was +3.38% peak and +2.23% wall cold, and +3.24% peak / +0.15% wall warm—all
inside this sampler's ±5% error band. Complete JSON parity remained exact over
2,169 files (shared SHA-256 recorded in leaf 76).

## What dominates the 4.27 GB serial peak: the TypeScript type program

Decomposition of the cold serial peak:

- **0.46 GB** — process + ESLint/plugin modules baseline (the warm run does
  essentially no work: every file is a cache hit, so no type program is built).
- **0.86 GB** — AST/parse/rule-engine floor: parsing all 2477 source files with
  the typescript-eslint parser and **zero rules** (so nothing calls
  `getParserServices()` and no TS `Program` is created). This memory is per-file
  transient — each file's AST is freed after it is linted.
- **~3.4 GB (≈80% of peak)** — the persistent typescript-eslint **ProjectService
  type program**: `4.27 − 0.86`. Type-aware linting builds a whole-program TS
  type checker that stays resident for the entire run so cross-file type queries
  work. The `TIMING=1` breakdown corroborates this — the top rules by time are
  all type-aware (`no-unsafe-assignment` 13.5%, `no-deprecated` 13.4%,
  `no-misused-promises` 11.8%, `no-floating-promises` 11.7%), and type-aware
  rule time reads as an aggregate (misattributed to the last type-aware rule).

Cross-check: `tsc` does the *same* type work in **1.83 GB** because project
references split it into 8 independently-collectable per-package programs, while
ESLint's `projectService` builds one monolithic default program in a single
process. So the type program is both the dominant driver **and** larger than it
needs to be because it is unpartitioned.

## Why `--concurrency` makes OOM worse, not better

`--concurrency` uses **worker_threads (V8 isolates) inside one process**, not
child processes (confirmed: `peak_processes` stayed 1 across every concurrency
run; `eslint --help`: "Number of linting threads"). Each worker isolate builds
its **own** ProjectService type program (~3.4 GB) in the same address space, so
aggregate memory ≈ `core + N × type-program`:

- serial (1 thread): `0.86 + 3.4 ≈ 4.27 GB` ✓
- `--concurrency=2`: `0.86 + 2×3.4 ≈ 7.7–8.1 GB` → measured **8.14 GB** ✓
- `--concurrency=auto`: N threads → N type programs → blew past 9.95 GB and
  **OOM-killed the host**.

Critically, `--max-old-space-size=6144` is applied **per isolate**, so the
shared heap policy does **not** bound the aggregate — N isolates can each
approach their own heap ceiling, leaving total memory effectively uncapped by
the flag. That is why the heap policy did not prevent the auto crash.

Tradeoff for `--concurrency=2`: **+91% memory (4.27 → 8.14 GB) for −32% wall
(78.7 → 53.8 s)**. On a 16 GB box that leaves ~8 GB, so any co-running slot
(test at 5.58 GB) tips it into OOM. Concurrency strictly *increases*
single-lane OOM likelihood.

## The original OOM cause: uncapped gate slot stacking

At the time of this profile, `scripts/verify.sh` parallel/changed mode (and
`.husky/pre-commit`) launched every slot as a background job with **no
concurrency cap**. Only `lint` and `ratchet` were deferred until `typecheck`
completed (they consume dist outputs — `musi_defer_dist_slot`). The peak window
was lint (4.27 GB) + ratchet (type-aware) landing on top of the still-running
test (5.58 GB) + scripts (2.47 GB):

- Additive worst case for two slots alone: **lint 4.27 + test 5.58 ≈ 9.85 GB**,
  before the ratchet (2.21 GB, itself type-aware and deferred alongside lint),
  scripts (2.47 GB), and typecheck tails — this is how a single lane OOMs
  occasionally and a 6-lane gate crashed the container. Because lint and ratchet
  are the two type-aware slots and both defer behind typecheck, they arrive
  together, and their combined ~6.5 GB lands squarely on the test slot's peak.
- **Fast-commit pre-commit skips `test`+`scripts`** (`MUSI_FAST_COMMIT_SKIP_SLOTS`),
  so the fast pre-commit path avoids the worst stack. Full `verify` /
  `verify:changed` / `verify:parallel` and multi-lane gate runs do not.

So the OOM risk is **not lint alone** — a cold lint peaks at 4.27 GB, comfortably
inside 16 GB. It is lint (and the equally type-aware ratchet) **stacking on the
test slot** without memory-aware scheduling. Commit `97e984ae` subsequently
added budget admission; leaf 76 now lowers lint's reservation from 4,270 MB to
3,700 MB so the scheduler can co-admit it in a wider headroom band. Both full
and changed lint now use the same four sequential partitions; changed lint
skips empty scopes, so it cannot rebuild the old multi-package monolith.

## Per-knob verdict

| Knob | Verdict |
|---|---|
| `--concurrency=auto` | **REJECT** — measured fatal (container OOM-kill). Never wire into any gate. |
| `--concurrency=2` (or any N>1) | **REJECT / PARK** — +91% memory for −32% wall; multiplies the dominant type program per in-process isolate; `--max-old-space-size` cannot cap the aggregate; increases single-lane OOM risk on 16 GB. |
| Keep every main ESLint process **serial** | **KEEP** — the adopted lane uses four processes strictly sequentially. |
| `--cache` main lane (leaf 21) | **KEEP** — the adopted four-way warm run is 461,580 KiB / 6.194 s versus 3,545,060 KiB / 78.254 s cold. A cache hit skips building the type program entirely; the single biggest lever. |
| Shared 6144 MB heap (leaf 20) | **KEEP, with a documented limitation** — it bounds one isolate, not the aggregate across concurrency isolates or across stacked slots; it does not prevent concurrency- or stacking-OOM. |
| Partition the type program | **ADOPTED (leaf 76)** — four strictly sequential package-source/remainder processes; final cold peak 3,545,060 KiB, exact file/diagnostic parity. Explicit `parserOptions.project` was rejected because it changed 1,109 cross-package diagnostics. |
| Memory-aware slot cap in `verify.sh` | **ADOPTED (`97e984ae`)** — budget admission prevents the additive host-kill by delaying heavy slots when their reservations do not fit. |

Worker-cloneability of the local plugin (leaf Do step 2): **clean** — every
module-level `Set`/`Map` in `eslint-rules/*.js` is an immutable lookup constant
populated once at import; zero rule modules hold top-level `let`/`var`
accumulators, so there is no shared mutable state that would corrupt under
worker threads. The concurrency blocker is memory, not plugin state.

## Ranked memory-reduction options

1. **Cap gate slot stacking under a memory budget — ADOPTED in `97e984ae`.**
   Budget admission prevents the additive lint + test peak (and multi-lane)
   crash by delaying a heavy slot when the live reservations, available memory,
   and safety margin do not leave room for its expected peak.
2. **Never adopt ESLint `--concurrency`; keep the lane serial** and record it as
   a hard NO so nobody wires it chasing wall-clock. Avoids +3.4 GB per extra
   isolate and the measured host kill (3.9 GB avoided vs `--concurrency=2`).
   Effectively the current state; the value is documenting *why*. → follow-up
   leaf (doc/guard only).
3. **Partition the main lint type program per package — ADOPTED in leaf 76.**
   The selected four-way sequential design measured 3,545,060 KiB / 78.254 s
   cold and 461,580 KiB / 6.194 s warm with exact parity. The deeper eight-way
   split and explicit project graph lost on wall time and correctness,
   respectively.
4. **(Supporting)** Lean on `--cache` — keep cold full-scans rare (warm peak
   0.46 GB), and derive any per-lane heap / slot budget from `/proc/meminfo` so
   N parallel worktree lanes don't each assume the full 16 GB.

At the time of this spike, no knob was a zero-risk change to fold into the
measurement commit: (2) was a documentation/guard, and (1) and (3) each needed
their own design and measurement work. Both have since been implemented in the
commits recorded above.

## Reproduction

The AST/parse-floor number used a standalone zero-rules flat config (run from
the repo root so `typescript-eslint` resolves from `node_modules`), then
`bunx eslint --no-config-lookup --config <file> --no-cache .`:

```js
// MEMORY PROFILING ONLY — parses every source .ts/.tsx with the
// typescript-eslint parser but runs ZERO rules, so no rule calls
// getParserServices() and no TS type program is built. Peak RSS isolates
// parse + AST + eslint-core cost (the floor beneath the cold lint's 4.27 GB).
import tseslint from "typescript-eslint";
export default [
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", "worktrees/**", "coverage/**",
      ".stryker-tmp/**", "reports/**", "test-results/**",
      "playwright-report/**", "**/*.tsbuildinfo",
    ],
  },
  { files: ["**/*.{ts,tsx,mts,cts}"], languageOptions: { parser: tseslint.parser }, rules: {} },
];
```

Sources: harness-sweep-2026-07 leaf 38; eslint-ecosystem.
