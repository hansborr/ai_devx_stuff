# Lint Hardening Leaf 4: ESLint Comments Hygiene

Completed: 2026-05-16.

## Inventory

`bun run lint` with the candidate eslint-comments rule block found eight
findings:

| Rule | Count | Files |
|---|---:|---|
| `eslint-comments/require-description` | 1 | `packages/server/src/utils/srd-query-helpers.ts` |
| `eslint-comments/require-description` | 2 | `packages/shared/src/map/area-template.ts` |
| `eslint-comments/require-description` | 1 | `packages/shared/src/map/grid-utils.ts` |
| `eslint-comments/require-description` | 2 | `packages/shared/src/rules/spellcasting.ts` |
| `eslint-comments/require-description` | 1 | `packages/shared/src/rules/xp.ts` |
| `eslint-comments/require-description` | 1 | `packages/shared/src/schemas/character.ts` |

No findings were present for `eslint-comments/no-aggregating-enable`,
`eslint-comments/no-duplicate-disable`, `eslint-comments/no-unlimited-disable`,
or stale disables.

## Result

- Installed `@eslint-community/eslint-plugin-eslint-comments`.
- Enabled `eslint-comments/require-description`,
  `eslint-comments/no-aggregating-enable`,
  `eslint-comments/no-duplicate-disable`,
  `eslint-comments/no-unlimited-disable`, and
  `eslint-comments/no-unused-disable`.
- Enabled `linterOptions.reportUnusedDisableDirectives: "error"` in a
  separate flat-config object so the global ignore block remains global.
- Added descriptions to eight `eslint-enable` comments.
- Updated `docs/ai-harness.md` with the new suppression-hygiene sensors.

`eslint-comments/no-unused-disable` stayed enabled. A stdin stale-disable probe
against the final config produced a single built-in unused-disable diagnostic
and no plugin duplicate, so the overlap does not double-report.

No placeholder suppression reasons were used.

## Verification

- `NODE_OPTIONS=--max-old-space-size=8192 bun run lint -- --no-cache` passed.
- `bash scripts/eslint-disable-register.sh /workspace` passed.
- Final required verification passed in the landing commit:
  - `bun run lint -- --max-warnings=0`
  - `bun run typecheck`
  - `bun run lint:changed`
  - `bun run verify:changed`
  - `bash scripts/eslint-disable-register.sh /workspace`
  - `bash scripts/test-eslint-disable-register.sh`
  - `bun run drift:ai --scope current` (exit 0 with two report-only duplicate
    warnings outside this leaf)

`bun run vitest run --project=eslint-rules` was not run because no local rule
implementation changed.
