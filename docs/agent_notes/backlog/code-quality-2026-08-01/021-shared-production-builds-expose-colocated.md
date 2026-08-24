# 21. A normal shared build emits all 73 colocated test suites into dist, and the wildcard exports turn nearly all of them into valid package subpaths

Status: Not started
Theme: build/export surface hygiene · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared`'s only TypeScript project is the emitting one: it includes all
of `src` with no exclusion, so every colocated `*.test.ts` file is a build input
and lands in `dist` as compiled `.js` plus `.d.ts` beside the production
modules. The package's exports map then makes the accident addressable: the
wildcard subpaths for `schemas/`, `rules/`, `dice/` and `map/` match any emitted
basename, so `@musi/shared/rules/attack-damage.test.js` resolves exactly as well
as `@musi/shared/rules/attack-damage.js`. At the pin, 73 test suites sit beside
72 production modules — the accidental surface nearly doubles the apparent
contract of the monorepo's most-imported package.

That costs contributors in two ways. Editor autocomplete and any tooling that
enumerates package subpaths present a polluted picture of what shared offers,
taxing the single most common cross-package path (server and client both consume
shared through these exports). Worse, the package has exactly one *deliberate*
test-facing export — `./test/*.js` serving `src/test/parse-helpers.ts`, which
server tests really do import — and nothing distinguishes that intentional API
from the 70 accidentally exposed suites next to it. A reader auditing the export
surface cannot tell design from leak. For a repo meant to be copied as a harness
reference, the standard two-project shape (emitting build project excluding
tests, inclusive no-emit check project) is itself part of what should be worth
copying.

## Evidence

- `packages/shared/tsconfig.json:8` — `"include": ["src"]`, no `exclude`; it
  extends `tsconfig.base.json` (`declaration`/`declarationMap` at :12-13,
  `composite` at :15), so every test file emits `.js` + `.d.ts` into `dist`.
- `packages/shared/package.json:35-36` — `build` is `tsc -b`, `dev` is
  `tsc -b --watch`; this emitting project is the only build path.
- `packages/shared/package.json:9-24` — wildcard exports for `./schemas/*.js`,
  `./rules/*.js`, `./dice/*.js`, `./map/*.js`; the patterns match emitted
  `*.test.js`/`*.test.d.ts` basenames just as readily as production ones.
- Measured at the pin: 73 `*.test.ts` files under `packages/shared/src` versus
  73 non-test `.ts` files (72 production modules plus the deliberate
  `src/test/parse-helpers.ts`). 69 of the 73 tests live under
  `schemas/`/`rules/`/`dice/`/`map/` and acquire valid domain-wildcard subpaths
  after emit; `src/test/parse-helpers.test.ts` is a 70th, addressable through
  the `./test/*.js` export (`packages/shared/package.json:25-28`).
- `packages/server/src/routers/dice.test.ts:3` — real consumer of the one
  intentional test export: `import { expectParseResultSuccess } from
  "@musi/shared/test/parse-helpers.js"`.
- `scripts/lib/test-dist-preflight.sh:59` — the staleness marker is pinned to
  `packages/shared/tsconfig.tsbuildinfo` (name derived from the config
  filename); the comment at :80-93 explicitly documents that `*.test.ts` files
  "are emitted to dist and DO bump tsconfig.tsbuildinfo on rebuild", and the
  stale-scan `find` at :94 accordingly treats tests as build inputs.
- Emit consumers reference the same single project: root `tsconfig.json:4`,
  `packages/server/tsconfig.json:8`, `packages/client/tsconfig.json:19`.
- Tooling that resolves shared via the nearest `tsconfig.json`, and therefore
  constrains where a test exclusion may live: type-aware ESLint
  (`projectService: true`, `eslint-config/code-quality-configs.js:101`) and
  code-intel's shared project (`scripts/code-intel/project-cache.ts:93`).

## Proposed direction

Split `packages/shared` into the standard two-project shape.

1. **Add `packages/shared/tsconfig.build.json`** — composite, emitting,
   `outDir: "dist"`, `include: ["src"]`,
   `exclude: ["src/**/*.test.ts"]` (the glob also covers the
   `*.slow.test.ts` sentinel, e.g. `src/test-tier-sentinel.slow.test.ts`).
   Repoint the package scripts (`packages/shared/package.json:35-36`) to
   `tsc -b tsconfig.build.json`. All callers — root `build`,
   `scripts/dev.sh:177`, `scripts/worktree-db.sh:939`, doctor hints — go
   through `bun run --filter @musi/shared build`, so no other invocation
   changes.
2. **Repurpose the existing `packages/shared/tsconfig.json` as the inclusive
   check project**: `composite: false`, `noEmit: true`,
   `declaration`/`declarationMap` off — mirror
   `packages/client/tsconfig.json`'s flag set. It keeps every `src` file, tests
   included. This shape is deliberately projectService- and code-intel-safe:
   type-aware ESLint and `scripts/code-intel/project-cache.ts:93` both resolve
   via the nearest `tsconfig.json`, which stays test-inclusive.
