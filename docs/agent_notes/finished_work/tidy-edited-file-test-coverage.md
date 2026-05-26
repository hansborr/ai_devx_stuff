# Tidy Edited File Test Coverage

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Expanded `scripts/ai-hooks/test.sh` coverage for
`scripts/ai-hooks/tidy-edited-file.sh`.

Added/strengthened coverage for:

- a `.ts` fixture that starts unformatted, runs through the stubbed Prettier
  and ESLint path, reports success, and has its fixture content rewritten by
  the formatter stub;
- missing files and unsupported paths, including `node_modules/foo.ts`, with
  valid hook JSON and no `npx` invocation;
- Prettier and ESLint failures staying non-blocking with parseable JSON;
- ESLint output truncation, including an exact 30-line bounded-output
  assertion;
- no-file and malformed-payload continue branches emitting parseable
  `{"continue":true}` JSON;
- Codex `tool_name: "apply_patch"` fixtures extracting paths from
  `tool_input.command`, deduping repeated patch paths, and ignoring
  `tool_input.file_path`.

## Verification

- `bash scripts/test-ai-hooks.sh`
- `bun run test:scripts:changed`
