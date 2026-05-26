# Path Policy Smoke Subject Sync

Completed 2026-05-25.

- Synced the bash `SMOKE_SUBJECTS` path-policy dependencies for
  `test-verify`, `test-lint-changed`, `test-lint-shell`,
  `test-lint-config-sensors`, `test-lint-agent-changed`, and
  `test-verify-metadata` with the TypeScript smoke-subject source.
- Added `scripts/path-policy-smoke-subjects.ts` to the `test-format-changed`
  subject list in both `scripts/path-policy-smoke-subjects.ts` and
  `scripts/test-scripts.sh`.
- Updated `scripts/test-test-scripts.sh` so a `scripts/path-policy-query.ts`
  change expects all path-policy-query dependent smokes.
