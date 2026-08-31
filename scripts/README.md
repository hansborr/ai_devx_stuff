# Scripts Layout

`scripts/` is the repo's command surface for package scripts, Husky/doctor
helpers, verification wrappers, AI harness checks, smoke tests, and maintenance
tools. The reorg contract is simple: keep the top level for command surfaces and
facades; put implementation families, shared helpers, fixtures, and smoke tests
under owner directories.

## Top Level

Top-level files should be one of these:

- A command called directly from `package.json`, such as `scripts/verify.sh`,
  `scripts/lint.sh`, `scripts/test-scripts.sh`, `scripts/harness-check.ts`, or
  `scripts/drift-ai.ts`.
- A hook or doctor surface sourced or invoked directly by `.husky/`,
  `.github/workflows/`, `scripts/doctor.sh`, or another top-level wrapper, such as
  `scripts/dependency-freshness.sh`, `scripts/doc-length-policy.sh`,
  `scripts/harness-emit-envelope.ts`, `scripts/prisma-client-freshness.sh`,
  `scripts/process-tree.sh`, `scripts/worktree-drift-hook.sh`,
  `scripts/eslint-disable-register.sh`, or `scripts/suppression-register.sh`.
- A facade that delegates to a family directory, such as `scripts/code-intel.ts`
  plus `scripts/code-intel/`, `scripts/lint-ratchet.ts` plus
  `scripts/lint-ratchet/`, `scripts/logs-audit.ts` plus
  `scripts/logs-audit/`, or `scripts/harness-check.ts` plus
  `scripts/harness/`.
- A direct companion for a top-level entrypoint: colocated tests, schemas,
  validation helpers, or config that exists only to support that entrypoint.
  When companions become a family, move them under a directory instead of adding
  more flat files.

Plain-JavaScript policy owns precise JSDoc, and `tsconfig.scripts.json` sets
`allowJs` so `scripts/*.ts` binds to `eslint-config/*.js` and the two imported
`eslint-rules/*.js` helpers directly — there is no declaration shadow to keep in
sync. Those bodies keep their `// @ts-check` pragma, and because this project
compiles them, that pragma is enforced here — a type error in one fails the
scripts typecheck. It is the only lane that gates any `eslint-rules/*.js` file;
the rest of that surface is still unenforced (harness-sweep-2026-07 leaf 22c).

Do not add a new implementation family as `scripts/<topic>-*.ts` or
`scripts/<topic>-*.sh`. Add `scripts/<topic>/` and keep only the package-facing
entrypoint or facade at the top level.

## Current Directories

The current tree uses these owner directories:

