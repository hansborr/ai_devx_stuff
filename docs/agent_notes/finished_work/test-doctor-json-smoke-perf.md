# test-doctor-json smoke perf

Date: 2026-05-25

## Summary

`scripts/test-doctor-json.sh` no longer pays for three live full-repo
`doctor.sh` runs. The JSON envelope, default prose surface, and
`harness:check` failure contract now run `doctor.sh` inside a tiny synthetic
git fixture with stubbed expensive subcommands:

- `worktree-db.sh`, `db-status.sh`, suppression register scripts, and
  migration safety live under the fixture root.
- A fake `bun` handles `drift:ai harness-freshness`, `sensor:knip`,
  `sensor:blob-size`, and `harness:check`.
- Unmatched `bun` calls still delegate to the real binary, so the test keeps
  using the real `scripts/harness-emit-envelope.ts` and shared schema.

The fixture includes a realistic migration-safety warning finding, an
eslint-disable register warning, and a drift freshness warning. The existing
BLOCK-prefix fixture still isolates `sensor:blob-size` so `BLOCK:` remains
covered as JSON warn severity.

## Timing

- Before: user-reported `~58-59s`; local instrumented run spent `18.717s` in
  live `doctor --json`, `18.340s` in live default doctor, and `18.137s` in the
  harness-failure doctor run (`~55.8s` across the measured test sections).
- After: `time -p bash scripts/test-doctor-json.sh` reported `real 1.30`.

## Verification

- `time -p bash scripts/test-doctor-json.sh`
- `bash scripts/test-doctor-json.sh`
- `bun run test:scripts:changed`
- `bun run verify:changed`
