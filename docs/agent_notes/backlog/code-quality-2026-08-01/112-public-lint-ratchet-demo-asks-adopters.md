# 112. The lint-ratchet adoption demo makes outside repos vendor a 1,245-line operational rail around a 17-line app

Status: Landed on fix/cq-112
Theme: portable-package adoption seam · Area: harness · Severity: high · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`@musi/lint-ratchet` is the repo's flagship copyable artifact: a portable,
repo-agnostic ratchet engine whose whole pitch is "copy this directory into
your repo and bind it with a thin adapter". The demo that proves that pitch
undercuts it. The package stops below the operational adoption seam — the git
rail of merge drivers, installers, post-merge truth-up hooks, preflight
wrappers, and stage-restore recovery is not part of the package. So the demo's
"Make it yours" instructions tell an adopter to copy `scripts/git/*` wholesale,
and the demo itself carries 15 script files totaling 1,245 lines to operate a
17-line application. The "thin adapter" an adopter actually needs is two files;
everything else is a vendored subsystem.

That vendored subsystem is also a maintenance tax inside this repo. Eleven of
the demo's `scripts/git/` files mirror files at the repository root: five are
byte-identical copies, six are hand-maintained forks whose drift is mostly
cosmetic renames (`musi_`-prefixed shell functions) and narrowed baseline
lists. Three more TypeScript files fork root counterparts. Every edit to the
root operational rail now has up to fourteen shadow files to keep honest, with
nothing checking them — and every outside adopter inherits the same fork the
moment they follow the README. For a repo whose stated purpose is to be a
harness-engineering reference judged on copyability, this is the largest
single gap between the portability claim and what adoption actually costs.

## Evidence

- `examples/lint-ratchet-demo/README.md:88-103` — "Make it yours": step 1
  copies the whole `tools/lint-ratchet` package, step 2 writes the adapter, and
  step 4 says "For the semantic baseline merge driver, copy `scripts/git/*`"
  plus a per-clone installer run. The operational rail is explicitly
  copy-owned, not package-provided.
- `examples/lint-ratchet-demo/scripts/` — measured at the pin: 15 files,
  1,245 lines total (11 shell/TS files under `scripts/git/`, 3 under
  `scripts/lint-ratchet/`, plus the 276-line `scripts/lint-ratchet.ts` CLI).
  The demo application is `examples/lint-ratchet-demo/src/app.ts` — 17 lines.
- Mirror relationship, re-derived by byte comparison against root: of the 11
  files under `examples/lint-ratchet-demo/scripts/git/`, 5 are byte-identical
  to their root `scripts/git/` counterparts (both `install-*` shims, both
  `check-*` scripts, `baseline-info-attributes.ts`) and 6 are forks
  (`baseline-merge-driver-lib.sh`, `baseline-merge-driver.sh`,
  `baseline-post-merge-truth-up.sh`, `lint-ratchet-merge-driver-lib.sh`,
  `lint-ratchet-post-merge-baseline-truth-up.sh`,
  `restore-generated-baseline-stage.sh`). Three more files fork root
  counterparts (`scripts/lint-ratchet.ts`,
  `scripts/lint-ratchet/baseline-merge-cli.ts`,
  `scripts/lint-ratchet/post-merge-baseline-preflight.ts`); only
  `scripts/lint-ratchet/adapter.ts` (78 lines) is demo-unique.
- Fork drift is renames and narrowing, i.e. pure divergence risk:
  `examples/lint-ratchet-demo/scripts/git/lint-ratchet-merge-driver-lib.sh:12`
  calls `baseline_driver_command` where the root file calls
  `musi_baseline_driver_command`; the demo's
  `restore-generated-baseline-stage.sh:31` accepts only
  `lint-ratchet.baseline.json` where root `scripts/git/restore-generated-baseline-stage.sh:33`
  enumerates three generated baseline paths.
- `examples/lint-ratchet-demo/scripts/git/install-baseline-merge-driver.sh:1-18`
  — the 155-line shared installer body (git config writes, attributes
  rendering, flock serialization) is consumer-owned vendored shell, not a
  supported package executable.
- `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:9-13` — the "nominally
  minimal" demo adapter owns five operational modes (gate, `--check-registry`,
  `--check-baseline`, `--update`, `--propose`), plus argument parsing, error
  taxonomy handling, and recovery-command rendering, in 276 lines.
- `tools/lint-ratchet/package.json` — no `bin` field; a fail-closed enumerated
  `exports` map of 43 subpaths. There is currently no supported executable
  surface an adopter could invoke instead of vendoring.
- `examples/lint-ratchet-demo/smoke.sh:56-63` — smoke step 2b typechecks the
  demo against that enumerated exports map; `smoke.sh:182,194,203` invoke the
  vendored `scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh` directly
  via `bash`, so the isolated adoption proof currently depends on the vendored
  copies existing.
- Root `scripts/git/` hosts the same rail for five driver families —
  `scripts/git/baseline-drivers.sh:1-19` is the driver-name registry sourced by
  the `install-all-merge-drivers.sh:1-10` dispatcher and the truth-up
  dispatcher — so the vendored demo rail is a second implementation of
  machinery the root already centralizes.

## Proposed direction

Move the operational rail into `@musi/lint-ratchet` as a supported, versioned
surface, and make both the demo and the root repo consume it, so exactly one
implementation exists.