| Directory                | Owns                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ai-hooks/`      | Shared AI hook bodies and hook libraries used by Claude and Codex adapters.                                                                                |
| `scripts/code-intel/`    | Implementation behind `scripts/code-intel.ts` and the code-intel daemon entrypoints.                                                                       |
| `scripts/codemods/`      | Codemod implementations, tests, fixtures, and codemod-local helpers.                                                                                       |
| `scripts/drift/`         | The `drift:e2e` locator-usage tool.                                                                                                                        |
| `scripts/drift-ai/`      | The portable `drift:ai` implementation, docs, fixtures, and advisory subcommands.                                                                          |
| `scripts/fixtures/`      | Shared script/generator fixtures that are not owned by a narrower family.                                                                                  |
| `scripts/git/`           | Git helper scripts, including the lint-ratchet merge-driver installer.                                                                                     |
| `scripts/harness/`       | Harness validation, manifest generators, diagnostics, and tests used by top-level harness facades.                                                         |
| `scripts/harness-audit/` | Fixtures for the `harness:audit` facade.                                                                                                                   |
| `scripts/import-closure/` | Source-level ESM import-closure walking for seed fingerprints and synthetic fixture copy sets.                                                            |
| `scripts/lib/`           | Shared shell and TypeScript helpers used by multiple script families, including sourced shell helpers and modules such as `scripts/lib/lint-rule-docs.ts`. |
| `scripts/lint-ratchet/`  | Lint-ratchet implementation modules, registry logic, output formatting, and tests.                                                                         |
| `scripts/logs-audit/`    | Logs-audit checks, redaction/event helpers, diagnostics projection, and tests.                                                                             |
| `scripts/path-policy/`   | Changed-file classification and smoke-test subject mapping, plus smoke-fixture copy-set closure analysis.                                                    |
| `scripts/tests/`         | Shell smoke tests run by `scripts/test-scripts.sh`.                                                                                                        |
| `scripts/verify/`        | Generated verify step data plus the static resolver library that interprets it.                                                                            |

## Smoke Tests

`scripts/test-scripts.sh` is the package entrypoint. The smoke tests it runs live
under `scripts/tests/` and are named `test-<subject>.sh`, for example
`scripts/tests/test-verify.sh` and `scripts/tests/test-harness-check.sh`.

Full-suite discovery is directory-based: every `scripts/tests/test-*.sh` file
is a smoke test. Helper-only shell files belong in `scripts/tests/lib/`; they
are sourced or invoked by smoke tests but are not standalone smoke subjects.

Changed-mode selection is subject-based and single-sourced from the smoke file
itself: declare each subject as a `# smoke-subjects: <repo-path>` header line
(at least one, the smoke's own path included; parsed by
`scripts/path-policy/smoke-subject-headers.ts`), optionally pin its position in
the sequential run with a unique `# smoke-order: <NNN>` (unordered smokes sort
last), then run `bun run test:scripts:subjects` and commit the regenerated
`scripts/path-policy/path-policy-smoke-subjects-data.ts` and
`scripts/fixtures/test-scripts/all-smoke-tests.txt`. `test:scripts:subjects:check`
guards drift. The agent-cli skill smoke's headers live inside a generated
`# BEGIN GENERATED SKILL SMOKE SUBJECTS` block owned by
`bun run harness:skills:refresh` — edit the canonical skill tree, not the header.

One thing no generator catches: some smokes assert the **exact set** of smokes
`--changed` selects for a given file (`scripts/tests/test-test-scripts.sh`, the
`MUSI_SCRIPTS_CHANGED_FILES=` blocks). Adding a `# smoke-subjects:` line for a
widely-touched subject such as `.github/workflows/ci.yml` legitimately joins
your smoke to that set and makes those pins stale — and removing a subject
bites the same way. `test:scripts:subjects:check`, `harness:check`, and the
coverage map validate the registry, not assertions written against it, so this
surfaces only in the full gate at land. Before committing a new or changed
smoke, grep `scripts/tests/` for `MUSI_SCRIPTS_CHANGED_FILES=` and extend any
expected-set literal that must gain (or lose) your smoke. Extend the exact set;
never weaken the assertion to a substring match.

## Generated Files

Checked-in generated files must have a freshness gate. Prefer placing generated
outputs beside the static library that consumes them, or make the producer and
consumer relationship explicit when the output belongs outside `scripts/`.

The complete set of generated surfaces is not enumerated here: it is every
control carrying a `generatedSurface` facet in `harness.controls.json`, which
is the machine-checked source of record for each family's trigger paths,
output paths, and check script. `docs/generated/harness-controls.md` is the
generated human-readable view of those controls — principle, source, and
invocation — not a second copy of the facets. Three of them, as worked
examples of the producer/output/refresh/check pattern:

- `scripts/verify/steps.generated.sh` is generated by
  `scripts/harness/generate-verify-steps.ts` from `harness.controls.json` (refresh
  with `bun run verify:steps`, check with `bun run verify:steps:check`) and
  consumed with `scripts/verify/steps-lib.sh` by `scripts/verify.sh` and
  `.husky/pre-commit`.
- The hook wiring in `.claude/settings.json` and the whole `.codex/hooks.json`
  and `.github/hooks/copilot.json` are generated by
  `scripts/harness/generate-hook-wiring.ts` from `harness.controls.json`
  (refresh with `bun run harness:wiring`, check with
  `bun run harness:wiring:check`). `.codex/hooks.json` and
  `.github/hooks/copilot.json` must keep their harnesses' supported top-level
  shapes, so generated-file ownership is enforced by the freshness check
  instead of an in-file marker. The `hooks` key in `.claude/settings.json` is
  generated too.
- `docs/generated/harness-controls.md` is generated by
  `scripts/harness/generate-harness-controls.ts` from `harness.controls.json`
  (refresh with `bun run docs:harness-controls`, check with
  `bun run docs:harness-controls:check`).

