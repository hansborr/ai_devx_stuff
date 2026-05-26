# Lint Reference Readiness: Path Policy Format Callers

Completed 2026-05-25.

- `format:changed` now routes changed path candidates through
  `scripts/path-policy-query.ts format-check-candidate` while preserving
  `prettier --write --ignore-unknown`, existing-file filtering, dedupe, and the
  missing-base full-repo fallback.
- Added `test-format-changed` shell smoke coverage for JSON/JSONC candidates,
  unsupported files, unstaged tracked files, deleted files, and missing-base
  full-repo write mode.
- Added the format smoke to script-smoke selection and included its path-policy
  query dependencies in `scripts/path-policy-smoke-subjects.ts`.

Verification:

- `shellcheck scripts/format-changed.sh scripts/test-format-changed.sh scripts/test-scripts.sh scripts/test-test-scripts.sh`
- `bash scripts/test-format-changed.sh`
- `bun test scripts/path-policy-query.test.ts scripts/path-policy.test.ts`
- `bash scripts/test-test-scripts.sh`
- `bun run format:changed`
- `bun run test:scripts:changed`
- `bun run verify:changed`
