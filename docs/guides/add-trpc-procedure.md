# Add A tRPC Procedure

Use this path when adding or changing a query or mutation in
`packages/server/src/routers/`.

To find which router a new procedure belongs in — how the router surface is
partitioned and which file owns which mount key — see
`packages/server/src/routers/routers-MODULE.md`. This guide covers the
authoring *mechanics*; that doc is the *map*.

For a worked reference, read the `encounter` slice in build order — it
exercises every step below on real code:

- shared contract: strict inputs in
  `packages/shared/src/schemas/encounter-inputs.ts` and named output schemas
  in `packages/shared/src/schemas/encounter.ts`, with tests beside each;
- server service: `packages/server/src/services/encounter-combat/` holds the
  combat business logic, tested in place;
- router: `packages/server/src/routers/encounter-combat.ts` is the exemplary
  delegating shape — the services taxonomy
  (`packages/server/src/services/README.md`) names it the documented ideal:
  every procedure is a one-line call into the service, shared input/output
  schemas are imported from concrete files, and auth checks and
  post-commit broadcasts are owned by the service. Its sibling
  `encounter.ts` shows the thin read shape (`get` is fetch, auth helper,
  mapper) plus one-line participant-write delegations. In particular,
  `packages/server/src/services/encounter-combat/participant-action.ts`
  `removeParticipant` is the request-facing pattern to copy: the service owns
  authorization, the lock/delete/reindex transaction, and the post-commit
  broadcast while the router remains a thin pass-through;
- client: `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx`
  consumes `trpc.encounter.get` through TanStack Query.

1. Put the wire contract in `packages/shared/src/schemas/`. Inputs live in a
   `*-inputs.ts` file and must be strict shared schemas. Outputs should be
   named result/detail/summary schemas that describe the response returned to
   the client.
2. Import shared schemas from their concrete source file, for example
   `@musi/shared/schemas/campaign-inputs.js`, not from a barrel.
3. Pick the narrowest base procedure: `publicProcedure` only for unauthenticated
   surfaces, otherwise `protectedProcedure`.
4. Chain `.input(inputSchema)` when the procedure accepts client data.
5. Chain `.output(outputSchema)` on every query and mutation. Avoid `z.any()`,
   top-level `z.unknown()`, and schemas that accept `undefined`.
   Shared output schema consts should use one of the suffixes understood by
   `codemod:trpc-shared-output`: `OutputSchema`, `ResponseSchema`,
   `ResultSchema`, or the generic `Schema`.
6. Keep router code thin. Put complex business behavior in
   `packages/server/src/services/` or an existing `utils/*-mutations.ts`
   helper when the write is race-sensitive.
7. Use the campaign and character auth helpers before persistence. Preserve the
   existing `NOT_FOUND` semantics for ownership or access mismatches.
8. Broadcast socket events only after the committed write succeeds, and use the
   broadcast helper for the event family rather than direct `.emit(...)`.
9. Return data through a mapper/helper when Prisma rows need date, JSON, or
   relation shaping before crossing the wire.
10. Add or update tests at the contract surface: shared schema tests for tricky
    validation, server router/service tests for auth and behavior, and client
    tests when cache or UI behavior changes.

## Fetching one entity by id

When a router exposes a "fetch one entity by id" query, name it bare `get`
(invoked as `trpc.<entity>.get`). This is the repo standard — `character`,
`encounter`, `map`, `campaign`, `monster`, and `magicItem` all use it — so the
procedure name is predictable from the entity without opening the router. Do
not introduce `getById`, `getOne`, or other spellings for this operation.

Exemptions (sanctioned multi-noun routers): a router that legitimately fetches
*different shapes or resources* keeps its descriptive names rather than
collapsing them into a single `get`. Specifically:

- `homebrew.getCollection` / `homebrew.getEntry` — two distinct fetch shapes.
- `srd.getSpecies` / `srd.getClass` / `srd.getSpell` — per-resource SRD lookups
  (built from the `srdGetByIdProcedure` factory, but exposed under domain
  nouns).

These are deliberate exceptions, not drift; do not rename them to `get`.

Useful checks:

- `local/strict-trpc-input` blocks inline `.input(z.object(...))` schemas that
  omit `.strict()`.
- `local/trpc-shared-input-schema` requires router `.input(...)` schemas to be
  imported from `@musi/shared/schemas/...`. Router-local structural changes
  such as `.extend(...)`, `.merge(...)`, `.and(...)`, and `.or(...)` are
  blocked; move those shapes into shared schemas. For simple inline or
  router-local const schemas, run
  `bun run codemod:trpc-shared-input -- <router-file>`. If the domain already
  stores inputs in a non-`*-inputs.ts` shared schema module, pass
  `--target @musi/shared/schemas/<domain>.js`. Use
  `bun run codemod:trpc-shared-input -- --check` to list candidate router
  files and unsupported manual-move reasons before choosing a file.
- `local/trpc-shared-output-schema` reports router `.output(...)` schemas that
  are inline, router-local, or wrapped in the router. For simple inline objects,
  shared-schema arrays, or local const schemas, run
  `bun run codemod:trpc-shared-output -- <router-file>`. Move more complex
  response shapes into shared schemas manually. Use
  `bun run codemod:trpc-shared-output -- --check` to discover candidates, or
  `bun run codemod:trpc-shared-output -- --all` when all discovered output
  shapes are safe for the codemod to move.
- `local/trpc-require-output-schema` gives a line-local lint failure when a
  query or mutation reaches `.query(...)` / `.mutation(...)` without
  `.output(schema)`.
- The shared-schema barrel import ban blocks `@musi/shared/schemas`.
- `app-router.output-coverage.test.ts` requires every app-router query and
  mutation to declare a non-permissive `.output(...)`.
- Restricted Prisma delegate types and `RawTxClient` import checks guard
  race-sensitive write paths.
- `local/socket-registry-broadcasts` blocks direct emits for registry-owned
  socket events.

Run `bun run verify:changed` before calling the change done.