`bun run harness:check` runs the relevant `--check` modes and fails when any
registered generated surface is stale. Do not hand-edit generated regions as a
substitute for changing the manifest or generator.

`examples/lint-ratchet-demo/` is not a generated surface and carries no facet:
it is an ordinary workspace consumer of the `@musi/lint-ratchet` package (no
copied-in engine, no sync manifest). Its `smoke.sh` proves the adoption path in
isolation and runs in `.github/workflows/lint-ratchet-demo.yml`.

Registering a **new doc generator** (`generate-*.ts` via `runDocGenerator` with
`--check`) is one manifest record plus regeneration:

1. Add the control record to `harness.controls.json` with a nested
   `generatedSurface` facet — `triggerPaths`, `outputPaths`, `checkScript`,
   `warnLabel`, `bunHook`, `fixturePaths` (the schema in
   `scripts/harness/generated-surfaces.ts` is strict). `bunHook: {refresh,
   check}` declares wrapped/bypass per script, plus an optional `scripts`
   record for extra package scripts the generator owns, so no hook heredoc is
   hand-edited. The `:check` script needs **no** `scriptParityExemptions`
   entry — it is a parity alias derived from `checkScript`, and a redundant
   exemption fails `harness:check`.
2. Add the base and `:check` scripts to `package.json`.
3. Run `bun run verify:steps` (regenerates every loader-derived artifact:
   freshness and classified-bun-scripts fragments, the fixture copy manifest,
   and `steps.generated.sh`), then `bun run docs:harness-controls`.
4. `fixturePaths` names the files the generator needs copied into the
   `test-harness-check.sh` fixture; `scripts/harness/fixture-closure-check.ts`
   fails on both missing and stale declarations and requires regular files.
   The fixture's `package.json` script wiring and the smoke's
   `# smoke-subjects:` headers stay hand-maintained.
5. Still hand-maintained on purpose: the id and `checkScript` `toEqual`
   tripwire lists in `scripts/harness/generated-surfaces.test.ts` — extend them
   with the new record.

`harness:check` validates the chain and `verify:steps:check` gates artifact
freshness; since 2026-07-22 pre-commit's `harness:registration:check`
admission catches a missed inventory at commit time rather than at land.

Run gate scripts (`bun run harness:check`, `verify:*`, `doctor`) from the
worktree root. `bun run <name>` resolves the script against the nearest
package.json walking up, so from a `@musi/*` package subdir (e.g.
`packages/client/src`) the bare name errors `Script not found "harness:check"`.
Programmatic callers (such as `doctor.sh`) invoke the validator by its absolute
module path so nested-cwd launches resolve; from a shell, `cd` to the root first
or run `bun --cwd="$(git rev-parse --show-toplevel)" run harness:check`.

## Adding A New Workspace Package

Adding a whole new `packages/*` or `tools/*` workspace package is the widest
registration surface in the repository — the `@musi/harness-diagnostics`
extraction (`a1f8f13ae`, 2026-08-21) crossed roughly twenty distinct
registration surfaces across 52 changed files, and no single gate lists them.
Nothing generates this list, so work it top to bottom. Items marked
*package-specific* are not always required.

1. The package itself: a private `package.json` named `@musi/<name>` with
   source-mapped `exports` (no build step), and a composite `tsconfig.json`.
   Copy the shape from `tools/harness-diagnostics/` or `tools/lint-ratchet/`.
2. Root `package.json`: add the `"@musi/<name>": "workspace:*"` devDependency
   (the `workspaces` globs already cover `packages/*` and `tools/*`), then run
   `bun install` and commit the `bun.lock` change.
3. Root `tsconfig.json`: add a `{ "path": "<dir>" }` project reference.
4. `eslint-config/config-surface-manifest.json`: add a record for each config
   file the package ships (typically its `vitest.config.ts`), then regenerate
   with `bun run harness:config-surfaces` — that rewrites `tsconfig.configs.json`,
   which is what gives those config files a parser project.
5. `eslint-config/tools-configs.js` (for `tools/*`) or
   `eslint-config/package-boundary-configs.js` (for `packages/*`): add the
   package to the parser-project reach block and give it a
   `no-restricted-imports` boundary group so it cannot reach into sibling Musi
   packages.
