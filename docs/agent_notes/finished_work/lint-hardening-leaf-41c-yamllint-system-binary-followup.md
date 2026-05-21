# Leaf 41c Yamllint System Binary Follow-up

Landed: 2026-05-21 on
`feature/lint-hardening-leaf-41c-config-sensors`.

## Change

Yamllint now resolves through `command -v yamllint` and uses the system binary
on `PATH` (`apt install yamllint`, version >=1.29.0). In this container the
resolved binary is `/usr/bin/yamllint`, reporting `yamllint 1.29.0`.

The repo-local Python venv install path was removed from
`scripts/lint-config-sensors.sh` and from the smoke test. `bun install` no
longer has any yamllint setup work to perform. The `.yamllint.yml` rule profile
did not need changes for yamllint 1.29.0.

`actionlint`, `taplo`, and `hadolint` remain on their pinned npm wrappers
because they are not available from the Debian/Ubuntu main repos.

## Diagnostics

When yamllint is missing:

- `scripts/lint-config-sensors.sh` fails with an `apt install yamllint` hint.
- `doctor.sh` warns with the same hint and continues.

No macOS/Homebrew contributor workflow was found in the repo, so no brew hint
was added.

## Verification

The requested ordered verification pass completed:

- `bun run lint:config-sensors`
- `bash scripts/test-lint-config-sensors.sh`
- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bash scripts/test-verify.sh`
- `bash scripts/doctor.sh` (yamllint section passed with `/usr/bin/yamllint`,
  `yamllint 1.29.0`; unrelated existing report-only WARNs remained)
- `bun run typecheck`
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`

`verify:changed` was rerun after staging the intended source-relevant files, as
the first attempt correctly stopped on its staged-content guard.
