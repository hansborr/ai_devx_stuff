# 8. Transaction-owning mutation orchestration lives inline in 8 routers, contradicting the services/ rubric the repo documents

Status: Done — the F4 pass (2026-07-25) extracted the last callback
transactions: `encounter-map.ts` (`linkParticipantToToken`,
`unlinkParticipantFromToken`, `autoLinkTokens`), `map-token.ts`
(`create`, `delete`), and `map.ts` (`delete`) now delegate to the new
`services/map-tokens/` module. **`auth.ts:223` is the only router
`$transaction` that remains inline by design** — it is the genuine trivial
batched `$transaction([...])` the scope caveat below describes.
Updated: 2026-07-25
Incremental extraction pass complete (2026-06-14, leaf-08 batch 4b): the three
clearest rubric matches now delegate to services, behavior-preserving —
`homebrew.ts` → `homebrew-import-service.ts` `persistImportedCollection` (the
two-pass cross-entry id resolver), `inventory.ts` → `inventory-service.ts` (owns
the `MAX_ATTUNED_ITEMS` `BAD_REQUEST` invariant on create/update), and
`encounter.ts` `addParticipant`/`updateParticipant` → `encounter-combat/participant-action.ts`
(owns the version-CAS participant write and the persistent-condition copy). A
signpost listing delegating-vs-inline routers was added to
`packages/server/src/services/README.md`.

C2 extraction complete (2026-07-19): `character.create`, `invite.join`,
`weaponMastery.set`, and `encounter.removeParticipant` now delegate their full
request-facing envelopes to services. The invite capacity claim retains its
compound `updateMany` CAS and awaited best-effort post-commit notification;
participant removal retains lock-before-derived-read ordering, blind-helper
reindexing, and its intentionally uncaught post-commit encounter broadcast.
The trivial batched `$transaction([...])` in `auth.ts` (session rotate)
remains inline by design per the scope caveat below.

F4 extraction complete (2026-07-25): the map surface followed. The C2-era
claim that `encounter-map.ts` held only a "sort-order batch" was stale —
by this pass it carried three *callback* transactions doing in-transaction
re-reads with documented concurrency invariants (the exact shape this
finding says belongs in a service), and `map.ts:delete` plus
`map-token.ts:create/delete` had accreted the same shape after the original
audit and were never in scope. All six now live in `services/map-tokens/`
(+ `MODULE.md`), a deep module organized around the one invariant they
share: every token<->participant link change must invalidate the
participant's captured turn origin in the same transaction. The extraction
was behavior-neutral — in-transaction link resolution, Pattern C compound
WHEREs and their `CONFLICT`s, `autoLinkTokens`' best-effort skip, the
sorted-id clear order, and every error code and message moved verbatim,
proven by error-contract characterization tests written and passing
*before* the move plus new fake-client tests covering the CAS branches that
were previously unreachable. `mapToken.update`/`move` and map
create/get/list/update stay inline as single non-racing writes owning no
transaction boundary.
Theme: server layering consistency · Area: server · Severity: medium · Size: L

Source: codebase maintainability/onboarding audit 2026-06-13 (lens: server-layering); evidence independently re-verified. · Confidence: high

## Problem
`AGENTS.md` and `packages/server/src/services/README.md` are explicit: orchestration that owns a transaction boundary, sequences multiple writes, or decides on broadcasts belongs in `services/` — and the README names "two-pass read/commit patterns" as a literal service trigger. Yet 8 production routers keep exactly that pattern inline. `encounter.ts` defines `executeParticipantWrite`, a `$transaction`-owning two-pass stats/participant orchestrator, and inlines `addParticipant`'s entire flow (DM auth, duplicate/validation checks, persistent-condition copy, sort-order, create + broadcast). `inventory.ts` owns two `$transaction`s enforcing `MAX_ATTUNED_ITEMS` with no inventory service existing at all. `homebrew.ts` inlines a two-pass cross-entry reference resolver inside a `$transaction` — the precise shape the rubric says to extract. Meanwhile `rest.ts` and `encounter-combat.ts` are thin one-line delegations to services. A new developer reading these side by side gets two contradictory mental models of "where mutation logic lives," with nothing marking which routers are the documented ideal and which are debt — so they cannot tell whether to follow the inline pattern or the delegating one, and risk piling more orchestration into a router because the neighbor already did.

