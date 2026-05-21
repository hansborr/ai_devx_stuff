# Leaf 18 Fix Pass

Date: 2026-05-17

Scope:

- `drift:ai harness-freshness` now skips backtick-quoted paths matched by
  `git check-ignore --stdin -v`, so generated artifacts under gitignored
  locations such as `reports/mutation/` do not report stale-path findings on
  clean checkouts.
- `sensor:blob-size --block` now exits nonzero only when at least one finding
  has `severity: "block"`; warn-threshold files and allowlist-format warnings
  remain report-only in blocking mode.

Tests/verification:

- Added harness-freshness coverage for ignored missing paths and preserved
  missing-path findings for non-ignored references.
- Added blob-size coverage for warn-only versus block-severity `--block`
  behavior.
- `bun run vitest run scripts/drift-ai/harness-freshness.test.ts scripts/sensor-blob-size.test.ts`
  passed.
- `bun run drift:ai harness-freshness` passed with `reports/mutation/` present
  and after moving that directory aside.
- `bun run lint -- --max-warnings=0`, `bun run typecheck`, and
  `bun run sensor:blob-size` passed.
