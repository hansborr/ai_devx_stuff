# 11. Two large router suites both assert the encounterMap link/unlink/auto-link contracts, and one of them re-tests its own failure paths a second time

Status: Not started
Theme: single-authority test suites · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The encounterMap router's behavior — `linkParticipantToToken`,
`unlinkParticipantFromToken`, `autoLinkTokens` — is pinned by two big suites at
once. `packages/server/src/routers/encounter-map.test.ts` (912 lines) is the
procedure-contract suite: success, failure, and authorization cases per
procedure, plus a turn-origin invalidation block and an exact error-contract
block. `packages/server/src/routers/encounter-combat-map.test.ts` (744 lines)
was meant to be the encounter-router integration suite — does `mapId` flow
through `encounter.create`/`update`/`get`/`list` — but six of its eleven
describes re-run the same procedure contracts end to end: twelve repeated
link/unlink/auto-link/failure/authorization cases in total.

Neither file says which one is authoritative, so a contributor changing map
linking has to find and update both, and a reviewer has to diff near-identical
tests to see whether a divergence is intentional. Worse, the copies are not
identical: the combat-map file holds at least one assertion that exists nowhere
else (the link-overwrite semantics), so "delete the second copy" done naively
would silently shrink the contract surface.

The procedure suite also duplicates itself. Its early failure tests assert only
HTTP status (`400`/`404`); a later "error contract" describe re-creates the
same six failure scenarios from scratch to add exact tRPC code + message
assertions. One failure per contract is being paid for twice — two setups, two
places to update, and the weaker status-only assertion adds nothing the exact
one does not cover.

## Evidence

- `packages/server/src/routers/encounter-map.test.ts` — 912 lines;
  `packages/server/src/routers/encounter-combat-map.test.ts` — 744 lines
  (both re-measured with `wc -l`).
- Twelve procedure contracts asserted in both files
  (encounter-combat-map.test.ts line ↔ encounter-map.test.ts line):
  link success `151↔50`, link with no map rejected `187↔88`, token on wrong
  map rejected `210↔152`, player cannot link `244↔207`, auto-link success
  `275↔368`, auto-link skips already-linked `320↔439`, auto-link with no map
  rejected `368↔481`, unlink success `388↔235`, unlink with no linked token
  404 `430↔284`, player cannot unlink `453↔338`, unlink from wrong encounter
  `478↔308`, player cannot auto-link `532↔497`.
- The re-testing describes in `encounter-combat-map.test.ts` sit at lines
  150 (`linkParticipantToToken`), 274 (`autoLinkTokens`), 387
  (`unlinkParticipantFromToken`), 531 (`autoLinkTokens authorization`), 554
  (`autoLinkTokens skips non-character participants`), and 604
  (`linkParticipantToToken overwrite`) — spanning lines 150-661 of the file.
- The genuinely integration-scoped describes are lines 37 (`create with
  mapId`), 83 (`update with mapId`), 667 (`encounter.get returns mapId`), 691
  (`encounter.list returns mapId`), 721 (`mapId change in active state`).
- Unique contract hiding among the duplicates:
  `encounter-combat-map.test.ts:604-661` asserts that relinking a token
  overwrites the previous participant link (`dbBefore` is participant A at
  :647, `dbAfter` is participant B at :659). The closest encounter-map test
  (`encounter-map.test.ts:656-689`) relinks the same way but asserts only the
  cleared turn-origin columns, never the token's `encounterParticipantId`.
- Near-duplicate needing case-by-case comparison:
  `encounter-combat-map.test.ts:554-598` (two monster participants + generic
  token → `linked: 0`) vs `encounter-map.test.ts:408-437` (one monster
  participant + generic token → `linked: 0`).
- Intra-file duplication in `encounter-map.test.ts`: the `error contract`
  describe at lines 766-911 re-builds six failure scenarios already covered
  status-only earlier — `799↔88` and `900↔481` (`BAD_REQUEST` / "Encounter has
  no linked map"), `817↔116`, `841↔152`, `861↔308`, `883↔284` (`NOT_FOUND`
  with four distinct messages). The earlier copies assert bare status codes
  (e.g. `expect(res.statusCode).toBe(400)` at :113, inside the test starting
  at :88).
- The error-contract header comment (`encounter-map.test.ts:755-764`) records
  a deliberate asymmetry the block pins: `linkParticipantToToken` rejects a
  foreign participant with "Participant not found" (:838) while
  `unlinkParticipantFromToken` uses "Participant not found in this encounter"
  (:880); the messages originate in
  `packages/server/src/services/map-tokens/participant-links.ts` (e.g. :56).
