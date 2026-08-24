# 45. Contracts are documented in comments that live away from the code enforcing them, and one header claims a compile-time guarantee the types do not give

Status: **Landed 2026-07-30 on branch
`feat/cq-server-comments-s14-s16`, merge `a01edb455`** through
[SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) slice **S14**, closing this
leaf; the plan shrinks it M→XS. **Steps 2 and 4 are dropped permanently**: the
five-pair transition union is type complexity for two correctly-marked
`interop` casts, and the three `*-mutations.ts` headers are three altitudes of
one contract, not three copies — both are durable rulings in
[CONSTRAINTS.md](./CONSTRAINTS.md). The "Sequencing with leaf 05" caveat is
answered: leaf 05 step 7 is dropped, so shape 5 stayed verbatim.
Theme: contract placement · Area: comments · Severity: medium · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Three of the server's most carefully documented contracts have the same
structural flaw: **the authoritative statement of the contract is a comment, and
that comment does not live in the file where the contract is typed or
enforced.** Once the prose is the authority, nothing checks it, and the three
sites show the three ways that fails.

**It can be false.** `packages/server/src/utils/encounter-state-mutations.ts`
opens by telling the reader that `setEncounterState` "enforces the 5 valid
transitions as a compile-time union derived from the `VALID_TRANSITIONS` tuple".
Neither half is true. There is no tuple —
`packages/shared/src/rules/combat.ts:8` declares `VALID_TRANSITIONS` as a
`Record<EncounterState, EncounterState[]>` — and the signature is built from two
*independent* unions, so it accepts the full 3×3 `from`/`to` cross product, not
five pairs. A second comment twenty-five lines down in the same file states this
correctly. Two comments in one file disagree, and the wrong one is first. The
reader who believes the header then finds
`packages/server/src/routers/encounter.ts` paying for the gap in cash: a 41-word
`type-assertion-boundary: interop` justification covering two `as` casts that
exist purely because `isValidTransition` is a runtime predicate whose narrowing
TS cannot see.

**It can be the third copy.** The three `utils/*-mutations.ts` files each open
with a 34-51 line header enumerating their write shapes, and
[`docs/CONCURRENCY.md`](../../../CONCURRENCY.md) restates the same contracts —
the `BlindParticipantFields` narrowing rationale and the turn-origin "exactly
three writer classes" invariant — at near-verbatim length. Three copies of a
concurrency invariant is three places to update and two places to be wrong.

**It can be split from its own types.** The Pino business-event log contract —
the dotted `event` vocabulary, the `actor` omission rule, the `outcome` enum —
is written out in full in `packages/server/src/app.ts`, the Fastify bootstrap,
which owns none of it. The file that *types* that vocabulary is
`packages/server/src/utils/request-logger.ts`: `AuthzOutcome` and `AuthzEvent`
are closed unions there, and `logAuthzDecision` / `logMutation` / `logBroadcast`
are the only emitters. `request-logger.ts` then points back at `app.ts` for the
contract it itself enforces. A reader arriving at either file is sent to the
other.

## Evidence

### The false compile-time claim

- `packages/server/src/utils/encounter-state-mutations.ts:21-22` — "`setEncounterState`
  enforces the 5 valid transitions as a compile-time union derived from the
  `VALID_TRANSITIONS` tuple." Part of the 37-line header at `:6-42`.
- `packages/server/src/utils/encounter-state-mutations.ts:44-45` —
  `type EncounterFromState = "setup" | "active" | "paused"` and
  `type EncounterToState = "active" | "paused" | "resolved"`, two independent
  unions; the signature therefore admits the whole cross product.
- `packages/server/src/utils/encounter-state-mutations.ts:47-54` — the correct
  statement, and it contradicts the header: "The compile-time signature accepts
  the full `from`/`to` cross product so callers with union-typed inputs (e.g.,
  `input.to` from a tRPC schema) can pass them without narrowing; runtime guards
  handle the rest."
