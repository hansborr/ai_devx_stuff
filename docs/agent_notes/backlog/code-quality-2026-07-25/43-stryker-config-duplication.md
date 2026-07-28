# 43. Every Stryker config re-copies the same runner/reporter/threshold block, so a plugin or threshold change means editing four files

Status: Done — landed 2026-07-26 (`6e4adaa4`, `816eb53a`) via the `.mjs` route, after step 1's feasibility stop was overturned in review; see [`00-index.md`](./00-index.md#landed)
Theme: config duplication · Area: tests · Severity: low · Size: S

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The repo runs four separate Stryker mutation lanes — shared, server, scripts,
and the lint-ratchet tool package — and each one is a standalone config object
that restates the same invariant preamble and the same reporting tail. The
constant span is roughly 19 lines: the three-line Bun-plugin-discovery comment
plus the `plugins` array (copied verbatim in all four), `testRunner`,
`checkers`, `concurrency: 1`, `incremental: true`, `reporters`, the
`htmlReporter`/`jsonReporter` blocks, and the five-line `thresholds` block.

The cost is a maintenance fan-out that is invisible until it bites: bumping the
Stryker plugin set, changing the `high`/`low`/`break` thresholds, or adding a
reporter is a four-file edit with no mechanism that notices when one lane is
missed. The `tools/stryker-lint-ratchet.ts` copy already carries a hand-written
`// Mirrors scripts/stryker-scripts.ts.` line, which is the copy admitting it is
a copy.

There is a second, cheaper win hiding in the tail: `incrementalFile`,
`htmlReporter.fileName`, and `jsonReporter.fileName` are three independent
strings per config that are all derived from one report directory
(`reports/mutation`, `reports/mutation-server`, `reports/mutation-scripts`,
`reports/mutation-lint-ratchet`). A factory taking a single `reportDir` collapses
three respellings per lane into one.

Size the win realistically. The shared span is 19 lines — 19 of the 37 lines in
`stryker.config.mjs`, 19 of the 48 in `stryker.config.server.mjs`. Most of
the server config's extra bulk is *unique multi-line rationale* that no factory
can absorb. This is a real 19-lines-times-four saving plus a single point of
truth for the plugin list — worth doing, not worth a large refactor.

## Evidence

- `stryker.config.mjs:2-6` ⇔ `stryker.config.server.mjs:2-6` ⇔
  `scripts/stryker-scripts.ts:2-6` ⇔ `tools/stryker-lint-ratchet.ts:2-7` — the
  Bun-plugin-discovery comment plus `plugins` / `testRunner` / `checkers`,
  identical in all four (`tools/stryker-lint-ratchet.ts:4` adds only the
  `// Mirrors scripts/stryker-scripts.ts.` line).
- `stryker.config.mjs:25-36` ⇔ `stryker.config.server.mjs:36-47` ⇔
  `scripts/stryker-scripts.ts:37-48` ⇔ `tools/stryker-lint-ratchet.ts:27-38` —
  `reporters`, `htmlReporter`, `jsonReporter`, and a byte-identical
  `thresholds: { high: 80, low: 60, break: null }`.
- `stryker.config.mjs:8-9` / `:10` and siblings — `concurrency: 1` and
  `incremental: true` repeated in all four; only `incrementalFile` differs, and
  it differs only in its report directory.
- `stryker.config.server.mjs:10-15` — the six-line rationale explaining that
  `concurrency: 1` sidesteps the `test-database-url.ts` DB-isolation gap
  (worker DBs key off `VITEST_POOL_ID`, not `STRYKER_MUTATOR_WORKER`). Unique to
  the server lane.
- `stryker.config.server.mjs:17-24` — the eight-line in-place-vs-sandbox
  tradeoff (server vitest config resolves `globalSetup`/`setupFiles` and the
  per-worktree test DB relative to the live worktree root). Unique.
- `scripts/stryker-scripts.ts:9-14` — a *different* in-place rationale (script
  tests resolve the repo via `import.meta.url` and `git`, which a copied sandbox
  breaks). Also unique.
- `stryker.config.server.mjs:7-8` — a third unique rationale, on why
  `tsconfigFile` is the package tsconfig and not the root.
- Genuinely divergent per lane: `tsconfigFile`, `incrementalFile`,
  `vitest.configFile`, `vitest.dir`, `mutate` globs, the report directories, and
  `inPlace` (absent in `stryker.config.mjs`, `true` in the other three).
- `package.json:51-54` — the four invocations: `test:mutation` (default config),
  `test:scripts:mutation`, `test:lint-ratchet:mutation`, `test:server:mutation`.
- `eslint-config/config-surface-manifest.json:16-27` — `stryker.config.mjs` and
  `stryker.config.server.mjs` are registered config surfaces in the `root-js`
  group with `coverageStatus: "linted"`.
- `docs/agent_notes/backlog/mutation-testing-stryker.md` (Status: landed) owns
  the four-lane inventory (`:3-5`) and the original per-lane rationale — the
  `VITEST_POOL_ID`/serial-concurrency decision at `:242-246` and the server
  `inPlace` history at `:280-283`. Update its config list if a shared factory
  file lands.

