# 46. Identifiers name the wrong thing: one word for two entities, one entity under two words

Status: **Scheduled work landed 2026-07-30 on branch
`feat/cq-server-comments-s14-s16`, merge `a01edb455` — stays open on optional S19
and S20.** [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) slices **S15 and
S16** delivered the two scheduled items, and the plan shrinks this leaf L→S.
S15 is the only user-visible behaviour change in the cluster. **Steps 1 and 3
remain optional** (S19, which also discharges leaf 05 step 3). **Steps 2, 4 and
5 are dropped permanently**, and **step 8 is replaced by optional S20**, which
extracts the five inline rect declarations and leaves the persisted `w`/`h`
spelling alone (a durable ruling in [CONSTRAINTS.md](./CONSTRAINTS.md)).
Client-cluster transfer: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md)
moved leaf 17 step 7 here because this leaf owns pure renames. The
[server/comments plan](./SERVER-COMMENTS-PLAN.md) accepts ownership but rules
the sweep opportunistic-only, not scheduled.
Theme: identifier vocabulary · Area: cross-cutting · Severity: low · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Eight sites across the server, the client canvas layer, and the verify-metadata
CLI share one defect: an identifier does not denote what it holds. The failure
comes in three shapes, and each shape costs a different kind of reader.

**One word bound to two different entities.** `combat-chat.ts:92` reads
`const action = await persistCombatChat(opts, msg.description, msg.action)` —
`action` is a `ChatMessage`, and `msg.action` in the same statement is the
combat-action label declared as `CombatChatBroadcast.action: string` at `:20`,
which is persisted into the row's `metadata` at `:67`. Two meanings, one
statement. `routers/srd.ts` binds `f` to a `ClassFeatureRow` at `:142` and to a
`FeatRow` at `:214` — separate function scopes 72 lines apart in one file, in a
domain where `ClassFeature` and `Feat` are separate Prisma models, so anyone
scanning the file has to keep checking which `f` they are on.
`srd-query-helpers.ts` destructures a bare `const fetch` in all three of its
procedure factories (`:38`, `:55`, `:72`), shadowing the global inside a Fastify
server process; the same factories name their Zod argument `item` (`:34`, `:50`)
or `output` (`:67`). Those two names genuinely denote different things — the list
factories wrap theirs in `z.array(...)` at `:39`/`:58`, so `item` is the array
*element* schema — but a bare `item` still reads as a domain object rather than
as a schema.

**One entity carrying two names on a single path.** `rest-service.ts`
builds a `ChatMessage` as `chatMsg`, renames it to `chatPayload` on the way out
of the transaction, and broadcasts it as `chatPayload` — twice, once for short
rest and once for long rest, with `broadcastRestChat` declared in that same file.

**A name that contradicts the value or the control flow.**
`finishTopLevelCommand` is invoked at the *top* of every command as
`return finishTopLevelCommand(ctx, {...})`; its body runs the command, logs, and
emits — it is the command envelope, not a finisher. Its two siblings in the same
file, `hasCharacterLiveStateSideEffects` and `emitCharacterLiveStateSideEffects`,
do describe themselves accurately, so it is the lone outlier.
`interface EpochWindow` in the verify-metadata CLI holds `startEpoch`,
`endEpoch`, **and** `exitCode` — a window plus an outcome — and both consumers
name the local `window`. The name is not wrong so much as half-true: it names
the timing half and silently drops the outcome half, so any replacement has to
carry both, not swap one omission for the other.

Two more sites are vocabulary drift rather than outright miscarriage.
`encounter-combat-auth.ts` uses two words for one role: the exported result type
and the log event say *combatant* (`EncounterCombatantResult`,
`authz.encounter.combatant`), while the argument and the deny reason say
*attacker* (`attackerParticipantId`, `not_attacker_owner`) even though the door
also serves spellcasting. Because the spell path routes
through the same door with `input.casterParticipantId`, a player casting with
someone else's caster is told *"Players can only attack with their own
character."* — a wrong user-facing message produced purely by the naming. And
`fogRegionSchema` spells its dimensions `w`/`h` while its sibling
`rectangleShapeSchema` in the same directory spells them `width`/`height`, which
collides inside one client file that emits both spellings — `width`/`height` for
a drawing rect at `tool-handlers.ts:65-66`, `w`/`h` for a fog rect at `:192`,
from local variables named `w` and `h` in both cases.

