# Leaf 41d ShellCheck System Binary Follow-up

Landed: 2026-05-21 on
`feature/lint-hardening-leaf-41d-shellcheck-apt-swap`.

## Change

ShellCheck now resolves through `command -v shellcheck` and uses the system
binary on `PATH` (`apt install shellcheck`). In this container the resolved
binary is `/usr/bin/shellcheck`, reporting ShellCheck 0.9.0. This is older than
the npm wrapper's upstream ShellCheck 0.11.0, but the smoke fixtures still
produce the expected findings.

The npm wrapper install path was removed from `scripts/lint-shell.sh`, from the
smoke test, and from `package.json` / `bun.lock`. `bun install` no longer pulls
`shellcheck@4.1.0`, and `node_modules/.bin/shellcheck` is absent after install.

`actionlint`, `taplo`, and `hadolint` remain on their pinned npm wrappers
because they are not available from the Debian/Ubuntu main repos.

## Diagnostics

When shellcheck is missing:

- `scripts/lint-shell.sh` fails with an `apt install shellcheck` hint.
- `doctor.sh` warns with the same hint and continues.

No ShellCheck source coverage changed.

## Verification

Verification completed with ShellCheck 0.9.0:

- `bun install` and confirmed `node_modules/.bin/shellcheck` is absent
- `bun run lint:shell`
- `bash scripts/test-lint-shell.sh`
- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bash scripts/test-verify.sh`
- `bash scripts/doctor.sh` (shellcheck section passed with
  `/usr/bin/shellcheck`, version 0.9.0; unrelated existing report-only WARNs
  remained)
- `bun run typecheck`
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`
