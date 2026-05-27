# ESLint Entrypoint Exports

Status: Done
Order: 15

## Context

`eslint.config.js` re-exports shared policy data for non-ESLint tooling.
`scripts/drift/locator-usage.ts` has depended on that export for
`e2ePreferRoleSelectorAllowlist`.

The source review recommends keeping `eslint.config.js` as an ESLint entrypoint
only. Non-ESLint consumers should import from `eslint-config/shared-policy.js`
or a neutral policy module directly.

Coordinate with `05-derive-linted-script-reinclude-patterns.md` if
shared-policy exports or `eslint.config.js` imports have changed.

## Scope

- Re-audit `eslint.config.js`, `eslint-config/shared-policy.js`,
  `scripts/drift/locator-usage.ts`, and related tests.
- Update drift tooling to import `e2ePreferRoleSelectorAllowlist` from the
  shared policy module or another neutral owner.
- Remove the re-export from `eslint.config.js`.
- Keep ESLint config behavior unchanged.

## Definition Of Done

No non-ESLint tool imports policy through `eslint.config.js`, and the ESLint
entrypoint no longer exports shared policy data.

## Verification

- `bun test scripts/drift/locator-usage.test.ts`
- `bun run drift:e2e`
- ESLint config tests or resolved-config checks
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
