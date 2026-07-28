# 53. Initiative ties need a DM-facing resolution workflow

Status: Decided — ready to schedule; not promoted (owner ruling 2026-07-27)
Theme: DM-facing combat workflow and explicit Musi rules policy · Area: shared + server + client + socket · Severity: low · Size: L

Source: final shared-cluster pre-merge panel and adjudication, 2026-07-27
(surfaced while reviewing slice E2) · Confidence: high

**Evidence in this leaf is pinned to `75bad57dc` (`main`), not the pack's
`883d48bf`.** The SRD passage, rule helper, policy tests and both server callers
were re-verified against that commit.

**The owner ruling and implementation consequences added in this decision pass
are pinned to `2decbb56a`, current `main` on 2026-07-27.** The current automatic
rule, both production callers and their policy comments were re-verified there.

## Problem

SRD 5.2.1 p.13 says: “If a tie occurs, the GM decides the order among tied
monsters, and the players decide the order among tied characters.” Musi exposes
neither choice. `sortByInitiative` instead applies two automatic rules:

1. on equal initiative, the higher initiative modifier acts first; then
2. on equal initiative and modifier, stable sort preserves the caller's input
   order.

Slice E2 correctly named both as **Musi policy**, added policy-bearing test
names, and added the corollary test proving that the same fully tied participant
set produces a different result when caller order changes. That satisfies
`docs/guides/change-rules-logic.md`; it does not resolve the rules gap. Naming a
substitute policy is not the same product decision as choosing whether the
substitute should exist.

The fallback is also less deliberate in production than the helper's contract
now makes it sound. Both callers pass raw
`prisma.encounterParticipant.findMany(...)` results with no `orderBy`:

- `executeRollAllInitiative` rolls every participant, then sorts and persists
  the resulting `sortOrder`;
- `activateEncounter` re-sorts already-rolled participants before starting
  combat.

Prisma does not promise an order for an unordered `findMany`, so a full tie in
either path resolves in whatever row order Postgres returns. That is not a
stable product policy: the same participant set can receive a different turn
order after a query-plan or storage-layout change with no application diff.

The current symptom is small and visible as tied-combatant ordering; there is no
data corruption or invariant violation. It is still a genuine rules gap because
turn order is observable gameplay and the SRD assigns the choice to people,
not to database row order.

The owner has now settled the policy direction: **the DM must be able to resolve
initiative ties.** The automatic modifier-then-caller-order behaviour is an
interim implementation, not the end state, and an explicit deterministic
secondary sort key is not the remedy. The work is a DM-facing tie-resolution
affordance.

That ruling deliberately does **not** claim to implement the SRD split. SRD
5.2.1 p.13 gives the GM the order among tied monsters and the players the order
among tied characters. Musi policy will give the DM resolution authority,
including where the SRD assigns tied-character choice to players. Whether
players should additionally be able to choose among their own tied characters
remains unsettled and must stay visible as a design sub-question.

## Evidence

- `docs/SRD_CC_v5.2.1.pdf`, p.13, “Ties” — the GM orders tied monsters and the
  players order tied characters. Re-verified from the checked-in PDF.
- `packages/shared/src/rules/initiative.ts:17-41` — explicitly classifies the
  modifier tie-break and caller-order fallback as Musi policy, records the SRD
  difference, and warns that both production callers are unordered.
- `packages/shared/src/rules/initiative.ts:48-60` — the comparator returns the
  modifier difference after initiative equality; a full tie returns `0`, so
  stable sort preserves input order.
- `packages/shared/src/rules/initiative.test.ts:42-80` — three policy-named
  cases pin higher modifier, caller order, and the absence of a deterministic
  secondary key.
- `packages/server/src/services/combat-actions/initiative.ts:17-22`,
  `:32-34`, `:46` — the roll-all caller documents the gap, performs an
  unordered `findMany`, and passes its result to `sortByInitiative`.
