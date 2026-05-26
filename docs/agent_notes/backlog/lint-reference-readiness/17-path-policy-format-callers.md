# Path Policy: Format Callers

Status: Done
Order: 17

## Context

Format scripts duplicate some of the same path-surface policy as lint callers,
but their write/check behavior is different enough to migrate separately.

## Prerequisite

Complete `14-path-policy-data-model.md` and
`15-path-policy-shell-interface.md`. Prefer completing
`16-path-policy-lint-callers.md` first so format migration can reuse any caller
patterns that proved stable.

## Scope

- Migrate format scripts where they duplicate shared path data.
- Preserve existing write-mode behavior for `format:changed`.
- Add selection regressions for JSON/JSONC, unsupported files, deleted files,
  and full-scan trigger behavior covered by format callers.
- Do not add the local changed-format check gate in this task; that is covered
  by `19-changed-format-check.md`.

## Definition Of Done

Format path-surface changes consume the shared policy data without changing the
existing formatting commands' write/check semantics.

## Verification

- Relevant format-script tests or shell smokes
- `shellcheck` for changed shell scripts
- `bun run format:changed`
- `bun run test:scripts:changed`
- `bun run verify:changed`
