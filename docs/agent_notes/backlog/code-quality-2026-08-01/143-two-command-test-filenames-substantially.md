# 143. Two harness suites are named after commands they never load, so the license gate and the near-duplicate benchmark have no command-level contract at all

Status: Landed on fix/cq-143
Theme: Test names overstate coverage · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/audit-dependency-licenses.test.ts` and
`scripts/benchmark-near-duplicates.test.ts` are named exactly after the two
commands they sit beside, and in this repo that naming reads as a promise: the
suite covers the command. Neither does.

The license suite is 47 lines and asserts two regexes, one `licenseValue`
array-join case, and the wording of a remedy string. The command it is named
after is 367 lines, and everything that makes it a *gate* — walking the
`node_modules` trees, computing the production dependency closure, excluding
workspace `@musi/*` packages, falling back to `UNKNOWN` when a manifest carries
no license field, deciding which packages are flagged, and setting a non-zero
exit code — lives in unexported functions and in the `import.meta.main` block,
none of which the suite can even reach. The benchmark suite is 41 lines and
never imports the 303-line entrypoint at all; it imports the 60-line
`benchmark-near-duplicates-core.ts` helper module and tests its two pure
statistics functions. The entrypoint's own boundaries — CLI parsing, worker
JSON validation, report construction — are untested.

The cost is not that these commands are untested by accident; small harness
scripts often are. The cost is that the filenames say otherwise. A contributor
refactoring the license traversal sees a test file bearing the command's name,
runs it green, and lands a change that silently stops the audit from finding
anything — the gate would still exit 0 on an empty package set, and no
assertion in the tree would notice. In a repo whose point is being a copyable
harness reference, a suite that names a command but pins only its helpers
teaches outside readers the wrong contract.

## Evidence

- `scripts/audit-dependency-licenses.test.ts` — 47 lines total. Its import block
  at `:3-8` names exactly four symbols: `LICENSE_AUDIT_REMEDY`, `licenseValue`,
  `REVIEW_COPYLEFT_RE`, `STRONG_COPYLEFT_RE`. Those are also the only four
  exports of the command module (`scripts/audit-dependency-licenses.ts:26`,
  `:27`, `:28`, `:47`), so the suite covers 100% of the module's export surface but none of its
  traversal, dependency-closure, flagging, or exit-code behavior.
- `scripts/audit-dependency-licenses.ts` is 367 lines. The operational
  functions are all module-private: `licenseFromNearbyFile` (`:65`),
  `collectPackagesFromNodeModules` (`:150`), `walkForNodeModules` (`:183`),
  `workspaceNodeModules` (`:212`), `collectInstalledPackages` (`:231`),
  `collectProductionPackages` (`:285`), `summarizeLicenses` (`:310`),
  `printPackageList` (`:318`).
- `scripts/audit-dependency-licenses.ts:330-367` — the `import.meta.main` block
  holds the gate decisions no test touches: mode selection at `:331`, the
  deduplicated `flaggedCount` built from a `name@version` `Set` at `:340-342`
  (with a comment explaining that a compound license can match two categories),
  and the exit rule at `:363-365` — `process.exitCode = 1` for strong or review
  copyleft, deliberately *not* for `UNKNOWN`/`UNLICENSED`, which are reported
  but do not fail.
- `scripts/audit-dependency-licenses.ts:106` — `readPackageInfo` drops any
  package whose name starts with `@musi/`; `:112-115` — the license falls
  through `license` → `licenses` → `licenseFromNearbyFile` → the literal
  `"UNKNOWN"`. Both are load-bearing gate semantics with no assertion anywhere.
- `scripts/audit-dependency-licenses.ts:25` — `const PROJECT_ROOT =
  resolve(import.meta.dirname, "..")`, and `:30` — `const ALL_MODE =
  process.argv.includes("--all")`. Both are resolved at module load, so a test
  cannot point the command at a fixture repository by changing the working
  directory; the root has to be injected.
- `scripts/benchmark-near-duplicates.test.ts` — 41 lines; its only import
  (`:3-6`) is from `./benchmark-near-duplicates-core.js`, and it exercises
  `summarizeNearDuplicatesMeasurements` and `decideNearDuplicatesBudget`. The
  file named in its own filename, `scripts/benchmark-near-duplicates.ts`
  (303 lines), is never imported.
- `scripts/benchmark-near-duplicates-core.ts` is 60 lines — the suite covers a
  fifth of the code its name implies.
- Untested boundaries in `scripts/benchmark-near-duplicates.ts`:
  `parseSampleCount` (`:234-247`, the usage error plus the "positive odd
  integer" rule), `parseWorkerAudit` (`:177-195`, throwing `"benchmark worker
  returned invalid JSON"` and `"benchmark worker returned invalid counts"`),
  its guards `hasWorkerCounts` (`:197`) and `isExactAudit` (`:210`),
  `sampleWorker` (`:142`), `processTreeRssKiB` (`:117`), `reportState` (`:277`)
  and `runBenchmark` (`:248`).
- The `-core.test.ts` naming idiom the benchmark suite should already be using
  exists in the same directory: `scripts/suppression-ledger-core.test.ts` and
  `scripts/lint-coverage-map-gen-core.test.ts`.
- `scripts/sensor-near-duplicates-cli-options.test.ts` (142 lines) is the
  in-repo model for the missing CLI contracts: a header comment at `:8-13`
  declares the suite characterization-first and enumerates the parser quirks it
  pins.
- Both commands are live root scripts: `package.json:66`
  (`"audit:licenses": "bun scripts/audit-dependency-licenses.ts"`) and
  `package.json:144`
  (`"sensor:near-duplicates:benchmark": "bun scripts/benchmark-near-duplicates.ts"`).
  Both invoke the entrypoints by path, so test renames cannot break them.
- `docs/generated/lint-coverage-map.md:165` and `:226` name both test files by
  filename in generated rows, so a rename must be followed by a regeneration.
- `eslint-config/max-lines-exceptions.baseline.json:179` lists
  `scripts/audit-dependency-licenses.ts`.
- `scripts/vitest.config.ts:12` — `include: ["**/*.test.ts"]`. Scripts test
  discovery is glob-based and these are Vitest suites, not shell smokes, so a
  rename needs no smoke-subject or harness registration.