- The reusable pieces for the fix already exist inside the error-contract
  block: `errorOf` (`encounter-map.test.ts:767-773`, carrying a
  `type-assertion-boundary: test` marker at :768) and `post` (:775-786).
- Both suites already share the same setup surface —
  `setupEncounterTestContext`/`addParticipant` from
  `packages/server/src/test/encounter-test-helper.ts` and `createMap` from
  `packages/server/src/test/map-test-helper.ts` (imports at
  `encounter-map.test.ts:8-15`, `encounter-combat-map.test.ts:8-16`) — so
  migrated tests port with little adaptation.
- `packages/server/src/routers/routers-MODULE.md:90` documents the
  `encounterMap` router boundary ("Participant↔token bridge … Ties encounter
  participants to map tokens only") but says nothing about the test split.

## Proposed direction

Make `encounter-map.test.ts` the single authority for encounterMap procedure
contracts (link/unlink/auto-link: success, failure, and authorization cases),
and narrow `encounter-combat-map.test.ts` to encounter-router `mapId`
integration only — its `create with mapId`, `update with mapId`,
`encounter.get returns mapId`, `encounter.list returns mapId`, and `mapId
change in active state` describes stay.

1. **Migrate, then delete, the combat-map procedure re-tests case by case.**
   The six describes at `encounter-combat-map.test.ts:150-661` go, but before
   deleting each test, compare it against its `encounter-map.test.ts`
   counterpart (pairings in Evidence) and move any strictly stronger or unique
   assertion into the corresponding describe there. At minimum the
   `linkParticipantToToken overwrite` case (:604, the only place the
   token-pointer overwrite semantics are asserted) must move, not die. For
   `autoLinkTokens skips non-character participants` (:554), compare against
   `encounter-map.test.ts:408` — the same `linked: 0` contract with one
   monster instead of two — and either merge or migrate the stronger variant.
2. **Collapse the intra-file duplication in `encounter-map.test.ts`.** Hoist
   the `errorOf`/`post` helpers from the `error contract` describe (:766-911)
   to file scope — the `type-assertion-boundary: test` marker comment at :768
   must survive the hoist — then upgrade the earlier status-only failure
   tests (e.g. the assertion at :113) to exact code + message assertions and
   delete the now-redundant error-contract block. End state: one failure test
   per contract, asserting both code and message.
3. **Mark the boundary.** Keep both files and their setup helpers
   (`encounter-test-helper.ts`/`map-test-helper.ts`) as-is, and add a short
   header comment in `encounter-combat-map.test.ts` stating its
   integration-only scope, so the division of authority is copyable for
   outside readers.

Verify with
`bun run test -- packages/server/src/routers/encounter-map.test.ts packages/server/src/routers/encounter-combat-map.test.ts`,
and produce a before/after list of test titles proving only genuine duplicates
were removed.

`routers-MODULE.md` needs no edit (it describes the router, not the test
split), but read it per the repo rule before editing files in
`packages/server/src/routers/`.

## Scope / caveats

- **Out of scope:** any change to router or service code
  (`encounter-map.ts`, `services/map-tokens/`); any restructuring of the
  shared encounter/map test helpers — helper promotion around this suite
  (the `OriginColumns`/`CLEARED_ORIGIN`/`readOrigin` cluster) is already
  tracked as the prior pack's optional slice 40.3 in
  [`../code-quality-2026-07-25/40-PLAN.md`](../code-quality-2026-07-25/40-PLAN.md)
  (leaf
  [`40-test-payload-factories.md`](../code-quality-2026-07-25/40-test-payload-factories.md));
  and the turn-origin invalidation describe
  (`encounter-map.test.ts:527-753`), which is unique and stays untouched.
- **Main risk:** deleting a combat-map case that is the only coverage of a
  distinct behavior (overwrite semantics, non-character skip, or a failure
  path whose setup differs subtly), silently shrinking the contract surface.
  The case-by-case migrate-then-delete discipline in step 1 is the
  mitigation, and the before/after test-title diff is the proof.
- **Secondary risk:** when folding the error-contract block into the earlier
  tests, keeping the weaker status-only assertion instead of the exact
  code + message one, or flattening the intentional NOT_FOUND-vs-BAD_REQUEST
  mismatch semantics — `docs/authorization.md` documents deliberate
  `NOT_FOUND` responses for existence-leak avoidance, and the error-contract
  header's message asymmetry (:755-764) is pinned on purpose. Preserve both.
- Mutation-testing and coverage scores over these routers may shift as
  duplicate tests disappear; that shift is expected and is not by itself a
  regression signal.
- No sequencing edges against other leaves in this pack.
