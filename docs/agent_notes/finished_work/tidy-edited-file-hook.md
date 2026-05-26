# Shared Tidy Edited File Hook

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Added `scripts/ai-hooks/tidy-edited-file.sh`, a shared post-edit hook script
for Claude/Codex adapters. The script handles Claude
`tool_input.file_path` payloads and Codex `tool_name: "apply_patch"` payloads
by parsing patch paths from `tool_input.command`.

The hook:

- skips missing/deleted files, paths outside the repo, `.git`, `node_modules`,
  non-regular files, and binary files;
- runs `npx prettier --write --ignore-unknown "$file"` for supported text
  files;
- runs `npx eslint --fix --no-warn-ignored "$file"` for JS/TS/JSON-like files;
- emits non-blocking `PostToolUse` additional context for success, skip, and
  formatter/linter errors;
- truncates long command output and supports `SKIP_TIDY_HOOK=1`.

Adapter wiring landed later in
`finished_work/tidy-edited-file-adapters.md`.

## Verification

- `shellcheck scripts/ai-hooks/tidy-edited-file.sh`
- `bash scripts/test-ai-hooks.sh`
- Direct missing-file smoke:
  `printf '{"tool_name":"Edit","tool_input":{"file_path":"scripts/ai-hooks/no-such-file-for-tidy-test.ts"}}' | scripts/ai-hooks/tidy-edited-file.sh | jq -c .`
