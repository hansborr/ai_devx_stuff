# 197. Shared must reject Node dependencies as rigorously as browser dependencies

Status: Landed on fix/cq-251
Theme: runtime boundary enforcement · Area: cross-cutting · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared` is intended to remain usable by both browser and server
consumers. Its lint boundary enforces the browser-facing half of that contract:
framework adapters and browser globals are forbidden. The same boundary does
not reject Node builtins or Node-only globals, while the package TypeScript
configuration makes Node ambient types available.

A contributor can therefore add `node:fs`, `Buffer`, `process`, or a `NodeJS`
type to production shared code and still compile and lint it. The mistake
surfaces later in a browser consumer rather than at the package boundary where
the repair is obvious. Production shared code is currently clean, so closing
the gate does not require a migration.

## Evidence

- `docs/adr/0006-shared-package-layering.md:15-24` — the accepted layering
  decision defines shared as the contract layer used by both applications and
  treats runtime-global coupling as a portability failure.
- `packages/shared/tsconfig.json:3-7` — the shared project explicitly includes
  Node ambient types.
- `eslint-config/package-boundary-configs.js:114-144` — the shared boundary bans
  cross-package imports and selected React, Socket.io, TanStack, and tRPC
  adapters, but contains no Node-builtin restriction.
- `eslint-config/package-boundary-configs.js:145-163` — its runtime-global list
  contains only `window`, `document`, `localStorage`, and `sessionStorage`.
- `eslint-config/restricted-syntax-policy.js:42-51` — the separate process
  policy covers only `process.exit(...)` and `process.env`; other `process`
  access and the other Node globals are outside it.
- `eslint-config/shared-policy.js:123-128` — shared production and
  test/helper tiers already have reusable, distinct file globs.
- `packages/shared/src` (measured at the pin) — 146 TypeScript/TSX files exist;
  72 remain after applying the configured test/helper exclusions, and none of
  those 72 matches Node builtin imports, `process`, `Buffer`, `NodeJS`,
  `__dirname`, or `__filename`.
- `packages/shared/src/test-tier-sentinel.test.ts:8-10` and
  `packages/shared/src/test-tier-sentinel.slow.test.ts:8-10` — the only matched
  Node-global uses are the two test-tier sentinels reading `process.env`.

## Proposed direction

Extend the shared runtime-neutrality boundary to ban Node builtin imports,
including canonical `node:*` specifiers, and the Node-only globals `process`,
`Buffer`, `__dirname`, `__filename`, and the `NodeJS` namespace in production
shared files. Preserve the existing browser-global and framework restrictions.

Add a production-only shared override using `sharedSourceFiles` with
`sharedTestAndHelperSourceFiles` ignored. Compose or repeat the existing
restricted-import and restricted-global entries deliberately: flat ESLint
configuration replaces a rule entry by key, so a later Node-specific block must
not erase the browser, framework, cross-package, or schemas-barrel bans.

Keep Node access available to the test/helper tier so the two tier sentinels
remain valid. Extend
`eslint-rules/restricted-syntax-and-globals-config.test.js` with resolved-config
and `lintText` probes that demonstrate:

- production shared files reject both prefixed and bare Node builtin imports;
- every named Node global/type namespace is rejected in production;
- all existing browser restrictions remain present in production and tests;
- a representative shared test file retains its intentional Node test access.

Update ADR-0006's decision text to state the now-enforced Node side of runtime
neutrality alongside its browser restrictions.

## Scope / caveats

- Do not remove `types: ["node"]` from the existing shared project in this
  leaf. Tests are compiled from the same `src` tree and the two tier sentinels
  intentionally require `process`; separating production and test TypeScript
  projects would be a larger change.
- This is an enforcement change with zero production cleanup at the pin, not a
  runtime refactor or a dependency migration.
- Keep test access narrowly tier-based. Do not weaken the existing rule that
  shared tests also cannot import browser/framework adapters.
- No 2026-07-25 leaf covers the missing Node half of this runtime boundary.
- Coordinate with
  [153-global-restricted-import-policy-survives.md](./153-global-restricted-import-policy-survives.md):
  build the production shared Node-builtin restriction through
  `restrictedImportsRule`; if this leaf lands first, leaf 153 must convert the
  new rule site while preserving its Node patterns, and if leaf 153 lands
  first, pass the Node patterns as composer extras.
- Coordinate with
  [157-shared-policyjs-grab-bag-unrelated-lint.md](./157-shared-policyjs-grab-bag-unrelated-lint.md):
  after the split, import `sharedSourceFiles` and
  `sharedTestAndHelperSourceFiles` from the focused path/glob module; if this
  leaf lands first, leaf 157 must retarget those imports when deleting
  `shared-policy.js`.