6. *Package-specific:* if the package needs a non-default `local/max-lines`
   cap, add its globs to `maxLinesEngineZone` in
   `eslint-config/max-lines-policy.js` (the globs and cap live there so the cap
   audit in `scripts/max-lines-exceptions.ts` can resolve them without loading
   ESLint plugins; `maxLinesEngineZoneConfigs` in
   `eslint-config/code-quality-configs.js` only wires them into a scoped rule).
7. Vitest: add a package-local `vitest.config.ts`, add the package directory to
   `test.projects` in the root `vitest.config.ts`, and add a matching
   `coverage.thresholds` block for its source glob.
8. `knip.config.ts`: add a workspace block with the package's `entry` and
   `project` globs, otherwise its exported surface is reported as an orphan.
   A package whose exports are an intentional public contract also needs an
   `ignoreIssues` entry (e.g. `"tools/harness-diagnostics/src/**": ["exports",
   "types"]`).
9. Coverage map: add row(s) to the right
   `scripts/lint-coverage-map-manifest-*.ts` module (portable `tools/*`
   packages go in `-portable-tooling.ts`), wire the group into
   `scripts/lint-coverage-map-manifest-sections.ts` if it is a new section, and
   regenerate `docs/generated/lint-coverage-map.md` with
   `bun run docs:lint-coverage-map:generate`.
10. *Package-specific:* if the lint-ratchet acceptance fixture must resolve the
    package, update the copy-set, the `externalPackages` closure list, and the
    `node_modules/@musi/<name>` symlink in `scripts/tests/test-lint-ratchet.sh`.
11. *Package-specific:* update any `# smoke-subjects:` headers whose smokes now
    exercise the new package, then regenerate the selection data with
    `bun run test:scripts:subjects`.
12. *Extraction only:* when the package is carved out of an existing one,
    repoint every production and test importer and grep for the old module
    path in prose — path references in docs and comments are not gated.

Two surfaces are hand-pinned and are **not** reliably caught by the
changed-mode gate — check both by hand:

- `eslint-rules/eslint-config-policy.test.js` pins the repository's config-file
  list in a `toEqual` assertion; a new package's `vitest.config.ts` has to be
  added there by hand (see the `"tools/harness-diagnostics/vitest.config.ts"`
  entry).
- `scripts/import-closure/alias-parity.test.ts` requires every `@musi/*`
  workspace package to appear in either `mappedWorkspaceSources` (`:12-15`) or
  `deliberatelyUnmappedWorkspacePackages` (`:17-23`); its
  `expect(classifiedPackages).toEqual(workspacePackages)` assertion (`:88`)
  does fail on an unclassified package, but only when that file is actually
  selected and run — which fast-commit's `test`-slot skip and changed-mode
  routing can both miss. Run it directly:
  `bun run test:scripts:file -- scripts/import-closure/alias-parity.test.ts`.

## Adding Or Moving A Script

Use this checklist when changing the scripts tree. Before editing, print the
joined governing chain for the surface you are touching — controls, package
scripts, verify slots, hooks, smoke selection, and generated trigger, output,
and fixture paths — with
`bun run harness:registration:check -- --explain --path <repo-path>`
(selectors `--control <control-id>` and `--script <package-script-name>` and a
`--json` envelope are also available):

1. Decide whether the file is a package-facing entrypoint/facade or an
   implementation helper. Helpers go under the owner directory unless they are
   deliberately hook-facing surfaces like the existing Husky/doctor helpers.
2. Add or update smoke coverage in `scripts/tests/test-<subject>.sh` when the
   script is a wrapper, generator, hook surface, or behavior-sensitive utility.
3. Update `scripts/path-policy/` if `test:scripts:changed` should select that
   smoke test for implementation edits.
4. Update `package.json` and `harness.controls.json` only for real command or
   harness-control surfaces.
5. After a move, run `rg` for the old path across docs and comments. Prose path
   references are not covered by lint, typecheck, or smoke gates.

For AI hook architecture, keep this file at the layout level and use
`docs/ai-harness.md` for the adapter boundary and wiring model. Use
`scripts/ai-hooks/README.md` for shim, shared-body, manifest authoring, and
porting details.