1. **Package executables for the git rail.** Add executable entrypoints to
   `tools/lint-ratchet` — package `bin` entries or enumerated `exports`
   subpaths run via `bun run` — for the operations the demo currently vendors:
   the merge-driver body, install/check, post-merge truth-up, preflight, and
   stage-restore. Parameterize them by the adopter's adapter module path and
   the baseline/debt-log filenames. Note the package's `exports` map is
   fail-closed and enumerated (43 subpaths today, no `bin` field): every new
   executable subpath must be added explicitly or both runtime resolution and
   the smoke's step-2b typecheck (`smoke.sh:56-63`) break — plan the
   `exports`/`bin` additions as an explicit list up front.
2. **A bootstrap generator where git needs a fixed command line.**
   `.git/config` merge-driver entries invoke a fixed command; where a packaged
   entrypoint cannot be referenced directly, ship a tiny versioned bootstrap
   generator that materializes a one-line shim with a regeneration marker —
   the repo's existing generated-surface idiom — rather than another
   maintained script.
3. **Slim the demo to the seam the README already promises.** Keep
   `scripts/lint-ratchet.ts` (with its demo-owned envelope renderer) and
   `scripts/lint-ratchet/adapter.ts`. Delete the other 13 vendored files — all
   11 under `scripts/git/` (5 byte-identical copies + 6 forks) and the 2
   remaining forks under `scripts/lint-ratchet/`
   (`baseline-merge-cli.ts`, `post-merge-baseline-preflight.ts`) — in favor of
   package invocations wired through the demo's `package.json` scripts.
4. **Migrate the root Musi rail onto the same packaged executables.** The root
   counterparts of the mirrored files move onto the package surface so one
   implementation exists. Per the standing prior-pack ruling (see caveats),
   this changes distribution and ownership only — the thin per-metric
   installer shims sourcing a shared body stay as designed. The migration must
   consume, not fork, the shared root surfaces (`scripts/git/baseline-drivers.sh`
   registry, `install-all-merge-drivers.sh` dispatcher), and the other driver
   families (knip-unused-exports, max-lines-exceptions, near-duplicates) stay
   untouched.
5. **Rewrite the adoption story and re-prove it in isolation.** Replace README
   "Make it yours" step 4 (`README.md:100-103`) with the one-command install
   story, and update `smoke.sh` so the isolated throwaway workspace exercises
   the packaged rail — proving a fresh adopter needs no vendored scripts —
   while keeping the existing merge-driver registration, truth-up, and
   check-driver assertions. Run it from the demo directory with `bash smoke.sh`.
6. **Regenerate harness surfaces if hook wiring moves.** If pre-commit or hook
   wiring changes as part of the root migration, run `bun run harness:check`
   and the smoke-subject regeneration path (`bun run test:scripts:subjects`),
   and commit the generated files.

Renderers and the result-envelope shape remain adopter-owned (the demo's
deliberately-distinct envelope in `lint-ratchet.ts` is the proof of that);
baseline format and merge semantics are unchanged.

## Scope / caveats

- **Binding constraint (prior pack).** CQ25-83
  (`docs/agent_notes/backlog/code-quality-2026-07-25/CONSTRAINTS.md:18`) is a
  standing ruling: do not re-parameterize the baseline merge-driver installer
  family — it is already parameterized (~15-line shims over a 155-line shared
  body). This leaf is compatible: it changes who distributes and owns the rail,
  not how the installer family is parameterized. Any drift toward restructuring
  the shim/body split is out of scope.
- **Out of scope:** the four non-lint-ratchet root driver families
  (knip-unused-exports, max-lines-exceptions, near-duplicates, and the generic
  baseline family's multi-baseline breadth), their shared
  `scripts/git/baseline-drivers.sh` registry, and
  `install-all-merge-drivers.sh`. Root migration consumes these surfaces; it
  does not rewrite them.
- **Path-resolution risk is the real one.** Git invokes merge drivers from
  `.git/config` with a fixed command line; packaged entrypoints must resolve in
  fresh clones, secondary worktrees, and the smoke's isolated Bun workspace. A
  resolution regression silently disables semantic baseline merges — keep the
  `check-*-merge-driver` guards as the tripwire, and treat the smoke's
  merge-driver walk as the acceptance test.
- **No half-migration.** A partial landing that leaves both a packaged rail and
  residual root or demo forks alive makes the drift tax worse than the status
  quo. Step 4 finishes or does not start.
- **Sequencing.** Soft edge to
  [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md):
  if that leaf restructures root `scripts/lint-ratchet/` CLI files this leaf
  migrates or deletes, coordinate ordering to avoid conflicting rewrites.
  There is no hard ordering dependency with
  [090-lint-ratchet-newcomer-docs-omit-prerequisite.md](./090-lint-ratchet-newcomer-docs-omit-prerequisite.md),
  but serialize the two leaves' edits to
  `examples/lint-ratchet-demo/README.md` so neither overwrites the other's
  adoption guidance. Apart from leaves 090 and 124, this work is independent of
  the other leaves in this pack.
- **Prior-pack coverage.** The live 2026-07-25 pack addressed the in-repo
  parameterization of this family (CQ25-83) but not its distribution model;
  outside adopters copying 1,245 lines is the new, uncovered problem.
