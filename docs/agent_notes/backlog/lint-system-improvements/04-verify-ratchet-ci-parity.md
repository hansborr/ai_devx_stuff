# Verify Ratchet CI Parity

Status: Done
Order: 4
Decision: Parity achieved by task 03

## Context

Default `lint:ratchet` now runs the registry preflight locally. The remaining
parity question from the source review is whether any extra ratchet CI-only pass
should also run in `verify` and `verify:changed`, or be documented as CI-only.

The PR template asks contributors to run `bun run verify:changed`, so that
command should be a reliable preview of CI for lint policy changes unless there
is a clear exception.

## Scope

- Re-audit `.github/workflows/ci.yml`, `scripts/verify.sh`, `package.json`,
  `.github/pull_request_template.md`, and harness controls.
- If `lint:ratchet:check-baseline` remains a CI gate, decide whether
  `verify` and `verify:changed` should run it too.
- If the check intentionally remains CI-only, document the exception in the PR
  template or lint guide.
- Keep local verification runtime reasonable and explain any tradeoff.

## Definition Of Done

Contributors can tell whether `verify:changed` previews every ratchet CI check,
and the command behavior or documentation matches that contract.

## Decision (2026-05-26)

Resolved by task 03's decision. Once `check-baseline` and the separate
`check-registry` step are removed from CI, `verify:changed` already runs the
same two ratchet gates as CI (`lint:ratchet` and `lint:ratchet:zero-baseline`
in `scripts/verify.sh`). No additional local work or documentation exception
needed.

## Verification

- `bun run verify:changed`
- `bash scripts/test-verify.sh` if verify wiring changes
- `bun run format:changed:check` if docs change