- `packages/shared/src/rules/combat.ts:8-13` —
  `const VALID_TRANSITIONS: Record<EncounterState, EncounterState[]>`, a Record,
  not a tuple, and `resolved: []` is one of its four entries.
- `packages/shared/src/rules/combat.ts:15` — `isValidTransition(from, to):
  boolean`, a plain predicate returning `boolean`, not a type guard.
- `packages/server/src/routers/encounter.ts:190` — the 41-word
  `// type-assertion-boundary: interop` justification.
- `packages/server/src/routers/encounter.ts:192-193` — the two casts it covers:
  `from: from as "active" | "paused"` and
  `to: input.to as "active" | "paused" | "resolved"`.
- `packages/server/src/routers/encounter.ts:185-186` — the `setup → active` case
  is handled in a *separate* branch calling `activateEncounter`, not
  `setEncounterState`; `:191-194` is the `else` branch's `setEncounterState`
  call.
- `packages/server/src/services/encounter-combat/activate-encounter.ts:49` — the
  only other `setEncounterState` caller, passing `from: "setup"`, `to: "active"`
  as literals. Two callers total, and `encounter-state-mutations.ts:52-54`
  documents the broad signature as a deliberate accommodation for the
  union-typed one (the router).
- `packages/server/src/routers/encounter.ts:169-170` — a *separate*
  `type-assertion-boundary: prisma` cast widening `encounter.state` off the
  `EncounterRow` string column. It is not part of this finding and step 2 does
  not remove it; only the two `interop` casts at `:192-193` are in scope.
- `scripts/codemods/concurrency-guard/helper-shapes.ts:166`, `:222` — the
  Pattern C concurrency guard keys its expected compound-WHERE shape and its
  zero-count-CONFLICT check off the literal function name `setEncounterState`
  inside this file.

### The three-way restatement

- `packages/server/src/utils/participant-stats-mutations.ts:6-56` — 51-line
  header, "Six helpers, four shapes" at `:15`.
- `packages/server/src/utils/encounter-state-mutations.ts:6-42` — 37-line
  header enumerating five write shapes.
- `packages/server/src/utils/character-stats-mutations.ts:6-39` — 34-line header
  enumerating two helpers.
- `docs/CONCURRENCY.md:94-102` — the `BlindParticipantFields` narrowing
  rationale, restating `participant-stats-mutations.ts:151-173` almost verbatim
  (both name `conditions` as read-modify-write and both call the narrowing
  load-bearing).
- `docs/CONCURRENCY.md:104-129` — "Turn-origin columns are non-racing … exactly
  three writer classes", restating the header's shape-4 paragraph at
  `participant-stats-mutations.ts:43-55` at full length.
- `packages/server/src/utils/participant-stats-mutations.ts:221-231` —
  `setParticipantTurnOrigin`'s JSDoc says "shape 4 in the header" and
  deliberately does *not* re-enumerate the three writer classes.
- `packages/server/src/utils/participant-stats-mutations.ts:248-268` —
  `clearParticipantTurnOrigin`'s JSDoc carries material found in **neither** the
  header nor `CONCURRENCY.md`: the relink-leak scenario and the capture/clear
  serialization channel (`docs/CONCURRENCY.md:131` covers the protocol
  separately, but not this file-local statement of it).
- `packages/server/src/utils/participant-stats-mutations.ts:17-33` — shape 1 and
  shape 2 described side by side, the only place the "derives from fresh stats"
  vs "blind-writes client-supplied absolute values" choice is laid out as a
  choice.

### The split log contract

- `packages/server/src/app.ts:90-106` — the dotted `event` vocabulary, the
  `actor` shape and its omission rule on public auth-failure paths, the scope-id
  rule, the `outcome` enum (`allow`/`deny`/`success`/`failure`/`skipped`) with
  low-cardinality `reason`, and the `socket.broadcast`/`socketEvent` convention.