- `packages/server/src/services/encounter-combat/activate-encounter.ts:21-25`,
  `:35-37`, `:50` — the activation caller does the same.
- `packages/server/prisma/schema.prisma:1290-1292` — participants already carry
  `initiative`, `initiativeModifier` and persisted `sortOrder`; no migration is
  required for the deterministic-caller option.
- Commit `24fe5592` is the E2 review fix that named the policy and the unordered
  callers. It intentionally changed no behavior.

## Decided direction

Implement a DM-facing workflow that surfaces initiative ties, keeps the choice
pending, accepts a DM-selected order, validates it on the server and persists
the resulting contiguous `sortOrder` values. Equal initiative is the human
decision boundary; the current higher-modifier result may be useful as a
suggested initial presentation, but it must not silently finalize the order.
`sortByInitiative` should group or identify the tie instead of inventing the
final human decision.

This is a shared + server + client + socket feature, not the small
shared/server policy cleanup originally estimated:

1. Write red behavior tests for both production paths. Roll-all and encounter
   activation must surface the same tied set instead of converting it directly
   into a database-order-dependent final order.
2. Add a shared contract for the pending tie and its proposed/resolved order.
   The server must validate that the submitted participant ids are exactly the
   unresolved tied set and that the caller is the encounter's DM.
3. Persist the pending state until it is resolved. The storage shape and
   transaction boundary are design work; do not assume the existing participant
   rows are sufficient or that no Prisma migration is needed.
4. Give the DM a client affordance to arrange and submit the tied combatants,
   including loading/reconnection behavior while a resolution is pending.
5. Broadcast the persisted pending/resolved transition so every encounter
   viewer converges on the same state after persistence.
6. Re-read `docs/guides/change-rules-logic.md` and replace E2's temporary policy
   naming at `packages/shared/src/rules/initiative.ts` and both server call
   sites. The landed names must say that the DM resolves ties as **Musi policy**,
   explicitly contrast the SRD's GM/player split, and stop describing
   modifier-then-unordered-caller-order as accepted final behavior. Tests must
   carry the same policy statement.

The product direction is settled, but the interaction and encounter-state
design are not. Resolve these questions in a dedicated plan before
implementation:

- What state is the encounter in while a tie is unresolved, and which setup,
  activation, turn-advance or roll actions remain available?
- Is DM resolution required, or may the DM skip it and accept a displayed
  fallback order?
- If a tie is discovered after combat has begun, can its resolution reorder
  combatants retroactively within the current round, or only from a later
  boundary?
- Do players ever receive an affordance to choose among their own tied
  characters, as the SRD specifies, or is resolution exclusively DM-facing in
  Musi?

## Scope / caveats

- **E2 is complete and must not be re-opened.** Restoring `originalIndex`, its
  cast or its Stryker suppressions does not resolve this leaf; it only
  re-implements stable sort.
- **Do not add a hidden deterministic secondary key.** The owner chose a human
  decision, so an `orderBy`, participant id or other total ordering cannot close
  this leaf. A deterministic display default is not a persisted resolution
  unless the DM explicitly accepts it under the still-open required/skippable
  design.
- **Do not claim the higher-modifier rule is SRD or the selected end state.**
  The SRD names no modifier tiebreak, and the owner chose DM resolution.
- **The roll-all test must control randomness.** A full tie requires equal rolls
  at minimum; inject the existing deterministic `rng` rather than relying on
  chance. Include unequal modifiers at the same initiative so the test proves
  that the modifier is no longer an automatic final tiebreak.
- **Pending resolution is persisted state, not client-local dialog state.**
  Reloads, reconnects and multiple DM tabs must observe one authoritative
  unresolved/resolved transition.
- **This L estimate is provisional until the dedicated plan answers the state
  and UX questions above.** Do not hide schema, socket or client work inside a
  shared/server implementation slice.
- No sequencing dependency on another leaf. This is follow-on product work from
  E2's review, not unfinished shared-cluster work.
