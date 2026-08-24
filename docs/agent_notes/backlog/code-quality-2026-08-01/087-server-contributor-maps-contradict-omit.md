# 87. The server's contributor maps leave the homebrew validation boundary undefined, hide a socket handler's direct Prisma reads, and give the 46-file seed subsystem no map at all

Status: Not started
Theme: contributor orientation maps · Area: docs · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The server's local orientation system — the `MODULE.md` contracts the project
tells contributors to read before editing a surface — fails at three
independent ownership boundaries. A contributor who trusts the maps can
misplace new code at each of them.

**The router-layering rule is under-specified where it matters most.**
`routers-MODULE.md` says routers "own the wire surface (input/output
contracts, base-procedure choice, auth checks) and stay thin; business logic
lives in `packages/server/src/services/`". The homebrew import contract then
deliberately assigns per-entry payload validation and the fail-fast
`BAD_REQUEST` construction to the *router*. Both documents are right — per-entry
validation of untrusted input is input-contract work, which the general rule
already grants to routers — but neither one says so. A reader holding only the
general charter either concludes the homebrew router is in violation, or copies
the wrong side of the split when adding the next import-style procedure.

**The socket collaborator map omits persistence.** `socket/MODULE.md` lists
three external collaborators and states the module "does not own persisted
mutations". True for writes — but `campaign-room-handler.ts` imports the
singleton Prisma client directly and reads `campaignMember` rows in two
handlers. A contributor extending the socket layer, or mocking its
collaborators in tests, discovers the database dependency only by reading the
implementation's imports.

**The seed subsystem has no map.** `packages/server/src/seed/` mixes 46
non-test TypeScript files across five subdirectories — runtime seeders,
generators, backfills, parsers, generated outputs, and vendored JSON — with 18
test files and 21 JSON assets, and carries no `MODULE.md` or `README` at any
level. The thirteen-step runtime seed order exists only as an imperative call
list, and which files are hand-written versus generator-owned is recoverable
only from the provenance test's manifest. New contributors must reconstruct
every role boundary from imports and call order.

## Evidence

- `packages/server/src/routers/routers-MODULE.md:22-25` — "Routers own the
  wire surface (input/output contracts, base-procedure choice, auth checks)
  and stay thin; business logic lives in `packages/server/src/services/`". No
  sentence defines where per-entry payload validation of untrusted input falls.
- `packages/server/src/services/homebrew-import-MODULE.md:26-31` — the more
  specific contract (shape 2 in `services/README.md`) deliberately assigns to
  the router: auth, the size guard (`assertImportSizeWithinLimit`), per-entry
  validation, and the fail-fast `BAD_REQUEST` message. Neither doc cross-links
  the other on this point.
- `packages/server/src/socket/MODULE.md:47-53` — the "External collaborators"
  list names `@musi/shared/schemas/socket-events.ts`, `services/presence-service.ts`,
  and `utils/request-logger.ts`. No persistence entry.
- `packages/server/src/socket/MODULE.md:10-12` — "This module does not own
  persisted mutations; tRPC routers and services persist first" — accurate for
  writes, silent on reads.
- `packages/server/src/socket/campaign-room-handler.ts:14` —
  `import { prisma } from "../prisma/client.js";`, alongside the injected
  `PresenceService`.
- `packages/server/src/socket/campaign-room-handler.ts:78` — `campaign:join`
  authorizes membership via `prisma.campaignMember.findFirst`.
- `packages/server/src/socket/campaign-room-handler.ts:39` — the
  `presence:heartbeat` handler re-validates membership the same way, forcing a
  leave + departure announcements when membership is gone (`:44-56`).
- `packages/server/src/seed/` — 46 non-test TypeScript files, 18 test files,
  21 JSON assets, five subdirectories (`class-features/`, `data/`,
  `rules-glossary-parser/`, `spell-parser/`, `subclass-features/`), and no
  `MODULE.md` or `README` anywhere under the directory; re-measured with
  `git ls-tree` at the pin.
- `packages/server/src/seed/seed-srd.ts:237-253` — `seedSrd` encodes the
  thirteen-step runtime seed order solely as an imperative call list
  (`seedAbilityScoresAndSkills` through `seedMagicItems`).
- `packages/server/src/seed/seed-derived-provenance.test.ts:1-34` — the
  checksum attestation over `seed/data` JSON and generated modules; its header
  is explicit that it is "an attestation, not a drift gate" because the
  generators read a gitignored operator checkout.

## Proposed direction

Three doc-only commits, one per boundary; the seed map is the M-sized bulk.