## Proposed direction

Split this in two, along the two very different risk profiles. Slice 1 is
mechanical and should land on its own; slice 2 is a real refactor of a live
gate.

**Slice 1 — rename the suites to what they test (mechanical).**

1. Rename `scripts/benchmark-near-duplicates.test.ts` to
   `scripts/benchmark-near-duplicates-core.test.ts`. It already imports only
   `benchmark-near-duplicates-core.js`, and the name then matches the existing
   `suppression-ledger-core.test.ts` / `lint-coverage-map-gen-core.test.ts`
   idiom.
2. Rename `scripts/audit-dependency-licenses.test.ts` to a helper-scoped name
   such as `scripts/audit-dependency-licenses-classification.test.ts`.
3. Update the coverage manifest entries that name the old filenames —
   `scripts-benchmark-near-duplicates-ts` in
   `scripts/lint-coverage-map-manifest-drift-ai.ts` and
   `scripts-audit-dependency-licenses-ts` in
   `scripts/lint-coverage-map-manifest-linted-scripts-a.ts` — then run
   `bun run docs:lint-coverage-map:generate` and commit the regenerated
   `docs/generated/lint-coverage-map.md`. The document is generated output:
   a rename that only regenerates leaves a glob matching no tracked file, which
   `docs:lint-coverage-map:check` fails. Nothing else needs registration.

**Slice 2 — add the missing command contracts.**

