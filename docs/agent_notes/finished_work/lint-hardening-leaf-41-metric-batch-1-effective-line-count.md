# Leaf 41 Metric Alignment Batch 1: Effective Line Count

Date: 2026-05-21

## Summary

Converted every current `local/max-lines-*` ratchet from `message-count` to
`effective-line-count`:

- `ratchet/local-max-lines`
- `ratchet/local-max-lines-code-intel`
- `ratchet/local-max-lines-codemods`
- `ratchet/local-max-lines-drift-ai`
- `ratchet/local-max-lines-generate-harness-controls`
- `ratchet/local-max-lines-logs-audit`
- `ratchet/local-max-lines-runtime`

The runner now parses the effective line count from the `local/max-lines`
diagnostic message and writes `{ count, lines }` baseline items for over-limit
files. Count semantics still catch new over-limit files; `lines` catches an
already-over-limit file getting longer while ESLint still emits one diagnostic.
Default and check-baseline modes require `lines` for migrated ratchets.
Structural update mode tolerates old count-only entries long enough to perform
the one-shot migration, while still refusing count or line regressions unless
`--allow-worse --reason` is supplied.

## Audit

The required pre-migration audit was re-run before implementation by refreshing
ratchet configs with `bun run lint:ratchet`, then running ESLint through each
generated `ratchet/local-max-lines-*` config and reading the interpolated
`This file has <N> effective lines` value.

Every generated post-migration `lines` value is at or below the audited
ceiling; no `--allow-worse` was used.

| Ratchet ID | File | Audit ceiling | Migrated lines |
| --- | --- | ---: | ---: |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/concurrency-guard.ts` | 804 | 804 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/expand-barrel.ts` | 1026 | 1026 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/lib/trpc-shared-schema.ts` | 783 | 783 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/structured-logging-fix.ts` | 491 | 491 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/trpc-shared-input.ts` | 346 | 346 |
| `ratchet/local-max-lines-codemods` | `scripts/codemods/trpc-shared-output.ts` | 353 | 353 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai.ts` | 1060 | 1060 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/config.ts` | 466 | 466 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/duplicates.ts` | 422 | 422 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/ghost-files.ts` | 579 | 579 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/harness-freshness.ts` | 332 | 332 |
| `ratchet/local-max-lines-drift-ai` | `scripts/drift-ai/suppressions.ts` | 420 | 420 |
| `ratchet/local-max-lines-generate-harness-controls` | `scripts/generate-harness-controls.ts` | 386 | 386 |
| `ratchet/local-max-lines-logs-audit` | `scripts/logs-audit.ts` | 685 | 685 |
| `ratchet/local-max-lines-runtime` | `scripts/harness-check.ts` | 441 | 441 |
| `ratchet/local-max-lines-runtime` | `scripts/lint-ratchet-baseline.ts` | 857 | 840 |
| `ratchet/local-max-lines-runtime` | `scripts/lint-ratchet.ts` | 846 | 832 |

`ratchet/local-max-lines` and `ratchet/local-max-lines-code-intel` emitted no
current `local/max-lines` diagnostics and therefore have no committed items.

## Tests

Added unit coverage for:

- strict parsing requiring `lines` on migrated `effective-line-count` items,
  while structural update parsing accepts count-only entries;
- equal-count line growth producing an `increased-lines` regression;
- equal-count line shrinkage producing a `lower-lines` improvement;
- `decideLintRatchetUpdate` refusing line regressions unless
  `--allow-worse --reason` is supplied.

Added a smoke fixture where a file starts over the max-lines limit at four
effective lines, grows to five effective lines, keeps exactly one ESLint
diagnostic, and fails both default `lint:ratchet` and
`lint:ratchet:check-baseline` with line-growth detail. The fixture also proves
shrinking from five to four effective lines reports an improvement.

## Verification

- `bun run lint:ratchet:update`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- baseline-audit gate against the re-audited ceilings above
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run verify:changed`

## Exit Path

This batch is ceiling-integrity work, not a drain. The migrated
`local/max-lines-*` baselines should drain only through normal file splits or
future cleanup leaves. The next named metric-alignment item is Batch 2:
`complexity-severity` for the three `core-complexity-*` ratchets.