1. **Homebrew layering: clarify, do not adjudicate.** There is no
   documented-decision conflict to resolve — `routers-MODULE.md:22-25` already
   grants routers "input/output contracts", and
   `homebrew-import-MODULE.md:26-31` assigns per-entry validation to the router
   as exactly that. Add one clarifying sentence to `routers-MODULE.md`'s
   Purpose section defining the boundary ("per-entry payload validation of
   untrusted input is input-contract work and may live in the router") and
   cross-link `homebrew-import-MODULE.md` as the worked example. Moving any
   validation code is explicitly out of scope: this audit already weighed
   relocating the router's validation block to the service and rejected it —
   the recorded contract won — so the clarification is the entire fix and
   describes a settled seam, not a pending one.
2. **Socket: document the persistence collaborator.** Add a persistence line
   to the External collaborators list in
   `packages/server/src/socket/MODULE.md` (`:47-53`): `campaign-room-handler.ts`
   reads `campaignMember` rows directly via the singleton `prisma` client for
   join authorization (`campaign-room-handler.ts:78`) and for heartbeat
   membership re-validation, which forces the leave/announce path
   (`campaign-room-handler.ts:39`). Refactoring the handler to injected
   persistence is out of scope.
3. **Seed: author `packages/server/src/seed/MODULE.md`.** Follow the
   `docs/module-docs.md` charter — a `Concepts:` line plus the required
   sections (Purpose, Data Flow, External Entry Points, State Ownership, Test
   Seams, Gotchas). It must be a real `MODULE.md`, not a `<name>-MODULE.md`
   flat-companion, because the directory has five subdirectories. Partition
   the 46 files by role rather than enumerating them:
   - runtime seeders (`seed-srd-*.ts`, `seed-users.ts`), with the thirteen-step
     runtime order **pointed at** `seedSrd` in `seed-srd.ts:237-253` as the
     source of truth — do not duplicate the call list in prose;
   - the four generators (`generate-class-features.ts`,
     `generate-srd-rules-glossary.ts`, `generate-srd-spells.ts`,
     `generate-subclasses.ts`);
   - the two backfills (`backfill-srd-monster-actions.ts`,
     `backfill-srd-spell-combat.ts`) plus `backfill-runner.ts`;
   - the parsers (`spell-parser/`, `rules-glossary-parser/`,
     `spell-splitter.ts`, `extract-monster-action.ts`);
   - generated outputs, governed by the `seed-derived-provenance.test.ts`
     checksum attestation;
   - vendored JSON under `data/`.

   The map must restate the seed pipeline's recorded decisions as settled
   facts, not gaps: there is deliberately no `:check` drift-gate script for
   seed provenance (the attestation cannot regenerate-and-diff because the
   generator inputs are a gitignored operator checkout); `seedRulesGlossary`
   sits deliberately outside the eight-function reference-table set; and the
   `worker-test-database.ts` `{1,6}` legacy regex variant stays. Run
   `bun run module:index` after adding the file so `MODULE-INDEX.md` picks it
   up.

## Scope / caveats

- **Doc-only.** No code moves anywhere in this leaf: the homebrew
  validation-vs-persistence seam move was already ruled out during this audit
  (the documented contract at `homebrew-import-MODULE.md:26-31` stands, so no
  cross-reference target exists for it), and converting
  `campaign-room-handler.ts` to injected persistence is a separate decision.
- **Point, do not restate.** The seed map duplicating the thirteen-step order
  or the file inventory in prose invites drift; enumerable facts belong to
  `seed-srd.ts:237-253` and the provenance manifest, and the map should point
  at them.
- **CQ25-220 is a binding constraint, not an overlap.** The prior pack's
  [`06-seed-pipeline-and-generators.md`](../code-quality-2026-07-25/06-seed-pipeline-and-generators.md)
  (Done 2026-07-29) settles seed-pipeline *implementation* caveats; this leaf
  adds contributor *orientation*. Describing its recorded decisions (no
  `:check` script, `seedRulesGlossary` outside the eight, the `{1,6}` variant)
  as open issues would effectively reopen do-not-reopen decisions — the map
  must present them as settled.
- **Coordinate with the backfill leaves on the same files.** The seed map
  should link the operator runbook from
  [097-two-database-writing-srd-backfill-commands.md](./097-two-database-writing-srd-backfill-commands.md)
  rather than author operator prose itself, leaving a pointer if that leaf has
  not landed;
  [203-add-previewapply-safety-boundary-srd.md](./203-add-previewapply-safety-boundary-srd.md)
  changes backfill behavior on the same files, so the map should describe the
  backfills' role, not their safety semantics.
- No dedicated seed/backfill guide exists under `docs/guides/` at the pin —
  guides mention seeding only incidentally — so the map may point at
  `docs/guides/per-worktree-dev.md` and `docs/guides/add-prisma-migration.md`
  where seeding intersects them, but should not claim a guide that does not
  exist.
