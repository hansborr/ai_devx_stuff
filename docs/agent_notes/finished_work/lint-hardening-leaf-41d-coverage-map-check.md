# Leaf 41d: Coverage Map Drift Check

Date: 2026-05-20

## Summary

Added the read-only `docs:lint-coverage-map:check` gate for the Leaf 41 lint
coverage map and wired it into the local pre-commit / verify path. The check
now catches four classes of map drift:

- stale path/group literals and globs that no longer match tracked files;
- unknown `ratchet/...` IDs cited by the map;
- status cells outside the accepted lint-map vocabulary;
- tracked lint-map file extensions not covered by any map row.

The first live run surfaced four real drift findings in the map. This landing
fixed the map to match reality rather than loosening the check:

- The shared tests row no longer lists `*.test-helper.*`; shared helpers live
  under `packages/shared/src/test/**`, already covered by `test/**`.
- The server tests row now lists `**/*-test-helper.ts` instead of the dotted
  helper glob because server helpers use the hyphenated convention.
- The `package.json` row status is now exactly `linted`; the parked Leaf 20
  policy follow-up remains in the follow-up column.
- The Markdown guidance row now includes `packages/**/README.md` and its
  count includes the one nested package README,
  `packages/server/src/services/README.md`.
- The same self-check also forced explicit map rows for
  `scripts/lint-coverage-map-check.ts` and its test once those tracked files
  existed.

## Explicit Non-Goals

These stay deferred for this leaf:

- `Files` count re-derivation;
- normal-lint membership re-derivation from `eslint.config.js`;
- ratchet membership re-derivation beyond validating cited ratchet IDs.

Exit path: lift the deferred automation to a named follow-on leaf if the map
needs full regeneration later. Otherwise this check is the floor and should
stay as-is.

## Verification

- `bun run docs:lint-coverage-map:check`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run test:scripts:changed`
- `bun run typecheck`