- `packages/server/src/app.ts:107-113` — redaction and one-log-per-boundary
  volume rules. This half *is* co-located with what `app.ts` owns: it sits
  directly after `LOGGER_REDACT_PATHS` (`:85-88`) and before
  `interface SerializedLogRequest` (`:115`).
- `packages/server/src/utils/request-logger.ts:27-32` — "Authz decisions follow
  the Pino business-event contract documented in `app.ts`…" (`:27-28`), plus the
  genuine extra fact that routing through one helper keeps the field shape
  consistent across `campaign-auth.ts`, `character-auth.ts`, and
  `encounter-combat-auth.ts`.
- `packages/server/src/utils/request-logger.ts:3` (`RequestLogger`), `:33`
  (`AuthzOutcome`), `:42` (`AuthzEvent`), `:80` (`logAuthzDecision`), `:109`
  (`logMutation`), `:138` (`logBroadcast`) — the whole vocabulary is typed and
  emitted here, in 143 lines.

## Proposed direction

Steps 1-2 are independent of 3-4 and can land in either order; within each pair
the order matters. Each numbered step is one commit.

1. **Delete the false sentence** (`encounter-state-mutations.ts:21-22`).
   Replace it with the accurate version already written at `:47-54`, or a
   pointer to it. Zero behavior change, zero risk, and it stops the header from
   misleading the next reader while step 2 is pending. Do this even if nothing
   else in this leaf lands.
