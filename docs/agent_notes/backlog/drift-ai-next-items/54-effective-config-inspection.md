# 54 - effective config inspection

Status: Done
Track: G
Size: small-medium
Depends on: none
Blocks: none

## Goal

Add a read-only inspection surface that shows the effective `drift:ai` config for
the current target repo.

## Background

The tools-checkout workflow asks operators to run `drift:ai` from one checkout
against another repo. When a scan skips files or runs unexpected checks, the
operator needs to confirm which config was auto-discovered, which roots are in
effect, and what defaults were filled in. The main JSON report includes some of
that data, but only after a scan.

This should be an inspection command, not a mutation or generator.

## Seams to touch

- `scripts/drift-ai/runner.ts`
- `scripts/drift-ai/subcommand-args.ts` or main CLI parsing if a flag is chosen
- `scripts/drift-ai/config.ts`
- `scripts/drift-ai/config-parsing.ts`
- `scripts/drift-ai/README.md`
- focused runner/config tests

## What to do

1. Choose one small surface, preferably a subcommand such as
   `drift:ai config --format text|json [--config <path>]`.
2. Render the effective config after defaults and normalization, plus:
   - config source: default, auto-discovered, or explicit path;
   - repo root used for discovery;
   - default check set and implemented check set;
   - roots and additional source extensions.
3. Keep output read-only. Do not rewrite config files.
4. Ensure foreign-repo invocation still anchors discovery to the target cwd/repo,
   not the tools checkout.
5. Keep the text concise; JSON can carry the full effective config.

## Testing

- Runner tests for default config, auto-discovered config, explicit config,
  invalid config, and text/JSON formatting.
- A small smoke inside the repo if the command is added.

## Out of scope

- Generating `drift-ai.config.json`.
- Validating target-specific semantics beyond the existing parser.
- Adding a full JSON Schema for config.

## Implementation notes (2026-06-04)

Shipped as a `drift:ai config` top-level subcommand, read-only.

- `scripts/drift-ai/config-inspect.ts` — pure inspection model + text/JSON
  formatters. Output carries a `kind: "config-inspection"` discriminant so it is
  never confused with the portable `DriftReport` (`--format json` on a scan) or a
  `kind: "advisory"` envelope. It imports nothing from `packages/shared`, so the
  portable-core constraint (shared context #8) holds.
- `scripts/drift-ai/config-inspect-command.ts` — CLI runner on the shared
  `subcommand-args` parser (`--format`/`--output`/`--config`). Resolves the
  target repo root from the subprocess cwd (`resolveRepoRoot`, i.e.
  `git --show-toplevel`) and loads config exactly as a scan would, so foreign-repo
  invocation anchors discovery to the target, not the tools checkout. Runs no
  checks and writes no config file; a missing explicit `--config` is exit 2.
- Source classification: `explicit` (`--config` passed) / `auto-discovered`
  (`drift-ai.config.json` at the target root) / `default` (no file). Text output
  is concise (source, repo root, roots, source extensions, default/implemented
  checks); `--format json` carries the full effective config.
- Registered in `runner.ts` `TOP_LEVEL_SUBCOMMANDS`, so the README subcommand
  table, `harness.controls.json` (`drift-scope/config`, regenerated doc), and
  the `cli-args` usage all gained the surface — guarded by the existing
  readme-config-parity and harness-controls-parity tests. New files are
  accounted for in `docs/agent_notes/lint-coverage-map.md`.
- Tests: `scripts/drift-ai/config-inspect.test.ts` (model classification,
  text/JSON rendering, end-to-end default/auto-discovered/explicit/missing-config,
  `--help`, and `--output` writes-only-the-report).
