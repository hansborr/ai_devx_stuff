# trpc-shared codemod ratchet drain

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Drained the trpc-shared slice of the codemod ratchets:

- `ratchet/core-complexity-codemods`: `24 -> 16`.
- `ratchet/local-max-lines-codemods`: `3 -> 2`.
- Total `lint:ratchet` current findings: `27 -> 18`.

The drained entries were:

- `scripts/codemods/lib/trpc-shared-schema.ts`: 7 complexity findings and
  1 max-lines finding.
- `scripts/codemods/trpc-shared-output.ts`: 1 complexity finding.

## Implementation

- `scripts/codemods/lib/trpc-shared-schema.ts` is now a stable re-export
  facade.
- Shared codemod helper logic moved into focused sibling modules for
  candidates, identifiers, imports, paths, types, validation, and writes.
- `scripts/codemods/trpc-shared-output.ts` argument parsing was split into
  small scanner and mode-finalization helpers.
- Existing import surface through `./lib/trpc-shared-schema.js` remains
  preserved for callers.

## Verification

- `bun test scripts/codemods/trpc-shared-schema-codemod.test.ts`
- `bash scripts/test-codemod-trpc-shared-output.sh`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:scripts:changed`
- `bun run docs:lint-coverage-map:check -- --check-eslint-reach --staged`
