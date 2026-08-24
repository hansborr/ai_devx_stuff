# Lane 03 — server package

Status: Dispatch material — not a schedulable note

**Scope.** `packages/server/src/` in full except `generated/`: services,
tRPC routers, socket layer, Prisma access patterns, auth helpers, utils;
`packages/server/prisma/` (schema, migrations, seeds);
`packages/server/scripts/`; plus the `packages/server` config surface
(tsconfig, vitest, package.json scripts). **Excluding**
`*.test.*`/`*.spec.*`/`*.test-helper.*` files — lane 06 owns test shape
repo-wide; pointer, not finding.

**Emphasis.** Business logic that leaked out of `services/` into routers or
socket handlers; service modules that grew past one responsibility; Prisma
query patterns repeated where a helper should exist; error-code and
Zod-parse conventions applied inconsistently across routers; socket
broadcast patterns that differ room-to-room without a reason; module and
folder organization a new contributor would misread; comment quality
(the SERVER-COMMENTS plan landed a sweep — find what it missed, don't redo
it).

**Known context.** Read `docs/authorization.md`, `docs/CONCURRENCY.md`, and
nearby MODULE.md files before judging intent — several shapes here are
deliberate (NOT_FOUND mismatch semantics, race-sensitive helper surfaces,
serializable-isolation corrections). Flag conflicts with docs rather than
assuming either side is right. Dedup against open leaves 03 and 07 and the
CONSTRAINTS rulings, which are dense for this package.
