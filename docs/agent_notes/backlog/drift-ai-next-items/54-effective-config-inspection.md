# 54 - effective config inspection

Status: Parked
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
