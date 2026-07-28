---
id: ADR-0005
date: 2026-07-25
status: Accepted
enforced_by:
  - eslint-rule:local/no-barrel
  - package-script:codemod:expand-barrel
  - test-file:eslint-rules/no-shared-schemas-barrel.test.js
  - test-file:eslint-rules/no-barrel.test.js
guide: docs/guides/local-eslint-rules.md
---

# Shared package APIs use subpath exports, not broad barrels

## Context

`@musi/shared` originally re-exported everything through a root `index.ts`.
A client route that wanted one Zod schema imported the entire shared graph —
rules, dice, schemas, types — and left the bundler's tree-shaker as the only
thing standing between that import and a much larger cold-start bundle. Worse
than the size was the opacity: "why is this module in my bundle?" had no
answer a reader could trace, because every import resolved through the same
barrel.

The same shape recurs inside packages. An `index.ts` that re-exports its
siblings hides the real dependency edge behind a directory name, so a module
graph reads as folder structure rather than as actual references.

## Decision

`packages/shared` declares scoped subpaths in `package.json` `exports`
(`./schemas/*.js`, `./rules/*.js`, `./dice/*.js`, `./map/*.js`, `./test/*.js`,
`./constants`) and publishes no `"."` root entry. Client and server import from
the narrowest subpath that has the symbol. The removed `@musi/shared/schemas`
barrel stays removed: a restricted-import pattern rejects the bare specifier
while deliberately allowing every real subpath beneath it.

The missing root entry is load-bearing, so it is gated rather than assumed. No
lint rule can read a `package.json` `exports` map, and re-adding `"."` pointed
at one existing module would reopen the bare `@musi/shared` specifier without
creating a barrel any rule can see. The barrel-restriction test therefore also
asserts the manifest's export keys are all scoped subpaths and that `"."` is not
among them.

Inside packages, `index.ts` files do not re-export sibling modules. Imports name
the module that defines the symbol.

## Consequences

New shared code lands under a specific subpath; when none fits, add an
`exports` entry rather than widening a generic bucket. Renaming a subpath moves
the `exports` field and every call site together — there is no root barrel to
absorb the change, which is the point. Run
`bun run codemod:expand-barrel -- --barrel <path>` to replace an existing
barrel with direct imports. The barrel-restriction test resolves the real
`eslint.config.js`, so a well-meaning re-add of the pattern fails there rather
than silently widening the contract.
