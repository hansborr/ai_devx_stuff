---
id: ADR-0006
date: 2026-07-25
status: Accepted
enforced_by:
  - test-file:eslint-rules/no-shared-schemas-barrel.test.js
  - test-file:eslint-rules/restricted-syntax-and-globals-config.test.js
guide: docs/architecture-plan.md
---

# packages/shared cannot depend on app or runtime adapters

## Context

Package flow is `shared` -> `server` -> `client`. `packages/shared` is the
layer both applications agree on: schemas, rules, constants, dice logic, shared
types. One import of a server module or a browser API from inside it inverts
that flow. The cycle is not always visible at the type level — a lone
`import type` compiles fine — but it makes the contract layer unbuildable in
isolation and drags a runtime into every consumer that only wanted a schema.

Runtime globals are the same failure in a different disguise. A `window` or
`localStorage` reference inside shared code type-checks against the DOM lib and
then throws the first time the server evaluates it.

## Decision

`packages/shared/src/**` may not import `@musi/server`, `@musi/client`, or
their subpaths, and may not import runtime adapters: `react`, `react-dom`,
`socket.io-client`, `@tanstack/*`, `@trpc/client`, `@trpc/server`. It may not
reference the browser globals `window`, `document`, `localStorage`, or
`sessionStorage`. Both restrictions apply to shared tests as well, because a
test that reaches for an adapter is evidence the module under test wants one.

Shared code also declares its own runtime dependencies: the extraneous-import
gate resolves them against `packages/shared/package.json` with
`devDependencies: false`, so a transitively-available package is not an
implicit dependency.

## Consequences

Code that needs a browser or server capability belongs in `packages/client` or
`packages/server`, with the shared layer holding only the contract it operates
on. When shared logic seems to need an adapter, the usual repair is to invert
it: take the value as a parameter or return a description the caller executes.
Both restriction blocks are asserted by resolving the real `eslint.config.js`,
so a flat-config rule replacement that silently drops them fails the gate
rather than the review. Adding a group to either ban means extending the
matching test in the same change.
