# Pre-commit Typecheck Parallelization Leaf 1

Date: 2026-05-21
Branch: `feature/lint-hardening-pre-commit-perf-exploration`

## Summary

`bun run typecheck` now runs the package project-reference build and scripts
tsconfig check concurrently through `scripts/typecheck.sh`.

The wrapper:

- runs `tsc -b` and `tsc -p tsconfig.scripts.json` in parallel;
- labels streamed stdout/stderr by command so simultaneous failures remain
  readable;
- aggregates both exit statuses before returning non-zero;
- traps `INT`/`TERM`, kills both child TypeScript processes, and reaps the
  output readers.

`typecheck:watch` remains `tsc -b --watch`.

## Timing

Perf report baseline: sequential composite `6.90s`; manual parallel probe
`5.44s`.

This landing: `time bun run typecheck` passed at `real 0m5.126s`, about
`1.77s` faster than the reported sequential composite.

The two checks still write to non-overlapping outputs: `tsc -b` owns package
`dist` and package `tsconfig.tsbuildinfo`, while `tsconfig.scripts.json` stays
`noEmit`.

## Verification

- `time bun run typecheck` — passed, `real 0m5.126s`
- `bun run lint -- --max-warnings=0` — passed
- `bun run lint:shell` — passed
- `bun run lint:config-sensors` — passed
- `bun run lint:ratchet` — passed with zero regressions
- `bun run lint:ratchet:check-baseline` — passed
- `bash scripts/test-lint-changed.sh` — skipped; `scripts/lint-changed.sh`
  semantics were not touched
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed` — passed in 395s
  with the expected soft-budget warning only
