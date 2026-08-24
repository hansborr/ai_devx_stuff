# 190. Make combat history navigable through one paginated read model

Status: Not started
Theme: Paginated combat history · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Combat history has two competing read paths, and neither gives users a complete, efficient experience. Every encounter-detail query loads and serializes the entire combat-log relation, but the production client does not render that embedded array. The visible panel instead queries the paginated endpoint once and stops at its first page.

Because that endpoint currently starts with the oldest records, a long encounter shows its earliest 50 actions while newer actions remain behind a cursor the UI never follows. The unbounded payload grows on a hot encounter and combat-action response path, yet does not compensate for the unusable pagination.

## Evidence

- `EncounterDetail` optionally embeds a `logs` array (`packages/shared/src/schemas/encounter.ts:179-185`).
- `ENCOUNTER_DETAIL_INCLUDE` always loads `combatLogs` in ascending creation order with no `take` limit, and `mapEncounterDetail` always serializes the entire relation into `logs` (`packages/server/src/utils/encounter-query.ts:132-138`, `packages/server/src/utils/encounter-query.ts:265-285`).
- The dedicated list input defaults to 50 records, caps requests at 100, and accepts a cursor (`packages/shared/src/schemas/encounter-inputs.ts:275-292`).
- `listCombatLogs` applies `createdAt > cursor`, sorts by ascending round and creation time, fetches one extra row, and returns `nextCursor` (`packages/server/src/services/encounter-combat/combat-log.ts:90-108`). Its first default page is therefore the oldest 50 records.
- The encounter view executes one ordinary query and passes only `data.logs` from that page to the panel (`packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:233-236`, `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:264-272`).
- `CombatLogPanel` groups and renders the supplied records but exposes no continuation control (`packages/client/src/components/campaign/combat/combat-log-panel.tsx:247-291`).
- The repository already has an infinite-query pattern with `getNextPageParam: (lastPage) => lastPage.nextCursor` and page flattening (`packages/client/src/components/campaign/notes/notes-panel.tsx:239-252`).
- Attack, spell, turn, and initiative actions all reload encounter detail after committing, so the unbounded relation also inflates their response envelopes (`packages/server/src/services/encounter-combat/attack-action.ts:45`, `packages/server/src/services/encounter-combat/spell-action.ts:47`, `packages/server/src/services/encounter-combat/turn-action.ts:32`, `packages/server/src/services/encounter-combat/initiative-action.ts:30`).

## Proposed direction

1. Remove `logs` from `encounterDetailSchema` and remove `combatLogs` from `ENCOUNTER_DETAIL_INCLUDE`, `mapEncounterDetail`’s input shape, and its returned object. Make `listCombatLogs` the sole combat-history read model. Sweep encounter fixtures and server tests that currently construct or inspect the embedded field.

2. Change `listCombatLogs` to newest-first page retrieval:

   - Order by `[{ round: "desc" }, { createdAt: "desc" }]`.
   - Change cursor filtering from `createdAt > cursor` to `createdAt < cursor`.
   - Keep the existing default and maximum page sizes.
   - Add an explicit pagination case proving that the newest round is on page one and that the next cursor retrieves earlier history.

   Newest-first is required for live combat: with oldest-first pages, newly appended records remain outside the loaded window.

3. Convert the query in `encounter-detail-view.tsx` to the existing tRPC/TanStack infinite-query idiom using `listCombatLogs.infiniteQueryOptions` and `getNextPageParam`. Flatten the pages and reverse the accumulated descending window before passing it to `CombatLogPanel`, preserving chronological top-to-bottom rendering.

4. Add a “Load earlier history” control at the top of the expanded log list, wired to `fetchNextPage`, `hasNextPage`, and the pending state. Keep the existing round grouping and `data-testid="combat-log"` behavior.

5. Preserve socket-driven `invalidateEncounterCombatLogs` behavior. Update `packages/client/src/test/mock-trpc-encounter.ts`, whose list node currently provides only `queryOptions`, to expose the infinite-list shape already modeled in `packages/client/src/test/mock-trpc-helpers.ts:116-148`.

## Scope / caveats

- Out of scope: combat-log write paths, the optional `round` filter’s semantics, virtualization, and hardening cursor uniqueness for identical `createdAt` values.
- Removing `EncounterDetail.logs` affects `encounter.get` and all combat envelopes returning a refreshed encounter. Fixtures and tests must be migrated in the same change; production client code has no consumer to preserve.
- Reversing the flattened page window must not reverse entries within rounds incorrectly or change the panel’s chronological presentation.
- Invalidating an infinite query may refetch every loaded page after each new combat event. If that proves excessive, retain only or reset to the newest page during invalidation; do not let older loaded pages prevent fresh logs from appearing.
- There is no hard dependency on [024-encounter-inputs-monolith-spanning-three.md](./024-encounter-inputs-monolith-spanning-three.md) or [026-monster-provenance-invariants-disappear.md](./026-monster-provenance-invariants-disappear.md). Both touch `encounter-inputs.ts` for separate reasons, so ordinary rebase coordination is sufficient.