3. **Repoint emit consumers at the build config**:
   `packages/server/tsconfig.json:8` and `packages/client/tsconfig.json:19`
   references become `{ "path": "../shared/tsconfig.build.json" }`. The root
   `tsconfig.json:4` reference to `packages/shared` stays as-is — it now
   resolves to the inclusive no-emit project, so the existing `tsc -b`
   typecheck lane type-checks all 73 test files exactly as the client project
   is checked today, while shared's build project is still built transitively
   through the server/client references. No new `scripts/typecheck.sh` lane is
   needed.
4. **Leave `src/test/parse-helpers.ts` and the `./test/*.js` export untouched**
   (it is not a `*.test.ts` file). Dist then retains the one deliberate
   test-helper API and drops the accidental wildcard-addressable test subpaths,
   leaving the 72 production modules plus the helper.
5. **Update `scripts/lib/test-dist-preflight.sh` in the same change**:
   `MUSI_TEST_DIST_TSBUILDINFO` (:59) moves to
   `packages/shared/tsconfig.build.tsbuildinfo` (the tsbuildinfo name derives
   from the config filename), and the `musi_test_dist_first_stale_src` find
   (:94) must now exclude `*.test.ts`, since tests are no longer build inputs —
   otherwise an edited test file reads as stale forever, the exact false-stale
   trap the function's comment warns about. Rewrite that comment block
   (:80-93), which currently documents the no-exclude behavior, and update the
   fixture tsbuildinfo paths in `scripts/tests/test-test-dist-preflight.sh`
   (:88, :192, :203). `MUSI_TEST_DIST_REQUIRED_OUTPUTS` (:22-29) already lists
   only production sentinels including `dist/test/parse-helpers.js` — leave it
   unchanged.
6. **Sweep the small registration surfaces**: add `tsconfig.build.json` to the
   `scripts/worktree-db.sh` fingerprint loops at :493 and :509 so
   dist-affecting config edits still invalidate provisioned artifacts, and
   confirm `.gitignore` covers the new tsbuildinfo (the `*.tsbuildinfo`
   pattern at `.gitignore:8` already does).

Verification, from a clean slate — `tsc -b` never deletes previously emitted
`dist/**/*.test.js` or the old `tsconfig.tsbuildinfo`, so incremental worktrees
keep the polluted surface until a clean rebuild; the end state must be proven
from an `rm -rf packages/shared/dist`:

- Fresh `bun run --filter @musi/shared build`, then assert
  `find packages/shared/dist -name '*.test.js' -o -name '*.test.d.ts'` is empty
  while `dist/test/parse-helpers.js` exists.
- Run a server test that imports `@musi/shared/test/parse-helpers.js`
  (e.g. `packages/server/src/routers/dice.test.ts`).
- `bun run typecheck` (all four lanes) and confirm the `tsc -b` lane still
  flags a deliberately broken shared `*.test.ts`.
- `bash scripts/tests/test-test-dist-preflight.sh`.

## Scope / caveats

- **Out of scope**: server/client emit hygiene (server's dist also emits tests
  but exposes no package exports surface), any redesign of the wildcard exports
  map, and relocating tests out of `src`.
- **Do not invert the shape.** Putting the exclude into the existing
  `tsconfig.json` instead of a new build config would silently drop 73 files
  from the ESLint projectService default project and hard-fail type-aware lint,
  and would blind code-intel's shared project. The new file must be the build
  config; the inherited name stays inclusive.
- **The preflight rewiring is the likeliest regression**: a missed tsbuildinfo
  path or an unfiltered stale-scan reintroduces the build-remediation loop the
  preflight comment documents, and its shell tests pin the old fixture paths
  (`scripts/tests/test-test-dist-preflight.sh:88,192,203`).
- **Prove the end state from a deleted dist** (see verification): stale
  `dist/**/*.test.js` artifacts and the orphaned old
  `packages/shared/tsconfig.tsbuildinfo` persist through incremental builds.
- TypeScript here is ~6.0.3 and the client project proves non-composite
  `noEmit` projects are accepted in this solution graph — if `tsc` complains
  about the shared check project, copy client's exact `compilerOptions` rather
  than making it composite.
- `tsconfig.e2e.json:26-30` paths-maps `@musi/shared` subpaths straight to
  `src` and needs no change.
- Prior pack: the 2026-07-25 shared-cluster work (CQ25-115) reorganized shared
  modules and exports and is closed — do not reopen it. It never covered
  production test emission; cite it as context only
  (`docs/agent_notes/backlog/code-quality-2026-07-25/21-shared-constants-single-source.md`).
- **Sequencing:** No hard ordering dependency with
  [025-spellcastingts-contains-five-independently.md](./025-spellcastingts-contains-five-independently.md),
  but do not work the two concurrently in `packages/shared`; whichever lands
  second must rebase the production/test counts and clean-build assertions on
  the module split left by the first. No other leaf in this pack edits shared's
  tsconfigs or the test-dist preflight.
