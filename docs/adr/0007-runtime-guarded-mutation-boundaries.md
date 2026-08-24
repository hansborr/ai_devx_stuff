---
id: ADR-0007
date: 2026-07-31
status: Accepted
enforced_by:
  - eslint-rule:local/concurrency-guard
  - restricted-import:RawTxClient
  - type-boundary:packages/server/src/utils/prisma-types.ts#TxClient
  - package-script:codemod:concurrency-guard
  - package-script:concurrency:relation-graph:check
  - test-file:packages/server/src/prisma/nested-write-guard.test.ts
  - test-file:packages/server/src/routers/invite-concurrency.test.ts
guide: docs/guides/add-race-sensitive-mutation.md
---

# Race-sensitive mutation boundaries include a nested-write runtime guard

## Context

ADR-0001 established helper-owned mutation boundaries for five delegates:
`characterStats`, `encounterParticipant`, `encounter`,
`characterSpellSlot`, and `characterClass`. Its restricted client types close
direct `update`, `updateMany`, `updateManyAndReturn`, and `upsert` calls, but
Prisma nested relation writes use generated parent update-input types instead
of the restricted target delegate. The author-time lint cannot see payloads
assembled through helpers or spreads, so it is useful diagnosis but not
runtime closure.

## Decision

The direct helper boundary from ADR-0001 remains mandatory. Business code uses
the matching `utils/*-mutations.ts` helper, and `RawTxClient` remains the
mutation-helper-only escape hatch. Pattern A locked writes and Pattern C atomic
claims retain the semantics documented in `docs/CONCURRENCY.md`.

Every query-capable Prisma client is constructed through
`createPrismaClient`, which installs a query extension before the result is
narrowed to `DbClient`. For root `update`, `updateMany`,
`updateManyAndReturn`, and `upsert`, the extension rejects a nested relation
route into one of the five gated models using the same four nested operations.
A checked-in generated artifact contains the relation subgraph that can reach a
gated model, the Prisma payload-envelope vocabulary, scalar names that collide
with that vocabulary, and canonical per-delegate repair suggestions. The repair
suggestions are hand-authored beside the gated policy in
`scripts/codemods/concurrency-guard/constants.ts`; generation requires exact
delegate coverage, live `docs/CONCURRENCY.md` anchors, and existing referenced
repo paths, and the always-on concurrency drift suite repeats that validation
against the live guide and tree. Both
runtime and lint walkers distinguish Prisma wrappers from model data and follow
only schema-known relation keys, while lint and the codemod scanner share the
generated repair guidance.

Violations throw `NestedWriteGuardError` with structural model, operation, and
relation-path metadata only. They are programmer errors that surface as
internal server errors; they are not concurrency conflicts. There is no
bypass, environment switch, configuration surface, telemetry, or raw client
factory. Constructor centralization, rather than a cast-defeatable client
brand, keeps the extension mandatory.

Nested create/delete variants and relation `connect`, `connectOrCreate`,
`disconnect`, and `set` remain outside this low-severity v1 policy. Prisma CLI
operations and raw SQL entry points are outside the query-extension boundary.

## Consequences

The lint remains an earlier, non-authoritative repair diagnostic, including a
lint-only regression corpus for its supported syntax. Helper/spread-assembled
and multi-hop payloads fail closed at runtime, including inside array and
interactive transactions. Production risk is bounded by schema-known
traversal, scalar-collision metadata, structural-only errors, and the narrow
operation list; arbitrary JSON is never recursively inspected.

Future policy for connect-style operators must first derive and validate
foreign-key ownership because the affected row depends on which side owns the
FK. Ownership parsing and inverse-pairing are deliberately absent until such a
policy exists. Follow the linked guide when extending either the helper-owned
delegate set or the runtime surface.