*Benchmark.* Export the module-private pure boundaries `parseSampleCount`
(`:234`) and `parseWorkerAudit` (`:177`) together with their guards
`hasWorkerCounts` (`:197`) and `isExactAudit` (`:210`) from
`scripts/benchmark-near-duplicates.ts` — or move them into a small
`scripts/benchmark-near-duplicates-cli.ts`. Add a characterization suite
modelled on `scripts/sensor-near-duplicates-cli-options.test.ts`, including its
header-comment idiom, pinning the usage error and the odd-integer rule for
`--samples` and the two distinct worker rejections (invalid JSON, invalid
counts). No process is spawned.

*License audit.* The command cannot gain contracts without an injection
refactor, because `PROJECT_ROOT` (`:25`) and `ALL_MODE` (`:30`) are both
resolved at module load — pointing a spawned process at a fixture working
directory will not work. Therefore:

1. Parameterize the root: give `collectProductionPackages` (`:285`) and
   `collectInstalledPackages` (`:231`) a `rootDir` argument instead of reading
   the `PROJECT_ROOT` constant, and export them.
2. Extract the flagging computation out of the `import.meta.main` block
   (`:330-367`) into an exported function returning the strong/review/unknown
   sets, the deduplicated flagged count, and the exit decision — so the test
   asserts a value rather than console prose.
3. Add a fixture-repository test using a temp directory containing a small
   `package.json` plus a plain `node_modules` tree, pinning: production-closure
   vs `--all` selection, the `@musi/*` workspace exclusion (`:106`, `:250`),
   the `licenseFromNearbyFile` → `"UNKNOWN"` fallback (`:112-115`), and the
   flagged-set/exit-code decision including the rule that `UNKNOWN` alone does
   not fail.

Keep the `import.meta.main` behavior byte-identical through the refactor, and
diff `bun run audit:licenses` output before and after.

## Scope / caveats

- **Explicitly out of scope:** any change to thresholds, regexes, or output
  format; spawn-based end-to-end benchmark runs (each invocation drives the
  near-duplicate engine ten-plus times and is far too slow for the test gate);
  covering `sampleWorker`'s spawn/RSS-poller loop (`:142`) and
  `processTreeRssKiB` (`:117`); and migrating `parseSampleCount` onto the
  shared `parseCli` substrate — that is a separate CLI-catalog concern, see
  [120-cli-option-models-remain-parallel-registries.md](./120-cli-option-models-remain-parallel-registries.md)
  and
  [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md)
  for where that work belongs.
- **Slice 2's license half touches the gate it is protecting.** Parameterizing
  the root and extracting the exit decision is a refactor of the live license
  audit; a slip weakens exactly the check this leaf exists to defend. Land
  slice 1 first and independently so the naming fix is not held hostage to it.
- **Keep the fixture trees boring.** `walkForNodeModules` (`:183`) dedups via
  `realpathSync` (`:190-192`, `:203-206`) and skips `.bin`/`.cache` (`:207`).
  Fixtures built from symlinks make traversal assertions platform-brittle; use
  plain directories only.
- **The generated coverage map is a parity gate.** Forgetting
  `bun run docs:lint-coverage-map:generate` after the renames fails the docs
  parity check, because rows `:165` and `:226` name both test files.
- **If slice 2 shrinks the command file, refresh the baseline with the
  tooling.** `eslint-config/max-lines-exceptions.baseline.json:179` lists
  `scripts/audit-dependency-licenses.ts`; use
  `bun run lint:max-lines-exceptions:update` rather than hand-editing the JSON.
- **Do not rename or move the entrypoints themselves.** `package.json:66` and
  `package.json:144` invoke them by path. Because slice 2 edits
  `scripts/benchmark-near-duplicates.ts`, it must also honor the live
  2026-07-25 pack's landed H4 converge-on-touch rule: replace local
  `USER_ARGUMENT_START` with imported `PROCESS_ARGV_USER_ARGS_START` from
  `scripts/lib/process-argv.ts`.
- Focused verification for either slice is
  `bun run test:scripts:file -- <path to the suite>`.
