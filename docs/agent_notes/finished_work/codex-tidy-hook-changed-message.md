# Codex tidy hook changed-file message

## Summary

`scripts/ai-hooks/tidy-edited-file.sh` now compares edited file content before
and after a successful Prettier/ESLint tidy pass. It emits a single brief line
only when content changes:

```text
tidy-edited-file: <path> tidied
```

Already-tidy successful runs still return bare continue JSON with no additional
context.

## Coverage

- Claude-style `Edit` payload that pinned Prettier rewrites.
- Codex `apply_patch` payload that pinned Prettier rewrites.
- Already-tidy TypeScript payload where Prettier and ESLint both run.
- Already-tidy Markdown payload where only Prettier runs.

## Verification

- `scripts/ai-hooks/test.sh`
