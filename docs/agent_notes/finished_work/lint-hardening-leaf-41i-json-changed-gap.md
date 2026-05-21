# Leaf 41i: JSON Changed/Pre-Commit Gap

Date: 2026-05-21

## Gap

Full `bun run lint` already covered maintained JSON through the `@eslint/json`
blocks in `eslint.config.js`, but the changed/pre-commit path had two gaps:

- `scripts/lint-changed.sh` filtered ESLint inputs to JS/TS extensions only,
  so staged JSON edits were dropped before ESLint could report JSON rules such
  as `json/no-duplicate-keys`.
- `.husky/pre-commit` used a curated source-relevance regex that missed five
  full-linted JSON config files, so pure staged edits to those paths skipped
  the pre-commit gate.

## Fix

- Extended the `lint:changed` per-file ESLint selector to include `*.json` and
  `*.jsonc`.
- Kept JSON out of the full-lint escalation trigger. Per-file ESLint is enough
  for ordinary JSON edits and avoids turning every JSON change into full lint.
- Added only the missing full-linted JSON config paths to the pre-commit
  source allowlist:
  - `.claude/settings.json`
  - `.codex/hooks.json`
  - `.devcontainer/devcontainer.json`
  - `.playwright/cli.config.json`
  - `drift-ai.config.json`
- Mirrored those paths in the shared changed-gate relevance helper so
  `verify:changed` and pre-commit unstaged-drift checks agree with the hook
  dispatch allowlist.

## Enumeration

Command used:

```bash
git ls-files | rg '\.json$' | rg -v 'node_modules|^worktrees/'
```

Result: 115 tracked JSON files. `bunx eslint --print-config <path>` showed 25
JSON paths with a non-`undefined` ESLint config.

Added to the hook regex because they were full-linted but not gated:

- `.claude/settings.json`
- `.codex/hooks.json`
- `.devcontainer/devcontainer.json`
- `.playwright/cli.config.json`
- `drift-ai.config.json`

Not added:

- `packages/server/src/seed/data/*.json`: ESLint reaches these files and the
  existing `packages/` pre-commit source pattern already gates them. They do
  not need JSON-specific hook entries.
- `scripts/codemods/fixtures/**/*.json`: `--print-config` returns
  `undefined`; these are codemod fixtures and remain outside JSON lint.
- `scripts/codemods/tsconfig.json` and
  `scripts/drift-ai/fixtures/jscpd-report.basic.json`: also `undefined` under
  current ESLint ignores and do not need hook additions.

After the hook update, a re-check found no ESLint-reached JSON path missing the
pre-commit source regex.

## Regression Coverage

- `scripts/test-lint-changed.sh` now stages
  `packages/server/src/data/duplicate.json` with a duplicate key, runs
  `scripts/lint-changed.sh` through real ESLint, and asserts a non-zero exit
  plus `json/no-duplicate-keys` output.
- `scripts/test-dependency-freshness.sh` now proves the pre-commit hook runs
  the lint gate for each of the five newly added JSON paths.
- `scripts/test-verify.sh` now covers the same five paths in the shared
  changed-gate unstaged-drift helper.

## Verification

Targeted preflight passed:

- `bash scripts/test-lint-changed.sh`
- `bash scripts/test-verify.sh`
- `bash scripts/test-dependency-freshness.sh`

Full requested verification was run before commit; see the commit context for
the command list.