2. **Then make the claim true, if it is worth making true.** Two things that
   look like one: dropping the router's casts, and making a five-pair
   compile-time guarantee exist. Only the second needs a type that actually
   enumerates the pairs. A helper returning
   `{ from: EncounterFromState; to: EncounterToState }` is *exactly* the 3×3
   cross product the header already misdescribes, so it would drop the casts
   while leaving the false claim just as false; and a TS type predicate narrows
   only the parameter it names, so `isValidTransition(from, to): from is …`
   cannot narrow `input.to`. Neither of those shapes is the fix.

   What works is a union of the legal pairs:

   ```ts
   type EncounterTransition =
     | { from: "setup"; to: "active" }
     | { from: "active"; to: "paused" }
     | { from: "active"; to: "resolved" }
     | { from: "paused"; to: "active" }
     | { from: "paused"; to: "resolved" };
   ```

   Derive it from `VALID_TRANSITIONS` rather than restating it. That requires
   re-declaring the constant
   `as const satisfies Record<EncounterState, readonly EncounterState[]>` in
   `packages/shared/src/rules/combat.ts:8`. Doing so widens nothing at runtime
   but does break `isValidTransition`'s body: a `readonly ["active"]` tuple
   rejects `.includes(to: EncounterState)`. Rewrite it as
   `.some((valid) => valid === to)` — do **not** reach for a cast to keep
   `.includes`.

   The mapped type must then drop the states with no outgoing transitions.
   `VALID_TRANSITIONS.resolved` is `[]`, so the obvious
   `{ [K in EncounterState]: { from: K; to: (typeof VALID_TRANSITIONS)[K][number] } }[EncounterState]`
   produces a sixth member `{ from: "resolved"; to: never }`. TS does not reduce
   that member away, so the router's `else` branch narrows `t.from` to
   `"active" | "paused" | "resolved"`, which is not assignable to
   `EncounterFromState` — `setEncounterState` stops compiling and the casts just
   removed come straight back. Guard the empty case:

   ```ts
   type EncounterTransition = {
     [K in EncounterState]: [(typeof VALID_TRANSITIONS)[K][number]] extends [never]
       ? never
       : { from: K; to: (typeof VALID_TRANSITIONS)[K][number] };
   }[EncounterState];
   ```

   The derived form groups by `from`
   (`{ from: "active"; to: "paused" | "resolved" }`), so it is mutually
   assignable with the five-pair union above but not structurally identical to
   it. Pin it with a compile-time assignment in each direction against that
   five-pair union rather than a type-equality helper, so a later edit to
   `VALID_TRANSITIONS` that widens the router's input fails typecheck instead of
   passing silently.

   Then add `parseEncounterTransition(from: EncounterState, to: EncounterState):
   EncounterTransition | undefined`, and have the router branch on the returned
   object: `t.from === "setup"` narrows to the single `setup → active` member
   (which keeps calling `activateEncounter`, per the caveat below), and the
   `else` branch narrows to the members whose `from`/`to` are already assignable
   to `SetEncounterStateOpts`. Both casts at
   `packages/server/src/routers/encounter.ts:192-193` and the marker at `:190`
   go with it.

   Leave `setEncounterState`'s own signature broad. The comment at `:47-54` is
   a deliberate accommodation and the second caller
   (`services/encounter-combat/activate-encounter.ts:49`) passes literals;
   narrowing the helper parameter to `EncounterTransition` is a separate,
   larger change and is not needed to remove the casts. Rewrite the header
   sentence from step 1 to what is then true: the *router* narrows through
   `parseEncounterTransition`, which returns one of the five pairs derived from
   `VALID_TRANSITIONS`.

   `VALID_TRANSITIONS` lives in shared rules, so read
   [`docs/guides/change-rules-logic.md`](../../../guides/change-rules-logic.md)
   before touching `packages/shared/src/rules/combat.ts`, and
   [`docs/guides/local-eslint-rules.md`](../../../guides/local-eslint-rules.md#type-assertion-boundary-marker)
   to confirm no marker is left orphaned. TDD: `combat.test.ts:16-65` already
   pins the complete 4×4 transition matrix — 16 `isValidTransition` assertions,
   5 true and 11 false. Every one of them must stay green through the
   `as const satisfies` change (`getValidTransitions` at `combat.ts:19` also
   reads the constant and is covered at `combat.test.ts:67-89`), and
   `parseEncounterTransition` coverage goes beside them before the router
   changes.
3. **Move the Pino vocabulary to where it is typed.** Move
   `packages/server/src/app.ts:90-106` to the top of
   `packages/server/src/utils/request-logger.ts`, above `RequestLogger`. Leave
   `:107-113` (redaction and volume) in `app.ts` next to `LOGGER_REDACT_PATHS`,
   where it belongs. Then trim `request-logger.ts:27-32` down to the authz-only
   fact it adds — that routing through this one helper keeps the field shape
   consistent across the three auth modules — deleting its "documented in
   `app.ts`" clause at `:27-28`, which becomes circular once the block moves.
   Leave a one-line pointer in `app.ts` to `utils/request-logger.ts` for readers
   who arrive at the bootstrap first;
   `docs/agent_notes/backlog/worktree-local-observability.md:22-23` points at
   `app.ts` for this contract and that pointer keeps it true.
4. **Collapse the three `*-mutations.ts` headers per paragraph.** For each of
   `participant-stats-mutations.ts:6-56`,
   `encounter-state-mutations.ts:6-42`, and
   `character-stats-mutations.ts:6-39`, keep the trust-boundary statement (this
   file is the sole sanctioned escape past `prisma-types.ts`'s type-level ban)
   and the helper-selection guidance, and replace the paragraphs that
   `docs/CONCURRENCY.md` already carries at full length with a pointer to the
   specific section. Expect roughly 60 lines removed, and check each paragraph
   individually rather than deleting whole headers. Read
   [`docs/CONCURRENCY.md`](../../../CONCURRENCY.md) and
   [`docs/guides/add-race-sensitive-mutation.md`](../../../guides/add-race-sensitive-mutation.md)
   first.

## Scope / caveats

- **Do not delete the `*-mutations.ts` headers wholesale, and do not assume a
  header paragraph is restated in the JSDoc of the function it describes.**
  `setParticipantTurnOrigin`'s JSDoc (`:221-231`) says "shape 4 in the header"
  and relies on the header for the three writer classes;
  `clearParticipantTurnOrigin`'s JSDoc (`:248-268`) adds the relink-leak
  scenario and the capture/clear serialization channel that appear in neither
  the header nor `CONCURRENCY.md`. Most importantly, the headers are the **only
  place a reader choosing between helpers sees shape 1 and shape 2 side by
  side** (`participant-stats-mutations.ts:17-33`) — the "derives from fresh
  stats" vs "blind-writes client-supplied absolute values" decision. That
  guidance stays.
- **Step 2 is optional and is the only part with real risk.** It is a
  production change to encounter state transitions, rated medium risk. If it is
  not being done now, step 1 still must be — a false header is worse than a
  correct one that documents a weaker guarantee.
- **Step 2 is less mechanical than it looks.** The router handles
  `setup → active` in a *separate* branch calling `activateEncounter`
  (`encounter.ts:185-186`); a `parseEncounterTransition` returning the narrowed
  pair must leave that branch intact rather than folding it into
  `setEncounterState`. Any refactor that routes `setup → active` through
  `setEncounterState` is out of scope and changes behavior.
- **Do not rename or relocate `setEncounterState`, and do not add a second
  `encounter.updateMany` call to that file, while doing step 2.**
  `scripts/codemods/concurrency-guard/helper-shapes.ts:166` and `:222` match the
  literal function name to decide the expected compound-WHERE fields and to
  require zero-count CONFLICT handling; an unrecognised helper in that file is
  reported as `pattern-c-helper-shape`. `parseEncounterTransition` is a pure
  function with no delegate call, so it is invisible to that guard — keep it
  that way.
- **Do not narrow `setEncounterState`'s parameter type as part of step 2.** The
  cross-product signature at `:44-45` is a documented accommodation for
  union-typed callers, not an oversight. The five-pair union belongs on
  `parseEncounterTransition`'s *return*, where the router consumes it; pushing
  it into the helper parameter forces every future caller to pre-narrow and is
  a different, larger decision.
- **Preserve the compound-WHERE / CAS rationale verbatim.** Every "Compound-WHERE
  on the expected `from` state so an invalid transition becomes CONFLICT instead
  of silently clobbering", the `assertTurnLock` `count=0` semantics
  (`encounter-state-mutations.ts:37-41`), the `conditions`
  read-modify-write reason
  (`participant-stats-mutations.ts:160-166`), and the "none bumps `version`"
  invariant are the concurrency oracle. Step 4 trims restatement, never these.
- **Step 3 is a move, not a rewrite.** Do not "improve" the vocabulary while
  moving it: `scripts/logs-audit/logs-audit-event-fields.ts` matches the
  `AuthzEvent` strings exactly (see `request-logger.ts:35-41`), so any edit to a
  literal is a behavior change to the log audit, not a comment change.
- **Do not delete `request-logger.ts:27-32` outright.** It is scoped
  specifically to authz decisions and adds a fact the moved block does not
  carry. Trim it to that fact.
- **Sequencing with leaf 05.** Leaf 05's optional step 7 merges the two
  `assertTurnLock` branches in `encounter-state-mutations.ts:209-264` — the same
  file whose header steps 1 and 4 rewrite, and shape 5 of that header
  (`:37-41`) is the prose description of exactly those two branches. If leaf 05
  step 7 is going to happen, land it first and then trim the header once;
  otherwise land this leaf's step 1 immediately and leave shape 5 verbatim.
- **Related leaves.** Leaf 44 covers the adjacent failure — comments citing
  authorities the reader cannot reach — including a `services/README.md` fix in
  the same package. No ordering dependency, but the two should not be worked
  concurrently in `packages/server/src/`. If leaf 40 (typed test factories) is
  in flight, note that step 2 touches transition coverage in shared, not the
  server suites it edits.
