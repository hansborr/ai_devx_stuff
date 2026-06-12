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

Sanctioned exception: `scripts/eslint-config-shared-policy.d.ts` is an ambient
declaration for `eslint-config/shared-policy.js` and `eslint-rules/max-lines.js`.
Keeping it under `scripts/` avoids the TypeScript and ESLint resolver treating it
as a concrete colocated module for only one of those JavaScript files.

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
| `scripts/lib/`           | Shared shell and TypeScript helpers used by multiple script families, including sourced shell helpers and modules such as `scripts/lib/lint-rule-docs.ts`. |
| `scripts/lint-ratchet/`  | Lint-ratchet implementation modules, registry logic, output formatting, and tests.                                                                         |
| `scripts/logs-audit/`    | Logs-audit checks, redaction/event helpers, diagnostics projection, and tests.                                                                             |
| `scripts/path-policy/`   | Changed-file classification and smoke-test subject mapping used by script wrappers.                                                                        |
| `scripts/tests/`         | Shell smoke tests run by `scripts/test-scripts.sh`.                                                                                                        |
| `scripts/verify/`        | Generated verify step data plus the static resolver library that interprets it.                                                                            |

## Smoke Tests

`scripts/test-scripts.sh` is the package entrypoint. The smoke tests it runs live
under `scripts/tests/` and are named `test-<subject>.sh`, for example
`scripts/tests/test-verify.sh` and `scripts/tests/test-harness-check.sh`.

Full-suite discovery is directory-based: every `scripts/tests/test-*.sh` file
is a smoke test. Helper-only shell files belong in `scripts/tests/lib/`; they
are sourced or invoked by smoke tests but are not standalone smoke subjects.

Changed-mode selection is subject-based. If a new script needs targeted
`test:scripts:changed` coverage, update the `scripts/path-policy/` subject map
so edits to the implementation select the right `scripts/tests/test-<subject>.sh`
file.

## Generated Files

Checked-in generated files must have a freshness gate. Prefer placing generated
outputs beside the static library that consumes them, or make the producer and
consumer relationship explicit when the output belongs outside `scripts/`.

Current generated surfaces:

- `scripts/verify/steps.generated.sh` is generated by
  `scripts/harness/generate-verify-steps.ts` from `harness.controls.json` (refresh
  with `bun run verify:steps`, check with `bun run verify:steps:check`) and
  consumed with `scripts/verify/steps-lib.sh` by `scripts/verify.sh` and
  `.husky/pre-commit`.
- The hook wiring in `.claude/settings.json` and the whole `.codex/hooks.json`
  are generated by `scripts/harness/generate-hook-wiring.ts` from
  `harness.controls.json` (refresh with `bun run harness:wiring`, check with
  `bun run harness:wiring:check`). `.codex/hooks.json` carries a generated marker;
  the `hooks` key in `.claude/settings.json` is generated too, but no marker is
  written there to avoid settings-schema risk.
- `docs/generated/harness-controls.md` is generated by
  `scripts/harness/generate-harness-controls.ts` from `harness.controls.json`
  (refresh with `bun run docs:harness-controls`, check with
  `bun run docs:harness-controls:check`).

`bun run harness:check` runs the relevant `--check` modes and fails when these
generated files are stale. Do not hand-edit generated regions as a substitute
for changing the manifest or generator.

## Adding Or Moving A Script

Use this checklist when changing the scripts tree:

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
