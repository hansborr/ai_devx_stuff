# CI Coverage-Map Gate

Status: Done
Order: 1

## Context

Local `verify`, `verify:changed`, and pre-commit can run
`docs:lint-coverage-map:check`, including staged mode for local loops. The
source review found that CI checked generated lint guidance and harness controls
but did not run the full coverage-map gate.

Without the full CI gate, fork PRs and contributors without hooks can merge
stale coverage-map rows, unknown ratchet ids, or ESLint reach gaps.

Overlap: `docs/agent_notes/backlog/lint-reference-readiness/28-lint-coverage-map-readiness.md`
is documentation-focused. This task is CI enforcement.

## Scope

- Re-audit `.github/workflows/ci.yml`, `scripts/verify.sh`, `package.json`,
  and `harness.controls.json` for current coverage-map wiring.
- Add full-tree CI execution of:

  ```sh
  bun run docs:lint-coverage-map:check
  ```

- Place the CI step where it has generated docs and lint config available.
- Preserve local staged behavior for pre-commit and changed verification.
- Update generated harness docs if the manifest changes.

## Definition Of Done

CI rejects stale lint coverage-map rows, unknown ratchet ids, and ESLint reach
gaps with the same full-tree check available locally.

Done 2026-05-26: `.github/workflows/ci.yml` validate now runs
`bun run docs:lint-coverage-map:check` after the lint-ratchet gates.

## Verification

- `bun run docs:lint-coverage-map:check`
- `bun run harness:check` if harness controls change
- `bun run verify:changed`
- Successful CI validate run
