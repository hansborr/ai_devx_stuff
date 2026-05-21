# Leaf 41b ShellCheck Floor

Landed: 2026-05-21 on
`feature/lint-hardening-leaf-41b-shellcheck-floor`.

## Scope

Maintained shell inventory now resolves to 82 files:

- `scripts/**/*.sh` excluding generated/vendor locations, with
  `scripts/ai-hooks/*.sh` tracked as its own row in the coverage map
- `.husky/*`, excluding `.husky/_/`
- `.codex/hooks/*.sh`
- `.claude/hooks/*.sh`
- `.devcontainer/*.sh`

Skipped locations remain `.husky/_/`, `node_modules/`, `worktrees/`, and
`.playwright-cli/`.

## Decisions

- Install path A: add pinned npm dev dependency `shellcheck@4.1.0`. This
  keeps setup in the existing Bun install path. The package was checked before
  adoption: current npm metadata showed v4.1.0 published recently, and the
  npm download API showed 123,682 downloads for 2026-05-13 through 2026-05-19.
- Upstream binary pin: `scripts/lint-shell.sh` exports
  `SHELLCHECKJS_RELEASE=v0.11.0` by default so the npm wrapper does not drift to
  a newer ShellCheck release unexpectedly.
- Rule profile: `--external-sources`, `--severity=warning`, no forced shell
  dialect so ShellCheck follows each file's shebang.
- Wiring path A: expose `bun run lint:shell`; full `bun run lint` invokes it
  before ESLint through `scripts/lint.sh`; `bun run lint:changed` invokes it
  through `scripts/lint-changed.sh` on changed maintained shell files, or the
  full maintained shell set when lint-affecting config changes force full lint.

## Findings

Initial ShellCheck pass reported 26 warning/error messages across 18 files,
below the leaf's stop threshold. All findings were handled in source; no
ShellCheck ratchet adapter or baseline file was added.

Fixes were local and mechanical: guarded `cd` calls, removed one unused parsed
value, corrected a command-substitution ambiguity, removed a redundant case
pattern, rewrote test-only env assignments, and added narrow ShellCheck
directives for intentional caller-read globals / allowlist glob matching.

New ShellCheck directives introduced by this leaf:

- `scripts/ai-hooks/process-runner.sh`: file-level `SC2034` for intentional
  `AI_RUN_*` status globals read by hook callers.
- `scripts/eslint-disable-register.sh`: `SC2053` where allowlist entries are
  intentionally interpreted as glob patterns.
- `scripts/suppression-register.sh`: `SC2053` where allowlist entries are
  intentionally interpreted as glob patterns.

## Verification Notes

New smoke coverage lives in `scripts/test-lint-shell.sh`. Existing
`scripts/test-lint-changed.sh`, `scripts/test-scripts.sh`, and
`scripts/test-test-scripts.sh` were updated so changed shell files exercise the
new floor.

Changed-gate source relevance now includes `.claude/hooks/*.sh`,
`.codex/hooks/*.sh`, and `.devcontainer/*.sh`; `.husky/pre-commit` was updated
so those staged paths do not skip the local pre-commit checks.
