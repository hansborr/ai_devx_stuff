# eslint-plugin-jsdoc 63 Upgrade

Status: Backlog
Date: 2026-05-28

## Why Parked

`eslint-plugin-jsdoc` 63 is a major plugin upgrade. The current repo usage is
small, but it runs in the local rule authoring lint surface, so failures can
block the lint system itself.

## Current Footprint

- Root dev dependency: `eslint-plugin-jsdoc` 62.9.0.
- Config use: `eslint-config/local-rule-authoring-configs.js`.
- Scope: `eslint-rules/*.js`, excluding local rule tests.
- Enabled rules:
  - `jsdoc/check-alignment`
  - `jsdoc/check-param-names`
  - `jsdoc/check-tag-names`
  - `jsdoc/check-types`
  - `jsdoc/no-undefined-types`
  - `jsdoc/require-param-name`
  - `jsdoc/require-param-type`
  - `jsdoc/require-returns-check`
  - `jsdoc/valid-types`

## Plan

1. Read the plugin changelog for 63.x and confirm its ESLint peer range.
2. Bump only `eslint-plugin-jsdoc` unless the changelog requires a companion
   ESLint upgrade.
3. Check for renamed rules, option schema changes, or changed defaults in the
   enabled rule subset.
4. Run the local rule authoring lint surface and update JSDoc comments only
   when the new rule behavior is clearly better.
5. Avoid broad `require-jsdoc` or prose-quality expansion in this task. New
   JSDoc policy belongs in separate lint-hardening work.

## Risk Areas

- The plugin may change how TypeScript names or imported ESTree types are
  resolved inside JSDoc comments.
- Local rule files are JavaScript with type-aware JSDoc comments, so parser or
  type-name assumptions can surface as lint-only failures.
- If this is done before ESLint 10, confirm the chosen plugin version still
  supports ESLint 9.

## Verification

- `bun install --frozen-lockfile`
- `bun run vitest run --project=eslint-rules`
- `bun run lint`
- `bun run lint:ratchet`
- `bun run verify:changed`