None of this is a bug (except the attack-worded spell denial). It is the tax the
next maintainer pays for having to open the implementation to learn what a name
already should have told them.

## Evidence

- `packages/server/src/utils/combat-chat.ts:92` — `const action = await persistCombatChat(opts, msg.description, msg.action)`; `persistCombatChat` returns `Promise<ChatMessage>` (`:56-60`), and the value goes straight to `broadcastChatMessage(io, room, action, …)` at `:94`. `CombatChatBroadcast.action: string` is declared at `:20` and persisted as `metadata: { action }` at `:67`. Sibling `const concentration` at `:98`, broadcast at `:100`. Both are block-scoped consts with no other references.
- `packages/server/src/routers/srd.ts:113` `mapSpecies(sp)`, `:120` `.map((st)`, `:125` `.map((sub)`, `:130` `.map((sst)`, `:142` `mapClassFeature(f: ClassFeatureRow)`, `:155` `mapClassListItem(c)` (with `narrowed` at `:156`), `:176` `mapClassDetail(cls)`, `:180` `.map((sc)`, `:181` `const ns = narrowSubclassEnumColumns(sc)`, `:197` `mapBackground(bg)`, `:214` `mapFeat(f: FeatRow)`, `:227` `mapEquipment(row)` — ten spellings for the same role; `row` at `:227` is the ready-made convention.
- `packages/server/src/utils/srd-query-helpers.ts:34` `item: TItem`, `:35` `fetch: (ctx: Context) => Promise<TRow[]>`, `:38` `const { item, fetch, map } = args`, `:39` `z.array(item)`, `:40` `await fetch(ctx)`; second factory repeats it at `:45-55` (`item: TItem` at `:50`, `fetch` at `:52`, destructure at `:55`, `z.array(item)` at `:58`). Third factory `srdGetByIdProcedure` at `:66-67` takes `output: TOutput` and passes it to `.output(output)` at `:75` unwrapped — the whole output schema, not the element schema the list factories take. Its `fetch` is declared at `:68` and destructured at `:72`.
- `packages/server/src/routers/srd.ts` — call-site counts: `item:` × 11, `fetch:` × 15, `output:` × 4 (`:263`, `:280`, `:372`, `:391`). Four of the 15 `fetch:` sites belong to `srdGetByIdProcedure` (calls at `:262`, `:279`, `:371`, `:390`), so the `fetch` spelling spans all three factories. Example at `:252` in `listSpecies`: `item: speciesDetailSchema` / `fetch: async (ctx) => …`.
- `packages/server/src/utils/srd-query-helpers.test.ts` — the factories' *other* consumer, and a second full set of call sites: `item:` × 6 (`:34`, `:51`, `:68`, `:88`, `:108`, `:125`), `fetch:` × 7 (`:52`, `:69`, `:127`, `:142`, `:158`, `:216`, `:232`), plus 5 shorthand `fetch,` properties (`:35`, `:90`, `:110`, `:183`, `:201`) fed by locals also named `fetch` (`:29`, `:81`, `:104`, `:178`, `:196`). 18 literal sites in this file alone. Six of the 12 `fetch` sites are `srdGetByIdProcedure` tests (`fetch:` at `:142`, `:158`, `:216`, `:232`; `fetch,` at `:183`, `:201`), which is also where the 6 `output:` properties sit (`:141`, `:157`, `:182`, `:200`, `:215`, `:231`).
- `packages/server/src/services/rest-service.ts:252` `const { result, chatPayload, loggedHp } = await ctx.prisma.$transaction(…)`; `:296` `let chatMsg: ChatMessage | null = null`; `:299` assignment; `:313` `chatPayload: chatMsg` in the returned object; `:320` `broadcastRestChat(…, chatPayload, …)`. Long-rest path repeats it verbatim: `:399` `let chatMsg` inside `runLongRestTransaction`, returned as `chatPayload` at `:416`, destructured as `chatPayload` at `:438`, broadcast at `:440`; the return shape is typed by `interface LongRestTxResult` (`:335-339`), whose field `chatPayload: ChatMessage | null` is at `:337`. `broadcastRestChat` is declared in the same file at `:118`, so the rename is confined to `rest-service.ts`.
- `packages/server/src/services/character-live-state/side-effects.ts:27-44` — `finishTopLevelCommand<T>` body: `await input.run()` → `logMutation(…)` → `await emitCharacterUpdate(…)` → `return result`. Siblings `hasCharacterLiveStateSideEffects` (`:14`) and `emitCharacterLiveStateSideEffects` (`:18`).
- **12** call sites in 5 source files: `spell-slot.ts:23`/`:40`/`:57`, `rest.ts:24`/`:45`, `sorcery-point.ts:42`/`:78`, `feature.ts:113`, `stats-conditions.ts:76`/`:116`/`:171`/`:215`. Test surface: `stats-conditions.test.ts` names it six times — import `:5`, comment `:21`, `vi.fn` mock `:25`, `const mockFinish = vi.mocked(finishTopLevelCommand)` `:31`, and two test titles at `:169` and `:195` (string literals the compiler will not flag); `feature-concurrency.test.ts:18` is a second `vi.fn` mock; `sorcery-point.test.ts:25` names it in an explanatory comment; `character-live-state/MODULE.md:56` explains it in prose. Nothing outside `character-live-state/` imports it.
- `scripts/lib/verify-metadata-core.ts:78-82` `interface EpochWindow { startEpoch; endEpoch; exitCode }`; `:84` `parseEpochWindow(startEpochArg, endEpochArg, exitCodeArg)`; `const window = parseEpochWindow(…)` at `:159` (`runStepMeta`) and `:181` (`runWrapperMeta`), each spread into `documentLine({ …, elapsed_seconds, exit_code })`.
- `packages/server/src/utils/encounter-combat-auth.ts:16` `EncounterCombatantResult`, `:28-34` `interface VerifyPlayerArgs` with `attackerParticipantId` at `:31`, `:36` `verifyPlayerCanAttack`, `:57` `"Attacker not found in this encounter"`, `:69`/`:88` `"Players can only attack with their own character"`, `:84` reason `not_attacker_owner`, `:100` `assertEncounterCombatant` with the `attackerParticipantId` parameter at `:103`.
- `packages/server/src/services/encounter-combat/spell-action.ts:18-23` passes `input.casterParticipantId` into that same door — the source of the attack-worded denial on the spell path.
- `packages/server/src/services/combat-actions/load-participants.ts:50` throws the *same* literal `"Attacker not found in this encounter"` from `loadAttackParticipants`, paired with `"Target not found in this encounter"` at `:53`. Auth runs first (`encounter-combat/attack-action.ts:18` calls `assertEncounterCombatant` before `executeAttack`), so this copy is a defensive second check on the attack-only path.
- `not_attacker_owner` has exactly four live occurrences outside this pack: `request-logger.ts:63` (the `AuthzReason` union member), `encounter-combat-auth.ts:84`, and `encounter-combat-auth.test.ts:391` (test title) / `:411` (assertion). `AuthzLogPayload.reason` is narrowed to `AuthzReason` at `request-logger.ts:72`, so a half-done reason rename is a typecheck error rather than a silent divergence.
- `packages/server/src/utils/request-logger.ts:42-50` is the `AuthzEvent` union (including `"authz.encounter.combatant"`); `:52-66` is the separate `AuthzReason` union. The comment at `:35-41` claims `scripts/logs-audit/logs-audit-event-fields.ts` matches these strings exactly, but that script carries no event or reason literals: it validates `reason` structurally at `:87-96` via `auditStableField` (a regex + length check at `:19-20`/`:45-46`) and only prefix-matches `authz.` at `:186`. The real enforcement is the union narrowing plus `packages/server/src/utils/__type-tests__/authz-vocabulary-restrictions.ts`. `packages/server/src/utils/encounter-combat-auth.test.ts` asserts `logger.byEvent("authz.encounter.combatant")` in 7 places (`:280`, `:301`, `:323`, `:341`, `:361`, `:379`, `:407`) — event-string assertions, untouched by a reason rename.
- `attackerParticipantId` is also a wire field name: `packages/shared/src/schemas/attack-roll-inputs.ts:61` and `:85`, `packages/server/src/services/combat-actions/types.ts:96`, threaded through client hooks (`packages/client/src/hooks/vtt-drawer/use-weapon-attack.ts:16`, `:37`, `:97`) and documented in `packages/client/src/hooks/vtt-drawer/MODULE.md:68`/`:71`. `encounter-combat/attack-action.ts:21` is the seam between that wire name and the auth helper's parameter.
- `packages/shared/src/map/fog.ts:22` `fogRegionSchema`, `w` at `:30` and `h` at `:32` (both documented `/** Width in grid cells (≥1) */` / `/** Height in grid cells (≥1) */`), consumed at `:88` in `isCellVisible` as `r.x + r.w`. Sibling `packages/shared/src/map/drawing.ts:66` `rectangleShapeSchema` ("Axis-aligned rectangle defined by top-left corner + dimensions") with `width`/`height` at `:70-71`.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:65-66` emits `width: w, height: h` for a drawing rect; `:139` declares `onFogRegionDrawn: (rect: { x; y; w; h }) => void`; `:171` `createFogHandler(onRegionDrawn: …)`; `:192` calls `onRegionDrawn({ x, y, w: …, h: … })`; `:300` feeds it `config.onFogRegionDrawn`.
- The same `{ x; y; w; h }` callback rect is re-declared, not imported, at four further sites: `packages/client/src/hooks/canvas-input/use-canvas-input.ts:41`, `packages/client/src/components/campaign/maps/map-canvas.tsx:35` (prop; threaded at `:48`/`:62`), and `packages/client/src/components/campaign/maps/map-fog-actions.ts:32` and `:47`.
- `packages/client/src/components/campaign/maps/map-fog-actions.ts:51` — `addFogRegion(fogLayer.data, { id: crypto.randomUUID(), ...rect })`. This spread is the **only** place a persisted `FogRegion` is built from the callback rect, and it works today purely because both spell the dimensions `w`/`h`. `:58-59` then compares the callback rect against stored regions (`r.x + r.w <= rect.x + rect.w`), mixing both objects in one expression.
- `packages/client/src/hooks/canvas-input/use-canvas-input-measure-fog.test.ts:119` — `expect(onFogRegionDrawn).toHaveBeenCalledWith({ x: 2, y: 1, w: 4, h: 4 })`; `packages/client/src/hooks/canvas-input/use-canvas-input.test-helper.ts:43`/`:52` supplies the spy.
- No `MODULE.md` in `packages/shared/src/map/` documents the short `w`/`h` spelling as deliberate. "Combatant" is already a code word in exactly one place — `encounter-combat-auth.ts` exports `EncounterCombatantResult` (`:16`) and `assertEncounterCombatant` (`:100`), which `spell-action.ts:5`/`:18` and `attack-action.ts:8`/`:18` import and `campaign-auth.ts:18`/`note-auth.ts:24` name in comments. Everywhere else it is informal prose (`packages/shared/src/schemas/encounter.ts:164`, `packages/server/src/utils/encounter-query.ts:247`), never a Prisma model, schema, or field name. Step 7 extends the vocabulary that file already owns; it does not introduce a new domain entity.

### Transferred client rename evidence

This subsection is newly re-resolved and pinned to `6cf8c78d5` (`main` at the
client-cluster bookkeeping pass); unlike the original leaf evidence above, its
anchors are not pinned to `883d48bf`.

- `rg -n '\bpid\b' packages/client/src --glob '!*.test.*'
  --glob '!*.test-helper.*'` returns **27 lines across 6 files**. The clearest
  collision is `components/campaign/encounters/encounter-detail-card.tsx:27-29`,
  whose three callbacks use `pid` immediately beside a correctly spelled
  `participantId` callback. `stores/combat-store.ts:10-11,31-35`,
  `components/campaign/combat/combat-map-bridges.ts:48-49`,
  `combat-map-content.tsx:114-121`,
  `tokens/token-context-menu.tsx:94` and
  `encounters/encounter-detail-view.tsx:90-116,211-212` carry the rest.
- A whole-word sweep misses **six camel-cased lines**:
  `encounter-detail-view.tsx:162-173` carries `hpPid` three times, in one of
  those same six files, and
  `hooks/vtt-drawer/use-weapon-attack.ts:93-98` carries `targetPid` three times
  in a seventh file. The complete verification is
  `rg -n '\bpid\b|[A-Za-z]Pid\b' packages/client/src`.
- The same encounter file also carries the single-letter half of the finding:
  `useParticipantHandlers` takes `m` at `:86-88` while
  `useHpDialogHandler` spells its sibling `mutations` at `:157`; local
  participants are `p` at `:90,95-97,113-119`; and `HpDialogSection` receives
  `p` at `:323-348`.

## Proposed direction

Ordered cheapest-and-safest first; land each step as its own conventional
commit. Steps 1, 2, 3 and 4 are file-local. Steps 5, 6, 7 and 8 each cross
files — step 5 into two consumers, step 6 into five callers plus mocks and a
MODULE doc, step 7 into the authz vocabulary union and its assertions, step 8
into six client files. Only the first four are the cheap ones.

1. `packages/server/src/utils/combat-chat.ts` — rename `action` → `actionMessage`
   and `concentration` → `concentrationMessage`. Both are block-scoped consts;
   the diff is four lines and removes the `action`/`msg.action` collision on `:92`.
2. `packages/server/src/services/rest-service.ts` — pick one name for the
   `ChatMessage` and use it end to end. `chatMessage` is the honest spelling
   (`chatPayload` suggests a wire payload it is not, and the value is a Prisma
   row). Change `let chatMsg` at `:296` and `:399`, the returned object keys at
   `:313` and `:416`, the `LongRestTxResult.chatPayload` field at `:337`, the
   destructures at `:252` and `:438`, and the `broadcastRestChat` argument name
   at `:118`. Whole rename is one file.
3. `packages/server/src/routers/srd.ts` — collapse the ten mapper-parameter
   spellings onto `row`, the convention already used by `mapEquipment` at `:227`.
   The `f`-is-two-entities hazard (`:142` vs `:214`) is the reason to do this;
   the rest is consistency that comes free in the same pass. Nested `.map()`
   callbacks (`st`, `sub`, `sst`, `sc`) can take the entity they iterate
   (`speciesTrait`, `subspecies`, `subspeciesTrait`, `subclass`) rather than
   `row`, since several are in scope simultaneously.
4. `scripts/lib/verify-metadata-core.ts` — rename `EpochWindow` →
   `TimedRunOutcome`, `parseEpochWindow` → `parseTimedRunOutcome`, and both
   locals `window` → `run` at `:159` and `:181`. Do **not** use `StepOutcome`
   or `RunOutcome`: those trade one half-truth for another, dropping the timing
   meaning that `startEpoch`/`endEpoch` carry and that
   `clampedElapsedSeconds(window.startEpoch, window.endEpoch)` consumes at
   `:167` and `:194`. `Step` is also wrong on its own — the interface serves
   both `runStepMeta` (`:154`) and `runWrapperMeta` (`:174`). The replacement
   has to name both halves or the rename is not worth doing. **Do not** justify
   this in the commit message as fixing a shadowed browser global: `window` is
   not a global in Node or Bun, and this file is a node-builtins-only CLI by its
   own header at `:16-18`. The rename stands on the type-name/field-set
   mismatch alone. Neither `EpochWindow` nor `parseEpochWindow` is exported, so
   this step is confined to one file — but the file is copied verbatim into
   sandbox repos by the shell tests (`:16-18`), so run the scripts smoke suite,
   not just the TS unit tests.
5. `packages/server/src/utils/srd-query-helpers.ts` — rename the `item`
   parameter to `itemSchema` in `srdListProcedure` (`:34`) and
   `srdListProcedureWithInput` (`:50`), and rename the destructured `fetch` to
   `query` or `load` so nothing shadows the global.

   **Do not rename `item` to `output`.** `srdGetByIdProcedure`'s `output`
   argument (`:67`) really is the whole procedure output — it goes into
   `.output(output)` at `:75` unwrapped. The two list factories instead pass
   `z.array(item)` (`:39`, `:58`) and type `map` as `(row: TRow) =>
   z.input<TItem>` (`:36`, `:53`), so `item` is the array *element* schema;
   `.output(z.array(output))` would name the element after the array, which is
   exactly the defect this leaf exists to fix. Leave the generic `TItem` alone
   too — it already names the element schema type correctly, and leaf 26 cites
   `z.input<TItem>` at `:36`/`:53`/`:69` by name.

   The `fetch` half is all-or-nothing across the file: the declarations at
   `:35`, `:52`, `:68` and the destructures at `:38`, `:55`, `:72` cover all
   three factories, and so do the call sites. This is a two-consumer rename,
   not a one-consumer one: update `packages/server/src/routers/srd.ts` (11
   `item:`, 15 `fetch:`, of which 4 belong to the `srdGetByIdProcedure` calls
   at `:262`, `:279`, `:371`, `:390`) **and** the 18 sites in
   `packages/server/src/utils/srd-query-helpers.test.ts` — 6 `item:`, 7
   `fetch:`, and 5 shorthand `fetch,` properties whose backing locals
   (`:29`, `:81`, `:104`, `:178`, `:196`) should be renamed with them rather
   than left as `query: fetch`; 6 of those 12 `fetch` sites are
   `srdGetByIdProcedure` tests. Nothing here is optional — a partial pass
   leaves the test constructing objects the factory no longer destructures, and
   TS will only catch that at the call sites it can see. Read
   `docs/guides/add-trpc-procedure.md` first — this is the shared procedure
   factory every SRD route goes through.
6. `packages/server/src/services/character-live-state/side-effects.ts` — rename
   `finishTopLevelCommand` to something that says it *runs* the command:
   `runTopLevelCommand` or `withCharacterCommandEnvelope`. Update the 12 call
   sites in `spell-slot.ts` (`:23`, `:40`, `:57`), `rest.ts` (`:24`, `:45`),
   `sorcery-point.ts` (`:42`, `:78`), `feature.ts` (`:113`) and
   `stats-conditions.ts` (`:76`, `:116`, `:171`, `:215`); all six references in
   `stats-conditions.test.ts` — import `:5`, comment `:21`, `vi.fn` mock `:25`,
   `mockFinish` binding `:31`, and the test titles at `:169` and `:195`, which
   are string literals the compiler will not flag; the second `vi.fn` mock in
   `feature-concurrency.test.ts:18`; the comment in `sorcery-point.test.ts:25`;
   and `character-live-state/MODULE.md:56` (see `docs/guides/add-module-doc.md`).
   One commit — a partial rename leaves the mocks pointing at a missing export.
7. `packages/server/src/utils/encounter-combat-auth.ts` — settle on the
   *combatant* vocabulary the exported type and the log event already use.
   Rename `VerifyPlayerArgs.attackerParticipantId` (`:31`) →
   `combatantParticipantId`, `verifyPlayerCanAttack` (`:36`) →
   `verifyPlayerControlsCombatant`, the reason code `not_attacker_owner` (`:84`)
   → `not_combatant_owner`, and the `assertEncounterCombatant` parameter at
   `:103`. Reword the two messages to cover both callers:
   `"Combatant not found in this encounter"` (`:57`) and `"Players can only act
   with their own character"` (`:69`, `:88`), updating the assertions at
   `encounter-combat-auth.test.ts:225`/`:237` and the two `not_attacker_owner`
   sites at `:391` (test title) and `:411`. This also fixes the attack-worded
   denial the spell path at `encounter-combat/spell-action.ts:18-23` currently
   produces.

   The reason code cannot move alone: `AuthzLogPayload.reason` is narrowed to
   the `AuthzReason` union in `request-logger.ts` (`:52-66`, member at `:63`) at
   `:72`, so rename both in the same commit or the build fails. While you are in
   that file, correct the comment at `:35-41`, which claims
   `scripts/logs-audit/logs-audit-event-fields.ts` "matches these strings
   exactly" — that script holds no event or reason literals any more (it
   validates `reason` structurally at `:87-96` and prefix-matches `authz.` at
   `:186`), and the real enforcement is this union plus
   `packages/server/src/utils/__type-tests__/authz-vocabulary-restrictions.ts`.
   Leaving the comment as-is sends the next reader to a file with nothing to
   change in it. Split the `reason` code change from the message change if you
   want the vocabulary edit reviewable on its own.
