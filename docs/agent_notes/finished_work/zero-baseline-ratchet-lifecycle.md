# Zero-Baseline Ratchet Audit Automation

Date: 2026-05-25

## Summary

Added report-first audit automation for drained lint ratchets:
`bun run lint:ratchet:zero-baseline`.

The command reads the committed baseline, finds ratchets with zero findings,
expands their registry globs against `git ls-files`, checks normal ESLint's
resolved config for the same rule/options, and prints a markdown report with
normal-lint coverage status plus the next lifecycle action.

Registry entries now support optional `zeroBaselineDisposition` metadata for
zero ratchets that intentionally remain ratchet-only or have a named promotion
exit path. Registry validation checks the metadata shape when present.

This did not resolve the lifecycle decisions themselves. Current audit output:
44 zero-baseline ratchets, 8 normal-lint error-covered rows, 0 documented
dispositions, and 36 rows still needing lifecycle action. Cleanup is parked in
`docs/agent_notes/backlog/lint-followups/43-zero-baseline-lifecycle-cleanup.md`.

Review follow-up tightened the command before landing: missing baselines now
raise the same `ConfigError` as the normal ratchet modes, the audit uses full
committed-baseline validation instead of structural-only parsing, overlapping
documented `normal-error` rows no longer undercount `Needs lifecycle action`,
and `git ls-files` collection is shared with `lint:ratchet:check-registry`.

The hadolint cache lock in `scripts/lint-config-sensors.sh` stayed in this
follow-up because removing it made the pre-commit hook fail reproducibly with
`spawn ETXTBSY` when `lint` and script smokes overlapped on the npm wrapper's
shared downloaded binary.

## Files

- `scripts/lint-ratchet-zero-baseline.ts`
- `scripts/lint-ratchet/git-tracked-files.ts`
- `scripts/lint-ratchet/ratchet-globs.ts`
- `scripts/lint-ratchet/zero-baseline-disposition.ts`
- `scripts/lint-ratchet/zero-baseline-types.ts`
- `scripts/lint-ratchet-config.ts`
- `scripts/lint-config-sensors.sh`
- `scripts/test-lint-config-sensors.sh`
- `docs/guides/lint-ratchet.md`
- `harness.controls.json`

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun test scripts/lint-ratchet-output.test.ts scripts/lint-ratchet-zero-baseline.test.ts scripts/lint-ratchet-check-registry.test.ts scripts/lint-ratchet-summary.test.ts`
- `bash scripts/test-lint-ratchet.sh`
- `bash scripts/test-test-scripts.sh`
- `bun run docs:harness-controls:check`
- `bunx prettier --check --ignore-unknown $(git diff --name-only main) $(git ls-files --others --exclude-standard)`
- `bun run typecheck`
- `bun run lint -- --max-warnings=0`
- `bun run test:changed`
- `bun run test:scripts:changed`
- `git diff --check main`
