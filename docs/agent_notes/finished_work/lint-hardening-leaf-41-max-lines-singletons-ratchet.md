# Leaf 41 Batch 8: Max-Lines Singleton Ratchets

Date: 2026-05-20

## Summary

Added three sibling `local/max-lines` ratchets for the remaining one-file
script scopes that were still unfloored for max-lines:

- `ratchet/local-max-lines-code-intel` for `scripts/code-intel.ts`: initial
  baseline count 0 (`items: {}`).
- `ratchet/local-max-lines-generate-harness-controls` for
  `scripts/generate-harness-controls.ts`: initial baseline count 1.
- `ratchet/local-max-lines-logs-audit` for `scripts/logs-audit.ts`: initial
  baseline count 1.

Each entry uses explicit file literals, default local source/minimal-ts parser
behavior, and the same rule options as the existing `local/max-lines`
ratchets: `{ max: 300, skipBlankLines: true, skipComments: true }`.

The coverage-map rows for all three scripts now list the new ratchet ids and
remain `ratcheted + proposed` for the follow-on lint families. Harness controls
were updated so the generated control docs include the three new ratchets.

## Zero-Finding Probe

`ratchet/local-max-lines-code-intel` had an empty initial baseline, so it was
probed before landing. A temporary in-scope array was appended to
`scripts/code-intel.ts` to push the file past 300 effective lines.
`bun run lint:ratchet` reported the regression under
`ratchet/local-max-lines-code-intel` for `scripts/code-intel.ts`; the probe was
then reverted and `bun run lint:ratchet:update` confirmed the real baseline.

No probe was needed for `ratchet/local-max-lines-generate-harness-controls` or
`ratchet/local-max-lines-logs-audit` because both produced non-empty baseline
items.

## Exit Paths

- `ratchet/local-max-lines-code-intel`: drain to zero in Leaf 31 while the
  facade rewrite also addresses the remaining `consistent-type-imports`
  findings.
- `ratchet/local-max-lines-generate-harness-controls`: drain to zero in Leaf
  30 alongside the planned `generate-harness-controls` split.
- `ratchet/local-max-lines-logs-audit`: drain to zero in Leaf 40 when the
  logs-audit entrypoint moves under normal lint coverage.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run typecheck`
