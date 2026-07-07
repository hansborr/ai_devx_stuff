# 10 — Reject option-looking values in `logs:audit` / `harness:audit` arg readers

Status: Ready
Track: T (tooling) · Priority: P1 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/logs-audit.ts:86` — `readOptionValue` takes `argv[index + 1]` as the
  option's value with no check that it is not itself an option, so
  `--file --latest` consumes `--latest` as the file path.
- `scripts/harness-audit.ts:120` — same pattern; `--output --format` consumes
  `--format` as the output path.
- `scripts/harness-emit-envelope.ts:35` — already implements the stricter
  pattern (rejects missing/`--*` values); use it as the reference shape.

## Do

Extract the stricter option-value reader (missing value, empty value, and
`--*`-prefixed value all fail with a usage error) into a small shared helper
and adopt it in `logs-audit.ts` and `harness-audit.ts`. Keep exit codes and
usage text conventions intact. TDD: add the `--flag --other-flag` and
trailing-flag cases to both test files first.

## Verify

```
bun run test:scripts:file -- scripts/logs-audit/logs-audit.test.ts scripts/harness/harness-audit.test.ts
```

## Acceptance

`bun run logs:audit -- --file --latest` (and the harness-audit equivalent)
fails with an actionable usage error instead of treating the flag as a path;
existing behavior for `--opt value` and `--opt=value` is unchanged.
