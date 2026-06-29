# 23 - harness:audit fusion consumer

Status: Superseded -> drift-ai-next-items 13 (harness:audit fusion consumer, Done)
Track: Dg (diagnostics)
Size: medium
Depends on: 11, 20, 21, 22, 53
Blocks: 24

## Goal

Add a `harness:audit` command that consumes shared diagnostics envelopes from
`drift:ai` and `logs:audit` and renders one bounded report.

## Background

The promising part of the external harness research was not a new AI evaluator;
it was a boring diagnostics spine: several deterministic tools emit a shared
shape, then one consumer summarizes them. This task builds the first consumer
after both producers exist.

## Seams to touch

- `package.json`
- A new script under `scripts/`, for example `scripts/harness-audit.ts`
- Tests beside the new script
- `docs/ai-harness.md`
- `scripts/test-test-scripts.sh`, only if changed-file selection needs a smoke

## What to do

1. Add `bun run harness:audit` with `--format text|json` and optional
   `--output <path>` if that matches nearby script patterns.
2. Run or read diagnostics for:
   - `drift:ai` current-scope report-only diagnostics;
   - `logs:audit` diagnostics, using latest/graceful-degrade mode from task 53
     when the command is responsible for discovering logs.
3. Validate every envelope with `harnessDiagnosticsSchema`.
4. Render a concise text report grouped by tool, with clear distinction between
   findings, skipped checks, and infrastructure failures.
5. Keep report-only semantics: findings do not fail the command; malformed
   envelopes and subprocess errors do.
6. Treat a `logs:audit` exit caused only by valid findings as report data when a
   valid diagnostics envelope was produced; do not collapse it into a subprocess
   infrastructure failure.
7. Document that this is a human/CI artifact generator, not an edit-loop gate.

## Testing

- Unit-test the formatter with fixture envelopes for clean, finding, skipped,
  and malformed-input cases.
- Add a CLI smoke with stubbed child commands or fixture files.
- Run the focused new test file and any changed script smoke.

## Out of scope

- GitHub Actions scheduling.
- PR comments.
- Promoting findings to failures.
- Adding new drift checks.
