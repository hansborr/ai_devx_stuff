# Leaf 41 Metric Alignment Batch 2: Complexity Severity

Date: 2026-05-21

## Summary

Converted the three core `complexity` ratchets from `message-count` to
`complexity-severity`:

- `ratchet/core-complexity-codemods`
- `ratchet/core-complexity-drift-ai`
- `ratchet/core-complexity-eslint-rules`

The runner parses ESLint's core complexity diagnostic message and stores
`{ count, maxComplexity, perFunction }` baseline items. Count semantics still
catch newly over-complex functions. Severity comparison also checks max
complexity, exact `line + nodeType + label` matches when available, and the
sorted descending complexity vector as a movement backstop.

Batch 1's metric-aware shape needed a small helper extraction:
`scripts/lint-ratchet-metrics.ts` now owns metric parser, formatting,
validation, and complexity comparison helpers. This kept
`scripts/lint-ratchet.ts` and `scripts/lint-ratchet-baseline.ts` below their
Batch 1 `effective-line-count` ceilings; the migrated runtime values are
`scripts/lint-ratchet.ts` 831 and `scripts/lint-ratchet-baseline.ts` 839.

## Audit

The required pre-migration audit was re-run by refreshing ratchet configs with
`bun run lint:ratchet`, then running ESLint through each generated
`ratchet/core-complexity-*` config and parsing
`Function '<name>' has a complexity of N` diagnostics.

Every generated post-migration value matches the audit exactly; no
`--allow-worse` was used.

| Ratchet ID | File | maxComplexity | perFunction vector |
| --- | --- | ---: | --- |
| `ratchet/core-complexity-codemods` | `scripts/codemods/concurrency-guard.ts` | 15 | `[15, 13]` |
| `ratchet/core-complexity-codemods` | `scripts/codemods/expand-barrel.ts` | 18 | `[18, 16, 16, 13, 12, 12, 12, 11]` |
| `ratchet/core-complexity-codemods` | `scripts/codemods/lib/trpc-shared-schema.ts` | 22 | `[22, 18, 13, 13, 13, 12, 11]` |
| `ratchet/core-complexity-codemods` | `scripts/codemods/structured-logging-fix.ts` | 18 | `[18, 15, 11]` |
| `ratchet/core-complexity-codemods` | `scripts/codemods/trpc-shared-input.ts` | 15 | `[15, 12]` |
| `ratchet/core-complexity-codemods` | `scripts/codemods/trpc-shared-output.ts` | 21 | `[21, 11]` |
| `ratchet/core-complexity-drift-ai` | `scripts/drift-ai.ts` | 49 | `[49, 18, 16, 11]` |
| `ratchet/core-complexity-drift-ai` | `scripts/drift-ai/comments.ts` | 21 | `[21]` |
| `ratchet/core-complexity-drift-ai` | `scripts/drift-ai/duplicates.ts` | 14 | `[14]` |
| `ratchet/core-complexity-drift-ai` | `scripts/drift-ai/ghost-files.ts` | 13 | `[13, 12]` |
| `ratchet/core-complexity-drift-ai` | `scripts/drift-ai/suppressions.ts` | 17 | `[17, 15]` |
| `ratchet/core-complexity-eslint-rules` | `eslint-rules/strict-trpc-input.js` | 15 | `[15]` |
| `ratchet/core-complexity-eslint-rules` | `eslint-rules/structured-logging.js` | 11 | `[11]` |
| `ratchet/core-complexity-eslint-rules` | `eslint-rules/type-assertion-boundary.js` | 11 | `[11]` |

## Tests

Added unit coverage for:

- parsing core complexity messages and throwing `ConfigError` on an
  unparseable message;
- strict parsing requiring `maxComplexity` and `perFunction` on migrated
  `complexity-severity` items, while structural update parsing accepts
  count-only entries;
- equal-count complexity growth, vector growth, and complexity shrinkage;
- `decideLintRatchetUpdate` refusing complexity regressions unless
  `--allow-worse --reason` is supplied.

Added a smoke fixture where one function starts over the complexity max at
complexity 3, grows to complexity 4, keeps exactly one ESLint diagnostic, and
fails both default `lint:ratchet` and `lint:ratchet:check-baseline` with
complexity-growth detail. The fixture also proves shrinking from 4 to 3 reports
an improvement.

## Verification

- `bun run lint:ratchet:update`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- baseline-audit gate against the re-audited vectors above
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run verify:changed`

## Closure

Batch 1 and Batch 2 are both done. The metric-alignment plan moved from
`docs/agent_notes/in_progress/` to `docs/agent_notes/finished_work/`. This was
ceiling-integrity work, not a drain; future complexity cleanup should happen in
separate named leaves.
