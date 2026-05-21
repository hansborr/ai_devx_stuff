# Leaf 41c Hadolint Prime Follow-up

Date: 2026-05-21

Branch: `feature/lint-hardening-leaf-41c-config-sensors`

## Summary

Fixed Codex review P2 against the Leaf 41c probe branch
(`aca65e31`, `4d887f0a`, `517c1261`): fresh installs could fail the first
`bun run lint:config-sensors` / `bun run lint` run because `hadolint@0.4.2`
lazily downloaded `hadolint-2.14.0` into its package cache with non-executable
mode, then immediately tried to spawn it.

`scripts/lint-config-sensors.sh` now primes the local npm wrapper with
`--version` only when the expected cache binary is missing, swallows that
first-run wrapper failure, chmods the downloaded binary, and then returns the
wrapper for the real invocation. Existing executable-cache, `MUSI_HADOLINT_BIN`,
and system `hadolint` behavior stay unchanged.

The smoke test had masked the production bug by pre-downloading/chmodding the
cache binary and injecting it through `MUSI_HADOLINT_BIN`. It now links the
fixture repo to the real `node_modules`, clears the hadolint cache before the
clean fixture, includes the minimal package metadata the wrapper expects, and
lets the production wrapper path handle priming.

`@tktco/node-actionlint@1.6.0` and `@taplo/cli@0.7.0` were checked for an
analogous first-run executable-cache issue. `node-actionlint` ships local WASM
read by Node, and Taplo ships a bundled executable JS/WASM CLI; neither lazily
downloads a native executable, so no changes were made to those runners.

## Verification

- `rm -f node_modules/.bun/hadolint@*/node_modules/hadolint/.cache/hadolint/hadolint-*`
  then `bun run lint:config-sensors`
- `bash scripts/test-lint-config-sensors.sh`
- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bash scripts/test-verify.sh`
- `bun run typecheck`
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`
