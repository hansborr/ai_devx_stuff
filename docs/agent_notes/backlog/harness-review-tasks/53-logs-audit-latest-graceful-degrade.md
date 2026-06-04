# 53 - logs:audit latest graceful degradation

Status: Parked
Track: Dg (diagnostics)
Size: medium
Depends on: none
Blocks: 23, 24

## Goal

Make a latest-run `logs:audit` mode safe for automation: when no suitable logs
exist, it should no-op with a clear hint instead of failing noisily.

## Background

The older autonomous-agent queue identified `logs:audit:latest` as a ready leaf.
The harness review kept the idea but narrowed it: graceful degradation first,
doctor or Stop integration only after the command is stable and quiet. This must
land before automation asks `harness:audit` or a scheduled lane to discover logs
on its own.

## Seams to touch

- `scripts/logs-audit.ts`
- Existing `logs:audit` tests, or a focused new test file
- `package.json`, if adding a `logs:audit:latest` alias is clearer than a flag
- `docs/ai-harness.md`

## What to do

1. Add `--latest` or a `logs:audit:latest` script that selects the newest
   compatible verify/hook log set.
2. If no compatible logs exist, exit zero with a bounded hint explaining which
   command creates the logs.
3. Preserve hard failures for malformed logs that were explicitly selected by
   path.
4. If task 22 has landed, ensure latest mode can also emit valid diagnostics.
5. Document that automation should use latest mode only after the no-log path is
   proven quiet.

## Testing

- Add tests for newest-log selection, no-log no-op, malformed explicit input,
  and malformed latest input.
- Run the focused `logs:audit` tests.

## Out of scope

- Wiring latest mode into Stop hooks.
- Making no-log state a failure.
- Adding scheduled CI; see task 24.
