# eslint-plugin-jsdoc floor for local ESLint rules

Branch: `feature/jsdoc-plugin-eslint-rules`

Added `eslint-plugin-jsdoc@62.9.0` as a root devDependency and scoped it only
to `eslint-rules/*.js` implementation files through the existing local-rule
ESLint config block. Tests under `eslint-rules/*.test.js`, `scripts/`,
`packages/`, and other repo paths are not covered by this plugin block.

Pre-install audit found no `eslint-plugin-jsdoc` package in `package.json` or
`bun.lock`. `jsdoc-type-pratt-parser` was already present transitively through
`eslint-plugin-regexp`.

JSDoc shape audit:

- 18 implementation files are in scope; the larger `eslint-rules/*.js` count
  includes RuleTester tests.
- 18/18 implementation files use the type-only
  `/** @type {import('eslint').Rule.RuleModule} */` marker on the default
  export.
- 0/18 have a full descriptive JSDoc block attached directly to the default
  export.
- 16/18 have separate prose overview blocks near the top; `max-lines.js` and
  `no-barrel.js` are helper/type-only.
- The files mostly use terse helper `@param`, `@returns`, and inline `@type`
  annotations; roughly 62 helper `@param` blocks are type-only and have no
  description.

Starter rule set:

- `jsdoc/check-alignment`
- `jsdoc/check-param-names`
- `jsdoc/check-tag-names`
- `jsdoc/check-types`
- `jsdoc/no-undefined-types`
- `jsdoc/require-param-name`
- `jsdoc/require-param-type`
- `jsdoc/require-returns-check`
- `jsdoc/valid-types`

The set is deliberately syntax/name/type focused so it catches incorrect JSDoc
without forcing a documentation rewrite. `check-tag-names` does not use
`typed: true` because these are JavaScript `// @ts-check` files where `@type`
is intentionally needed. `require-jsdoc`, `require-description`,
`require-param-description`, broad `require-returns`, and return descriptions
remain off to avoid mass churn.

Spot check: temporarily changed `no-barrel.js` from
`@param {string} filename` to `@param {string} fileName`; `bun run lint --
--max-warnings=0` failed with `jsdoc/check-param-names`, then the typo was
reverted.

Verification:

- `bun run lint -- --max-warnings=0`
- `bun run lint:shell`
- `bun run lint:config-sensors`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run typecheck`
- `bun run docs:lint-guidance:check`
- `bun run docs:lint-coverage-map:check`
- Spot check: temporary `@param` typo failed `bun run lint --
  --max-warnings=0` on `jsdoc/check-param-names`, then was reverted.
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed` passed in 364s with
  the expected soft-budget warning.
