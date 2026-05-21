# Leaf 41c Actionlint Wrapper Follow-Up

Landed: 2026-05-21 on
`feature/lint-hardening-leaf-41c-config-sensors`.

## Review Fix

Codex review P2 against `aca65e31` noted that the pinned
`@tktco/node-actionlint` wrapper slices argv but calls `run(args[0])`, so only
the first positional workflow path is linted.

`scripts/lint-config-sensors.sh` now invokes actionlint once per collected
workflow file, echoes each path before linting it, accumulates any failures,
and returns nonzero after all workflows have been checked. This closes the
latent gap where a valid first workflow could let an invalid later workflow
pass the config-sensor floor.

## Regression

`scripts/test-lint-config-sensors.sh` now creates a fixture repo with a valid
first workflow and an invalid second workflow (`zz-bad.yml`) and asserts that
the run fails while reporting both the second workflow path and the invalid
`github.nope` expression. The case would fail before the caller-side loop.

## Adjacent Tool Check

The other config-sensor runners were checked and left unchanged:

- `yamllint --help` accepts `[FILE_OR_DIR ...]`.
- `taplo fmt --help` and `taplo lint --help` accept `[FILES]...`.
- `hadolint --help` accepts `[DOCKERFILE...]`.

## Verification

The requested ordered verification pass completed:

- `bash scripts/test-lint-config-sensors.sh`
- `bun run lint:config-sensors`
- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bash scripts/test-verify.sh`
- `bun run typecheck`
