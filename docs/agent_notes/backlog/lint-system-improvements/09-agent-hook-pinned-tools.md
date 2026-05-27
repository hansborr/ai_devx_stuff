# Agent Hook Pinned Tools

Status: Done
Order: 9

## Context

Agent tidy and coverage hooks currently use `npx prettier` or `npx eslint` in
some paths. Reference users expect pinned behavior, and `npx` can resolve
outside the Bun lockfile/toolchain convention.

Post-edit tidy should remain non-blocking. The issue is tool provenance, not
whether tidy failures block the edit loop.

## Scope

- Re-audit `scripts/ai-hooks/`, `.codex/hooks*`, `.claude/settings.json`, and
  hook tests for `npx`, `bunx`, and direct binary usage.
- Choose one pinned no-install convention:
  - `node_modules/.bin/prettier` and `node_modules/.bin/eslint`; or
  - `bunx --no-install prettier` and `bunx --no-install eslint`.
- Apply the same convention to nearby hook/tooling surfaces where supported.
- Audit `bunx commitlint --edit` and document or adjust its convention
  separately if needed.
- Keep hook failures non-blocking where they are non-blocking today.

## Definition Of Done

Agent hooks use the repository-pinned formatter/linter toolchain and do not
fall back to external package resolution.

## Verification

- `bash scripts/ai-hooks/test.sh` or `bash scripts/test-ai-hooks.sh`
- Hook fixture tests for missing dependencies if behavior changes
- `bun run verify:changed`