8. **Client-side fog dimensions only.** Spell the fog callback rectangle
   `width`/`height` to match the drawing rect emitted ~126 lines earlier in the
   same file, and translate to the persisted `w`/`h` at the one point where a
   `FogRegion` is constructed — plus the one comparison that reads both shapes
   at once. That callback shape is re-declared inline at five sites and asserted
   in a sixth, so all of these move together or none do:
   - `hooks/canvas-input/tool-handlers.ts` — `:139` (type), `:192` (emit), and
     `:171` `createFogHandler(onRegionDrawn)` renamed to `onFogRegionDrawn` to
     match the config key it is fed from at `:300`.
   - `hooks/canvas-input/use-canvas-input.ts:41` — same inline type.
   - `components/campaign/maps/map-canvas.tsx:35` — same inline type as a prop.
   - `components/campaign/maps/map-fog-actions.ts:32`/`:47` — same inline type,
     twice.
   - `components/campaign/maps/map-fog-actions.ts:51` — **the translation
     point.** `{ id: crypto.randomUUID(), ...rect }` currently spreads straight
     into `addFogRegion` and typechecks only because both spellings agree;
     it becomes an explicit
     `{ id, x: rect.x, y: rect.y, w: rect.width, h: rect.height }`.
   - `components/campaign/maps/map-fog-actions.ts:58-59` — the containment
     comparison reads `r.w`/`r.h` off stored `FogRegion`s and `rect.w`/`rect.h`
     off the callback rect in one expression; after the rename the two sides
     spell dimensions differently and the expression must be adjusted, not
     find-and-replaced.
   - `hooks/canvas-input/use-canvas-input-measure-fog.test.ts:119` — the
     `toHaveBeenCalledWith({ x: 2, y: 1, w: 4, h: 4 })` assertion, which is what
     will catch a half-done pass. Update it in the same commit.

   Consider extracting the shape once (e.g. `FogRectInput` beside the fog
   handler) instead of a sixth inline re-declaration; the five copies are the
   reason this step is bigger than it reads. Stop there — see caveats.