## Evidence
- `packages/server/src/services/README.md:84-88` — the "Before adding a new service" rubric, question 1: "Does it orchestrate — own a transaction boundary, sequence multiple writes, or decide on broadcasts?"; `:22-23` — promotion criteria name "two-pass read/commit patterns" as a concurrency invariant warranting a module.
- `packages/server/src/routers/encounter.ts:127` — `executeParticipantWrite` (helper owning the participant write); `:143` — `prisma.$transaction(async (tx) => …)` doing the stats-update + locked participant write + re-read inside the router file; `:352` — `addParticipant` inlines `assertEncounterDm`, resolved-state check, character/homebrew validation, `getMaxSortOrder`, the persistent-condition copy (`:388-401`), the `create`, and the broadcast — all in the procedure body.
- `packages/server/src/routers/inventory.ts:68` — `assertAttunementLimit` enforces `MAX_ATTUNED_ITEMS`; `:192` and `:273` — two separate `$transaction`s (in `create` and `update`) that call it then write; no `services/*inventory*` file exists (verified: `services/` has no inventory file).
- `packages/server/src/routers/homebrew.ts:132` — `persistImportedCollection`; `:140` — its `$transaction`; `:173` — `resolveCrossEntryReferences`, the second-pass name→id resolver invoked at `:161` inside that transaction (the exact two-pass commit the README flags).
- `packages/server/src/routers/rest.ts:11-20` — contrasting thin delegations: `shortRest(ctx, input)` / `longRest(ctx, input)` to `services/character-live-state/rest.js`; `packages/server/src/routers/encounter-combat.ts:26-56` — every procedure is a one-line delegation to `services/encounter-combat/*` (the documented ideal).
- `rg -l '\$transaction' packages/server/src/routers/` returns 8 non-test routers owning inline transactions: `auth.ts`, `character.ts`, `encounter-map.ts`, `encounter.ts`, `homebrew.ts`, `inventory.ts`, `invite.ts`, `weapon-mastery.ts` (`auth.ts:223`, `character.ts:50`, `encounter-map.ts:128`, `invite.ts:144`, `weapon-mastery.ts:108` are the remaining five).

## Proposed direction
Fix the shape, not every router at once. This is layering debt, so the highest-leverage move is an incremental extraction guided by the existing rubric — do not rewrite all 8 in one pass.

1. **Pick the clearest rubric matches first** (the ones the README's own wording indicts): `homebrew.ts`'s `persistImportedCollection`/`resolveCrossEntryReferences` two-pass commit, and a new `inventory-service.ts` (flat service, per the README taxonomy — one concern, the `MAX_ATTUNED_ITEMS` invariant) owning the create/update attunement transactions. `encounter.ts`'s `executeParticipantWrite`/`addParticipant` likely belong in or beside the existing `character-live-state/` module since they already call into it.
2. **TDD, behavior-preserving.** These routers have existing coverage (`character-level-up.test.ts`, `rest-long.test.ts`, encounter/homebrew/inventory router tests). Before moving code, ensure each extracted procedure has a test pinning its observable contract (auth error codes, the `MAX_ATTUNED_ITEMS` `BAD_REQUEST`, the persistent-condition copy on `addParticipant`, the homebrew cross-entry id patching). Move the logic into the service, leave the router as a thin delegation matching `rest.ts`, and re-run the same tests — green without edits proves the extraction is faithful. Add a focused service-level test for any invariant that was previously only exercised through the router.
3. **Respect the package-flow and concurrency guides.** No `shared` changes are needed (schemas are the contract already). Read `docs/CONCURRENCY.md` and `docs/guides/add-race-sensitive-mutation.md` before relocating the locked/CAS writes (`updateParticipantStatsLockedWithExpectedVersion`, the attunement count-then-write) so the transaction boundary and isolation semantics move intact. Follow `packages/server/src/services/README.md`'s three-question rubric to decide flat-service vs. folder+`MODULE.md` for each extraction; document the `MAX_ATTUNED_ITEMS` and two-pass-resolver invariants in the new service/MODULE doc so the rule a future maintainer would break is written down.
4. **Leave a signpost.** After the first extractions, add a one-line note in `services/README.md` (or the routers' nearest orientation doc) listing which routers still hold inline orchestration as known debt, so a newcomer knows the delegating routers are the pattern to copy and the inline ones are not yet migrated.

## Scope / caveats
- This is a **server-layering / discoverability** finding, explicitly **not** a duplication or dead-code finding — none of the cited code is duplicated or unused; it is live, correct orchestration sitting in the wrong layer per the repo's own documented rubric. Duplication/dead-code is owned by `docs/agent_notes/backlog/drift-ai-findings/` and is not touched here.
- Distinct from the agent-friction and lint-debt backlogs: this is about human onboarding ("where does mutation logic live?"), not agent harness ergonomics or lint ratchets.
- Behavior must not change. Do not "improve" the concurrency model, error codes, or broadcast timing during extraction — preserve `NOT_FOUND`/`BAD_REQUEST` semantics (see `docs/authorization.md`) and the intentional last-writer-wins notes already in `encounter.ts`. Keep `auth.ts`/`character.ts`/`encounter-map.ts`/`invite.ts`/`weapon-mastery.ts` for later passes if their transactions are genuinely thin; the rubric (own a boundary AND sequence multiple writes AND non-obvious invariants) is the gate for which ones earn a service — a single trivial batched `$transaction([...])` may legitimately stay inline. Sequence the work one router per change so each is independently reviewable and revertable.
  - **Refreshed 2026-07-25 (F4).** As resolved, `auth.ts:223` (session rotate) is the *only* surviving example of the batched-transaction exemption; every other router named here has been extracted. The caveat is easy to over-apply, so note the failure mode this pass hit: a router cited as holding a "trivial batched `$transaction([...])`" had in fact been rewritten into callback transactions with in-transaction re-reads, and the stale caveat kept it out of scope for two passes. **Re-read the code before invoking this exemption** — it applies to the transaction shape found today, not to the shape the audit recorded.
