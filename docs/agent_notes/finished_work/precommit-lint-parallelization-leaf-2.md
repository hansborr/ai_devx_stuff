# Pre-commit Lint Parallelization Leaf 2

Date: 2026-05-21
Branch: `feature/lint-hardening-pre-commit-perf-exploration`

## Summary

`bun run lint` now runs ShellCheck, config sensors, and ESLint concurrently
through a shared bash helper at `scripts/parallel-runner.sh`.

The helper:

- labels streamed stdout/stderr by substep;
- aggregates every child exit before returning non-zero;
- reports each failed substep as `<context>: <label> failed with exit N`;
- traps `INT`/`TERM`, kills child processes, reaps output readers, and cleans
  up its FIFO temp directory.

`scripts/lint.sh` still strips one leading `--` separator and forwards the
remaining args only to ESLint. ESLint cache location and the default
`--max-warnings=0` are unchanged.

`scripts/lint-changed.sh` uses the same fan-out for missing-base full fallback,
lint-affecting config full escalation, and the final changed-mode ShellCheck /
config sensor / ESLint pass.

## Timing

Perf report baseline: sequential composite `bun run lint` at `11.37s`
(ShellCheck `5.99s`, config sensors `2.29s`, warm ESLint `1.76s`).

This landing: `time bun run lint` passed at `real 0m6.158s`, about `5.21s`
faster than the reported sequential composite.

## Verification

- `time bun run lint` — passed, `real 0m6.158s`
- `bun run lint -- --max-warnings=0` — passed
- `bun run lint:changed` — passed through the full-lint escalation path
- `bun run lint:shell` — passed
- `bun run lint:config-sensors` — passed
- `bun run lint:ratchet` — passed with zero regressions
- `bun run lint:ratchet:check-baseline` — passed
- `bash scripts/test-lint-changed.sh` — passed
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed` — passed in 409s with
  the expected soft-budget warning only