9. **Transferred from leaf 17; not scheduled.** If these files are already open
   for higher-value work, expand `pid` → `participantId`, `p` → `participant`
   and `m` → `mutations`, including `hpPid` → `hpParticipantId` and
   `targetPid` → `targetParticipantId`. This is opportunistic-only under
   [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md), not a session to
   promote on its own. Verify with the combined grep above; a bare whole-word
   check is insufficient.

## Scope / caveats

- **Do not rename `w`/`h` in `packages/shared/src/map/fog.ts`.** `FogLayerData`
  is persisted JSON; renaming the schema fields silently invalidates every stored
  fog layer. The client-callback half is the shippable slice; the persisted
  spelling stays, and the two meet at a single translation point
  (`map-fog-actions.ts:51`). If someone later wants the shared schema aligned,
  that is a Prisma data migration plus a tolerant read seam — a separate, much
  larger piece of work under `docs/guides/add-prisma-migration.md`, not part of
  this leaf.
- **Do not change the `"authz.encounter.combatant"` event string** in step 7,
  and do not touch the `AuthzEvent` union in `request-logger.ts:42-50`. That
  string is the stable identity of the audited log stream and is asserted 7
  times in `encounter-combat-auth.test.ts` (`:280`, `:301`, `:323`, `:341`,
  `:361`, `:379`, `:407`); those assertions stay exactly as they are through a
  reason rename. Step 7 touches the `AuthzReason` union (`:52-66`) only.