## Proposed direction

1. **Spike the loader question first, before adding any file.** The whole value
   of this leaf is *one* source of truth for the plugin list and thresholds
   across all four lanes, so the first thing to establish is whether the two
   `.ts` lanes can import a root `.mjs` module under `stryker run`
   (`package.json:52-53` invoke `scripts/stryker-scripts.ts` and
   `tools/stryker-lint-ratchet.ts` directly). Throwaway spike: add a temporary
   `export const x = 1` module, import it from `scripts/stryker-scripts.ts`, run
   `bun run test:scripts:mutation` far enough to clear the dry run, then revert.
   **If all four lanes cannot consume the factory, stop and close this leaf**
   (see the fallback caveat below) — do not proceed to step 2.
2. **Add the factory.** Create `stryker.shared.mjs` at the repo root exporting
   `createStrykerConfig({ tsconfigFile, reportDir, vitest, mutate, inPlace })`.
   It owns the plugin comment and `plugins`, `testRunner`, `checkers`,
   `concurrency: 1`, `incremental: true`, `reporters`, `thresholds`, and derives
   `incrementalFile`, `htmlReporter.fileName`, and `jsonReporter.fileName` from
   `reportDir`. Register the new file in
   `eslint-config/config-surface-manifest.json` (`language: "mjs"`, group
   `root-js`) in the same commit, refresh `docs/generated/lint-coverage-map.md`
   (its config-surface row at `:392` names the `.mjs` surfaces individually), and
   run `bun run harness:check`. Skipping the manifest registration is what will
   fail the gate, not the config change itself.
3. **Convert `stryker.config.mjs`.** Smallest lane, no unique rationale beyond
   the `mutate` comments — those stay at the call site as comments on the
   `mutate` argument.
4. **Convert `stryker.config.server.mjs`.** The three rationale blocks (`:7-8`
   tsconfig, `:10-15` concurrency/`VITEST_POOL_ID`, `:17-24` in-place) move
   verbatim onto the corresponding factory arguments. They do not move into
   `stryker.shared.mjs`.
5. **Convert `scripts/stryker-scripts.ts` and `tools/stryker-lint-ratchet.ts`**,
   on the evidence gathered in step 1. Delete the
   `// Mirrors scripts/stryker-scripts.ts.` line at
   `tools/stryker-lint-ratchet.ts:4` — the factory makes it true structurally.
6. **Prove each converted lane still starts.** Run each of the four
   `package.json:51-54` scripts far enough to clear Stryker's dry run (the dry
   run is where a broken `tsconfigFile`, `vitest.configFile`, or sandbox-path
   assumption fails). A full mutation run is not required.

## Scope / caveats

- **Do not pull the per-lane rationale comments into the factory.** The
  server's `VITEST_POOL_ID`/DB-isolation paragraph and the two *different*
  in-place-vs-sandbox explanations (server vs scripts) are the reason those
  settings survive review. They are per-lane facts, they contradict each other
  in detail, and a factory that swallowed them would leave four call sites
  saying `inPlace: true` with no reader-visible reason. Keep them at the call
  site, verbatim.
- **Do not target a line-count.** The rationale comments stay at the call sites
  (step 4), so expect the server config to remain roughly 30 lines, most of it
  prose. A conversion that gets it much shorter has discarded rationale.
- **A two-lane factory is not a smaller win, it is a worse outcome — do not ship
  one.** If step 1 shows the `.ts` lanes cannot import the shared `.mjs`, the
  fallback is to close this leaf, not to convert the two `.mjs` configs anyway.
  Converting only those two saves ~19 lines twice (from 37- and 48-line files),
  leaves the plugin list and thresholds still duplicated across three places
  instead of four, and *adds* a permanently registered config surface plus a
  coverage-map row to carry that non-result. The whole justification here is the
  single point of truth; two of four lanes does not deliver it. If a cheaper
  variant is wanted after a failed spike, spike a shared module format all four
  loaders can read (for example a plain data file holding only `plugins` and
  `thresholds`) rather than settling for the partial conversion.
- **This is not a licence to unify the lanes themselves.** `concurrency: 1` and
  `inPlace` are per-lane correctness settings, not style. In particular
  `stryker.config.mjs` deliberately does *not* set `inPlace` (shared is pure
  logic with no path-resolution dependency on the live worktree); do not add it
  "for consistency".
- **Config-surface registration is the real gate cost, and it is narrow.**
  Adding a root `.mjs` file touches
  `eslint-config/config-surface-manifest.json` and
  `docs/generated/lint-coverage-map.md` (checked via
  `bun run docs:lint-coverage-map:check`, which reads the manifest entries). It
  does **not** touch the generated `tsconfig.configs.json`: that project is
  built from `tsConfigFiles`, which filters the manifest to `language === "ts"`
  (`eslint-config/config-surfaces.js:92`, `scripts/harness/generate-config-surfaces.ts:4`),
  so an `mjs`-language surface never appears in it and
  `bun run harness:config-surfaces` produces no diff for this change. Run
  `bun run harness:check` before committing.
- No sequencing dependency on other leaves in this pack.
