# 31. Fence `$queryRaw`/`$executeRaw` to sanctioned modules and migrate the inventory-router escapee

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: lint-rules · Area: server · Severity: high · Size: S · Confidence: high
Theme: raw-sql-boundary · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Raw SQL bypasses Prisma's typed layer and the schema contract; the repo already treats raw
access as a reviewable trust boundary for race-sensitive writes (`RawTxClient` may only be
imported by `utils/*-mutations.ts`), but `$queryRaw`/`$executeRaw` on the plain client are not
fenced at all. One production escapee already exists in a tRPC router file. Without a fence,
agents will reach for raw SQL wherever the typed API is awkward, and each new site is an
unreviewed injection/typing/migration-drift surface.

## Evidence
- Exactly 2 non-test raw-SQL sites in `packages/server/src` (verified
  `rg '\$(queryRaw|executeRaw)'`, 2026-07-01): 1 production —
  `packages/server/src/routers/inventory.ts:81` (`prisma.$queryRaw<InventoryAggregateRow[]>` in
  `getInventoryAggregates`, a helper inside the router file computing SUM/COUNT aggregates) —
  and 1 test-infra — `packages/server/src/test/prepare-test-db.ts:79`. The audit's "~2 real
  non-test sites" holds, with the nuance that only one is production code.
- The escapee is parametrized via `Prisma.sql` (`inventory.ts:65-74`), so it is injection-safe
  today, but it sits in a router, outside any sanctioned raw boundary, contradicting the
  "complex business logic in services" rule (AGENTS.md Working Model).
- Centralization precedent to mirror: `eslint-config/package-boundary-configs.js:148-180`
  (`rawTxClientBoundaryConfigs`) — files `packages/server/src/**/*.ts`, ignores
  `utils/prisma-types.ts` + `utils/*-mutations.ts`, message naming the sanctioned path.
- `packages/server/src/utils/prisma-types.ts:13-14`: "`RawTxClient` … the sole sanctioned
  escape. Only files matching `utils/*-mutations.ts` may import" it.
- No existing config restricts `$queryRaw`/`$executeRaw` (verified across `eslint-config/*.js`).

## Proposed direction
Config-only fence, no custom rule: add a `no-restricted-syntax` entry (selector
`MemberExpression[property.name=/^\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]`)
in a new config block alongside `rawTxClientBoundaryConfigs`, scoped to
`packages/server/src/**/*.ts` with an ignores allowlist for the sanctioned raw modules
(proposal: `utils/*-mutations.ts` plus `src/test/**` for test infra). Message names the
boundary and `docs/CONCURRENCY.md`. Include the `Unsafe` variants — those are the actual
injection risk and currently have zero uses. In the same commit, migrate the escapee: move
`getInventoryAggregates` + `buildInventoryAggregateWhereSql` from `routers/inventory.ts` into
`services/inventory-service.ts` (which already owns inventory business logic and 4
`$transaction` uses) or a `utils/inventory-mutations.ts`-style raw module, and add that file to
the allowlist.

## Scope / caveats
- If the escapee migration turns non-trivial (the helper is self-contained, so it should not),
  fall back to the house convention: land the fence as a lint-ratchet entry with the 1-finding
  baseline (`docs/guides/lint-ratchet.md`, "Adding a new rule to an already linted area") and
  drain it in a follow-up. With migration done, findings are zero → straight to normal lint.
- Decide whether the allowlist should be an ESLint `ignores` block (house pattern, per
  `rawTxClientBoundaryConfigs`) or `eslint-disable` per site — use `ignores`; per-site disables
  are the pattern the repo avoids.
- Does not attempt SQL-string analysis (injection linting); the fence is about module
  boundaries, and `Prisma.sql` tagged templates stay the required construction inside the
  boundary.
- One small commit: config block + escapee migration + a config-restriction test if the
  existing `eslint-config` test suite covers restricted-syntax entries
  (`eslint-rules/restricted-syntax-and-globals-config.test.js` is the model).