- **Step 7 stops at the auth helper's own parameter.** `attackerParticipantId`
  is also the wire field on `packages/shared/src/schemas/attack-roll-inputs.ts`
  (`:61`, `:85`) and `services/combat-actions/types.ts:96`, consumed by client
  hooks and documented in `hooks/vtt-drawer/MODULE.md`. Do not rename those —
  the attack path is genuinely an attack, and renaming a shared input schema is
  an API change, not a naming cleanup. Only `VerifyPlayerArgs.attackerParticipantId`
  (`:31`) and the `assertEncounterCombatant` parameter (`:103`) change;
  `encounter-combat/attack-action.ts:21` keeps passing
  `input.attackerParticipantId` into the renamed parameter.
- **Leave `services/combat-actions/load-participants.ts:50` alone**, even though
  it throws the identical `"Attacker not found in this encounter"` literal. That
  file is `loadAttackParticipants`, reached only from `executeAttack` on the
  attack path and only after `assertEncounterCombatant` has already passed, so
  its wording is correct for its caller and the two messages diverging is
  intentional. Grep will surface it during step 7; this is the answer.
- Step 7 is the only item with user-visible behaviour change (two error message
  strings). Follow TDD: the messages are asserted at
  `encounter-combat-auth.test.ts:225` and `:237`, and nowhere under `e2e/`.
  Everything else in this leaf is behaviour-preserving.
