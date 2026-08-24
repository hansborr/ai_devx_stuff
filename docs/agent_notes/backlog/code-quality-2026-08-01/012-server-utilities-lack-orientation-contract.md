# 12. The 46-file flat server utils directory owns authorization, race-sensitive mutation, and Prisma trust boundaries but has no MODULE.md to orient anyone

Status: Not started
Theme: module orientation contracts · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/server/src/utils/` is a flat directory of 46 direct non-test
TypeScript files that most server changes traverse, and it carries some of the
repo's most consequential contracts: the four authorization guard modules with
their ADR-0002 NOT_FOUND masking semantics, the six race-sensitive
`*-mutations.ts` capability files that are the sole sanctioned escapes past the
restricted Prisma delegates, the `prisma-types.ts` type-level write ban itself,
plus mapping, messages, chat, notification, query, and small primitive helpers.
Yet there is no `MODULE.md` — the directory's ownership map exists only as long
file-header comments and remote documents (`docs/CONCURRENCY.md`,
`docs/authorization.md`). The repo's own module-docs charter requires an
orientation doc for exactly this shape of surface: large folders and surfaces
that own transactions, locks, or cross-module contracts. Every other major
server area (`routers/`, `routes/`, `socket/`, `test/`, the deep services) has
one; utils — the largest undocumented application-source directory — is the
gap. A contributor landing here has no way to learn which of 46 files is a
trust boundary versus a convenience helper without reading headers file by
file, and no single place that names the sanctioned entry points callers must
use instead of raw Prisma writes.

## Evidence

- `packages/server/src/utils/` — 46 direct non-test TypeScript files at the pin
  (87 tracked `.ts` files minus `.test.ts` files, measured via
  `git ls-tree`), and no `MODULE.md`. Thirteen `*MODULE.md` files exist elsewhere
  under `packages/server/src/` (routers, routes, socket, test, and nine service
  areas); utils has none.
- `docs/module-docs.md:24-30` — the charter's "Where Required" list: large
  feature directories with several files, and surfaces that own transactions,
  locks, or cross-module contracts. Utils meets both clauses.
- `packages/server/src/utils/participant-stats-mutations.ts:6-56` — a 51-line
  header ("Six helpers, four shapes") is the only statement of the sanctioned
  write escape for `EncounterParticipant`, its mutation shapes, version-CAS
  locks, and the turn-origin writer classes. This depth exists per file, with
  no layer above it.
- `packages/server/src/utils/prisma-types.ts:3-31` — the restricted-delegate
  trust boundary: writes to five race-sensitive tables are a TypeScript error
  except through `utils/*-mutations.ts`; `RawTxClient` (`:34-39`) is the sole
  sanctioned escape, importable only by those files, each the single trust
  boundary for its table. The assignability ban is pinned by
  `packages/server/src/utils/__type-tests__/raw-client-widening-restrictions.ts`.
- `packages/server/src/utils/character-auth.ts:10-15` — `assertCharacterOwner`
  documents the ADR-0002 masking (NOT_FOUND for both missing characters and
  ownership mismatches); the same flat directory holds `campaign-auth.ts`,
  `encounter-combat-auth.ts`, and `note-auth.ts` with sibling semantics.
- Six race-sensitive mutation files sit undifferentiated among the 46:
  `character-class-mutations.ts`, `character-stats-mutations.ts`,
  `damage-mutations.ts`, `encounter-state-mutations.ts`,
  `participant-stats-mutations.ts`, `spell-slot-mutations.ts` — nothing but
  the filename convention distinguishes a capability file from a helper like
  `pick-defined.ts` or `string-order.ts`.

## Proposed direction

Add `packages/server/src/utils/MODULE.md` following
[`docs/guides/add-module-doc.md`](../../../guides/add-module-doc.md) and the
charter's standard sections (Purpose, Data Flow, External Entry Points, State
Ownership, Test Seams, Gotchas), written as a **family/trust-boundary map, not
a file-by-file tree**. Before writing, read a neighboring server module doc
(e.g. `packages/server/src/services/combat-actions/MODULE.md`) for depth and
link style, per guide step 2.

Group the 46 files into a handful of named families:

1. **Authorization guards** — `campaign-auth.ts`, `character-auth.ts`,
   `encounter-combat-auth.ts`, `note-auth.ts`; state the ADR-0002 NOT_FOUND
   masking semantics in one line and link
   [`docs/authorization.md`](../../../authorization.md) and
   [`docs/adr/0002-character-not-found-semantics.md`](../../../adr/0002-character-not-found-semantics.md).
2. **Race-sensitive mutation capabilities** — the six `*-mutations.ts` helpers
   plus the `prisma-types.ts` restricted delegates. State the `RawTxClient`
   rule — only `utils/*-mutations.ts` may import it; each file is the sole
   trust boundary for its table — and link
   [`docs/CONCURRENCY.md`](../../../CONCURRENCY.md) and the `__type-tests__`
   pin (`raw-client-widening-restrictions.ts`).
3. **Encounter/character query and domain helpers** — `encounter-query.ts`,
   `encounter-helpers.ts`, `encounter-participant-helpers.ts`,
   `character-campaign.ts`, `caster-resolver.ts`, `concentration-helpers.ts`,
   `prepared-spells.ts`, and kin.
4. **Mapping / messages / chat / notification helpers** —
   `character-mapping.ts`, `spell-mapping.ts`, `*-messages.ts`,
   `chat-helpers.ts`, `combat-chat.ts`, `notification-helpers.ts`,
   `socket-helpers.ts`, loggers.
5. **Small primitives** — `cookie.ts`, `crypto-rng.ts`, `pick-defined.ts`,
   `dice-error-wrap.ts`, `string-order.ts`.

In **External Entry Points**, name the sanctioned functions callers must use
instead of raw Prisma writes: `updateParticipantStatsLocked` and its siblings,
`updateCharacterStatsLocked`, `assertCharacterOwner`, etc. In **Gotchas**,
record that the deep contracts live in the file headers themselves — three
altitudes: `docs/CONCURRENCY.md` → `prisma-types.ts` → per-file mutation
headers — and that the MODULE.md is a pointer layer above them, not a
replacement.

Finish with `bun run module:index` and commit the regenerated
`MODULE-INDEX.md` (guide step 13). Verify with `bun run module:index:check`
and `bun run verify:changed`.

## Scope / caveats

- **Explicitly out of scope:** any code change, file moves/renames or
  subdirectory restructuring of utils, and any trimming or consolidation of
  the existing mutation-file headers.
- **Standing ruling (carried verbatim, binding):** do not trim or fold the
  `packages/server/src/utils/*-mutations.ts` headers into the new doc — the
  prior pack refused that trim permanently
  ([`code-quality-2026-07-25/CONSTRAINTS.md`](../code-quality-2026-07-25/CONSTRAINTS.md)
  line 38, via
  [`45-comments-compensating-for-code.md`](../code-quality-2026-07-25/45-comments-compensating-for-code.md)):
  a file-local helper-selection guide, the cross-cutting concurrency doc, and
  per-function JSDoc are three altitudes of one contract, not three copies.
  The MODULE.md summarizes each family in a line or two and links down.
- **Main regression risk:** the doc duplicating rather than pointing at the
  protected mutation headers and `CONCURRENCY.md`, creating a fourth altitude
  that drifts and re-tempts a future trim. Keep every boundary statement to
  one line plus a link. Secondary risks: a 46-file map degenerating into a
  churn-prone directory listing (the charter explicitly warns against
  restating the tree), and forgetting the `module:index` regeneration, which
  fails `module:index:check`.
- **Sequencing:** no hard edges. Soft:
  [`092-concurrency-rulebook-claims-three-exhaustive.md`](./092-concurrency-rulebook-claims-three-exhaustive.md)
  and
  [`099-concurrency-rulebook-mislocates-participant.md`](./099-concurrency-rulebook-mislocates-participant.md)
  fix accuracy issues in `docs/CONCURRENCY.md`, a doc this MODULE.md links to.
  Order-independent as long as the MODULE.md links `CONCURRENCY.md` by path
  and does not restate its specific claims — which the direction above already
  forbids.
