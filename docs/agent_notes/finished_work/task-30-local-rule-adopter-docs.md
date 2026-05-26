# Task 30: Local Rule Adopter Docs

Date: 2026-05-26

## Landed

Linked the authored local-rule guide to the generated local-rule catalog and
documented the JavaScript custom-rule format as an intentional ESLint bootstrap
choice.

- `docs/guides/local-eslint-rules.md` now points adopters to
  `docs/generated/local-lint-rules.md` for the current `local/*` rule catalog,
  principles, paired guides, and repair kinds.
- The guide now records that local rules stay as plain `.js` files with
  `// @ts-check` and JSDoc so ESLint can load them directly before any
  TypeScript compilation step, accepting less implementation type safety for
  direct bootstrap loading.

## Verification

- `bunx prettier --check --ignore-unknown docs/guides/local-eslint-rules.md`
- `bun run docs:lint-guidance:check`
- `bun run verify:changed`