- Step 6 must not become a refactor. The tempting follow-on — hoisting
  `logMutation` + `emitCharacterUpdate` out of the envelope, or moving the call
  to the end of each command so the name "finish" becomes true — changes when the
  socket emit fires relative to the transaction. That is race-sensitive; read
  `docs/CONCURRENCY.md` and `docs/guides/add-socket-broadcast.md` before
  entertaining it, and do it as a separate leaf if at all. Here, rename only.
- Step 3 touches only local parameter names inside `srd.ts` mappers. Do not take
  the opportunity to restructure the `Prisma.*GetPayload` row types or the
  `narrow*EnumColumns` helpers while you are in there.
- These eight sites share a cause (identifiers that do not denote their value)
  but not a code path. They are grouped so one implementer can land the whole
  vocabulary sweep in one pass; steps 1-3 and 5-7 (server), step 4
  (harness/scripts), and step 8 (client) split cleanly into three leaves with no
  shared files if the whole sweep is too much for one slot. Size is **L**: step
  5 spans two consumers (26 sites in `routers/srd.ts`, 18 in
  `srd-query-helpers.test.ts`), step 8 spans six client files including the
  `FogRegion` construction point, and step 6 spans 12 call sites plus eight test
  references and a MODULE doc.
- **Sequencing with leaf 05.** Two collisions, both in `packages/server/src`:
  - Leaf 05 step 3 renames the *same* `routers/srd.ts` mapper parameters this
    leaf's step 3 renames (`sp`, `st`, `sub`, `sst`, `f`, `c`). One owner only.
    Leaf 05 step 3 proposes the same sweep over a narrower inventory (six
    spellings). This step is the one to implement: it covers all ten, including
    `mapClassDetail(cls)`, `mapBackground(bg)` and the nested `.map()` callbacks,
    and it fixes the target convention as `row`, already used by `mapEquipment`
    at `:227`. Do the sweep once.
  - Leaf 05 step 4 moves `services/rest-service.ts` into `services/rest/`,
    which is the file this leaf's step 2 renames values inside. Do the move
    first and rebase step 2 onto it; a rename inside a file that is about to be
    `git mv`'d costs a conflict for nothing.
- Step 5 also overlaps `routers/srd.ts` with leaf 05 step 6 (the optional
  family split) and with leaf 23's SRD schema work — land it before or after,
  not concurrently.
